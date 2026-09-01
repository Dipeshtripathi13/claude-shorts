import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { statePath } from '../config.js';
import type { ShortVideo } from '../types.js';
import { log } from '../log.js';

/**
 * Disk cache of provider results, keyed by the normalized topic.
 *
 * This is the single most important component for staying inside YouTube's
 * 100-search/day budget: the same question asked twice a week apart costs one
 * search, not two.
 *
 * YouTube's Developer Policies require cached API data to be refreshed or
 * dropped within 30 days, so MAX_TTL_MS is a hard ceiling regardless of config.
 */
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Entry {
  key: string;
  provider: string;
  videos: ShortVideo[];
  storedAt: number;
  hits: number;
}

interface CacheFile { version: 1; entries: Record<string, Entry>; }

export class ResultCache {
  private data: CacheFile = { version: 1, entries: {} };
  private dirty = false;

  /** `file` is injectable so tests never share the user's real cache. */
  constructor(private ttlHours: number, private maxEntries: number, private file = statePath('cache.json')) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as CacheFile;
      if (parsed?.version === 1 && parsed.entries) this.data = parsed;
    } catch (e) {
      log.warn('cache unreadable, starting fresh:', (e as Error).message);
    }
    this.evict();
  }

  private ttlMs(): number {
    return Math.min(this.ttlHours * 3600_000, MAX_TTL_MS);
  }

  static id(provider: string, key: string, variant: string): string {
    return createHash('sha1').update(`${provider} ${key} ${variant}`).digest('hex').slice(0, 20);
  }

  get(provider: string, key: string, variant: string): ShortVideo[] | null {
    const id = ResultCache.id(provider, key, variant);
    const e = this.data.entries[id];
    if (!e) return null;
    if (Date.now() - e.storedAt >= this.ttlMs()) {
      delete this.data.entries[id];
      this.dirty = true;
      return null;
    }
    e.hits++;
    this.dirty = true;
    return e.videos;
  }

  set(provider: string, key: string, variant: string, videos: ShortVideo[]): void {
    const id = ResultCache.id(provider, key, variant);
    this.data.entries[id] = { key, provider, videos, storedAt: Date.now(), hits: 0 };
    this.dirty = true;
    this.evict();
  }

  /** Drop expired entries first, then least-used, until under the size cap. */
  private evict(): void {
    const now = Date.now();
    const ttl = this.ttlMs();
    for (const [id, e] of Object.entries(this.data.entries)) {
      if (now - e.storedAt >= ttl) { delete this.data.entries[id]; this.dirty = true; }
    }
    const ids = Object.keys(this.data.entries);
    if (ids.length <= this.maxEntries) return;
    const sorted = ids.sort((a, b) => {
      const ea = this.data.entries[a]!, eb = this.data.entries[b]!;
      return (ea.hits - eb.hits) || (ea.storedAt - eb.storedAt);
    });
    for (const id of sorted.slice(0, ids.length - this.maxEntries)) delete this.data.entries[id];
    this.dirty = true;
  }

  stats(): { entries: number; hits: number; oldestDays: number } {
    const list = Object.values(this.data.entries);
    const hits = list.reduce((a, e) => a + e.hits, 0);
    const oldest = list.reduce((a, e) => Math.min(a, e.storedAt), Date.now());
    return { entries: list.length, hits, oldestDays: Math.round((Date.now() - oldest) / 86_400_000) };
  }

  clear(): void {
    this.data = { version: 1, entries: {} };
    this.dirty = true;
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);   // atomic: a crash never leaves a half-written cache
    this.dirty = false;
  }
}
