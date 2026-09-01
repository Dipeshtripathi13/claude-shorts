import { createHash } from 'node:crypto';
import type { Provider, SearchOptions, ShortVideo } from '../types.js';

/**
 * Deterministic fake provider for tests, CI and UI work.
 *
 * Returns plausible metadata derived from the query hash, so the daemon,
 * ranking, cache and panel can all be exercised without credentials or network.
 * The ids are not real videos: playback will not work, by design. Anything that
 * needs real clips needs a real provider.
 */
export class MockProvider implements Provider {
  readonly name = 'mock';
  readonly quotaCost = 0;

  async unavailableReason(): Promise<string | null> { return null; }

  async search(opts: SearchOptions): Promise<ShortVideo[]> {
    const seed = createHash('sha256').update(opts.query).digest();
    const topic = opts.query.replace(/\s+explained$/, '');
    const shapes = [
      `${topic} explained in 60 seconds`,
      `The truth about ${topic}`,
      `${topic}: a visual intro`,
      `Why ${topic} matters`,
      `${topic} for beginners`,
      `${topic} in one diagram`,
      `Common ${topic} mistakes`,
      `${topic}, but simpler`,
    ];
    const channels = ['ByteSized', 'Chalk & Talk', 'The Curious Engineer', 'Minute Science', 'Depth First'];

    const out: ShortVideo[] = [];
    for (let i = 0; i < Math.min(shapes.length, opts.count * 2); i++) {
      const b = (n: number) => seed[(i * 5 + n) % seed.length]!;
      const durationSec = 18 + (b(0) % 100);
      if (durationSec > opts.maxDurationSec) continue;
      const id = `mock${seed.subarray(i, i + 6).toString('hex')}`;
      out.push({
        id,
        title: shapes[i]!,
        channel: channels[b(1) % channels.length]!,
        durationSec,
        thumbnail: '',
        publishedAt: new Date(Date.now() - (b(2) % 900) * 86_400_000).toISOString(),
        viewCount: 1000 * (b(3) + 1) * (b(4) + 1),
        url: `https://www.youtube.com/shorts/${id}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
        score: 0,
      });
    }
    return out;
  }
}
