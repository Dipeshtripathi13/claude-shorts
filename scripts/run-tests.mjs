#!/usr/bin/env node
/**
 * Runs the compiled test suite.
 *
 * This exists instead of a one-line `node --test ...` because every shorter
 * form breaks on some supported configuration:
 *
 *   node --test dist/test/*.test.js  - PowerShell does not expand globs, and
 *                                      Node 20's runner cannot expand them
 *                                      either, so Windows + Node 20 fails.
 *   node --test dist/test/           - Node 22 treats a path argument as a file
 *                                      to load, not a directory to scan.
 *   node --test                      - Node >=22.18 strips TypeScript by
 *                                      default, so discovery also picks up
 *                                      src/test/*.test.ts, whose ".js" imports
 *                                      only resolve after compilation.
 *
 * Enumerating the files here and passing them explicitly is deterministic on
 * every OS, shell and supported Node version.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = join(root, 'dist', 'test');

if (!existsSync(testDir)) {
  console.error(`No compiled tests at ${testDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => join(testDir, f));

// A silent pass with zero tests is worse than a failure: it looks like success.
if (files.length === 0) {
  console.error(`No *.test.js files in ${testDir}. Did the build succeed?`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
