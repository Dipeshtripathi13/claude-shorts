/** Tiny leveled logger. Everything goes to stderr so hook stdout stays clean. */
type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

let current: Level = (process.env.SHORTS_LOG as Level) || 'info';

export function setLevel(l: Level): void { current = l; }

function emit(level: Level, args: unknown[]): void {
  if (ORDER[level] < ORDER[current]) return;
  const tag = { debug: 'dbg', info: 'inf', warn: 'WRN', error: 'ERR', silent: '' }[level];
  process.stderr.write(`[shorts ${tag}] ${args.map(fmt).join(' ')}\n`);
}
function fmt(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack ?? v.message;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const log = {
  debug: (...a: unknown[]) => emit('debug', a),
  info: (...a: unknown[]) => emit('info', a),
  warn: (...a: unknown[]) => emit('warn', a),
  error: (...a: unknown[]) => emit('error', a),
};
