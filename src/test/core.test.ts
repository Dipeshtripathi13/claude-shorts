import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every module that touches config writes under SHORTS_HOME; keep tests hermetic.
process.env.SHORTS_HOME = mkdtempSync(join(tmpdir(), 'claude-shorts-test-'));

const { extractTopic } = await import('../core/topic.js');
const { redact } = await import('../core/redact.js');
const { rankShorts, parseIsoDuration } = await import('../core/rank.js');
const { QuotaTracker } = await import('../core/quota.js');
const { ResultCache } = await import('../core/cache.js');
const { MockProvider } = await import('../providers/mock.js');
const { Suggester } = await import('../core/suggest.js');
const { DEFAULTS } = await import('../config.js');
type ShortVideo = import('../types.js').ShortVideo;

/** A fresh state file per test, so no test can poison another. */
const tmpFile = () => join(process.env.SHORTS_HOME!, `${randomUUID()}.json`);

describe('redact', () => {
  test('blocks text containing credentials', () => {
    for (const secret of [
      'my key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAA',
      'token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'AWS AKIAIOSFODNN7EXAMPLE here',
      'password: hunter2correct',
    ]) {
      assert.equal(redact(secret).blocked, true, `should block: ${secret}`);
    }
  });

  test('strips code, paths and urls but keeps prose', () => {
    const out = redact('How does `useEffect` work in /Users/me/app/src/App.tsx? See https://x.com/a');
    assert.equal(out.blocked, false);
    assert.match(out.text, /How does/);
    assert.doesNotMatch(out.text, /useEffect|Users|https/);
  });

  test('honours user-supplied deny patterns', () => {
    assert.equal(redact('the acme merger details', ['acme']).blocked, true);
  });

  test('a broken user regex does not throw', () => {
    assert.doesNotThrow(() => redact('hello world', ['(unclosed']));
  });
});

describe('extractTopic', () => {
  const cases: Array<[string, string]> = [
    ['what is photosynthesis?', 'photosynthesis'],
    ['why does gradient descent get stuck in local minima', 'gradient descent'],
    ['explain how the CAP theorem applies to our event sourcing setup', 'cap theorem'],
    ['can you help me understand compound interest', 'compound interest'],
    ['our postgres connection pool keeps exhausting under load', 'connection pool'],
  ];

  for (const [input, expected] of cases) {
    test(`finds "${expected}" in "${input.slice(0, 40)}..."`, () => {
      const t = extractTopic(input);
      assert.ok(t, 'expected a topic');
      assert.ok(t.query.includes(expected), `got "${t.query}"`);
    });
  }

  test('a known concept beats the same phrase padded with filler', () => {
    const t = extractTopic('I have a heavy database migration to plan this week');
    assert.ok(t);
    assert.ok(t.query.startsWith('database migration'), `got "${t.query}"`);
  });

  test('suppresses mechanical turns', () => {
    for (const noise of ['yes', 'ok thanks', 'run the tests again', 'commit this', 'fix the typo in the readme', '/help']) {
      assert.equal(extractTopic(noise), null, `should suppress: ${noise}`);
    }
  });

  test('suppresses anything carrying a secret', () => {
    assert.equal(extractTopic('debug this with key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA'), null);
  });

  test('question forms score higher than imperative ones', () => {
    const q = extractTopic('what is eventual consistency')!;
    const i = extractTopic('add eventual consistency to the docs page')!;
    assert.ok(q.confidence > i.confidence, `${q.confidence} should exceed ${i.confidence}`);
  });

  test('respects blocked topics', () => {
    const t = extractTopic('what is photosynthesis', { blockTopics: ['photosynthesis'] });
    assert.ok(!t || !t.query.includes('photosynthesis'));
  });

  test('is deterministic, so the cache key is stable', () => {
    const a = extractTopic('how does the raft consensus algorithm elect a leader')!;
    const b = extractTopic('how does the raft consensus algorithm elect a leader')!;
    assert.equal(a.key, b.key);
  });
});

