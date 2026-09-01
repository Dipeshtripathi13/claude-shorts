import type { Provider, SearchOptions, ShortVideo } from '../types.js';
import { ProviderError } from '../types.js';
import { parseIsoDuration } from '../core/rank.js';
import { log } from '../log.js';

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * Official YouTube Data API v3.
 *
 * Two calls per search:
 *   search.list  - costs 1 unit from the 100/day Search Queries bucket
 *   videos.list  - costs 1 unit from the separate 10,000/day bucket
 *
 * There is no "is this a Short" flag in the API, so we over-fetch with
 * videoDuration=short (which means "under 4 minutes") and filter on the real
 * duration from contentDetails.
 */
export class YouTubeProvider implements Provider {
  readonly name = 'youtube';
  readonly quotaCost = 1;

  constructor(private apiKey: string, private verifyShorts = false) {}

  async unavailableReason(): Promise<string | null> {
    if (!this.apiKey) {
      return 'no YouTube API key set (run `shorts setup`, or set SHORTS_YOUTUBE_API_KEY)';
    }
    return null;
  }

  async search(opts: SearchOptions): Promise<ShortVideo[]> {
    const searchUrl = new URL(`${API}/search`);
    searchUrl.search = new URLSearchParams({
      key: this.apiKey,
      part: 'snippet',
      q: opts.query,
      type: 'video',
      videoDuration: 'short',        // < 4 min; real Shorts are a subset
      videoEmbeddable: 'true',       // must be playable in our iframe
      videoSyndicated: 'true',       // playable outside youtube.com
      safeSearch: opts.safeSearch,
      regionCode: opts.regionCode,
      relevanceLanguage: opts.relevanceLanguage,
      order: 'relevance',
      maxResults: String(Math.min(50, Math.max(10, opts.count * 4))),
    }).toString();

    const found = await this.getJson(searchUrl);
    const ids: string[] = (found.items ?? [])
      .map((i: any) => i?.id?.videoId)
      .filter((v: unknown): v is string => typeof v === 'string');
    if (ids.length === 0) return [];

    // One batched videos.list gives durations, view counts and canonical titles.
    const detailUrl = new URL(`${API}/videos`);
    detailUrl.search = new URLSearchParams({
      key: this.apiKey,
      part: 'contentDetails,snippet,statistics,status',
      id: ids.join(','),
      maxResults: '50',
    }).toString();

    const details = await this.getJson(detailUrl);
    const out: ShortVideo[] = [];

    for (const item of details.items ?? []) {
      const id = item?.id;
      if (typeof id !== 'string') continue;
      if (item?.status?.embeddable === false) continue;
      const durationSec = parseIsoDuration(item?.contentDetails?.duration ?? '');
      if (durationSec <= 0 || durationSec > opts.maxDurationSec) continue;

      const sn = item.snippet ?? {};
      out.push({
        id,
        title: String(sn.title ?? 'Untitled'),
        channel: String(sn.channelTitle ?? ''),
        channelUrl: sn.channelId ? `https://www.youtube.com/channel/${sn.channelId}` : undefined,
        durationSec,
        thumbnail: pickThumb(sn.thumbnails),
        publishedAt: sn.publishedAt,
        viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
        url: `https://www.youtube.com/shorts/${id}`,
        embedUrl: embedUrl(id),
        score: 0,
      });
    }

    return this.verifyShorts ? await filterRealShorts(out) : out;
  }

  private async getJson(url: URL): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new ProviderError(`youtube request failed: ${(e as Error).message}`, true);
    }
    const body = await res.text();
    if (!res.ok) {
      let reason = `${res.status}`;
      try {
        const err = JSON.parse(body);
        reason = err?.error?.errors?.[0]?.reason ?? err?.error?.message ?? reason;
      } catch { /* keep status code */ }
      if (/quota/i.test(reason)) throw new ProviderError('quotaExceeded', false);
      if (res.status === 403) throw new ProviderError(`youtube rejected the key: ${reason}`, false);
      throw new ProviderError(`youtube error ${res.status}: ${reason}`, res.status >= 500);
    }
    return JSON.parse(body);
  }
}

function pickThumb(t: any): string {
  return t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? '';
}

/** Shorts must be embedded from /embed/, never /shorts/ — the latter will not frame. */
export function embedUrl(id: string): string {
  // youtube-nocookie defers cookie setting until playback starts.
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1`;
}

/**
 * Unofficial but accurate: youtube.com/shorts/<id> returns 200 for a real Short
 * and redirects (303) to /watch for anything else. Costs one HEAD per video and
 * can break without notice, so it is opt-in via shorts.verifyShorts.
 */
async function filterRealShorts(videos: ShortVideo[]): Promise<ShortVideo[]> {
  const checks = await Promise.allSettled(videos.map(async (v) => {
    const res = await fetch(`https://www.youtube.com/shorts/${v.id}`, {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000),
    });
    return res.status === 200 ? v : null;
  }));
  const kept = checks
    .map((c) => (c.status === 'fulfilled' ? c.value : null))
    .filter((v): v is ShortVideo => v !== null);
  // If the heuristic nukes everything, it probably broke; fall back to unfiltered.
  if (kept.length === 0 && videos.length > 0) {
    log.warn('verifyShorts filtered every result; falling back to duration filtering');
    return videos;
  }
  return kept;
}
