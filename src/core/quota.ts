import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { statePath } from '../config.js';

/**
 * YouTube grants a project 100 search.list calls per day, reset at midnight
 * US/Pacific. Overrunning it returns quotaExceeded for the rest of the day, so
 * we track spend locally and refuse before the API does.
 */
interface QuotaFile { day: string; used: number; blockedUntil?: number; }

const PACIFIC = 'America/Los_Angeles';

/** The current YouTube quota day, as YYYY-MM-DD in US/Pacific. */
export function quotaDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export class QuotaTracker {
  private data: QuotaFile = { day: quotaDay(), used: 0 };

  /** `file` is injectable so tests never share the user's real quota state. */
  constructor(private dailyLimit: number, private file = statePath('quota.json')) {
    if (existsSync(this.file)) {
      try { this.data = JSON.parse(readFileSync(this.file, 'utf8')) as QuotaFile; } catch { /* fall through to reset */ }
    }
    this.roll();
  }

  private roll(): void {
    const today = quotaDay();
    if (this.data.day !== today) this.data = { day: today, used: 0 };
  }

  /** True when another search of the given cost fits in today's budget. */
  canSpend(cost = 1): boolean {
    this.roll();
    if (this.data.blockedUntil && Date.now() < this.data.blockedUntil) return false;
    return this.data.used + cost <= this.dailyLimit;
  }

  spend(cost = 1): void {
    this.roll();
    this.data.used += cost;
    this.save();
  }

  /** Called when the API itself reports quotaExceeded: stop trying until tomorrow. */
  markExhausted(): void {
    this.roll();
    this.data.used = this.dailyLimit;
    this.data.blockedUntil = nextPacificMidnight();
    this.save();
  }

  status(): { used: number; limit: number; remaining: number; resetsInMin: number } {
    this.roll();
    return {
      used: this.data.used,
      limit: this.dailyLimit,
      remaining: Math.max(0, this.dailyLimit - this.data.used),
      resetsInMin: Math.round((nextPacificMidnight() - Date.now()) / 60_000),
    };
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }
}

function nextPacificMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const secsIntoDay = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  return now.getTime() + (86_400 - secsIntoDay) * 1000;
}
