# Tangent — the store build

A standalone Chrome and Brave extension. Unlike the [daemon-based
version](../extension) in this repo, it needs nothing installed on your machine:
all logic ships in the package and it searches YouTube with the user's own API
key.

That difference is not cosmetic. The Chrome Web Store forbids remotely hosted
code under Manifest V3, and the daemon build serves its whole panel UI from
`127.0.0.1` — which would be rejected, and would also leave a reviewer staring
at a "connect to the local daemon" screen. **This is the version to publish.**

## How it differs

| | `../extension` (daemon) | `store-extension` (this) |
|---|---|---|
| Needs a local install | yes, `claude-shorts` daemon | no |
| Where the logic lives | on the daemon | in the package |
| Video source | YouTube API, yt-dlp or Piped | YouTube API only |
| Cache and quota | shared with the CLI | `chrome.storage`, per browser |
| Publishable | no | yes |
| Brave | side panel, unreliable | in-page panel, works |

Both share one topic extractor — `tsconfig.core.json` compiles the same
`src/core/*.ts` this repo's CLI uses, so a fix to the lexicon or the ranking
improves both and there is no forked copy to drift.

## Build

```bash
npm install
npm run build      # compile the shared core, generate the icons
npm test           # 12 self-tests; no API key, no network
npm run package    # -> dist/tangent-1.0.0.zip and load-unpacked/
```

Load `load-unpacked` at `chrome://extensions` → Developer mode → Load unpacked.

## Layout

```
manifest.json          MV3, AI-chat hosts plus googleapis, no remote code
src/background.js      service worker: extracts topics, and only searches on a click
src/content.js         reads the composer, hosts the panel iframe
src/youtube.js         YouTube Data API v3 over fetch
src/storage.js         settings, cache and daily budget on chrome.storage
src/ui/                panel, options and welcome pages — all in-package
src/generated/         compiled from ../src/core, do not edit
tools/make-icons.mjs   writes the PNGs directly, no image dependency
tools/package.mjs      validates then zips; refuses to package a broken build
tools/selftest.mjs     drives the real message handlers against stubbed chrome.*
```

## The phrase is editable

The offer pane prefills the search phrase in a text field rather than printing
it as a caption. The extractor is a heuristic and is sometimes wrong; the person
reading it always knows whether it got their question right. An edited phrase is
searched verbatim and gets its own cache key, so it cannot be served the guess's
results.

## The rule to preserve

**Extract locally, search only on a click.** Naming the topic is free and
offline, so it can happen on every message; the network call waits for intent.
That is what keeps the extension inside YouTube's 100-searches-per-day limit and
what keeps it from being a distraction. `tools/selftest.mjs` asserts it directly
— `fetchCalls.length === 0` after a message, `2` after an accept.

## Why clips open in a window instead of playing inline

YouTube requires an HTTP `Referer` header to identify who is embedding a player.
Chrome sends none from a `chrome-extension://` page, so an inline embed fails
with *Video player configuration error (153)*,
`errorCode: embedder.identity.missing.referrer`. This began with Chrome 141 and
affects every extension that embeds YouTube.

Nothing in the extension's control fixes it:

- `referrerpolicy` on the iframe does not apply to the extension origin
- `declarativeNetRequest` cannot modify `Referer`
- Signing in to YouTube only masks it, per session

The only real fix is to proxy the embed through a page on an https domain, which
would make the extension depend on a server it deliberately does not have. So a
clip opens in a compact popup window instead: always works, no infrastructure,
and it sits beside the conversation.

`docs/player.html` in this repository is that page, served from GitHub Pages.
The URL lives in settings, so anyone can host their own copy or clear it to fall
back to opening clips in a window.

The player is loaded together with the result rather than behind a play button.
Lazy-loading cost two clicks — ours, then YouTube's — because user activation
does not reach a cross-origin iframe created after the click, and neither
`?autoplay=1` nor the IFrame Player API's `playVideo()` gets around it.

## What is not verified

The self-tests stub `fetch`, so the YouTube request shape is exercised but has
never been checked against the live API from inside the extension. Add a key in
settings, click **Test key**, then run one real search before you submit.

## Publishing

See [SUBMISSION.md](SUBMISSION.md) for the listing copy, permission
justifications, the data-use disclosures, and the checks to make first.
[PRIVACY.md](PRIVACY.md) is the policy to host.
