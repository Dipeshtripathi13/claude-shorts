import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, configPath, authToken, baseUrl } from '../config.js';

/**
 * `shorts setup` — wire the tool into Claude Code and print what to do for the
 * other surfaces. Everything it writes is reversible with `shorts setup --undo`.
 */

const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'] as const;
const MARKER = 'claude-shorts';

interface HookEntry { type: string; command: string; timeout?: number }
interface HookMatcher { matcher?: string; hooks: HookEntry[] }

export async function runSetup(argv: string[]): Promise<number> {
  const undo = argv.includes('--undo');
  const settingsPath = argv.includes('--project')
    ? join(process.cwd(), '.claude', 'settings.json')
    : join(homedir(), '.claude', 'settings.json');

  if (undo) return removeHooks(settingsPath);

  const cfg = loadConfig();
  const interactive = process.stdin.isTTY && !argv.includes('--yes');

  console.log('\n  claude-shorts setup\n  ' + '─'.repeat(46) + '\n');

  if (interactive && !cfg.youtube.apiKey && cfg.provider === 'youtube') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('  Discovery needs a source. The default is the official YouTube');
    console.log('  Data API, which needs a free key from a Google Cloud project:');
    console.log('    https://console.cloud.google.com/apis/library/youtube.googleapis.com\n');
    console.log('  Leave blank to use yt-dlp instead (no key, needs yt-dlp on PATH).\n');
    const key = (await rl.question('  YouTube API key: ')).trim();
    if (key) {
      cfg.youtube.apiKey = key;
    } else {
      cfg.provider = 'ytdlp';
      console.log('  → falling back to the yt-dlp provider.');
    }
    rl.close();
    saveConfig(cfg);
    console.log(`  saved ${configPath()}\n`);
  }

  const code = installHooks(settingsPath);
  if (code !== 0) return code;

  const token = authToken();
  console.log('  Hooks installed in ' + settingsPath);
  console.log('    ' + HOOK_EVENTS.join(', ') + '\n');
  console.log('  Next\n');
  console.log('    1. Terminal panel, in a split next to Claude Code:');
  console.log('         shorts panel\n');
  console.log('    2. Browser panel (Claude Desktop, or just a spare tab):');
  console.log('         shorts panel --web\n');
  console.log('    3. Browser extension for claude.ai and chatgpt.com:');
  console.log('         load extension/ unpacked at chrome://extensions,');
  console.log('         then run `shorts pair` and click Pair in its options.\n');
  console.log('    4. VS Code sidebar:');
  console.log('         install the extension in vscode/, then open the');
  console.log('         "Shorts" view in the activity bar.\n');
  console.log('  Panel URL   ' + baseUrl() + '/panel?token=' + token.slice(0, 6) + '…');
  console.log('  Config      ' + configPath());
  console.log('\n  Undo any time with: shorts setup --undo\n');
  return 0;
}

/** Recognises both the `shorts hook` form and the absolute-path fallback. */
function isOurs(h: HookEntry): boolean {
  const c = h.command ?? '';
  return c.includes(MARKER) || /(?:^|[\s"'/\\])shorts(?:\.js)?["']?\s+hook\b/.test(c) || /cli\.js["']?\s+hook\b/.test(c);
}

function readSettings(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`  ${path} is not valid JSON; refusing to touch it.`);
    console.error(`  ${(e as Error).message}`);
    throw e;
  }
}

/**
 * Prefer the short `shorts hook`, but only if it actually resolves — otherwise a
 * git checkout silently installs a hook that Claude Code cannot run. Falling
 * back to absolute paths makes `npm start`-style development work unchanged.
 */
function hookCommand(): string {
  if (process.env.SHORTS_HOOK_COMMAND) return process.env.SHORTS_HOOK_COMMAND;
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['shorts'], { stdio: 'pipe' });
    return 'shorts hook';
  } catch {
    const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
    return `${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} hook`;
  }
}

function installHooks(path: string): number {
  let settings: Record<string, any>;
  try { settings = readSettings(path); } catch { return 1; }

  if (existsSync(path)) {
    const backup = `${path}.backup.claude-shorts.${Date.now()}`;
    copyFileSync(path, backup);
    console.log(`  backed up existing settings to ${backup}`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }

  settings.hooks ??= {};
  const cmd = hookCommand();

  for (const event of HOOK_EVENTS) {
    const list: HookMatcher[] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    // Drop any previous install so re-running setup is idempotent.
    const cleaned = list
      .map((m) => ({ ...m, hooks: (m.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((m) => m.hooks.length > 0);

    cleaned.push({ hooks: [{ type: 'command', command: cmd, timeout: 5 }] });
    settings.hooks[event] = cleaned;
  }

  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  return 0;
}

function removeHooks(path: string): number {
  if (!existsSync(path)) { console.log(`  nothing to undo: ${path} does not exist`); return 0; }
  let settings: Record<string, any>;
  try { settings = readSettings(path); } catch { return 1; }

  let removed = 0;
  for (const event of HOOK_EVENTS) {
    const list: HookMatcher[] = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
    const cleaned = list
      .map((m) => {
        const before = m.hooks?.length ?? 0;
        const hooks = (m.hooks ?? []).filter((h) => !isOurs(h));
        removed += before - hooks.length;
        return { ...m, hooks };
      })
      .filter((m) => m.hooks.length > 0);
    if (cleaned.length) settings.hooks[event] = cleaned;
    else delete settings.hooks?.[event];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  console.log(`  removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'} from ${path}`);
  console.log('  config and cache are untouched; delete ~/.config/claude-shorts to remove them.');
  return 0;
}
