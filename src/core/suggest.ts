import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { Offer, Provider, ShortVideo, SourceId, Suggestion, Topic } from '../types.js';
import { ProviderError } from '../types.js';
import { makeProvider } from '../providers/index.js';
import { ResultCache } from './cache.js';
import { QuotaTracker } from './quota.js';
import { rankShorts } from './rank.js';
import { extractTopic } from './topic.js';
import { log } from '../log.js';

export interface SuggestInput {
  text: string;
  sessionId: string;
  source: SourceId;
  /** Ids already shown in this session, so we never repeat a clip. */
  seen?: Set<string>;
  /** Bypass the confidence gate (used by explicit `shorts ask "..."`). */
  force?: boolean;
}

export type SuggestOutcome =
  | { ok: true; suggestion: Suggestion }
  | { ok: false; reason: string; topic?: Topic };

export type EvalOutcome =
  | { ok: true; topic: Topic }
  | { ok: false; reason: string; topic?: Topic };

/**
 * Turns raw conversation text into a ranked batch of Shorts, spending as little
 * quota as possible on the way. Order matters: extract, gate, cache, then spend.
 */
export class Suggester {
  readonly cache: ResultCache;
  readonly quota: QuotaTracker;
  private provider: Provider;
  /** In-flight searches keyed by topic, so three surfaces asking at once cost one call. */
  private inflight = new Map<string, Promise<ShortVideo[]>>();

  constructor(private cfg: Config) {
    this.cache = new ResultCache(cfg.cache.ttlHours, cfg.cache.maxEntries);
    this.quota = new QuotaTracker(cfg.quota.dailySearches);
    this.provider = makeProvider(cfg);
  }

  /** Swap providers at runtime (config reload) without losing cache or quota state. */
  reconfigure(cfg: Config): void {
    this.cfg = cfg;
    this.provider = makeProvider(cfg);
  }

  get providerName(): string { return this.provider.name; }

  topicFor(text: string): Topic | null {
    return extractTopic(text, {
      denyPatterns: this.cfg.privacy.denyPatterns,
      blockTopics: this.cfg.topics.block,
      boostTerms: this.cfg.topics.boost,
    });
  }

  /**
   * The free half: work out what this text is about and whether it is worth
   * offering. Touches no network and spends no quota, so it can run on every
   * single prompt without consequence.
   */
  evaluate(text: string, force = false): EvalOutcome {
    const topic = this.topicFor(text);
    if (!topic) return { ok: false, reason: 'no teachable topic in this message' };
    if (!force && topic.confidence < this.cfg.trigger.minConfidence) {
      return { ok: false, reason: `confidence ${topic.confidence} below ${this.cfg.trigger.minConfidence}`, topic };
    }
    return { ok: true, topic };
  }

  /** True when this topic can be served without spending a search. */
  isCached(topic: Topic): boolean {
    return this.cache.get(this.provider.name, topic.key, this.variantKey()) !== null;
  }

  /** Package a topic as an offer the user can accept. Still costs nothing. */
  offerFor(text: string, sessionId: string, source: SourceId, force = false): Offer | null {
    const evaluated = this.evaluate(text, force);
    if (!evaluated.ok) return null;
    return {
      id: randomUUID(),
      sessionId,
      source,
      topic: evaluated.topic,
      createdAt: Date.now(),
      cached: this.isCached(evaluated.topic),
    };
  }

  /**
   * The expensive half: actually go and find clips for a topic the user has
   * asked for. Only ever called on explicit intent, or by auto mode.
   */
  async fetch(topic: Topic, input: Omit<SuggestInput, 'text'>): Promise<SuggestOutcome> {
    const variant = this.variantKey();
    const cached = this.cache.get(this.provider.name, topic.key, variant);
    if (cached) {
      return { ok: true, suggestion: this.pack(topic, cached, input, true) };
    }

    const unavailable = await this.provider.unavailableReason();
    if (unavailable) return { ok: false, reason: unavailable, topic };

    if (this.provider.quotaCost > 0 && !this.quota.canSpend(this.provider.quotaCost)) {
      const q = this.quota.status();
      return { ok: false, reason: `daily search budget spent (${q.used}/${q.limit}); resets in ${q.resetsInMin} min`, topic };
    }

    let videos: ShortVideo[];
    try {
      videos = await this.fetchOnce(topic, variant);
    } catch (e) {
      if (e instanceof ProviderError && e.message === 'quotaExceeded') {
        this.quota.markExhausted();
        return { ok: false, reason: 'YouTube quota exhausted for today', topic };
      }
      log.warn('provider search failed:', e);
      return { ok: false, reason: (e as Error).message, topic };
    }

    if (videos.length === 0) return { ok: false, reason: `no Shorts matched "${topic.query}"`, topic };
    return { ok: true, suggestion: this.pack(topic, videos, input, false) };
  }

  /** Evaluate then fetch in one step — used by `shorts ask` and the MCP tool. */
  async suggest(input: SuggestInput): Promise<SuggestOutcome> {
    const evaluated = this.evaluate(input.text, input.force ?? false);
    if (!evaluated.ok) return evaluated;
    return this.fetch(evaluated.topic, input);
  }

  /** Collapse concurrent identical searches into a single provider call. */
  private fetchOnce(topic: Topic, variant: string): Promise<ShortVideo[]> {
    const id = `${topic.key}|${variant}`;
    const existing = this.inflight.get(id);
    if (existing) return existing;

    const p = (async () => {
      if (this.provider.quotaCost > 0) this.quota.spend(this.provider.quotaCost);
      const videos = await this.provider.search({
        query: topic.query,
        maxDurationSec: this.cfg.shorts.maxDurationSec,
        count: this.cfg.shorts.count,
        regionCode: this.cfg.youtube.regionCode,
        relevanceLanguage: this.cfg.youtube.relevanceLanguage,
        safeSearch: this.cfg.youtube.safeSearch,
      });
      if (videos.length > 0) {
        this.cache.set(this.provider.name, topic.key, variant, videos);
        this.cache.flush();
      }
      return videos;
    })().finally(() => this.inflight.delete(id));

    this.inflight.set(id, p);
    return p;
  }

  /** Cache entries are only interchangeable when these settings match. */
  private variantKey(): string {
    const s = this.cfg.shorts;
    const y = this.cfg.youtube;
    return `${s.maxDurationSec}:${y.regionCode}:${y.relevanceLanguage}:${y.safeSearch}`;
  }

  private pack(topic: Topic, videos: ShortVideo[], input: Omit<SuggestInput, 'text'>, cached: boolean): Suggestion {
    const ranked = rankShorts(videos, topic, {
      preferUnderSec: this.cfg.shorts.preferUnderSec,
      maxDurationSec: this.cfg.shorts.maxDurationSec,
      seen: input.seen,
    }).slice(0, this.cfg.shorts.count);

    return {
      id: randomUUID(),
      sessionId: input.sessionId,
      source: input.source,
      topic,
      videos: ranked,
      createdAt: Date.now(),
      cached,
    };
  }
}
