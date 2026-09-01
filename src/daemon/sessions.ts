import type { Config } from '../config.js';
import type { ConversationEvent, Offer, Suggestion } from '../types.js';
import type { Suggester } from '../core/suggest.js';
import { log } from '../log.js';

/**
 * Decides *when* to say anything at all.
 *
 * Two modes, and the default is the quiet one:
 *
 * 'manual' — a prompt raises an **offer**: a button naming the topic we could
 *   search for. Extracting that topic is local and free, so this can happen on
 *   every prompt without spending a single search or interrupting anything. No
 *   network call happens until the user clicks.
 *
 * 'auto' — the original behaviour, kept for people who want it: fill dead time
 *   unprompted. A prompt arms a timer, and the timer only fires if the model is
 *   still working when it expires, so a fast answer stays silent.
 */
interface SessionState {
  id: string;
  source: ConversationEvent['source'];
  label: string;
  thinkingSince: number | null;
  pendingText: string | null;
  timer: NodeJS.Timeout | null;
  lastSuggestedAt: number;
  lastTopicKey: string | null;
  count: number;
  seen: Set<string>;
  lastActivity: number;
  /** The offer currently shown as a button, if any. */
  pendingOffer: Offer | null;
}

export type OnSuggestion = (s: Suggestion) => void;
export type OnOffer = (o: Offer) => void;
export type OnSkip = (sessionId: string, reason: string) => void;

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export class SessionManager {
  private sessions = new Map<string, SessionState>();

  constructor(
    private cfg: Config,
    private suggester: Suggester,
    private onSuggestion: OnSuggestion,
    private onOffer: OnOffer,
    private onSkip: OnSkip = () => {},
  ) {}

  reconfigure(cfg: Config): void { this.cfg = cfg; }

  private get(ev: ConversationEvent): SessionState {
    let s = this.sessions.get(ev.sessionId);
    if (!s) {
      s = {
        id: ev.sessionId,
        source: ev.source,
        label: ev.cwd ? ev.cwd.split('/').pop() ?? ev.source : ev.source,
        thinkingSince: null, pendingText: null, timer: null,
        lastSuggestedAt: 0, lastTopicKey: null, count: 0,
        seen: new Set(), lastActivity: Date.now(), pendingOffer: null,
      };
      this.sessions.set(ev.sessionId, s);
    }
    s.lastActivity = Date.now();
    s.source = ev.source;
    return s;
  }

  handle(ev: ConversationEvent): void {
    this.sweep();
    const s = this.get(ev);

    if (ev.role === 'assistant' || ev.state === 'idle') {
      // The model finished (or spoke). Stop waiting; the gap is over.
      this.disarm(s);
      s.thinkingSince = null;
      if (this.cfg.privacy.useAssistantText && ev.role === 'assistant' && ev.text.length > 40) {
        s.pendingText = `${s.pendingText ?? ''} ${ev.text}`.slice(-4000);
      }
      return;
    }

    // A user turn.
    s.pendingText = ev.text;
    s.thinkingSince = Date.now();
    this.disarm(s);

    if (this.cfg.trigger.mode === 'manual') {
      this.offer(s, ev.text);
      return;
    }

    const gate = this.precheck(s, ev.text);
    if (gate) { this.onSkip(s.id, gate); return; }

    const delay = Math.max(0, this.cfg.trigger.minThinkingMs);
    s.timer = setTimeout(() => { void this.fire(s); }, delay);
    // A pending auto-suggestion must never keep the process alive on its own.
    s.timer.unref?.();
  }

  /**
   * Raise a button, not a video. Free: the topic is extracted locally and no
   * provider is contacted, so there is no cooldown and no per-session cap here —
   * an offer the user ignores costs nothing at all.
   */
  private offer(s: SessionState, text: string): void {
    const offer = this.suggester.offerFor(text, s.id, s.source);
    if (!offer) {
      s.pendingOffer = null;
      this.onSkip(s.id, 'nothing worth offering in this message');
      return;
    }
    s.pendingOffer = offer;
    this.onOffer(offer);
  }

  /** Look up an offer the user has just accepted. */
  offerById(id: string): Offer | null {
    for (const s of this.sessions.values()) {
      if (s.pendingOffer?.id === id) return s.pendingOffer;
    }
    return null;
  }

  /** Record that an offer was accepted and its clips shown. */
  accepted(suggestion: Suggestion): void {
    const s = this.sessions.get(suggestion.sessionId);
    if (!s) return;
    s.count++;
    s.lastSuggestedAt = Date.now();
    s.lastTopicKey = suggestion.topic.key;
    for (const v of suggestion.videos) s.seen.add(v.id);
  }

  /** Ids already shown in a session, so an accepted offer never repeats a clip. */
  seenFor(sessionId: string): Set<string> {
    return this.sessions.get(sessionId)?.seen ?? new Set();
  }

  /** Cheap rejections that do not need the extractor or the network. */
  private precheck(s: SessionState, text: string): string | null {
    if (s.count >= this.cfg.trigger.maxPerSession) return 'per-session suggestion limit reached';
    const since = Date.now() - s.lastSuggestedAt;
    if (s.lastSuggestedAt && since < this.cfg.trigger.cooldownMs) {
      return `cooling down (${Math.ceil((this.cfg.trigger.cooldownMs - since) / 1000)}s left)`;
    }
    if (text.trim().length < 12) return 'message too short to have a topic';
    return null;
  }

  private async fire(s: SessionState): Promise<void> {
    s.timer = null;
    if (s.thinkingSince === null) return;          // model already answered
    const text = s.pendingText;
    if (!text) return;

    const topic = this.suggester.topicFor(text);
    if (topic && topic.key === s.lastTopicKey) {
      this.onSkip(s.id, 'same topic as the last suggestion');
      return;
    }

    const outcome = await this.suggester.suggest({
      text, sessionId: s.id, source: s.source, seen: s.seen,
    });

    if (!outcome.ok) { this.onSkip(s.id, outcome.reason); return; }

    s.count++;
    s.lastSuggestedAt = Date.now();
    s.lastTopicKey = outcome.suggestion.topic.key;
    for (const v of outcome.suggestion.videos) s.seen.add(v.id);
    log.info(`suggesting "${outcome.suggestion.topic.query}" (${outcome.suggestion.videos.length} shorts, ${outcome.suggestion.cached ? 'cached' : 'fresh'})`);
    this.onSuggestion(outcome.suggestion);
  }

  private disarm(s: SessionState): void {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  }

  /** Drop sessions nobody has touched in hours so the map cannot grow forever. */
  private sweep(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of this.sessions) {
      if (s.lastActivity < cutoff) { this.disarm(s); this.sessions.delete(id); }
    }
  }

  /** Mark a topic unwanted for the rest of this session. */
  mute(sessionId: string, videoIds: string[]): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    for (const id of videoIds) s.seen.add(id);
  }

  list(): Array<{ id: string; source: string; label: string; count: number; thinking: boolean; offering: string | null }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id, source: s.source, label: s.label, count: s.count,
      thinking: s.thinkingSince !== null, offering: s.pendingOffer?.topic.label ?? null,
    }));
  }

  shutdown(): void {
    for (const s of this.sessions.values()) this.disarm(s);
    this.sessions.clear();
  }
}
