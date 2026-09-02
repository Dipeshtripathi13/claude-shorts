/**
 * Service worker: the only place that talks to YouTube.
 *
 * The split that matters: reading your message and naming a topic happens here,
 * locally, on every turn and for free. Searching happens only when you click.
 * Nothing about a message you ignore ever leaves the browser.
 */
import { extractTopic } from './generated/core/topic.js';
import { rankShorts } from './generated/core/rank.js';
import { searchShorts, QuotaExceededError, ApiKeyError, verifyKey } from './youtube.js';
import {
  getSettings, saveSettings, settingsDefaults,
  cacheGet, cacheSet, clearCache, cacheStats,
  getQuota, spendQuota, markQuotaExhausted,
  setOffer, getOffer, clearOffer, markSeen, getSeen,
} from './storage.js';

/* ------------------------------------------------------------- lifecycle */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    // Nothing works without a key, so send people straight to the one screen
    // that matters rather than letting them wonder why nothing happens.
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/welcome.html') });
  }
});

// Clicking the toolbar icon shows or hides the in-page panel.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
  } catch {
    // No content script here (wrong site, or the tab predates the install).
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/welcome.html') });
  }
});

/* --------------------------------------------------------------- routing */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true;   // keep the channel open for the async reply
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'turn':      return onTurn(msg, sender);
    case 'accept':    return onAccept();
    case 'get-state': return getState();
    case 'dismiss':   return onDismiss();
    case 'settings':  return { ok: true, settings: await getSettings(), defaults: settingsDefaults() };
    case 'save-settings': {
      const settings = await saveSettings(msg.patch ?? {});
      return { ok: true, settings };
    }
    case 'verify-key': return await verifyKey(msg.apiKey ?? '');
    case 'clear-cache': {
      const removed = await clearCache();
      return { ok: true, removed };
    }
    default: return { ok: false, error: `unknown message: ${msg?.type}` };
  }
}

/* ------------------------------------------------------------ the offer */

/**
 * A new user message. Extract a topic locally; if it is worth offering, park it
 * and light up the toolbar badge. No network call happens here, ever.
 */
async function onTurn(msg, sender) {
  const settings = await getSettings();

  const host = safeHost(sender?.tab?.url ?? msg.href);
  if (host && settings.disabledHosts.includes(host)) return { ok: true, offered: false, reason: 'disabled here' };

  const topic = extractTopic(msg.text ?? '');
  if (!topic || topic.confidence < settings.minConfidence) {
    await clearOffer();
    await badge('');
    await broadcast({ type: 'no-offer', reason: topic ? 'below the confidence threshold' : 'no teachable topic' });
    return { ok: true, offered: false };
  }

  const variant = variantKey(settings);
  const cached = await cacheGet(topic.key, variant, settings.cacheTtlHours);

  const offer = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    topic,
    cached: cached !== null,
    createdAt: Date.now(),
  };
  await setOffer(offer);
  await badge('1');
  await broadcast({ type: 'offer', offer });
  return { ok: true, offered: true };
}

async function onDismiss() {
  await clearOffer();
  await badge('');
  return { ok: true };
}

/* ----------------------------------------------------------- the search */

/** The click. This is the only path that spends a search. */
async function onAccept() {
  const offer = await getOffer();
  if (!offer) return { ok: false, error: 'That suggestion expired. Send another message.' };

  const settings = await getSettings();
  if (!settings.apiKey) {
    return { ok: false, error: 'no-key' };
  }

  const variant = variantKey(settings);
  const seen = await getSeen();

  let videos = await cacheGet(offer.topic.key, variant, settings.cacheTtlHours);
  let fromCache = videos !== null;

  if (!fromCache) {
    const quota = await getQuota(settings.dailySearches);
    if (quota.blocked || quota.remaining <= 0) {
      return { ok: false, error: `Daily search budget spent (${quota.used}/${quota.limit}). It resets at midnight US Pacific.` };
    }
    try {
      await spendQuota(settings.dailySearches);
      videos = await searchShorts(offer.topic.query, settings);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        await markQuotaExhausted(settings.dailySearches);
        return { ok: false, error: 'YouTube says the daily quota is used up. It resets at midnight US Pacific.' };
      }
      if (e instanceof ApiKeyError) {
        return { ok: false, error: `YouTube rejected the API key: ${e.message}` };
      }
      return { ok: false, error: e.message };
    }
    if (videos.length > 0) await cacheSet(offer.topic.key, variant, videos);
  }

  if (!videos || videos.length === 0) {
    return { ok: false, error: `No short videos matched "${offer.topic.query}".` };
  }

  const ranked = rankShorts(videos, offer.topic, {
    preferUnderSec: settings.preferUnderSec,
    maxDurationSec: settings.maxDurationSec,
    seen,
  }).slice(0, settings.count);

  await markSeen(ranked.map((v) => v.id));
  await clearOffer();
  await badge('');

  const result = { topic: offer.topic, videos: ranked, cached: fromCache };
  await broadcast({ type: 'results', result });
  return { ok: true, result };
}

/* --------------------------------------------------------------- shared */

async function getState() {
  const settings = await getSettings();
  const [offer, quota, cache] = await Promise.all([
    getOffer(),
    getQuota(settings.dailySearches),
    cacheStats(),
  ]);
  let build = 'dev';
  try { ({ BUILD: build } = await import('./build.js')); } catch { /* unpackaged */ }
  return {
    ok: true, offer, quota, cache,
    hasKey: !!settings.apiKey,
    playerBase: settings.playerBase,
    build,
  };
}

/** Cache entries are only interchangeable when these settings match. */
function variantKey(s) {
  return `${s.maxDurationSec}:${s.regionCode}:${s.relevanceLanguage}:${s.safeSearch}`;
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return null; }
}

async function badge(text) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#c85c2e' });
  } catch { /* badge is cosmetic */ }
}

/** Tell every open panel. No listener is a normal state, not an error. */
async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch { /* nobody listening */ }
}
