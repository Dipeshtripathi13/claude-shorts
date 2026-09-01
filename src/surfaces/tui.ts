import { spawn } from 'node:child_process';
import { authToken, baseUrl } from '../config.js';
import type { Offer, Suggestion } from '../types.js';

/**
 * Terminal panel: `shorts panel`.
 *
 * Meant to live in a tmux/iTerm split next to Claude Code. A terminal cannot
 * play video, so this is a chooser, not a player: it shows what is worth
 * watching and hands the chosen clip to the browser.
 */

const A = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', italic: '\x1b[3m',
  accent: '\x1b[38;5;173m', ok: '\x1b[38;5;71m', muted: '\x1b[38;5;245m',
  inv: '\x1b[7m', clear: '\x1b[2J\x1b[H', hideCur: '\x1b[?25l', showCur: '\x1b[?25h',
  altOn: '\x1b[?1049h', altOff: '\x1b[?1049l',
};

interface PanelState {
  batch: Suggestion | null;
  offer: Offer | null;
  searching: boolean;
  index: number;
  connected: boolean;
  note: string;
  quota: string;
}

export async function runTui(): Promise<number> {
  const state: PanelState = {
    batch: null, offer: null, searching: false, index: 0,
    connected: false, note: 'waiting for your next message', quota: '',
  };
  const out = process.stdout;

  out.write(A.altOn + A.hideCur);
  const restore = () => { out.write(A.altOff + A.showCur); };
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(0); });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (buf) => {
      const k = buf.toString();
      if (k === 'q' || k === '\x03') { restore(); process.exit(0); }

      // An offer is a prompt to press f, not a result. Nothing is searched
      // until the key is pressed.
      if (state.offer && !state.batch) {
        if (k === 'f' || k === '\r') { void accept(state, () => draw(state)); }
        else if (k === 'n') { state.offer = null; state.note = 'skipped'; }
        draw(state);
        return;
      }

      if (!state.batch) return;
      const n = state.batch.videos.length;
      if (k === 'j' || k === '\x1b[B') state.index = (state.index + 1) % n;
      else if (k === 'k' || k === '\x1b[A') state.index = (state.index - 1 + n) % n;
      else if (k === '\r' || k === 'o') openUrl(state.batch.videos[state.index]!.url);
      else if (k === 'a') openUrl(`${baseUrl()}/panel?token=${encodeURIComponent(authToken())}`);
      draw(state);
    });
  }

  draw(state);
  await streamEvents(state, () => draw(state));
  return 0;
}

function draw(s: PanelState): void {
  const w = Math.max(38, Math.min(process.stdout.columns ?? 60, 100));
  const lines: string[] = [];
  const rule = A.dim + '─'.repeat(w) + A.reset;

  lines.push(`${A.accent}${A.bold}  shorts${A.reset}${A.dim}  while you wait${A.reset}`);
  lines.push(rule);

  if (s.searching) {
    lines.push('');
    lines.push(`  ${A.accent}searching…${A.reset}`);
    lines.push(`  ${A.dim}${truncate(s.offer?.topic.query ?? '', w - 4)}${A.reset}`);
  } else if (s.offer && !s.batch) {
    lines.push('');
    lines.push(`  ${A.dim}spotted in your message${A.reset}`);
    lines.push(`  ${A.bold}${truncate(s.offer.topic.label, w - 4)}${A.reset}`);
    lines.push('');
    lines.push(`  ${A.accent}${A.bold}[f]${A.reset} find shorts    ${A.dim}[n] not now${A.reset}`);
    lines.push('');
    lines.push(`  ${A.dim}${s.offer.cached ? 'already cached, costs nothing' : "uses one of today's searches"}${A.reset}`);
  } else if (!s.batch) {
    lines.push('');
    lines.push(`  ${A.muted}${s.note}${A.reset}`);
    lines.push('');
    lines.push(`  ${A.dim}Ask Claude something. If there is a concept worth`);
    lines.push(`  explaining, a button appears here.${A.reset}`);
    lines.push('');
    lines.push(`  ${A.dim}shorts ask "cap theorem"   search right now${A.reset}`);
  } else {
    const b = s.batch;
    lines.push(`  ${A.bold}${truncate(b.topic.label, w - 4)}${A.reset}`);
    lines.push(`  ${A.dim}"${truncate(b.topic.query, w - 12)}" · ${b.cached ? 'cached' : 'fresh'} · ${b.source}${A.reset}`);
    lines.push('');
    b.videos.forEach((v, i) => {
      const sel = i === s.index;
      const marker = sel ? `${A.accent}▸${A.reset}` : ' ';
      const title = truncate(v.title, w - 12);
      lines.push(`  ${marker} ${sel ? A.bold : ''}${title}${A.reset}`);
      lines.push(`    ${A.muted}${truncate(v.channel, w - 20)} · ${fmtDur(v.durationSec)}${A.reset}`);
    });
  }

  lines.push('');
  lines.push(rule);
  const dot = s.connected ? `${A.ok}●${A.reset}` : `${A.dim}○${A.reset}`;
  const help = s.offer && !s.batch
    ? 'f find · n skip · a full panel · q quit'
    : 'j/k move · enter open · a full panel · q quit';
  lines.push(`  ${dot} ${A.dim}${help}${A.reset}`);
  if (s.quota) lines.push(`  ${A.dim}${s.quota}${A.reset}`);

  process.stdout.write(A.clear + lines.join('\n') + '\n');
}

