# Contributing

## Getting set up

```bash
npm install
npm run build
npm test          # no API key and no network needed
```

Tests run against the `mock` provider, which returns deterministic fixtures, so
the whole pipeline — extraction, ranking, caching, quota, suggestion — is
exercised offline.

Run the daemon against mock data while you work on UI:

```bash
SHORTS_PROVIDER=mock SHORTS_LOG=debug node dist/cli.js serve
node dist/cli.js ask "what is a bloom filter"
```

## Layout

```
src/core/        extraction, ranking, cache, quota — pure logic, heavily tested
src/providers/   video sources behind one interface
src/daemon/      HTTP + SSE hub, session state machine, panel UI
src/surfaces/    hook, transcript watcher, terminal panel, setup
src/mcp/         MCP stdio server
extension/       MV3 browser extension
vscode/          VS Code sidebar extension
```

`docs/ARCHITECTURE.md` explains how they fit together.

## The one rule to protect

**Suggestions only appear during real dead time.** A prompt the model answers
quickly must produce nothing at all. Every gate in `daemon/sessions.ts` and
`core/suggest.ts` exists to keep this true, and it is what separates the tool
from a distraction machine.

If a change makes the tool speak more often, it needs a strong argument and a
test.

## Good first contributions

- **Lexicon coverage.** `core/lexicon.ts` is English- and CS-heavy. Adding solid
  vocabulary for medicine, law, music theory or another field is genuinely
  valuable and needs no architectural knowledge. Add a case to the extraction
  tests alongside it.
- **Firefox support.** The extension uses `chrome.sidePanel`; Firefox has an
  incompatible `sidebarAction`. A shim would open up a whole browser.
- **More `MECHANICAL_CUES`.** Real chore phrasings that should never trigger a
  suggestion. These are cheap, high-value and easy to test.
- **A better `looksProper` heuristic.** Proper-noun detection is currently a
  regex and misses plenty.

## Changing extraction

Extraction is the part most likely to regress invisibly. When you touch
`core/topic.ts`:

1. Add cases to `describe('extractTopic')` for both what should match **and**
   what should stay suppressed.
2. Check the confidence spread by hand — a change that pins everything at the
   ceiling has broken the threshold even if tests pass:

```bash
for t in "what is photosynthesis" "rerun the tests" "explain the CAP theorem"; do
  node dist/cli.js topic "$t"
done
```

## Style

- TypeScript, `strict`, no runtime dependencies. Please keep the dependency count
  at zero; it is why `npx claude-shorts` is instant.
- Comments explain *why*, not *what*. If a line encodes a constraint from
  YouTube's API or Claude Code's hook contract, say so — that is the context a
  future reader cannot recover from the code.
- No telemetry, ever.

## Reporting extraction bugs

Include the output of `shorts topic "<the text>"` and what you expected. That
single line is usually enough to diagnose it.
