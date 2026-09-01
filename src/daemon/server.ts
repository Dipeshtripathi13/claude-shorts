import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig, authToken, type Config } from '../config.js';
import { Suggester } from '../core/suggest.js';
import { SessionManager } from './sessions.js';
import { panelHtml } from './panel.js';
import type { ConversationEvent, Offer, Suggestion } from '../types.js';
import { log } from '../log.js';

interface Client { id: number; res: ServerResponse; }

/** Origins allowed to talk to the daemon. Everything else is a drive-by. */
function originAllowed(origin: string | undefined, cfg: Config): boolean {
  if (!origin || origin === 'null') return true;                  // curl, hooks, VS Code
  if (/^chrome-extension:\/\//.test(origin)) return true;
  if (/^moz-extension:\/\//.test(origin)) return true;
  if (/^vscode-webview:\/\//.test(origin)) return true;
  return origin === `http://${cfg.server.host}:${cfg.server.port}`
      || origin === `http://localhost:${cfg.server.port}`
      || origin === `http://127.0.0.1:${cfg.server.port}`;
}

/**
 * Rejects DNS-rebinding: an attacker page can point a hostname at 127.0.0.1,
 * but it cannot forge the Host header we require.
 */
function hostAllowed(host: string | undefined, cfg: Config): boolean {
  if (!host) return false;
  const name = host.split(':')[0]!;
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === cfg.server.host;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export class ShortsDaemon {
  private cfg: Config;
  private token: string;
  private suggester: Suggester;
  private sessions: SessionManager;
  private clients = new Map<number, Client>();
  private nextClientId = 1;
  private recent: Suggestion[] = [];
  /** The most recent offer, replayed to panels that connect late. */
  private lastOffer: Offer | null = null;
  private pairingUntil = 0;
  private server = createServer((req, res) => { void this.route(req, res); });

  constructor(cfg = loadConfig()) {
    this.cfg = cfg;
    this.token = authToken();
    this.suggester = new Suggester(cfg);
    this.sessions = new SessionManager(
      cfg,
      this.suggester,
      (s) => this.publish(s),
      (o) => this.publishOffer(o),
      (sessionId, reason) => this.broadcast('skip', { sessionId, reason }),
    );
  }

  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.cfg.server.port, this.cfg.server.host, () => {
        resolve(`http://${this.cfg.server.host}:${this.cfg.server.port}`);
      });
    });
  }

  async close(): Promise<void> {
    this.sessions.shutdown();
    this.suggester.cache.flush();
    for (const c of this.clients.values()) c.res.end();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Opens a window during which /pair hands out the token to a local client. */
  openPairing(ms = 120_000): number {
    this.pairingUntil = Date.now() + ms;
    return this.pairingUntil;
  }

  private publish(s: Suggestion): void {
    this.recent.unshift(s);
    this.recent = this.recent.slice(0, 30);
    this.lastOffer = null;          // the button has been spent
    this.broadcast('suggestion', s);
  }

  private publishOffer(o: Offer): void {
    this.lastOffer = o;
    this.broadcast('offer', o);
  }

  private broadcast(event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, c] of this.clients) {
      try { c.res.write(frame); } catch { this.clients.delete(id); }
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const origin = req.headers.origin as string | undefined;

    if (!hostAllowed(req.headers.host, this.cfg)) return send(res, 403, { error: 'bad host' });
    if (!originAllowed(origin, this.cfg)) return send(res, 403, { error: 'origin not allowed' });

    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return send(res, 204, null);

    // --- unauthenticated endpoints -------------------------------------------
    if (url.pathname === '/health') {
      return send(res, 200, { ok: true, version: 1, provider: this.suggester.providerName });
    }
    if (url.pathname === '/pair' && req.method === 'POST') {
      if (Date.now() > this.pairingUntil) {
        return send(res, 403, { error: 'pairing window closed; run `shorts pair` first' });
      }
      return send(res, 200, { token: this.token });
    }

    // --- everything below needs the token ------------------------------------
    if (!this.authorized(req, url)) return send(res, 401, { error: 'missing or bad token' });

    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /panel': {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return void res.end(panelHtml());
        }
        case 'GET /events': return this.streamEvents(req, res);
        case 'GET /status': return send(res, 200, this.status());
        case 'GET /suggestions':
          return send(res, 200, { suggestions: this.recent.slice(0, Number(url.searchParams.get('limit') ?? 10)) });

        case 'POST /event': {
          const ev = await readJson<ConversationEvent>(req);
          if (!ev?.sessionId || !ev?.role) return send(res, 400, { error: 'need sessionId and role' });
          // Text may be empty: an idle/Stop event carries no words, and it is
          // exactly the event that cancels a pending suggestion.
          if (ev.role === 'user' && !ev.text) return send(res, 400, { error: 'user events need text' });
          ev.text ??= '';
          this.sessions.handle(ev);
          return send(res, 202, { accepted: true });
        }

        case 'POST /ask': {
          const body = await readJson<{ text: string; sessionId?: string; source?: ConversationEvent['source'] }>(req);
          if (!body?.text) return send(res, 400, { error: 'need text' });
          const outcome = await this.suggester.suggest({
            text: body.text,
            sessionId: body.sessionId ?? 'manual',
            source: body.source ?? 'manual',
            force: true,
          });
          if (!outcome.ok) return send(res, 200, { ok: false, reason: outcome.reason, topic: outcome.topic ?? null });
          this.publish(outcome.suggestion);
          return send(res, 200, { ok: true, suggestion: outcome.suggestion });
        }

        case 'POST /accept': {
          const body = await readJson<{ offerId?: string; sessionId?: string }>(req);
          const offer = body?.offerId ? this.sessions.offerById(body.offerId) : this.lastOffer;
          if (!offer) return send(res, 404, { error: 'that offer has expired; send another message' });

          const outcome = await this.suggester.fetch(offer.topic, {
            sessionId: offer.sessionId,
            source: offer.source,
            seen: this.sessions.seenFor(offer.sessionId),
          });
          if (!outcome.ok) {
            this.broadcast('skip', { sessionId: offer.sessionId, reason: outcome.reason });
            return send(res, 200, { ok: false, reason: outcome.reason });
          }
          this.sessions.accepted(outcome.suggestion);
          log.info(`accepted "${outcome.suggestion.topic.query}" (${outcome.suggestion.videos.length} shorts, ${outcome.suggestion.cached ? 'cached' : 'fresh'})`);
          this.publish(outcome.suggestion);
          return send(res, 200, { ok: true, suggestion: outcome.suggestion });
        }

        case 'POST /feedback': {
          const body = await readJson<{ sessionId: string; videoIds?: string[] }>(req);
          if (body?.sessionId) this.sessions.mute(body.sessionId, body.videoIds ?? []);
          return send(res, 200, { ok: true });
        }

        case 'POST /pair-open': {
          const until = this.openPairing();
          return send(res, 200, { ok: true, until });
        }

        case 'POST /reload': {
          this.cfg = loadConfig(true);
          this.suggester.reconfigure(this.cfg);
          this.sessions.reconfigure(this.cfg);
          return send(res, 200, { ok: true, provider: this.suggester.providerName });
        }

        default:
          return send(res, 404, { error: 'not found' });
      }
    } catch (e) {
      log.error('request failed:', e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const supplied = bearer ?? url.searchParams.get('token');
    return !!supplied && safeEqual(supplied, this.token);
  }

  private streamEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const id = this.nextClientId++;
    this.clients.set(id, { id, res });
    res.write(`retry: 2000\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify(this.status())}\n\n`);
    for (const s of this.recent.slice(0, 3).reverse()) {
      res.write(`event: suggestion\ndata: ${JSON.stringify(s)}\n\n`);
    }
    // A panel opened after the prompt still needs to see the button.
    if (this.lastOffer) {
      res.write(`event: offer\ndata: ${JSON.stringify(this.lastOffer)}\n\n`);
    }

    // Proxies and sleeping laptops kill idle streams; a comment keeps it warm.
    const beat = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { /* cleanup below */ }
    }, 25_000);
    beat.unref?.();

    const cleanup = () => { clearInterval(beat); this.clients.delete(id); };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  status() {
    return {
      provider: this.suggester.providerName,
      quota: this.suggester.quota.status(),
      cache: this.suggester.cache.stats(),
      sessions: this.sessions.list(),
      panels: this.clients.size,
      trigger: this.cfg.trigger,
      mode: this.cfg.trigger.mode,
    };
  }
}

function send(res: ServerResponse, code: number, body: unknown): void {
  if (body === null) { res.writeHead(code); return void res.end(); }
  const json = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

async function readJson<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 512 * 1024) throw new Error('request body too large');
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; } catch { return null; }
}
