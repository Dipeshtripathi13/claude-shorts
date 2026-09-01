/** Shared types for claude-shorts. */

/** Where a conversation event came from. */
export type SourceId =
  | 'claude-code'
  | 'claude-desktop'
  | 'claude-web'
  | 'chatgpt-web'
  | 'vscode'
  | 'manual';

/** A single observed turn in some conversation, normalized across surfaces. */
export interface ConversationEvent {
  source: SourceId;
  /** Stable per-conversation id, so cooldowns and dedupe are per-chat. */
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  /** 'thinking' means the assistant started working: this is the dead time we fill. */
  state?: 'thinking' | 'idle';
  /** Client-supplied ms epoch; the daemon trusts its own clock instead. */
  ts?: number;
  /** Optional working directory, used only to name the session in the UI. */
  cwd?: string;
}

/** What the extractor decided the user is actually curious about. */
export interface Topic {
  /** The search string we would send to a video provider. */
  query: string;
  /** Human-readable label shown in the UI ("why am I seeing this"). */
  label: string;
  /** 0..1 — how sure we are this is worth interrupting for. */
  confidence: number;
  kind: 'concept' | 'task' | 'debug' | 'mechanical';
  /** Normalized cache key. */
  key: string;
  terms: string[];
}

/** One suggested video, provider-agnostic. */
export interface ShortVideo {
  id: string;
  title: string;
  channel: string;
  channelUrl?: string;
  durationSec: number;
  thumbnail: string;
  publishedAt?: string;
  viewCount?: number;
  /** Canonical watch URL (always youtube.com/shorts or /watch, never /embed). */
  url: string;
  /** Player URL used by the panel iframe. */
  embedUrl: string;
  score: number;
}

/**
 * A topic we are *offering* to search for. Costs nothing to produce: the topic
 * is extracted locally, and no provider is contacted until the user asks.
 */
export interface Offer {
  id: string;
  sessionId: string;
  source: SourceId;
  topic: Topic;
  createdAt: number;
  /** True when this topic is already cached, so accepting is free. */
  cached: boolean;
}

/** A batch of suggestions tied to a topic, pushed to panels. */
export interface Suggestion {
  id: string;
  sessionId: string;
  source: SourceId;
  topic: Topic;
  videos: ShortVideo[];
  createdAt: number;
  /** True when served from cache (no quota spent). */
  cached: boolean;
}

export interface SearchOptions {
  query: string;
  maxDurationSec: number;
  count: number;
  regionCode: string;
  relevanceLanguage: string;
  safeSearch: 'none' | 'moderate' | 'strict';
}

export interface Provider {
  readonly name: string;
  /** Throws ProviderError on failure; returns [] when simply nothing matched. */
  search(opts: SearchOptions): Promise<ShortVideo[]>;
  /** How many units of the daily search budget one search() call costs. */
  readonly quotaCost: number;
  /** Human-readable reason the provider cannot run (missing key, missing binary). */
  unavailableReason(): Promise<string | null>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'ProviderError';
  }
}
