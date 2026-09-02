#!/usr/bin/env node
/**
 * Exercises the service worker's real message handlers against stubbed
 * chrome.* APIs and a stubbed fetch.
 *
 * This cannot prove the extension loads in Chrome, but it does prove the part
 * most likely to be wrong: that a message raises an offer without touching the
 * network, that only an accept spends a search, that the cache and the daily
 * budget are honoured, and that a credential in a prompt is dropped.
 *
 * Run with `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

/* --------------------------------------------------------- chrome stubs */

function makeArea() {
  const data = new Map();
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return Object.fromEntries(data);
      if (typeof keys === 'string') return data.has(keys) ? { [keys]: data.get(keys) } : {};
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (data.has(k)) out[k] = data.get(k);
        return out;
      }
      const out = { ...keys };
      for (const k of Object.keys(keys)) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data.set(k, v); },
    async remove(keys) { for (const k of [].concat(keys)) data.delete(k); },
    _data: data,
  };
}

const listeners = { message: [], installed: [], clicked: [] };
const broadcasts = [];

globalThis.chrome = {
  storage: { local: makeArea(), session: makeArea() },
  tabs: { create: async () => {}, sendMessage: async () => {}, onRemoved: { addListener: () => {} } },
  runtime: {
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    sendMessage: async (msg) => { broadcasts.push(msg); },
    getURL: (p) => `chrome-extension://test/${p}`,
    openOptionsPage: async () => {},
  },
  action: {
    onClicked: { addListener: (fn) => listeners.clicked.push(fn) },
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
  },
};

/* ----------------------------------------------------------- fetch stub */

let fetchCalls = [];
let fetchImpl = null;

globalThis.fetch = async (url) => {
  const href = String(url);
  fetchCalls.push(href);
  if (fetchImpl) return fetchImpl(href);
  return youtubeOk(href);
};

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function youtubeOk(href) {
  if (href.includes('/search?')) {
    return json({ items: Array.from({ length: 8 }, (_, i) => ({ id: { videoId: `vid${i}` } })) });
  }
  return json({
    items: Array.from({ length: 8 }, (_, i) => ({
      id: `vid${i}`,
      status: { embeddable: true },
      contentDetails: { duration: `PT${20 + i * 7}S` },
      snippet: {
        title: `Thing explained, part ${i}`,
        channelTitle: `Channel ${i % 3}`,
        channelId: `ch${i % 3}`,
        publishedAt: '2025-01-01T00:00:00Z',
        thumbnails: { high: { url: `https://i.ytimg.com/vi/vid${i}/hq.jpg` } },
      },
      statistics: { viewCount: String(10000 + i * 500) },
    })),
  });
}

/* ------------------------------------------------------------- harness */

await import('../src/background.js');

const handler = listeners.message[0];
assert.ok(handler, 'background.js should register a message listener');

/** Every real caller lives in a tab; default to one so state is scoped. */
function send(msg, sender = { tab: { id: 1 } }) {
  return new Promise((resolve) => handler(msg, sender, resolve));
}

async function reset(settings = {}) {
  chrome.storage.local._data.clear();
  chrome.storage.session._data.clear();
  fetchCalls = [];
  fetchImpl = null;
  broadcasts.length = 0;
  await send({ type: 'save-settings', patch: { apiKey: 'TEST_KEY', ...settings } });
}

/* --------------------------------------------------------------- tests */

test('a real question raises an offer and spends no network call', async () => {
  await reset();
  const res = await send({ type: 'turn', text: 'what is photosynthesis and how do plants use it' });
  assert.equal(res.ok, true);
  assert.equal(res.offered, true);
  assert.equal(fetchCalls.length, 0, 'extracting a topic must not hit the network');

  const state = await send({ type: 'get-state' });
  assert.ok(state.offer, 'the offer should be persisted for the click');
  assert.match(state.offer.topic.query, /photosynthesis/);
});

test('a chore raises no offer', async () => {
  await reset();
  for (const chore of ['yes', 'run the tests again', 'commit this please']) {
    const res = await send({ type: 'turn', text: chore });
    assert.equal(res.offered, false, `should not offer for: ${chore}`);
  }
  assert.equal(fetchCalls.length, 0);
});

test('a prompt containing a credential is dropped entirely', async () => {
  await reset();
  const res = await send({
    type: 'turn',
    text: 'debug my auth with key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA please',
  });
  assert.equal(res.offered, false);
  assert.equal(fetchCalls.length, 0);
});

