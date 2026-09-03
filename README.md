# claude-shorts

**A "Find shorts" button, for whatever you just asked about.**

You ask an AI assistant to plan a zero-downtime database migration. It goes
away for forty seconds. You alt-tab, and you are gone for four minutes.

This repository puts a button in your sidebar instead — **Find explainers:
database migration**. Click it and you get a handful of 45-second explainers on
that exact topic. Ignore it and nothing happens at all.

Working out the topic is local and free, so the button can appear on every
message. **Nothing is ever searched until you click.**

---

## Two things live here

### Tangent — the browser extension

A standalone extension for Chrome and Brave. Nothing to install on your
machine: all the logic ships in the package and it searches with your own
YouTube API key. Runs on sixteen AI chat sites.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/kagpgdldipdgmplebhgohaojbigdnpje)**
&nbsp;·&nbsp; [source](store-extension/)
&nbsp;·&nbsp; [privacy](https://dipeshtripathi13.github.io/tangent/privacy.html)
&nbsp;·&nbsp; [changelog](store-extension/CHANGELOG.md)

### claude-shorts — the CLI and daemon

For Claude Code. Hooks into the terminal and the VS Code sidebar through a
local daemon, which also serves a browser panel and an MCP server for Claude
Desktop. Can use `yt-dlp` instead of an API key, so it needs no Google account.

This is the older, more capable half, and the one that cannot be published: its
panel UI is served from `127.0.0.1`, which Manifest V3 forbids. It is the
power-user path.

| | Tangent | claude-shorts |
|---|---|---|
| Needs a local install | no | yes, a daemon |
| Works with Claude Code | no | yes, via hooks |
| Works in the browser | yes, 16 chat sites | yes, claude.ai and ChatGPT |
| Video source | YouTube API only | YouTube API, `yt-dlp` or Piped |
| Publishable | yes, and published | no |

Both share one topic extractor: `store-extension/tsconfig.core.json` compiles
the same `src/core/*.ts` the CLI uses, so a fix to the lexicon or the ranking
improves both and there is no forked copy to drift.

---

## How it works, in one picture

```
  you ─── prompt ───▶ Claude Code  /  a chat site
                          │
                UserPromptSubmit hook  /  content script
                          │
                          ▼
              ┌────────────────────────┐
              │  extract topic         │  local, offline, free
              │  "database migration"  │
              └───────────┬────────────┘
                          │ offer
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   terminal panel   VS Code sidebar   browser panel
        │                 │                 │
        └────── [ Find explainers ] ◀───────┘   ← you click here
                          │
                          ▼                 ┌─────────────┐
                       search ─────────────▶│   YouTube   │
                                            └─────────────┘
```

The phrase it will search is **editable** before you click, prefilled with the
guess. The extractor is a heuristic and is sometimes wrong; the person reading
it always knows whether it got their question right.

---

## Why this is not just a video search box

The hard part is not finding videos. It is **not being annoying**. Three rules
do most of that work:

**1. Nothing plays unless you ask.** A prompt raises a button, not a video.
Reading your message and naming the topic happens locally and costs nothing, so
the button is cheap to ignore — and ignoring it is the common case.

**2. It knows the difference between a question and a chore.** "What is
photosynthesis" gets a button. "rerun the tests", "commit this", "yes" get
nothing, and are dropped before anything touches the network.

**3. Even after you click, it stays quiet.** No autoplay, no sound, no
recommendations, no "up next" — a fixed batch of clips and a thumbnail until you
press play.

```
$ shorts topic "run the tests again"
{ "topic": null, "wouldSuggest": false, "reason": "no teachable topic" }

$ shorts topic "I have a heavy database migration to plan from mysql to postgres"
{ "query": "database migration postgres explained", "confidence": 0.759, ... }
```

In the panel, that second one becomes:

```
             spotted in your message
             database migration postgres

                 [ Find shorts ]

           uses one of today's searches
```

---

## The CLI: quick start

Everything from here down is the `claude-shorts` CLI and daemon. For the browser
extension, see [store-extension/](store-extension/).

```bash
npm install -g claude-shorts     # not yet published — see "from source" below
shorts setup                     # installs Claude Code hooks, backs up settings.json
shorts panel                     # terminal panel — put it in a split beside Claude Code
```

From source:

```bash
git clone https://github.com/Dipeshtripathi13/tangent.git && cd claude-shorts
npm install && npm run build
npm link            # puts `shorts` on your PATH
shorts setup
```

`setup` detects whether `shorts` resolves on your PATH and writes an absolute
node invocation into the hook if it does not, so a plain checkout works too.

`shorts setup` asks for a YouTube Data API key
([free, from a Google Cloud project](https://console.cloud.google.com/apis/library/youtube.googleapis.com)).
Leave it blank to use `yt-dlp` instead, which needs no key.

Try it without wiring anything up:

```bash
shorts ask "what is the CAP theorem"
```

---

## The surfaces

| Where you work | How it hooks in | Where the button appears |
|---|---|---|
| **Claude Code** (terminal) | `UserPromptSubmit` / `Stop` hooks | `shorts panel` in a tmux or iTerm split — press `f` |
| **Claude Code** (VS Code) | same hooks | a sidebar view in the activity bar |
| **claude.ai / ChatGPT** | browser extension | a native browser side panel (or use [Tangent](store-extension/), which needs no daemon) |
| **Claude Desktop** | MCP server | no button; ask Claude for clips instead |
| **Anything else** | `POST /event` | the daemon takes events from any client |

The panel has to be open to show you a button. In the terminal that means
`shorts panel` running in a split; in the browser it means the side panel open.

### Claude Code

`shorts setup` writes three hooks into `~/.claude/settings.json` (backing up the
existing file first). Use `--project` to scope them to one repo, and
`shorts setup --undo` to remove them.

The hook **never writes to stdout**. `UserPromptSubmit` stdout is injected into
Claude's context, so printing suggestions there would feed video titles into your
conversation. Suggestions travel out of band to the panel instead.

Prefer not to edit `settings.json`? `shorts watch` follows Claude Code's own
session transcripts under `~/.claude/projects/` and needs no configuration.

### VS Code

```bash
cd vscode && npm install && npm run compile
```

Then install the folder as an extension (`F5` in the Extension Development Host,
or package it with `vsce`). The **Shorts** icon appears in the activity bar.

### Browser (claude.ai, ChatGPT)

1. `chrome://extensions` → Developer mode → **Load unpacked** → pick `extension/`
2. Run `shorts pair` in a terminal
3. Click the extension icon, then **Pair** — within two minutes

The content script reads only the chat page you already have open, holds no
token, and sends what you typed to `127.0.0.1` and nowhere else.

### Claude Desktop

Claude Desktop has no hook API, so the trigger inverts: instead of the tool
noticing a good moment, you ask for one. Add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-shorts": { "command": "shorts", "args": ["mcp"] }
  }
}
```

---

## What leaves your machine

Short version: **a search phrase, to YouTube.** Nothing else, nowhere else.

Your prompt is processed locally. Before anything is derived from it, the
redactor strips code blocks, diffs, stack traces, file paths, URLs, emails,
hashes, base64 blobs, IPs and environment variables — and if the text contains
anything shaped like a credential (`sk-…`, `ghp_…`, `AKIA…`, a JWT, a private
key, `password: …`), the whole turn is **dropped without a search**.

What remains is reduced to a few words. `database migration postgres explained`
is what YouTube sees. Not your prompt, not your repo, not your file names.

```bash
shorts topic "<anything>"   # shows exactly what would be sent, and searches nothing
```

And in the default `manual` mode, even that phrase only leaves when you click
**Find shorts**. A message you never click on reaches nothing but your own
machine.

No telemetry, no analytics, no account. Everything else — cache, quota counter,
token — is a file under `~/.config/claude-shorts/`. See [docs/PRIVACY.md](docs/PRIVACY.md).

---

## The quota reality

YouTube gives each project **100 `search.list` calls per day**, reset at midnight
US/Pacific. That is the binding constraint on the whole design, and it is why
searching is opt-in: a day of heavy Claude Code use might raise fifty buttons and
spend three searches, because you only clicked three times.

Caching is keyed by topic rather than by prompt, so everyone who asks about the
Krebs cycle this week shares one search. The panel tells you which it is before
you click — "already cached, costs nothing" or "uses one of today's searches".

The daemon tracks spend locally and refuses before the API does. `shorts status`
shows what is left.

| Provider | Key needed | Cost | Notes |
|---|---|---|---|
| `youtube` *(default)* | yes | 1 search/topic | Official API. 100/day. |
| `ytdlp` | no | free | Needs `yt-dlp` on PATH. Slower, unofficial. Uses YouTube's own under-4-minutes filter, without which its results are almost all long-form. |
| `piped` | no | free | Public instances are unreliable; self-host for real use. |
| `mock` | no | free | Deterministic fixtures for tests and UI work. |

Playback always goes through YouTube's official embedded player, on all
providers. Only *discovery* differs.

---

## Configuration

`~/.config/claude-shorts/config.json` — every field is optional.

```jsonc
{
  "provider": "youtube",
  "youtube": { "apiKey": "", "regionCode": "US", "relevanceLanguage": "en", "safeSearch": "moderate" },

  "shorts": {
    "maxDurationSec": 180,   // YouTube allows Shorts up to 3 min
    "preferUnderSec": 60,    // but rank the classic ones higher
    "count": 6,
    "verifyShorts": false    // unofficial HEAD check on /shorts/<id>; accurate, slow, fragile
  },

  "trigger": {
    "mode": "manual",        // "manual": raise a button, search only on click
                             // "auto":   search unprompted during a long think
    "minConfidence": 0.45,   // below this, no button appears at all

    // auto mode only:
    "minThinkingMs": 8000,   // wait this long before deciding it's real dead time
    "cooldownMs": 90000,
    "maxPerSession": 20
  },

  "quota": { "dailySearches": 90 },
  "cache": { "ttlHours": 168, "maxEntries": 800 },

  "privacy": {
    "useAssistantText": false,   // extract topics from your words only
    "denyPatterns": ["acme-corp", "internal-\\w+"]
  },

  "topics": { "block": ["crypto"], "boost": ["rust"] }
}
```

Tuning it to taste:

- **Button appearing too often?** Raise `minConfidence` to 0.6.
- **Want it to just go and find things?** Set `trigger.mode` to `"auto"`. It then
  searches on your behalf, but only once the model has been busy `minThinkingMs`
  — a fast answer still shows nothing. This spends quota without asking, so the
  cooldown and per-session cap matter again.
- **Running dry on quota?** Raise `cache.ttlHours`, or switch to `ytdlp`.

Environment overrides: `SHORTS_YOUTUBE_API_KEY`, `SHORTS_PROVIDER`, `SHORTS_PORT`,
`SHORTS_HOST`, `SHORTS_HOME`, `SHORTS_LOG`.

---

## Commands

```
shorts setup [--project] [--yes]   install Claude Code hooks
shorts setup --undo                remove them
shorts panel [--web]               terminal panel (press f to search), or browser panel
shorts serve                       run the daemon in the foreground
shorts watch                       follow transcripts instead of using hooks
shorts ask "<text>"                suggest for this text right now
shorts topic "<text>"              show what would be extracted; search nothing
shorts status                      provider, quota, cache, live sessions
shorts doctor                      diagnose config, provider and daemon
shorts pair                        open a pairing window for the extension
shorts cache clear                 drop cached results
```

---

## How it works

`docs/ARCHITECTURE.md` has the detail. In short:

1. A surface observes a turn and `POST`s it to the daemon on `127.0.0.1:8787`.
2. The **session manager** arms a timer. If an idle event arrives first, it disarms.
3. On expiry, the **extractor** redacts the text, matches it against a curated
   concept lexicon, scores candidate n-grams, and emits a query plus a confidence.
4. The **suggester** checks the topic cache, then the quota, then calls a provider.
5. Results are filtered to real Shorts by duration, re-ranked for brevity,
   relevance and channel diversity, and pushed to every open panel over SSE.

The daemon binds to loopback, requires a bearer token, checks `Host` against
DNS-rebinding and allowlists origins.

## Limitations

- **Topic extraction is heuristic, not a model.** It is fast, free, offline and
  private, and it is sometimes wrong. `shorts topic` shows you when.
- **The lexicon is English-centric.** Unlisted concepts still work via the rarity
  and position heuristics, but less reliably. PRs welcome.
- **YouTube has no "is this a Short" flag.** Duration is a proxy; a 59-second
  landscape video can slip through. `verifyShorts` closes the gap unofficially.
- **The browser extension reads the DOM.** It avoids site-specific selectors, but
  a big enough redesign of either site can still break the submit signal.
- **Shorts are a shallow medium.** This is for orientation during a wait, not for
  learning a subject.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` needs no key or network —
the `mock` provider covers the whole pipeline.

## License

MIT
