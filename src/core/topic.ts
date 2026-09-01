import { STOPWORDS, CHAT_NOISE, CONCEPT_CUES, MECHANICAL_CUES } from './stopwords.js';
import { LEXICON_UNIGRAMS, LEXICON_PHRASES, domainOf } from './lexicon.js';
import { redact } from './redact.js';
import type { Topic } from '../types.js';

export interface ExtractOptions {
  denyPatterns?: string[];
  /** Topics the user has thumbed down; never resurfaced. */
  blockTopics?: string[];
  boostTerms?: string[];
}

interface Candidate {
  phrase: string;
  score: number;
  fromLexicon: boolean;
  firstIndex: number;
}

const MAX_QUERY_WORDS = 6;
/** Score awarded to a curated multi-word concept from the lexicon. */
const PHRASE_SCORE = 4.0;

/** Tokens that may not start or end an n-gram (they make phrases read as garbage). */
function isEdgeJunk(tok: string): boolean {
  return STOPWORDS.has(tok) || CHAT_NOISE.has(tok) || tok.length < 3;
}

function isContentToken(tok: string): boolean {
  return !STOPWORDS.has(tok) && !CHAT_NOISE.has(tok) && tok.length >= 3 && !/^\d+$/.test(tok);
}

/**
 * Decide what this turn is about.
 * Returns null when there is nothing worth interrupting the user for.
 */
export function extractTopic(rawText: string, opts: ExtractOptions = {}): Topic | null {
  const raw = (rawText ?? '').trim();
  if (!raw) return null;

  // A one-word "yes" or a slash command is never a teachable moment.
  if (MECHANICAL_CUES.some((re) => re.test(raw))) return null;

  const { text, blocked } = redact(raw, opts.denyPatterns ?? []);
  if (blocked || text.length < 8) return null;

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.filter(isContentToken).length < 1) return null;

  const kind = classify(raw, lower);
  if (kind === 'mechanical') return null;

  const candidates = new Map<string, Candidate>();
  const add = (phrase: string, score: number, fromLexicon: boolean, at: number) => {
    const existing = candidates.get(phrase);
    if (existing) {
      // Repetition is evidence, but with diminishing returns.
      existing.score += Math.min(score * 0.35, 1.2);
      return;
    }
    candidates.set(phrase, { phrase, score, fromLexicon, firstIndex: at });
  };

  // 1. Known multi-word concepts win outright — longest first so "cap theorem"
  //    is found before "theorem" can claim the tokens.
  const claimed = new Set<number>();
  const foundPhrases: string[] = [];
  for (const phrase of LEXICON_PHRASES) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(phrase, from);
      if (idx === -1) break;
      const before = idx === 0 ? ' ' : lower[idx - 1]!;
      const after = lower[idx + phrase.length] ?? ' ';
      if (/[\s]/.test(before) && /[\s]/.test(after)) {
        const wordIdx = lower.slice(0, idx).split(/\s+/).filter(Boolean).length;
        add(phrase, PHRASE_SCORE, true, wordIdx);
        foundPhrases.push(phrase);
        for (let i = 0; i < phrase.split(' ').length; i++) claimed.add(wordIdx + i);
      }
      from = idx + phrase.length;
    }
  }

  // 2. Generic n-grams (1..3) over the remaining words.
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n) as string[];
      if (isEdgeJunk(slice[0]!) || isEdgeJunk(slice[n - 1]!)) continue;
      if (slice.some((w) => claimed.has(words.indexOf(w)) && n === 1)) continue;
      const contentCount = slice.filter(isContentToken).length;
      if (contentCount === 0) continue;
      if (n > 1 && contentCount < n) continue; // no stopwords in the middle of a topic

      const phrase = slice.join(' ');
      let score = 0.55 * contentCount;
      const lexHits = slice.filter((w) => LEXICON_UNIGRAMS.has(w)).length;
      score += lexHits * 1.15;
      if (n === 2) score += 0.5;         // two-word topics search best
      if (n === 3) score += 0.2;
      score += avgRarity(slice) * 0.6;
      score += positionBonus(i, words.length);
      if (looksProper(raw, phrase)) score += 0.55;
      for (const b of opts.boostTerms ?? []) if (phrase.includes(b.toLowerCase())) score += 1.5;

      // "heavy database migration" must not outrank "database migration". An
      // n-gram that merely wraps a known concept in filler is always the worse
      // search, however many lexicon words it happens to contain.
      if (foundPhrases.some((p) => p !== phrase && ` ${phrase} `.includes(` ${p} `))) {
        score = Math.min(score, PHRASE_SCORE - 0.5);
      }

      add(phrase, score, lexHits > 0, i);
    }
  }

  const blockList = (opts.blockTopics ?? []).map((s) => s.toLowerCase());
  const ranked = [...candidates.values()]
    .filter((c) => !blockList.some((b) => c.phrase.includes(b)))
    .sort((a, b) => b.score - a.score || a.firstIndex - b.firstIndex);

  const top = ranked[0];
  if (!top) return null;

  const terms = buildTerms(top, ranked);
  const label = terms.join(' ');
  const query = buildQuery(label, kind);
  const confidence = scoreConfidence(top, ranked, kind, words.length);

  return {
    query,
    label,
    confidence,
    kind,
    key: normalizeKey(query),
    terms,
  };
}