describe('rank', () => {
  const mk = (over: Partial<ShortVideo>): ShortVideo => ({
    id: 'x', title: 't', channel: 'c', durationSec: 40, thumbnail: '',
    url: '', embedUrl: '', score: 0, ...over,
  });
  const topic = extractTopic('what is a bloom filter')!;

  test('prefers clips under the preferred length', () => {
    const out = rankShorts(
      [mk({ id: 'long', title: 'bloom filter explained', durationSec: 170 }),
       mk({ id: 'short', title: 'bloom filter explained', durationSec: 45, channel: 'other' })],
      topic, { preferUnderSec: 60, maxDurationSec: 180 });
    assert.equal(out[0]!.id, 'short');
  });

  test('penalises engagement bait', () => {
    const out = rankShorts(
      [mk({ id: 'bait', title: 'SHOCKING bloom filter gone wrong', channel: 'a' }),
       mk({ id: 'real', title: 'bloom filter explained', channel: 'b' })],
      topic, { preferUnderSec: 60, maxDurationSec: 180 });
    assert.equal(out[0]!.id, 'real');
  });

  test('never repeats a channel before others have had a turn', () => {
    const out = rankShorts(
      [mk({ id: '1', channel: 'A', title: 'bloom filter explained' }),
       mk({ id: '2', channel: 'A', title: 'bloom filter explained' }),
       mk({ id: '3', channel: 'B', title: 'bloom filter explained' })],
      topic, { preferUnderSec: 60, maxDurationSec: 180 });
    assert.notEqual(out[0]!.channel, out[1]!.channel);
  });

  test('drops clips already seen this session', () => {
    const out = rankShorts(
      [mk({ id: 'seen', title: 'bloom filter explained', channel: 'a' }),
       mk({ id: 'new', title: 'bloom filter explained', channel: 'b' })],
      topic, { preferUnderSec: 60, maxDurationSec: 180, seen: new Set(['seen']) });
    assert.equal(out[0]!.id, 'new');
  });

  test('parses ISO durations', () => {
    assert.equal(parseIsoDuration('PT59S'), 59);
    assert.equal(parseIsoDuration('PT1M30S'), 90);
    assert.equal(parseIsoDuration('PT2H1M'), 7260);
    assert.equal(parseIsoDuration('garbage'), 0);
  });
});

describe('quota', () => {
  test('refuses to spend past the daily limit', () => {
    const q = new QuotaTracker(3, tmpFile());
    for (let i = 0; i < 3; i++) { assert.equal(q.canSpend(), true); q.spend(); }
    assert.equal(q.canSpend(), false);
    assert.equal(q.status().remaining, 0);
  });

  test('an API quota error blocks further spending', () => {
    const q = new QuotaTracker(100, tmpFile());
    q.markExhausted();
    assert.equal(q.canSpend(), false);
  });
});

describe('cache', () => {
  const video: ShortVideo = {
    id: 'a', title: 't', channel: 'c', durationSec: 30,
    thumbnail: '', url: '', embedUrl: '', score: 1,
  };

  test('round-trips a result', () => {
    const c = new ResultCache(1, 10, tmpFile());
    c.set('mock', 'photosynthesis', 'v1', [video]);
    assert.equal(c.get('mock', 'photosynthesis', 'v1')?.length, 1);
  });

  test('misses when the settings variant differs', () => {
    const c = new ResultCache(1, 10, tmpFile());
    c.set('mock', 'k', 'v1', [video]);
    assert.equal(c.get('mock', 'k', 'v2'), null);
  });

  test('expires entries past the TTL', () => {
    const c = new ResultCache(0, 10, tmpFile());
    c.set('mock', 'k', 'v', [video]);
    assert.equal(c.get('mock', 'k', 'v'), null);
  });
});

