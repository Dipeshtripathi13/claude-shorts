/**
 * Everything here runs *before* any text influences a network call.
 *
 * Two jobs:
 *  1. strip material that must never leave the machine (secrets, paths, URLs);
 *  2. strip material that would poison topic extraction anyway (code, logs, diffs).
 *
 * They happen to be the same material, which is why redaction is not optional.
 */

/** Patterns that mean "this prompt is sensitive; do not derive a query from it at all". */
const HARD_STOP: RegExp[] = [
  /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/,                 // OpenAI/Anthropic-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,                   // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/,                           // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,                 // Slack
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,  // JWT
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*\S+/i,
];

const SCRUB: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ' '],                          // fenced code
  [/~~~[\s\S]*?~~~/g, ' '],
  [/`[^`\n]{1,200}`/g, ' '],                         // inline code
  [/^\s*[+-]{1,3}\s.*$/gm, ' '],                     // diff hunks
  [/^\s*(?:at |File ")\S.*$/gm, ' '],                // stack frames
  [/https?:\/\/\S+/g, ' '],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' '],             // email
  [/(?:[A-Za-z]:)?[~.]?\/(?:[\w.-]+\/){1,}[\w.-]*/g, ' '],  // unix-ish paths
  [/\b[\w-]+\.(?:ts|tsx|js|jsx|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sql|json|yaml|yml|toml|md|sh|css|html)\b/gi, ' '],
  [/\b[0-9a-f]{16,}\b/gi, ' '],                      // hashes / blobs
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' '],             // IPv4
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, ' '],            // base64 blobs
  [/\$\{?[A-Z_][A-Z0-9_]{2,}\}?/g, ' '],             // env vars
  [/<[^>\n]{1,120}>/g, ' '],                         // tags / placeholders
  [/\b[\w-]+::[\w-]+\b/g, ' '],                      // Foo::bar
  [/\b\w+\([^)\n]{0,80}\)/g, ' '],                   // call sites
];

export interface RedactResult {
  text: string;
  /** True when the input tripped a hard-stop rule and must not be used. */
  blocked: boolean;
  reason?: string;
}

export function redact(input: string, extraDenyPatterns: string[] = []): RedactResult {
  const raw = input ?? '';
  for (const re of HARD_STOP) {
    if (re.test(raw)) return { text: '', blocked: true, reason: 'looks like it contains a credential' };
  }
  for (const src of extraDenyPatterns) {
    try {
      if (new RegExp(src, 'i').test(raw)) return { text: '', blocked: true, reason: `matched deny pattern /${src}/` };
    } catch {
      // A bad user regex should never take the pipeline down.
    }
  }

  let text = raw;
  for (const [re, sub] of SCRUB) text = text.replace(re, sub);
  text = text.replace(/[^\p{L}\p{N}\s'’-]+/gu, ' ').replace(/\s+/g, ' ').trim();

  return { text, blocked: false };
}

/** Cheap check used by the panel to show what actually left the machine. */
export function describeRedaction(before: string, after: string): string {
  const pct = before.length ? Math.round((1 - after.length / before.length) * 100) : 0;
  return `${before.length} chars in, ${after.length} out (${pct}% removed)`;
}