function truncate(s: string, n: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, Math.max(1, n - 1)) + '…';
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${sec % 60}s` : `${sec}s`;
}

export function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Minimal SSE reader over fetch. Reconnects with backoff, because the daemon
 * restarting should not require restarting the panel.
 */
async function streamEvents(state: PanelState, onChange: () => void): Promise<void> {
  const url = `${baseUrl()}/events?token=${encodeURIComponent(authToken())}`;
  let backoff = 500;

  for (;;) {
    try {
      const res = await fetch(url, { headers: { accept: 'text/event-stream' } });
      if (!res.ok || !res.body) throw new Error(`stream returned ${res.status}`);
      state.connected = true;
      state.note = 'waiting for your next message';
      backoff = 500;
      onChange();

      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          handleFrame(frame, state, onChange);
        }
      }
      throw new Error('stream ended');
    } catch (e) {
      state.connected = false;
      state.note = `daemon unreachable (${(e as Error).message}); retrying`;
      onChange();
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 10_000);
    }
  }
}

/** Turn the pending offer into a real search. The only place the TUI spends quota. */
async function accept(state: PanelState, onChange: () => void): Promise<void> {
  if (!state.offer) return;
  state.searching = true;
  onChange();
  try {
    const res = await fetch(`${baseUrl()}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken()}` },
      body: JSON.stringify({ offerId: state.offer.id }),
    });
    const body = await res.json() as { ok?: boolean; reason?: string; error?: string };
    // On success the suggestion also arrives over SSE, which does the rendering.
    if (!body.ok) state.note = `no luck: ${body.reason ?? body.error ?? res.status}`;
  } catch (e) {
    state.note = `search failed: ${(e as Error).message}`;
  } finally {
    state.searching = false;
    onChange();
  }
}

function handleFrame(frame: string, state: PanelState, onChange: () => void): void {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return;

  let parsed: any;
  try { parsed = JSON.parse(data.join('\n')); } catch { return; }

  if (event === 'offer') {
    state.offer = parsed as Offer;
    state.batch = null;
    state.index = 0;
  } else if (event === 'suggestion') {
    state.batch = parsed as Suggestion;
    state.offer = null;
    state.index = 0;
  } else if (event === 'status') {
    const q = parsed.quota;
    state.quota = parsed.provider === 'youtube'
      ? `${q.remaining}/${q.limit} searches left today · ${parsed.cache.entries} cached`
      : `${parsed.provider} · ${parsed.cache.entries} cached`;
  } else if (event === 'skip') {
    if (!state.batch && !state.offer) state.note = `nothing to offer: ${parsed.reason}`;
  }
  onChange();
}