describe('suggester', () => {
  const cfg = structuredClone(DEFAULTS);
  cfg.provider = 'mock';

  /** Swap in a counting provider so tests can assert *whether* a search happened. */
  function stubProvider(s: InstanceType<typeof Suggester>, onCall: () => void): void {
    const p = new MockProvider();
    const original = p.search.bind(p);
    (s as unknown as { provider: unknown }).provider = {
      name: 'mock', quotaCost: 1,
      unavailableReason: async () => null,
      search: (o: Parameters<typeof original>[0]) => { onCall(); return original(o); },
    };
  }

  test('returns ranked shorts for a real topic', async () => {
    const s = new Suggester(cfg);
    const r = await s.suggest({ text: 'what is a bloom filter and when should I use one', sessionId: 't', source: 'manual' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(r.suggestion.videos.length > 0);
      assert.equal(r.suggestion.cached, false);
    }
  });

  test('serves the second identical request from cache', async () => {
    const s = new Suggester(cfg);
    const q = 'how does the krebs cycle produce atp';
    await s.suggest({ text: q, sessionId: 't', source: 'manual' });
    const second = await s.suggest({ text: q, sessionId: 't', source: 'manual' });
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.suggestion.cached, true);
  });

  test('declines when there is no teachable topic', async () => {
    const s = new Suggester(cfg);
    const r = await s.suggest({ text: 'ok thanks', sessionId: 't', source: 'manual' });
    assert.equal(r.ok, false);
  });

  test('evaluating a prompt spends nothing', async () => {
    const s = new Suggester(cfg);
    let calls = 0;
    stubProvider(s, () => calls++);
    const e = s.evaluate('how does the raft consensus algorithm elect a leader');
    assert.equal(e.ok, true);
    assert.equal(calls, 0, 'evaluate must never touch a provider');
  });

  test('an offer names a topic without searching for it', async () => {
    const s = new Suggester(cfg);
    let calls = 0;
    stubProvider(s, () => calls++);
    const offer = s.offerFor('what is a materialized view in postgres', 'sess', 'claude-code');
    assert.ok(offer, 'expected an offer');
    assert.match(offer.topic.query, /materialized view/);
    assert.equal(offer.cached, false);
    assert.equal(calls, 0, 'building an offer must not search');
  });

  test('a chore raises no offer at all', () => {
    const s = new Suggester(cfg);
    for (const chore of ['yes', 'run the tests again', 'commit this']) {
      assert.equal(s.offerFor(chore, 'sess', 'claude-code'), null, `should not offer for: ${chore}`);
    }
  });

  test('accepting an offer is what actually searches', async () => {
    const s = new Suggester(cfg);
    let calls = 0;
    stubProvider(s, () => calls++);
    const offer = s.offerFor('explain how a write ahead log works in postgres', 'sess', 'claude-code');
    assert.ok(offer);
    assert.equal(calls, 0);
    const out = await s.fetch(offer.topic, { sessionId: 'sess', source: 'claude-code' });
    assert.equal(out.ok, true);
    assert.equal(calls, 1, 'exactly one search per accepted offer');
  });

  test('an offer for an already-cached topic is marked free', async () => {
    const s = new Suggester(cfg);
    const text = 'what is a covalent bond';
    const first = s.offerFor(text, 'sess', 'claude-code')!;
    assert.equal(first.cached, false);
    await s.fetch(first.topic, { sessionId: 'sess', source: 'claude-code' });
    const second = s.offerFor(text, 'sess', 'claude-code')!;
    assert.equal(second.cached, true, 'second offer should know it costs nothing');
  });

  test('concurrent identical searches cost one provider call', async () => {
    const s = new Suggester(cfg);
    let calls = 0;
    stubProvider(s, () => calls++);
    const text = 'explain the central limit theorem';
    await Promise.all([
      s.suggest({ text, sessionId: 'a', source: 'manual' }),
      s.suggest({ text, sessionId: 'b', source: 'manual' }),
      s.suggest({ text, sessionId: 'c', source: 'manual' }),
    ]);
    assert.equal(calls, 1, 'expected the in-flight map to collapse duplicates');
  });
});
