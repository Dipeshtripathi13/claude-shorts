# Architecture

## Shape

One daemon, many thin surfaces. Every integration does the same two things —
observe a turn, render a batch — so all the logic that could be wrong lives in
one process with one cache and one quota counter.

```
  ┌────────────────────────────────────────────────────────────┐
  │ surfaces (thin, replaceable)                               │
  │                                                            │
  │  shorts hook      browser extension    MCP server          │
  │  shorts watch     VS Code webview      shorts ask          │
  └───────────────┬────────────────────────────────────────────┘
                  │  POST /event  { source, sessionId, role, text, state }
                  ▼
  ┌────────────────────────────────────────────────────────────┐
  │ daemon  127.0.0.1:8787                                     │
  │                                                            │
  │  SessionManager ── when to speak (timers, cooldowns)       │
  │        │                                                   │
  │  Suggester ────── what to say                              │
  │    ├─ extractTopic   redact → lexicon → n-grams → score    │
  │    ├─ ResultCache    keyed by normalized topic             │
  │    ├─ QuotaTracker   100 searches/day, Pacific reset       │
  │    ├─ Provider       youtube | ytdlp | piped | mock        │
  │    └─ rankShorts     brevity, relevance, diversity         │
  └───────────────┬────────────────────────────────────────────┘
                  │  GET /events  (SSE)
                  ▼
        terminal panel · browser side panel · VS Code view
```

**Why SSE and not WebSockets.** Suggestions only travel one way. SSE is one-way,
reconnects on its own, and needs no dependency — the package ships with zero
runtime dependencies as a result.

**Why a daemon at all.** The quota is global to the user, not to a window. A
shared process means three open surfaces cost one search, and the cache survives
individual editors and tabs closing.

---

## The decision path

The pipeline is split in half by a human click. Everything above the line is
free and local; nothing below it runs until the user asks.

```
  turn arrives
      │
      ├─ mechanical cue?  ("yes", "rerun the tests", "/help")   → no button
      ├─ credential-shaped?                                      → no button, ever
      ├─ extract topic → confidence < minConfidence?             → no button
      │
      └─ raise an OFFER  ────────────────────────────▶ button in every open panel
                                                        (cost so far: zero)
  ═══════════════════════ the user clicks ═══════════════════════
      │
      ├─ cache hit?                                    → serve, spend nothing
      ├─ quota exhausted?                              → explain, spend nothing
      └─ provider search → rank → cache → broadcast    → 1 of 100
```

The ordering is the point. Extraction is cheap enough to run on every prompt, so
the expensive step can sit behind an explicit signal of intent rather than a
guess about one.

`trigger.mode: "auto"` restores the older behaviour — the daemon crosses the line
itself once the model has been busy `minThinkingMs`, disarming if the model
answers first. It is off by default because it spends quota on a guess.

---

## Modules

| File | Responsibility |
|---|---|
| `core/redact.ts` | Strip secrets and code before anything else sees the text. Hard-stops on credentials. |
| `core/lexicon.ts` | Curated concept vocabulary across CS, science, math and finance. A boost list, not a filter. |
| `core/topic.ts` | Redact → match curated phrases → score n-grams → query + confidence. |
| `core/rank.ts` | Re-rank for a 30-second attention gap: brevity, title relevance, channel diversity, anti-bait. |
| `core/cache.ts` | Topic-keyed disk cache. 30-day hard TTL ceiling per YouTube policy. |
| `core/quota.ts` | Daily search budget with a Pacific-midnight roll. |
| `core/suggest.ts` | `evaluate()` is free and local; `fetch()` is the only thing that spends quota. Collapses concurrent identical searches. |
| `daemon/sessions.ts` | Raises offers, and (in auto mode) runs the dead-time state machine. |
| `daemon/server.ts` | HTTP + SSE, token auth, origin and Host checks. |
| `daemon/panel.ts` | The single panel UI, shared by all three renderers. |

---

## Topic extraction

Heuristic on purpose: it must be fast enough to run on every prompt, free enough
to run unlimited times, and local enough that prompts never leave the machine
just to be understood.

1. **Redact.** Code, diffs, paths, URLs, hashes and secrets are removed. This
   both protects the user and improves extraction — a stack trace has no topic.
2. **Match curated phrases.** Longest first, so `cap theorem` is found before
   `theorem` can claim the words.
3. **Score n-grams** (1–3) on lexicon membership, word rarity, position,
   capitalization and length. An n-gram that merely wraps a curated phrase in
   filler is capped below it, so `heavy database migration` cannot beat
   `database migration`.
4. **Pair, if thin.** A one-word winner gets a second strong term appended, which
   is how `connection pool` becomes `connection pool postgres`.
5. **Score confidence** with soft saturation, `s / (s + 3.2)`, so real topics
   spread across the range instead of all pinning at 1.0.

Inspect any of it with `shorts topic "<text>"`.

### Extending the lexicon

Add to the relevant block in `core/lexicon.ts`. Single words go in the domain
blocks; multi-word concepts must also be listed in `PHRASE_SOURCE` so phrase
boundaries are respected. Add a case to `core.test.ts` alongside it.

---

## Security

The daemon holds a token that grants access to your conversation topics, so it is
treated as a local network service rather than a toy:

- binds to `127.0.0.1` only
- bearer token, compared with `timingSafeEqual`, stored `0600`
- `Host` header checked — a page can point a hostname at loopback but cannot
  forge `Host`, which is the standard DNS-rebinding defence
- origins allowlisted to extension, webview and loopback schemes
- `/pair` hands out the token only inside a 2-minute window opened by
  `shorts pair`, so the extension never needs a copy-pasted secret
- request bodies capped at 512 KB

Content scripts hold no token. The extension's service worker is the only part
that talks to the daemon.

---

## Adding a surface

Anything that can make an HTTP request can be a surface:

```bash
curl -X POST http://127.0.0.1:8787/event \
  -H "authorization: Bearer $(shorts token)" \
  -H 'content-type: application/json' \
  -d '{"source":"manual","sessionId":"my-app","role":"user",
       "text":"how does raft elect a leader","state":"thinking"}'
```

Send `{"role":"assistant","state":"idle"}` on the same `sessionId` when the model
finishes. That is the whole contract.

Then listen on `GET /events` for an `offer` frame, show it however you like, and
`POST /accept` with its `id` when the user says yes:

```bash
curl -X POST http://127.0.0.1:8787/accept \
  -H "authorization: Bearer $(shorts token)" \
  -H 'content-type: application/json' \
  -d '{"offerId":"<id from the offer frame>"}'
```

The resulting `suggestion` frame goes to every connected panel, not just the one
that accepted.

## Adding a provider

Implement `Provider` in `src/providers/`, return `ShortVideo[]`, register it in
`providers/index.ts` and widen the config union. `unavailableReason()` should
explain in one sentence how to fix a missing dependency — it is shown directly to
the user by `shorts doctor`.
