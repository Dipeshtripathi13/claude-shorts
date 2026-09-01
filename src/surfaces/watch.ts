import { watch, readdirSync, statSync, createReadStream, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DaemonClient } from '../client.js';
import { log } from '../log.js';

/**
 * Hook-free fallback: tail Claude Code's own session transcripts.
 *
 * Claude Code appends every turn to ~/.claude/projects/<slug>/<session>.jsonl.
 * Following those files gives the same signal as the UserPromptSubmit hook
 * without touching settings.json — useful for trying the tool out, for locked
 * down machines, and for watching sessions started before install.
 *
 * The hook is still the better path: it fires on submit, whereas the transcript
 * lands a moment later.
 */
const PROJECTS = join(homedir(), '.claude', 'projects');

interface Cursor { offset: number; }

export async function runWatch(): Promise<number> {
  if (!existsSync(PROJECTS)) {
    log.error(`no Claude Code transcripts at ${PROJECTS}`);
    return 1;
  }

  const client = new DaemonClient();
  if (!(await client.ensureRunning())) {
    log.error('could not reach or start the daemon');
    return 1;
  }

  const cursors = new Map<string, Cursor>();
  // Start at the end of every existing file: replaying history would fire a
  // burst of stale suggestions the moment the watcher starts.
  for (const f of allTranscripts()) {
    try { cursors.set(f, { offset: statSync(f).size }); } catch { /* vanished */ }
  }
  log.info(`watching ${cursors.size} transcript(s) under ${PROJECTS}`);

  const pump = async (file: string) => {
    const cur = cursors.get(file) ?? { offset: 0 };
    cursors.set(file, cur);
    let size: number;
    try { size = statSync(file).size; } catch { return; }
    if (size <= cur.offset) {
      if (size < cur.offset) cur.offset = 0;   // file was truncated or rotated
      return;
    }
    const start = cur.offset;
    cur.offset = size;
    await readRange(file, start, size, client);
  };

  watch(PROJECTS, { recursive: true }, (_evt, name) => {
    if (!name || !name.endsWith('.jsonl')) return;
    void pump(join(PROJECTS, name)).catch((e) => log.debug('pump failed:', e));
  });

  // fs.watch misses some writes on network and container filesystems.
  const poll = setInterval(() => {
    for (const f of allTranscripts()) void pump(f).catch(() => {});
  }, 2000);
  poll.unref?.();

  await new Promise(() => { /* run until killed */ });
  return 0;
}

function allTranscripts(): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(PROJECTS);
  return out;
}

async function readRange(file: string, start: number, end: number, client: DaemonClient): Promise<void> {
  const sessionId = file.split('/').pop()?.replace(/\.jsonl$/, '') ?? file;
  const rl = createInterface({ input: createReadStream(file, { start, end }), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }

    const text = extractUserText(rec);
    if (text) {
      await client.sendEvent({
        source: 'claude-code', sessionId, role: 'user', text, state: 'thinking', cwd: rec.cwd,
      }).catch(() => {});
    } else if (rec?.type === 'assistant') {
      await client.sendEvent({
        source: 'claude-code', sessionId, role: 'assistant', text: '', state: 'idle', cwd: rec.cwd,
      }).catch(() => {});
    }
  }
}

/** Pull the human's words out of a transcript record, skipping tool results. */
function extractUserText(rec: any): string | null {
  if (rec?.type !== 'user') return null;
  if (rec.isMeta || rec.isCompactSummary) return null;
  const content = rec.message?.content;

  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    // tool_result blocks are Claude talking to itself, not the user asking.
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  const joined = parts.join('\n').trim();
  if (!joined) return null;
  // Hook and command wrappers are machine chatter, not questions.
  if (/^<(?:command-name|local-command|system-reminder|user-prompt-submit-hook)/.test(joined)) return null;
  return joined;
}
