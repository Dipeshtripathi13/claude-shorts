#!/usr/bin/env node
import { loadConfig, configPath, authToken, baseUrl } from './config.js';
import { setLevel, log } from './log.js';
import { DaemonClient } from './client.js';
import { ShortsDaemon } from './daemon/server.js';
import { Suggester } from './core/suggest.js';
import { runHook } from './surfaces/hook.js';
import { runTui, openUrl } from './surfaces/tui.js';
import { runWatch } from './surfaces/watch.js';
import { runSetup } from './surfaces/setup.js';
import { makeProvider } from './providers/index.js';

const USAGE = `
  shorts — relevant YouTube Shorts while the model thinks

  Setup
    shorts setup [--project] [--yes]   install Claude Code hooks (backs up settings)
    shorts setup --undo                remove them again
    shorts pair                        open a 2-minute window for the browser extension
    shorts doctor                      check config, provider and daemon health

  Watch
    shorts panel [--web]               terminal panel, or open the browser panel
    shorts serve                       run the daemon in the foreground
    shorts watch                       follow Claude Code transcripts without hooks

  Ad hoc
    shorts ask "<text>"                suggest for this text right now
    shorts topic "<text>"              show what would be extracted, search nothing
    shorts status                      provider, quota, cache, live sessions
    shorts cache clear                 drop cached results

  Plumbing
    shorts hook                        Claude Code hook entry point (reads stdin)
    shorts mcp                         MCP stdio server for Claude Desktop

  Config  ~/.config/claude-shorts/config.json
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? 'help';
  const rest = argv.slice(1);

  if (argv.includes('--verbose')) setLevel('debug');
  if (argv.includes('--quiet')) setLevel('error');

  switch (cmd) {
    case 'hook':
      setLevel(process.env.SHORTS_LOG ? (process.env.SHORTS_LOG as 'debug') : 'error');
      return runHook(rest);

    case 'serve': return serve();
    case 'panel': return rest.includes('--web') ? webPanel() : runTui();
    case 'watch': return runWatch();
    case 'setup': return runSetup(rest);
    case 'mcp': {
      const { runMcpServer } = await import('./mcp/server.js');
      return runMcpServer();
    }

    case 'ask': return ask(rest.join(' '));
    case 'topic': return showTopic(rest.join(' '));
    case 'status': return status();
    case 'pair': return pair();
    case 'token': process.stdout.write(authToken() + '\n'); return 0;
    case 'cache': return cache(rest);
    case 'doctor': return doctor();

    case 'help': case '--help': case '-h':
      process.stdout.write(USAGE);
      return 0;
    case 'version': case '--version': case '-v':
      process.stdout.write('claude-shorts 0.1.0\n');
      return 0;

    default:
      process.stderr.write(`unknown command "${cmd}"\n${USAGE}`);
      return 1;
  }
}

async function serve(): Promise<number> {
  const daemon = new ShortsDaemon();
  try {
    const url = await daemon.listen();
    log.info(`daemon listening on ${url}`);
    log.info(`panel: ${url}/panel?token=${authToken()}`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EADDRINUSE') {
      log.error(`port ${loadConfig().server.port} is already in use — another daemon is probably running.`);
      return 1;
    }
    throw e;
  }

  const stop = async () => { await daemon.close(); process.exit(0); };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  await new Promise(() => { /* until signalled */ });
  return 0;
}

async function webPanel(): Promise<number> {
  const client = new DaemonClient();
  if (!(await client.ensureRunning())) {
    log.error('could not start the daemon; try `shorts serve` to see why');
    return 1;
  }
  const url = client.panelUrl();
  console.log(url);
  openUrl(url);
  return 0;
}

async function ask(text: string): Promise<number> {
  if (!text.trim()) { log.error('usage: shorts ask "<text>"'); return 1; }

  const client = new DaemonClient();
  if (await client.health()) {
    const r = await client.ask(text);
    if (!r.ok) { console.log(`no suggestion: ${r.reason}`); return 1; }
    printSuggestion(r.suggestion!);
    return 0;
  }

  // No daemon: answer directly so `shorts ask` always works.
  const cfg = loadConfig();
  const suggester = new Suggester(cfg);
  const outcome = await suggester.suggest({ text, sessionId: 'cli', source: 'manual', force: true });
  suggester.cache.flush();
  if (!outcome.ok) { console.log(`no suggestion: ${outcome.reason}`); return 1; }
  printSuggestion(outcome.suggestion);
  return 0;
}

function printSuggestion(s: { topic: { label: string; query: string; confidence: number; kind: string }; cached: boolean; videos: Array<{ title: string; channel: string; durationSec: number; url: string }> }): void {
  const dim = '\x1b[2m', reset = '\x1b[0m', bold = '\x1b[1m';
  console.log(`\n  ${bold}${s.topic.label}${reset}`);
  console.log(`  ${dim}"${s.topic.query}" · ${s.topic.kind} · ${Math.round(s.topic.confidence * 100)}% · ${s.cached ? 'cached' : 'fresh'}${reset}\n`);
  s.videos.forEach((v, i) => {
    const m = Math.floor(v.durationSec / 60), sec = v.durationSec % 60;
    console.log(`  ${i + 1}. ${v.title}`);
    console.log(`     ${dim}${v.channel} · ${m ? m + 'm ' : ''}${sec}s · ${v.url}${reset}`);
  });
  console.log('');
}

function showTopic(text: string): number {
  if (!text.trim()) { log.error('usage: shorts topic "<text>"'); return 1; }
  const suggester = new Suggester(loadConfig());
  const topic = suggester.topicFor(text);
  const cfg = loadConfig();
  if (!topic) {
    // Always emit JSON so this command stays scriptable.
    console.log(JSON.stringify({ topic: null, wouldSuggest: false, reason: 'no teachable topic' }, null, 2));
    return 0;
  }
  console.log(JSON.stringify({
    ...topic,
    wouldSuggest: topic.confidence >= cfg.trigger.minConfidence,
    threshold: cfg.trigger.minConfidence,
  }, null, 2));
  return 0;
}

async function status(): Promise<number> {
  const client = new DaemonClient();
  if (!(await client.health())) {
    console.log('daemon: not running (start it with `shorts serve` or `shorts panel`)');
    return 1;
  }
  const s = await client.get<any>('/status');
  console.log(`daemon    ${baseUrl()}`);
  console.log(`provider  ${s.provider}`);
  if (s.provider === 'youtube') {
    console.log(`quota     ${s.quota.used}/${s.quota.limit} searches used, resets in ${s.quota.resetsInMin} min`);
  }
  console.log(`cache     ${s.cache.entries} topics, ${s.cache.hits} hits`);
  console.log(`panels    ${s.panels} connected`);
  console.log(`sessions  ${s.sessions.length}`);
  for (const sess of s.sessions) {
    console.log(`          ${sess.label} (${sess.source}) — ${sess.count} shown${sess.thinking ? ', thinking' : ''}`);
  }
  return 0;
}

async function pair(): Promise<number> {
  const client = new DaemonClient();
  if (!(await client.ensureRunning())) { log.error('daemon would not start'); return 1; }
  try {
    await client.post('/pair-open', {});
  } catch (e) {
    log.error('could not open a pairing window:', (e as Error).message);
    return 1;
  }
  console.log('\n  Pairing window open for 2 minutes.');
  console.log('  In the extension options, click "Pair with local daemon".');
  console.log(`  Or paste this token manually:\n\n    ${authToken()}\n`);
  return 0;
}

function cache(rest: string[]): number {
  const suggester = new Suggester(loadConfig());
  if (rest[0] === 'clear') {
    suggester.cache.clear();
    console.log('cache cleared');
    return 0;
  }
  console.log(JSON.stringify(suggester.cache.stats(), null, 2));
  return 0;
}

async function doctor(): Promise<number> {
  const cfg = loadConfig();
  const ok = (b: boolean) => (b ? '\x1b[32mok\x1b[0m' : '\x1b[31mno\x1b[0m');
  console.log('');
  console.log(`  config file     ${configPath()}`);
  console.log(`  provider        ${cfg.provider}`);

  const provider = makeProvider(cfg);
  const reason = await provider.unavailableReason();
  console.log(`  provider ready  ${ok(!reason)}${reason ? '  — ' + reason : ''}`);

  const client = new DaemonClient();
  const up = await client.health();
  console.log(`  daemon          ${ok(up)}  ${baseUrl()}`);

  if (up) {
    const s = await client.get<any>('/status').catch(() => null);
    if (s?.provider === 'youtube') {
      console.log(`  quota           ${s.quota.remaining}/${s.quota.limit} left today`);
    }
    console.log(`  panels open     ${s?.panels ?? 0}`);
  }

  const probe = new Suggester(cfg).topicFor('how does database migration work in postgres');
  console.log(`  extractor       ${ok(!!probe)}${probe ? '  — "' + probe.query + '"' : ''}`);
  console.log('');
  return reason || !probe ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { log.error(e); process.exitCode = 1; });
