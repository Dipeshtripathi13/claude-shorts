import type { ShortVideo, Topic } from '../types.js';

/**
 * Re-rank provider results for *this* use case: a 30-second gap in someone's
 * attention. Relevance matters, but so does brevity, and so does not showing
 * the same channel six times.
 */
export interface RankOptions {
  preferUnderSec: number;
  maxDurationSec: number;
  /** Video ids already shown in this session; heavily penalised. */
  seen?: Set<string>;
}

export function rankShorts(videos: ShortVideo[], topic: Topic, opts: RankOptions): ShortVideo[] {
  const terms = topic.terms.flatMap((t) => t.split(/\s+/)).filter((t) => t.length > 2).map((t) => t.toLowerCase());
  const scored = videos.map((v) => ({ ...v, score: scoreOne(v, terms, opts) }));
  scored.sort((a, b) => b.score - a.score);
  return diversify(scored);
}

function scoreOne(v: ShortVideo, terms: string[], opts: RankOptions): number {
  let s = 0;

  // Title relevance: how many of the topic's words actually appear.
  const title = v.title.toLowerCase();
  const hits = terms.filter((t) => title.includes(t)).length;
  s += terms.length ? (hits / terms.length) * 3.0 : 0;

  // Brevity. A true Short is the point; a 3-minute video is a fallback.
  if (v.durationSec <= opts.preferUnderSec) s += 1.6;
  else s += Math.max(0, 1.2 * (1 - (v.durationSec - opts.preferUnderSec) / Math.max(1, opts.maxDurationSec - opts.preferUnderSec)));
  if (v.durationSec < 8) s -= 1.5;   // too short to teach anything

  // Popularity, compressed: useful signal, but must not dominate relevance.
  if (typeof v.viewCount === 'number' && v.viewCount > 0) {
    s += Math.min(1.4, Math.log10(v.viewCount) / 5);
  }

  // Mild recency preference; tech rots faster than photosynthesis, but we
  // cannot tell which is which here, so keep the nudge small.
  if (v.publishedAt) {
    const years = (Date.now() - Date.parse(v.publishedAt)) / (365 * 86_400_000);
    if (Number.isFinite(years)) s += Math.max(-0.5, 0.45 - years * 0.12);
  }

  // Explainer signals in the title.
  if (/\b(explained|explain|what is|how (?:does|do|to)|in \d+ seconds?|basics|intro|simply|eli5|tutorial)\b/i.test(v.title)) s += 0.7;
  // Anti-signals: engagement bait rather than teaching.
  if (/\b(shocking|you won'?t believe|gone wrong|prank|reaction|drama|giveaway|subscribe)\b/i.test(v.title)) s -= 2.0;
  if (/[\u{1F300}-\u{1FAFF}]{3,}/u.test(v.title)) s -= 0.4;   // emoji spam

  if (opts.seen?.has(v.id)) s -= 5;

  return Number(s.toFixed(4));
}

/**
 * Interleave so no channel appears twice before every other channel has had a
 * turn. Six clips from one creator is a subscription, not a suggestion.
 */
function diversify(videos: ShortVideo[]): ShortVideo[] {
  const byChannel = new Map<string, ShortVideo[]>();
  for (const v of videos) {
    const k = v.channel || v.id;
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k)!.push(v);
  }
  const queues = [...byChannel.values()];
  const out: ShortVideo[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) { out.push(next); progressed = true; }
    }
  }
  return out;
}

/** ISO-8601 duration (PT1M30S) to seconds. Returns 0 when unparseable. */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  const [, d, h, min, sec] = m;
  return (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Math.round(Number(sec ?? 0));
}