function classify(raw: string, lower: string): Topic['kind'] | 'mechanical' {
  if (CONCEPT_CUES.some((re) => re.test(raw))) return 'concept';
  if (/\b(?:traceback|stack ?trace|exception|panic|segfault|undefined is not|cannot read propert|econnrefused|500 error|timeout)\b/i.test(raw)) {
    return 'debug';
  }
  const contentWords = lower.split(/\s+/).filter(isContentToken);
  if (contentWords.length < 2) return 'mechanical';
  return 'task';
}

/** Longer, less-common words carry more topic weight than short common ones. */
function avgRarity(words: string[]): number {
  const scores = words.map((w) => Math.min(1, Math.max(0, (w.length - 4) / 8)));
  return scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
}

/** Topics tend to sit early in a question and late in a statement; favour early. */
function positionBonus(index: number, total: number): number {
  if (total <= 1) return 0;
  return 0.5 * (1 - index / total);
}

/** Capitalised mid-sentence usually means a product or proper noun. */
function looksProper(raw: string, phrase: string): boolean {
  const first = phrase.split(' ')[0]!;
  const re = new RegExp(`(?<!^)(?<![.!?]\\s)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
  const m = raw.match(re);
  return !!m && /[A-Z]/.test(m[0]?.[0] ?? '');
}

/**
 * A single generic phrase ("migration") searches badly. If the winner is short
 * and a second strong, non-overlapping term exists, pair them.
 */
function buildTerms(top: Candidate, ranked: Candidate[]): string[] {
  const terms = [top.phrase];
  const used = new Set(top.phrase.split(' '));
  const topWords = top.phrase.split(' ').length;
  if (topWords <= 2) {
    for (const c of ranked.slice(1, 8)) {
      if (c.score < 1.4) break;
      const cw = c.phrase.split(' ');
      if (cw.some((w) => used.has(w))) continue;
      if (!c.fromLexicon && c.score < 2.2) continue;
      if (topWords + cw.length > 4) continue;
      terms.push(c.phrase);
      break;
    }
  }
  return terms;
}

function buildQuery(label: string, kind: Topic['kind']): string {
  const words = label.split(/\s+/).slice(0, MAX_QUERY_WORDS - 1);
  const head = words.join(' ');
  // "explained" reliably surfaces teaching content rather than vlogs or reviews.
  switch (kind) {
    case 'concept': return `${head} explained`;
    case 'debug': return `${head} explained`;
    default: {
      const d = domainOf(words[0] ?? '');
      return d === 'science' || d === 'math' ? `${head} explained` : `${head} explained`;
    }
  }
}

function scoreConfidence(top: Candidate, ranked: Candidate[], kind: Topic['kind'], wordCount: number): number {
  // Soft saturation rather than a hard clamp: a linear score divided by a
  // constant pinned almost everything at 1.0, which made the whole confidence
  // threshold decorative. This curve keeps real topics well separated.
  let c = top.score / (top.score + 3.2);
  if (kind === 'concept') c += 0.15;
  if (kind === 'debug') c -= 0.05;
  if (top.fromLexicon) c += 0.08;
  // A clear winner is more trustworthy than a field of ties.
  const second = ranked[1]?.score ?? 0;
  if (top.score - second > 1.0) c += 0.06;
  // Terseness usually means a mechanical turn ("rerun it") — but not when the
  // user asked an outright question. "What is photosynthesis" is three words
  // and could not be a clearer request to be taught something.
  if (wordCount < 4 && kind !== 'concept') c -= 0.25;
  if (wordCount > 120) c -= 0.1;
  return Math.max(0, Math.min(0.99, Number(c.toFixed(3))));
}

export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}
