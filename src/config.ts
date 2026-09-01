import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface Config {
  provider: 'youtube' | 'ytdlp' | 'piped' | 'mock';
  youtube: { apiKey: string; regionCode: string; relevanceLanguage: string; safeSearch: 'none' | 'moderate' | 'strict' };
  piped: { instance: string };
  shorts: {
    /** Hard ceiling. YouTube now allows Shorts up to 3 min; 180 keeps those in play. */
    maxDurationSec: number;
    /** Videos at or under this get a ranking bonus — classic <=60s Shorts. */
    preferUnderSec: number;
    count: number;
    /** Unofficial HEAD check against /shorts/<id>. Accurate but slow and fragile. */
    verifyShorts: boolean;
  };
  trigger: {
    /**
     * 'manual' (default): a prompt raises a *button*; nothing is searched until
     * the user clicks it. Costs no quota and interrupts nothing.
     * 'auto': search on the user's behalf once the model has been busy
     * `minThinkingMs`, and push the result unprompted.
     */
    mode: 'manual' | 'auto';
    /** Auto mode only: don't surface anything until the assistant has been busy this long. */
    minThinkingMs: number;
    /** Minimum gap between two suggestion batches in one session. */
    cooldownMs: number;
    maxPerSession: number;
    minConfidence: number;
  };
  /** YouTube grants 100 search.list calls/day. Stay under it. */
  quota: { dailySearches: number };
  cache: { ttlHours: number; maxEntries: number };
  privacy: {
    /** Include assistant replies in topic extraction (off: only your own words). */
    useAssistantText: boolean;
    /** Persist derived queries to disk for debugging. */
    logQueries: boolean;
    /** Extra regexes; a prompt matching any of these is never used for search. */
    denyPatterns: string[];
  };
  server: { host: string; port: number };
  topics: { block: string[]; boost: string[] };
}

export const DEFAULTS: Config = {
  provider: 'youtube',
  youtube: { apiKey: '', regionCode: 'US', relevanceLanguage: 'en', safeSearch: 'moderate' },
  piped: { instance: 'https://pipedapi.kavin.rocks' },
  shorts: { maxDurationSec: 180, preferUnderSec: 60, count: 6, verifyShorts: false },
  trigger: { mode: 'manual', minThinkingMs: 8000, cooldownMs: 90_000, maxPerSession: 20, minConfidence: 0.45 },
  quota: { dailySearches: 90 },
  cache: { ttlHours: 168, maxEntries: 800 },
  privacy: { useAssistantText: false, logQueries: false, denyPatterns: [] },
  server: { host: '127.0.0.1', port: 8787 },
  topics: { block: [], boost: [] },
};

export function configDir(): string {
  const base = process.env.SHORTS_HOME
    ?? (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'claude-shorts') : join(homedir(), '.config', 'claude-shorts'));
  mkdirSync(base, { recursive: true });
  return base;
}

export const configPath = (): string => join(configDir(), 'config.json');
export const statePath = (name: string): string => join(configDir(), name);

/** Deep-merge user JSON over defaults so partial configs stay valid across upgrades. */
function merge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = out[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

let cached: Config | null = null;

export function loadConfig(force = false): Config {
  if (cached && !force) return cached;
  let cfg = DEFAULTS;
  const p = configPath();
  if (existsSync(p)) {
    try {
      cfg = merge(DEFAULTS, JSON.parse(readFileSync(p, 'utf8')));
    } catch (e) {
      throw new Error(`config at ${p} is not valid JSON: ${(e as Error).message}`);
    }
  }
  // Env always wins, so CI and one-off runs never need to touch the file.
  const env = process.env;
  if (env.SHORTS_YOUTUBE_API_KEY) cfg.youtube.apiKey = env.SHORTS_YOUTUBE_API_KEY;
  if (env.YOUTUBE_API_KEY && !cfg.youtube.apiKey) cfg.youtube.apiKey = env.YOUTUBE_API_KEY;
  if (env.SHORTS_PROVIDER) cfg.provider = env.SHORTS_PROVIDER as Config['provider'];
  if (env.SHORTS_PORT) cfg.server.port = Number(env.SHORTS_PORT);
  if (env.SHORTS_HOST) cfg.server.host = env.SHORTS_HOST;
  cached = cfg;
  return cfg;
}

export function saveConfig(cfg: Config): void {
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  cached = cfg;
}

/** Shared secret between the daemon and its panels. Created on first use. */
export function authToken(): string {
  const p = statePath('token');
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const t = randomBytes(24).toString('base64url');
  writeFileSync(p, t + '\n', { mode: 0o600 });
  return t;
}

export function baseUrl(cfg = loadConfig()): string {
  return `http://${cfg.server.host}:${cfg.server.port}`;
}
