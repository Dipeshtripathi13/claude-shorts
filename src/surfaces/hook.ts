import { DaemonClient } from '../client.js';
import type { ConversationEvent } from '../types.js';
import { log } from '../log.js';

/**
 * Claude Code hook entry point: `shorts hook` reads the event JSON on stdin.
 *
 * Two hard rules here, both about not being in the way:
 *
 *  1. Never write to stdout. For UserPromptSubmit, stdout is injected into
 *     Claude's context, so anything printed would poison the conversation with
 *     video titles. Suggestions travel out-of-band to the panel instead.
 *
 *  2. Always exit 0, fast. A hook that errors or hangs degrades every prompt the
 *     user types. Failure here means "no suggestion", never "broken session".
 */
interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  message?: string;
  source?: string;
  stop_hook_active?: boolean;
}

const HOOK_BUDGET_MS = 2500;

export async function runHook(argv: string[]): Promise<number> {
  const payload = await readStdin();
  if (!payload) return 0;

  const event = payload.hook_event_name ?? argv[0] ?? 'UserPromptSubmit';
  const sessionId = payload.session_id ?? 'claude-code';
  const ev = toEvent(event, payload, sessionId);
  if (!ev) return 0;

  const client = new DaemonClient();

  // Don't pay daemon-startup cost on a turn the user is waiting through: if the
  // daemon is down, start it and let this turn go unsuggested.
  if (!(await client.health(400))) {
    if (event === 'SessionStart' || event === 'UserPromptSubmit') {
      void client.ensureRunning(0).catch(() => {});
    }
    return 0;
  }

  try {
    await withTimeout(client.sendEvent(ev), HOOK_BUDGET_MS);
  } catch (e) {
    log.debug('hook delivery failed (ignored):', (e as Error).message);
  }
  return 0;
}

function toEvent(hookName: string, p: HookPayload, sessionId: string): ConversationEvent | null {
  switch (hookName) {
    case 'UserPromptSubmit':
      if (!p.prompt?.trim()) return null;
      return { source: 'claude-code', sessionId, role: 'user', text: p.prompt, state: 'thinking', cwd: p.cwd };

    // The model finished: the gap we were filling is over.
    case 'Stop':
    case 'SubagentStop':
      return { source: 'claude-code', sessionId, role: 'assistant', text: '', state: 'idle', cwd: p.cwd };

    // Claude is waiting on the user (permission prompt, idle). Also dead time,
    // but the user's attention is being asked for, so stand down.
    case 'Notification':
      return { source: 'claude-code', sessionId, role: 'assistant', text: '', state: 'idle', cwd: p.cwd };

    case 'SessionStart':
      return null;

    default:
      return null;
  }
}

async function readStdin(): Promise<HookPayload | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  try {
    for await (const c of process.stdin) {
      chunks.push(c as Buffer);
      if (chunks.reduce((a, b) => a + b.length, 0) > 1024 * 1024) break;
    }
  } catch {
    return null;
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as HookPayload;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('hook budget exceeded')), ms).unref?.()),
  ]);
}
