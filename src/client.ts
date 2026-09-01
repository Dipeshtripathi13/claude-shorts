import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authToken, baseUrl, loadConfig } from './config.js';
import type { ConversationEvent, Suggestion } from './types.js';

/** Thin client for the local daemon, shared by the hook, the TUI and the CLI. */
export class DaemonClient {
  constructor(private base = baseUrl(), private token = authToken()) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.token}` };
  }

  async health(timeoutMs = 900): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async post<T>(path: string, body: unknown, timeoutMs = 5000): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} returned ${res.status}: ${await res.text()}`);
    return await res.json() as T;
  }

  async get<T>(path: string, timeoutMs = 5000): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return await res.json() as T;
  }

  sendEvent(ev: ConversationEvent): Promise<{ accepted: boolean }> {
    return this.post('/event', ev, 2500);
  }

  ask(text: string, sessionId = 'manual'): Promise<{ ok: boolean; suggestion?: Suggestion; reason?: string }> {
    return this.post('/ask', { text, sessionId, source: 'manual' }, 30_000);
  }

  panelUrl(): string {
    return `${this.base}/panel?token=${encodeURIComponent(this.token)}`;
  }

  /**
   * Start the daemon in the background if it is not already up.
   * Detached, so it outlives the CLI invocation that spawned it.
   */
  async ensureRunning(waitMs = 6000): Promise<boolean> {
    if (await this.health()) return true;

    const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
    const child = spawn(process.execPath, [cli, 'serve'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, SHORTS_LOG: process.env.SHORTS_LOG ?? 'warn' },
    });
    child.unref();

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      if (await this.health()) return true;
    }
    return false;
  }
}

export const defaultClient = (): DaemonClient => {
  loadConfig();
  return new DaemonClient();
};
