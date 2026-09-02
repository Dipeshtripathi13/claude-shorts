/**
 * Settings, result cache and search budget, all on chrome.storage.
 *
 * A Manifest V3 service worker is killed after roughly thirty seconds of
 * idleness, so nothing may live in a module-level variable and be expected to
 * survive. Every piece of state that matters is read and written here.
 */

const SETTINGS_DEFAULTS = {
  apiKey: '',
  regionCode: 'US',
  relevanceLanguage: 'en',
  safeSearch: 'moderate',
  maxDurationSec: 180,
  preferUnderSec: 60,
  count: 6,
  minConfidence: 0.45,
  /** Daily ceiling we impose on ourselves, under YouTube's 100. */
  dailySearches: 90,
  cacheTtlHours: 168,
  /**
   * An https page that frames the YouTube embed on the extension's behalf.
   * Chrome sends no Referer from a chrome-extension:// page and YouTube refuses
   * to play without one, so an inline embed here fails with error 153. Framing
   * a real https page gives YouTube an origin it accepts.
   * Empty means "do not play inline" — clips open in a window instead.
   */
  playerBase: 'https://dipeshtripathi13.github.io/claude-shorts/player.html',
  /** Sites the user has switched off. */
  disabledHosts: [],
};

/** YouTube requires cached API data to be refreshed or dropped within 30 days. */
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;

export async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...SETTINGS_DEFAULTS, ...(stored.settings ?? {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const settingsDefaults = () => ({ ...SETTINGS_DEFAULTS });

/* ------------------------------------------------------------------ cache */

const cacheId = (key, variant) => `c:${variant}:${key}`;

export async function cacheGet(key, variant, ttlHours) {
  const id = cacheId(key, variant);
  const store = await chrome.storage.local.get(id);
  const entry = store[id];
  if (!entry) return null;
  const ttl = Math.min(ttlHours * 3600_000, MAX_TTL_MS);
  if (Date.now() - entry.storedAt >= ttl) {
    await chrome.storage.local.remove(id);
    return null;
  }
  return entry.videos;
}

export async function cacheSet(key, variant, videos) {
  await chrome.storage.local.set({
    [cacheId(key, variant)]: { storedAt: Date.now(), videos, hits: 0 },
  });
  await evictCache();
}

/** Drop expired entries, then the oldest, so storage cannot grow without bound. */
async function evictCache() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([k]) => k.startsWith('c:'));
  const now = Date.now();

  const stale = entries.filter(([, v]) => now - v.storedAt >= MAX_TTL_MS).map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);

  const live = entries.filter(([k]) => !stale.includes(k));
  if (live.length <= MAX_CACHE_ENTRIES) return;
  live.sort((a, b) => a[1].storedAt - b[1].storedAt);
  await chrome.storage.local.remove(live.slice(0, live.length - MAX_CACHE_ENTRIES).map(([k]) => k));
}

export async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('c:'));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

export async function cacheStats() {
  const all = await chrome.storage.local.get(null);
  return { entries: Object.keys(all).filter((k) => k.startsWith('c:')).length };
}

/* ------------------------------------------------------------------ quota */

/** YouTube's quota day rolls at midnight US/Pacific, not local midnight. */
function quotaDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export async function getQuota(limit) {
  const { quota } = await chrome.storage.local.get('quota');
  const today = quotaDay();
  const fresh = !quota || quota.day !== today ? { day: today, used: 0 } : quota;
  return {
    ...fresh,
    limit,
    remaining: Math.max(0, limit - fresh.used),
    blocked: !!fresh.blockedUntil && Date.now() < fresh.blockedUntil,
  };
}

export async function spendQuota(limit) {
  const q = await getQuota(limit);
  await chrome.storage.local.set({ quota: { day: q.day, used: q.used + 1, blockedUntil: q.blockedUntil } });
}

/** The API itself said quotaExceeded: stop trying until the Pacific day rolls. */
export async function markQuotaExhausted(limit) {
  const q = await getQuota(limit);
  await chrome.storage.local.set({
    quota: { day: q.day, used: limit, blockedUntil: nextPacificMidnight() },
  });
}

function nextPacificMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const secs = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  return now.getTime() + (86_400 - secs) * 1000;
}

/* ------------------------------------------------- current offer (session) */

/**
 * The pending offer lives in session storage: it is meaningful only for the
 * current browsing session, and it must survive the service worker being
 * suspended between the user's message and their click.
 */
export async function setOffer(offer) {
  await chrome.storage.session.set({ offer });
}

export async function getOffer() {
  const { offer } = await chrome.storage.session.get('offer');
  return offer ?? null;
}

export async function clearOffer() {
  await chrome.storage.session.remove('offer');
}

/** Video ids already shown, so a session never repeats a clip. */
export async function markSeen(ids) {
  const { seen = [] } = await chrome.storage.session.get('seen');
  const next = [...new Set([...seen, ...ids])].slice(-300);
  await chrome.storage.session.set({ seen: next });
}

export async function getSeen() {
  const { seen = [] } = await chrome.storage.session.get('seen');
  return new Set(seen);
}
