#!/usr/bin/env node
/**
 * Builds the upload zip for the Chrome Web Store.
 *
 * Ships only what the extension needs. Build tooling, the self-test and the
 * TypeScript config stay out: reviewers read what you upload, and every extra
 * file is one more thing to explain.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'load-unpacked');
const INCLUDE = ['manifest.json', 'icons', 'src'];

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

function listHtml(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listHtml(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/* ------------------------------------------------- check before packing */

const problems = [];

for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  if (!existsSync(join(ROOT, path))) problems.push(`icons.${size} missing: ${path} (run npm run build:icons)`);
}
for (const path of [
  manifest.background?.service_worker,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap((r) => r.resources ?? []),
]) {
  if (path && !existsSync(join(ROOT, path))) problems.push(`manifest references a missing file: ${path}`);
}
if (!existsSync(join(ROOT, 'src', 'generated', 'core', 'topic.js'))) {
  problems.push('src/generated is missing (run npm run build:core)');
}
if (!/^\d+\.\d+(\.\d+)?(\.\d+)?$/.test(manifest.version)) {
  problems.push(`version "${manifest.version}" is not a valid Chrome extension version`);
}

// Every local script and stylesheet an HTML page pulls in must exist. A missing
// one is silent in the browser but breaks the page, and it is easy to introduce
// by renaming a file.
for (const page of listHtml(join(ROOT, 'src'))) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|#|\/\/)/.test(ref)) continue;
    if (!existsSync(join(dirname(page), ref))) {
      problems.push(`${page.slice(ROOT.length + 1)} references a missing file: ${ref}`);
    }
  }
}

// The site list is repeated in three manifest fields. They must stay identical:
// a site in content_scripts but missing from host_permissions injects a script
// that cannot message the worker, and one missing from web_accessible_resources
// injects a panel that will not load. Both fail silently on that site alone.
{
  const sites = (manifest.content_scripts ?? []).flatMap((c) => c.additionalProperties ?? c.matches ?? []);
  const war = (manifest.web_accessible_resources ?? []).flatMap((r) => r.matches ?? []);
  const hosts = (manifest.host_permissions ?? []).filter((h) => !h.includes('googleapis.com'));
  const diff = (a, b) => a.filter((x) => !b.includes(x));

  for (const [label, missing] of [
    ['host_permissions', diff(sites, hosts)],
    ['web_accessible_resources', diff(sites, war)],
    ['content_scripts (listed as a host but never injected)', diff(hosts, sites)],
  ]) {
    if (missing.length) problems.push(`${label} is missing: ${missing.join(', ')}`);
  }
}

// A ReferenceError only appears at runtime, so check before packaging rather
// than after a user reports a blank panel.
const lint = spawnSync(process.execPath, [join(ROOT, 'tools', 'lint.mjs')], { cwd: ROOT, encoding: 'utf8' });
if (lint.status !== 0) {
  problems.push('undeclared identifiers found:\n' + (lint.stderr || lint.stdout).trim());
}

if (problems.length) {
  console.error('Cannot package:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

/* ------------------------------------------------------------- assemble */

rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
mkdirSync(join(ROOT, 'dist'), { recursive: true });

for (const entry of INCLUDE) {
  cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true });
}

// A visible build stamp: without one, "did the reload take?" is unanswerable
// from a screenshot, and stale-code confusion costs more than this line saves.
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const staged = JSON.parse(readFileSync(join(STAGE, 'manifest.json'), 'utf8'));
staged.version_name = `${manifest.version} build ${stamp}`;
writeFileSync(join(STAGE, 'manifest.json'), JSON.stringify(staged, null, 2) + '\n');

// Also emit it as a module. The browser can serve a cached manifest after an
// unpacked reload, which makes version_name an unreliable answer to "which code
// is running"; a module is loaded with the code itself, so it cannot disagree.
writeFileSync(
  join(STAGE, 'src', 'build.js'),
  `/** Written by tools/package.mjs. */\nexport const BUILD = '${stamp}';\n`,
);

const zipName = `tangent-${manifest.version}.zip`;
const zipPath = join(ROOT, 'dist', zipName);

try {
  // -r recurse, -q quiet, -X drop macOS resource forks the store does not want.
  execFileSync('zip', ['-rqX', zipPath, ...INCLUDE], { cwd: STAGE });
} catch (e) {
  console.error(`Could not run "zip": ${e.message}`);
  console.error(`The unpacked build is ready at ${STAGE} — zip its contents yourself.`);
  process.exit(1);
}

const bytes = readFileSync(zipPath).length;
console.log(`  ${zipName}  ${(bytes / 1024).toFixed(1)} KB`);
console.log('');
console.log('  Build stamp    ->  ' + stamp);
console.log('  Load unpacked  ->  ' + STAGE);
console.log('  Upload to store->  ' + zipPath);
