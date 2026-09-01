import type { Provider, SearchOptions, ShortVideo } from '../types.js';
import { ProviderError } from '../types.js';
import { embedUrl } from './youtube.js';

/**
 * No-API-key fallback via a Piped instance.
 *
 * Public instances come and go, so this provider is best-effort: it exists so
 * someone can try the tool in one command before deciding whether to create a
 * Google Cloud project. Point `piped.instance` at your own instance for
 * anything you rely on.
 */
export class PipedProvider implements Provider {
  readonly name = 'piped';
  readonly quotaCost = 0;

  constructor(private instance: string) {}

  async unavailableReason(): Promise<string | null> {
    try {
      const res = await fetch(`${this.instance}/healthcheck`, { signal: AbortSignal.timeout(4000) });
      return res.ok ? null : `piped instance ${this.instance} returned ${res.status}`;
    } catch {
      // Not every instance implements /healthcheck; let the real search decide.
      return null;
    }
  }

  async search(opts: SearchOptions): Promise<ShortVideo[]> {
    const url = new URL(`${this.instance}/search`);
    url.search = new URLSearchParams({ q: opts.query, filter: 'videos' }).toString();

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    } catch (e) {
      throw new ProviderError(`piped request failed: ${(e as Error).message}`, true);
    }
    if (!res.ok) throw new ProviderError(`piped error ${res.status}`, res.status >= 500);

    const body = await res.json() as { items?: any[] };
    const out: ShortVideo[] = [];
    for (const it of body.items ?? []) {
      const id = String(it.url ?? '').replace(/^.*[?&]v=/, '').replace(/^\/watch\?v=/, '');
      const durationSec = Number(it.duration ?? 0);
      if (!id || !durationSec || durationSec > opts.maxDurationSec) continue;
      out.push({
        id,
        title: String(it.title ?? 'Untitled'),
        channel: String(it.uploaderName ?? ''),
        channelUrl: it.uploaderUrl ? `https://www.youtube.com${it.uploaderUrl}` : undefined,
        durationSec,
        thumbnail: it.thumbnail ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        publishedAt: it.uploaded ? new Date(Number(it.uploaded)).toISOString() : undefined,
        viewCount: it.views ? Number(it.views) : undefined,
        url: `https://www.youtube.com/shorts/${id}`,
        embedUrl: embedUrl(id),
        score: 0,
      });
    }
    return out;
  }
}
