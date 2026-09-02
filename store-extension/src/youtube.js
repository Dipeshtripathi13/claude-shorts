/**
 * YouTube Data API v3, called directly from the extension with the user's own
 * key. This replaces the local daemon: everything ships in the package, which
 * is what Manifest V3 requires.
 *
 * Two calls per search:
 *   search.list  - 1 unit from the 100/day Search Queries bucket
 *   videos.list  - 1 unit from the separate 10,000/day bucket
 *
 * The API has no "is this a Short" flag, so we over-fetch with
 * videoDuration=short (which means under four minutes) and filter on the real
 * duration from contentDetails.
 */

const API = 'https://www.googleapis.com/youtube/v3';

export class QuotaExceededError extends Error {
  constructor() {
    super('YouTube quota exhausted for today');
    this.name = 'QuotaExceededError';
  }
}

export class ApiKeyError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ApiKeyError';
  }
}

export async function searchShorts(query, settings) {
  const search = new URL(`${API}/search`);
  search.search = new URLSearchParams({
    key: settings.apiKey,
    part: 'snippet',
    q: query,
    type: 'video',
    videoDuration: 'short',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    safeSearch: settings.safeSearch,
    regionCode: settings.regionCode,
    relevanceLanguage: settings.relevanceLanguage,
    order: 'relevance',
    maxResults: String(Math.min(50, Math.max(10, settings.count * 4))),
  }).toString();

  const found = await getJson(search);
  const ids = (found.items ?? []).map((i) => i?.id?.videoId).filter((v) => typeof v === 'string');
  if (ids.length === 0) return [];

  const details = new URL(`${API}/videos`);
  details.search = new URLSearchParams({
    key: settings.apiKey,
    part: 'contentDetails,snippet,statistics,status',
    id: ids.join(','),
    maxResults: '50',
  }).toString();

  const full = await getJson(details);
  const out = [];

  for (const item of full.items ?? []) {
    if (typeof item?.id !== 'string') continue;
    if (item?.status?.embeddable === false) continue;
    const durationSec = parseIsoDuration(item?.contentDetails?.duration ?? '');
    if (durationSec <= 0 || durationSec > settings.maxDurationSec) continue;

    const sn = item.snippet ?? {};
    out.push({
      id: item.id,
      title: String(sn.title ?? 'Untitled'),
      channel: String(sn.channelTitle ?? ''),
      channelUrl: sn.channelId ? `https://www.youtube.com/channel/${sn.channelId}` : undefined,
      durationSec,
      thumbnail: pickThumb(sn.thumbnails),
      publishedAt: sn.publishedAt,
      viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
      url: `https://www.youtube.com/shorts/${item.id}`,
      // A /shorts/ URL will not load in an iframe; it has to be /embed/.
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.id)}?rel=0&modestbranding=1&playsinline=1`,
      score: 0,
    });
  }
  return out;
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new Error(`Could not reach YouTube: ${e.message}`);
  }

  const body = await res.text();
  if (!res.ok) {
    let reason = String(res.status);
    try {
      const err = JSON.parse(body);
      reason = err?.error?.errors?.[0]?.reason ?? err?.error?.message ?? reason;
    } catch { /* keep the status code */ }
    if (/quota/i.test(reason)) throw new QuotaExceededError();
    if (res.status === 400 || res.status === 403) throw new ApiKeyError(reason);
    throw new Error(`YouTube error ${res.status}: ${reason}`);
  }
  return JSON.parse(body);
}

function pickThumb(t) {
  return t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? '';
}

/** ISO-8601 duration (PT1M30S) to seconds. Returns 0 when unparseable. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [, d, h, min, sec] = m;
  return (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Math.round(Number(sec ?? 0));
}

/** Cheap validation for the options page, so a bad key fails there not later. */
export async function verifyKey(apiKey) {
  const url = new URL(`${API}/videos`);
  url.search = new URLSearchParams({ key: apiKey, part: 'id', chart: 'mostPopular', maxResults: '1' }).toString();
  try {
    await getJson(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
