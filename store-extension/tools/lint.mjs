#!/usr/bin/env node
/**
 * Fails the build on undeclared identifiers.
 *
 * A missing `let` is invisible to `node --check` (it is valid syntax) and only
 * shows up as a ReferenceError once the code runs in a browser — which is
 * exactly how a broken panel shipped. TypeScript can find these in plain JS.
 *
 * Only "cannot find name" diagnostics are treated as failures. Full type
 * checking of DOM-heavy extension code produces mostly noise about
 * getElementById returning HTMLElement, which would drown the real signal.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.check.json'], {
  cwd: ROOT, encoding: 'utf8',
});

const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`;
// TS2304: Cannot find name 'x'.  TS2552: Cannot find name 'x'. Did you mean 'y'?
const fatal = output.split('\n').filter((l) => /error TS(2304|2552):/.test(l));

if (fatal.length) {
  console.error('Undeclared identifiers:\n' + fatal.map((l) => `  ${l}`).join('\n'));
  process.exit(1);
}
console.log('  lint: no undeclared identifiers');
