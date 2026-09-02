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
import { execFileSync } from 'node:child_process';

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
