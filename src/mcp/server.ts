import { createInterface } from 'node:readline';
import { loadConfig } from '../config.js';
import { Suggester } from '../core/suggest.js';
import { DaemonClient } from '../client.js';
import type { Suggestion } from '../types.js';

/**
 * MCP stdio server for Claude Desktop.
 *
 * Claude Desktop has no hook API, so it cannot be watched the way Claude Code
 * can. What it does have is MCP, which inverts the trigger: instead of the tool
 * noticing a good moment, the model asks. That is a worse fit for "fill the
 * dead time" but a better fit for "I asked and want to see clips", and it is
 * the only sanctioned way in.
 *
 * Implemented directly against JSON-RPC 2.0 to keep the package dependency-free.
 */

const PROTOCOL_VERSION = '2024-11-05';

interface Rpc { jsonrpc: '2.0'; id?: number | string | null; method?: string; params?: any; }

const TOOLS = [
  {
    name: 'suggest_shorts',
    description:
      'Find short explainer videos (YouTube Shorts) about a topic the user is working on or asking about. ' +
      'Use when the user asks for a video, or explicitly asks to see clips while waiting on a long task. ' +
      'Returns titles and links; it does not play anything.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The concept to explain, e.g. "database migration" or "photosynthesis".' },
        count: { type: 'integer', description: 'How many to return (1-10).', minimum: 1, maximum: 10 },
      },
      required: ['topic'],
    },
  },
  {
    name: 'open_shorts_panel',
    description:
      'Open the local claude-shorts panel in the browser so the user can watch suggestions as they arrive.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

export async function runMcpServer(): Promise<number> {
  const cfg = loadConfig();
  const suggester = new Suggester(cfg);
  const client = new DaemonClient();

  const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');
  const reply = (id: Rpc['id'], result: unknown) => write({ jsonrpc: '2.0', id, result });
  const fail = (id: Rpc['id'], code: number, message: string) =>
    write({ jsonrpc: '2.0', id, error: { code, message } });

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let req: Rpc;
    try {
      req = JSON.parse(line) as Rpc;
    } catch {
      fail(null, -32700, 'parse error');
      continue;
    }

    // Notifications carry no id and expect no response.
    const isNotification = req.id === undefined;

    try {
      switch (req.method) {
        case 'initialize':
          reply(req.id, {
            protocolVersion: req.params?.protocolVersion ?? PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'claude-shorts', version: '0.1.0' },
          });
          break;

        case 'notifications/initialized':
        case 'notifications/cancelled':
          break;

        case 'ping':
          reply(req.id, {});
          break;

        case 'tools/list':
          reply(req.id, { tools: TOOLS });
          break;

        case 'tools/call': {
          const name = req.params?.name;
          const args = req.params?.arguments ?? {};

          if (name === 'open_shorts_panel') {
            const up = await client.ensureRunning();
            reply(req.id, text(up
              ? `Panel is running. Open it here: ${client.panelUrl()}`
              : 'Could not start the local daemon. Run `shorts serve` in a terminal.'));
            break;
          }

          if (name !== 'suggest_shorts') {
            fail(req.id, -32602, `unknown tool "${name}"`);
            break;
          }

          const topic = String(args.topic ?? '').trim();
          if (!topic) { reply(req.id, text('No topic given.', true)); break; }

          const outcome = await suggester.suggest({
            text: topic, sessionId: 'mcp', source: 'claude-desktop', force: true,
          });
          suggester.cache.flush();

          if (!outcome.ok) { reply(req.id, text(`No Shorts found: ${outcome.reason}`, true)); break; }

          // Push to any open panel too, so the user can watch rather than read links.
          void client.post('/ask', { text: topic, sessionId: 'mcp', source: 'claude-desktop' }).catch(() => {});
          reply(req.id, text(format(outcome.suggestion)));
          break;
        }

        default:
          if (!isNotification) fail(req.id, -32601, `method not found: ${req.method}`);
      }
    } catch (e) {
      if (!isNotification) fail(req.id, -32603, (e as Error).message);
    }
  }

  suggester.cache.flush();
  return 0;
}

function text(body: string, isError = false) {
  return { content: [{ type: 'text', text: body }], isError };
}

function format(s: Suggestion): string {
  const lines = [`Shorts about "${s.topic.label}" (searched "${s.topic.query}"):`, ''];
  s.videos.forEach((v, i) => {
    const m = Math.floor(v.durationSec / 60);
    const dur = m ? `${m}m${v.durationSec % 60}s` : `${v.durationSec}s`;
    lines.push(`${i + 1}. ${v.title} — ${v.channel} (${dur})`);
    lines.push(`   ${v.url}`);
  });
  return lines.join('\n');
}