test('accepting is what searches, and it searches once', async () => {
  await reset();
  await send({ type: 'turn', text: 'explain how the cap theorem applies to distributed systems' });
  assert.equal(fetchCalls.length, 0);

  const res = await send({ type: 'accept' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.result.videos.length > 0, true);
  assert.equal(res.result.cached, false);
  // search.list + videos.list
  assert.equal(fetchCalls.length, 2, 'one search is two API calls, no more');
});

test('a repeated topic is served from cache without searching', async () => {
  await reset();
  const q = 'what is a bloom filter and when should I use one';
  await send({ type: 'turn', text: q });
  await send({ type: 'accept' });
  const before = fetchCalls.length;

  await send({ type: 'turn', text: q });
  const state = await send({ type: 'get-state' });
  assert.equal(state.offer.cached, true, 'the offer should know it is free');

  const res = await send({ type: 'accept' });
  assert.equal(res.ok, true);
  assert.equal(res.result.cached, true);
  assert.equal(fetchCalls.length, before, 'a cached topic must cost no API calls');
});

test('results are ranked and never repeat a clip in one session', async () => {
  await reset();
  await send({ type: 'turn', text: 'explain the central limit theorem in statistics' });
  const first = await send({ type: 'accept' });
  const firstIds = first.result.videos.map((v) => v.id);

  // A different topic, same stubbed catalogue: previously seen ids sink.
  await send({ type: 'turn', text: 'what is a materialized view in postgres' });
  const second = await send({ type: 'accept' });
  assert.notEqual(second.result.videos[0].id, firstIds[0], 'the top clip should not repeat');
});

test('no API key produces a distinct signal, not a crash', async () => {
  await reset({ apiKey: '' });
  await send({ type: 'turn', text: 'what is photosynthesis and how does it work' });
  const res = await send({ type: 'accept' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'no-key');
  assert.equal(fetchCalls.length, 0);
});

test('the daily budget is enforced before calling YouTube', async () => {
  await reset({ dailySearches: 1 });
  await send({ type: 'turn', text: 'explain how raft consensus elects a leader' });
  await send({ type: 'accept' });
  const after = fetchCalls.length;

  await send({ type: 'turn', text: 'what is a write ahead log in databases' });
  const res = await send({ type: 'accept' });
  assert.equal(res.ok, false);
  assert.match(res.error, /budget/i);
  assert.equal(fetchCalls.length, after, 'must not call YouTube once the budget is spent');
});

test('a quotaExceeded reply from YouTube is handled, not thrown', async () => {
  await reset();
  fetchImpl = () => json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
  await send({ type: 'turn', text: 'explain how tls handshake works' });
  const res = await send({ type: 'accept' });
  assert.equal(res.ok, false);
  assert.match(res.error, /quota/i);
});

test('a rejected API key is reported clearly', async () => {
  await reset();
  fetchImpl = () => json({ error: { message: 'API key not valid' } }, 400);
  await send({ type: 'turn', text: 'explain what a bloom filter is used for' });
  const res = await send({ type: 'accept' });
  assert.equal(res.ok, false);
  assert.match(res.error, /API key/i);
});

test('clips longer than the ceiling are filtered out', async () => {
  await reset({ maxDurationSec: 40 });
  await send({ type: 'turn', text: 'explain how garbage collection works in java' });
  const res = await send({ type: 'accept' });
  assert.equal(res.ok, true, res.error);
  for (const v of res.result.videos) {
    assert.ok(v.durationSec <= 40, `${v.durationSec}s should have been filtered`);
  }
});

test('one tab\'s offer never appears in another tab', async () => {
  await reset();
  const gemini = { tab: { id: 11 } };
  const chatgpt = { tab: { id: 22 } };

  await send({ type: 'turn', text: 'explain how the solar system formed' }, gemini);

  const other = await send({ type: 'get-state' }, chatgpt);
  assert.equal(other.offer, null, 'a different tab must not inherit the offer');

  const same = await send({ type: 'get-state' }, gemini);
  assert.match(same.offer.topic.query, /solar system/);

  // Accepting in the tab that never had an offer must not search.
  const before = fetchCalls.length;
  const res = await send({ type: 'accept' }, chatgpt);
  assert.equal(res.ok, false);
  assert.equal(fetchCalls.length, before, 'no search for a tab with no offer');
});

test('broadcasts carry the tab they belong to', async () => {
  await reset();
  broadcasts.length = 0;
  await send({ type: 'turn', text: 'explain how the krebs cycle works' }, { tab: { id: 7 } });
  const offer = broadcasts.find((m) => m.type === 'offer');
  assert.ok(offer, 'an offer should be broadcast');
  assert.equal(offer.tabId, 7, 'panels filter on this; without it every panel reacts');
});

test('the panel is told about offers and results', async () => {
  await reset();
  broadcasts.length = 0;
  await send({ type: 'turn', text: 'what is the krebs cycle and why does it matter' });
  assert.ok(broadcasts.some((m) => m.type === 'offer'), 'panel should hear about the offer');
  await send({ type: 'accept' });
  assert.ok(broadcasts.some((m) => m.type === 'results'), 'panel should hear about the results');
});
