import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Provider, SearchOptions, ShortVideo } from '../types.js';
import { ProviderError } from '../types.js';
import { embedUrl } from './youtube.js';

const run = promisify(execFile);

/**
 * YouTube's own "Duration: under 4 minutes" search filter, as the opaque
 * protobuf blob the results page uses. It is the same cut the Data API makes
 * with videoDuration=short, so both providers see a comparable candidate pool.
 *
 * This matters more than it looks: a plain `ytsearch:` query returns YouTube's
 * default ranking, which is dominated by long-form video. Measured over 25
 * results for "photosynthesis explained", the plain query yielded 2 clips under
 * three minutes; with this filter, 17.
 */
const UNDER_4_MIN = 'EgIYAQ%3D%3D';

function searchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${UNDER_4_MIN}`;
}

/**
 * No-API-key fallback using a local yt-dlp binary.
 *
 * Trade-offs versus the official API: no daily quota, but slower (a few seconds),
 * and it depends on yt-dlp keeping up with YouTube's page changes. Playback still
 * goes through the official embedded player, so this only replaces *discovery*.
 */
export class YtDlpProvider implements Provider {
  readonly name = 'ytdlp';
  readonly quotaCost = 0;

  constructor(private binary = process.env.SHORTS_YTDLP ?? 'yt-dlp') {}

  async unavailableReason(): Promise<string | null> {
    try {
      await run(this.binary, ['--version'], { timeout: 5000 });
      return null;
    } catch {
      return `yt-dlp not found on PATH (install it, or set provider to "youtube")`;
    }
  }

  async search(opts: SearchOptions): Promise<ShortVideo[]> {
    const n = Math.min(40, Math.max(15, opts.count * 5));
    let stdout: string;
    try {
      ({ stdout } = await run(this.binary, [
        searchUrl(opts.query),
        '--flat-playlist',
        '--dump-json',
        '--no-warnings',
        '--ignore-errors',
        '--playlist-end', String(n),
        '--socket-timeout', '8',
      ], { timeout: 25_000, maxBuffer: 12 * 1024 * 1024 }));
    } catch (e) {
      const err = e as { stdout?: string; message: string };
      // yt-dlp exits non-zero when individual entries fail but still emits the rest.
      if (!err.stdout) throw new ProviderError(`yt-dlp failed: ${err.message}`, true);
      stdout = err.stdout;
    }

    const out: ShortVideo[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const id = e.id;
      const durationSec = Math.round(Number(e.duration ?? 0));
      if (typeof id !== 'string' || !durationSec || durationSec > opts.maxDurationSec) continue;
      out.push({
        id,
        title: String(e.title ?? 'Untitled'),
        channel: String(e.channel ?? e.uploader ?? ''),
        channelUrl: e.channel_url ?? e.uploader_url,
        durationSec,
        thumbnail: e.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        publishedAt: e.upload_date
          ? `${e.upload_date.slice(0, 4)}-${e.upload_date.slice(4, 6)}-${e.upload_date.slice(6, 8)}`
          : undefined,
        viewCount: e.view_count ? Number(e.view_count) : undefined,
        url: `https://www.youtube.com/shorts/${id}`,
        embedUrl: embedUrl(id),
        score: 0,
      });
    }
    return out;
  }
}
