# Feasibility research

Notes behind the design, written before the implementation. Everything here was
checked against primary sources in September 2026; the load-bearing findings are
cited inline.

---

## 1. Can we see what the user is asking?

This is the question the whole idea rests on, and the answer differs per surface.

### Claude Code — yes, officially

Claude Code exposes a hook system. `UserPromptSubmit` fires the moment a prompt
is submitted and receives JSON on stdin:

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/…/.claude/projects/…/<uuid>.jsonl",
  "cwd": "/Users/…",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

`Stop` fires when the model finishes, which gives us the *other* half of the
signal: when the wait ends. `Notification` fires when Claude is blocked on the
user. Together these are exactly the state machine we need, with no scraping.

**Two constraints that shaped the code:**

- For `UserPromptSubmit`, **stdout is injected into Claude's context**. A hook
  that prints suggestions would feed video titles into the conversation. So the
  hook prints nothing and delivers out of band.
- Hooks run on every prompt. A slow or failing hook degrades every turn, so ours
  exits 0 unconditionally and gives itself a 2.5-second budget.

There is also a hook-free path: Claude Code appends every turn to
`~/.claude/projects/<slug>/<session>.jsonl`, which can simply be tailed.
Implemented as `shorts watch` for people who would rather not touch
`settings.json`.

Sources: [Hooks reference](https://code.claude.com/docs/en/hooks),
[hook schemas](https://gist.github.com/FrancisBourre/50dca37124ecc43eaf08328cdcccdb34),
[JSONL transcript format](https://claude-dev.tools/docs/jsonl-format)

### Claude Desktop — only by inversion

No hook API. MCP is the sanctioned extension point, but MCP is *pull*: a server
exposes tools and the model decides when to call them. That cannot implement
"notice a long think and offer something", only "the user asked for clips".

So the Desktop integration is deliberately weaker, and the README says so.

Source: [MCP on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

### claude.ai and ChatGPT — browser extension

A content script can read the page the user already has open. The two signals we
need are obtainable without any site-specific selector, which matters because
chat UIs are redesigned constantly:

- **what was asked** — read the composer's own text at the moment of submit
  (Enter keydown, or a button click while the composer is non-empty)
- **still working** — watch for DOM churn; streaming replies mutate the DOM
  continuously, so ~2.5s of quiet means the reply finished

A selector-based scraper would break on the next deploy. This approach survives
redesigns as long as chat boxes remain editable elements.

### Rendering: use the native side panel, not an injected div

Injecting a sidebar into the page means fighting the host page's CSP to embed
YouTube. Chrome's `chrome.sidePanel` API (Chrome 114+) sidesteps this entirely:
the panel is an **extension page** with its own CSP, so it can frame
`youtube.com/embed` freely, and the content script never needs elevated powers.

Firefox uses an incompatible `sidebarAction` API — noted as future work.

Sources: [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel),
[MDN sidebarAction](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction)

---

## 2. Can we get the right videos?

### The binding constraint: 100 searches per day

This is the single most important finding.

> "Projects that enable the YouTube Data API have a default quota allocation of
> 100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day
> combined for all other endpoints."

Not 10,000 searches. **One hundred.** Reset at midnight US/Pacific.

A naive implementation that searches on every prompt burns the day's budget in
an hour of normal Claude Code use. Three consequences, all in the code:

1. **Cache by topic, not by prompt.** Ten differently-worded questions about the
   Krebs cycle normalize to one key and cost one search.
2. **Gate hard before spending.** The confidence threshold, cooldown and
   dead-time timer all run *before* the network call.
3. **Track spend locally** and refuse at 90/100, leaving headroom.

Sources: [Getting started / quota](https://developers.google.com/youtube/v3/getting-started),
[Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)

### There is no "is this a Short" filter

The API has no Shorts flag anywhere in `snippet` or `contentDetails`. The closest
lever is `videoDuration=short`, which means **under four minutes** — far too
broad.

The approach used here:

1. `search.list` with `videoDuration=short`, `videoEmbeddable=true`,
   `videoSyndicated=true`, over-fetching ~4× the needed count
2. one batched `videos.list` (`contentDetails,statistics,status`) to get real
   durations — 1 unit, from the *other* quota bucket
3. filter to `maxDurationSec`, rank clips ≤60s higher

There is also an unofficial trick: `HEAD https://www.youtube.com/shorts/<id>`
returns 200 for a real Short and 303 for anything else. Accurate, but undocumented
and fragile, so it is opt-in behind `shorts.verifyShorts` and falls back to
duration filtering if it ever starts rejecting everything.

Sources: [search.list](https://developers.google.com/youtube/v3/docs/search/list),
[Shorts detection discussion](https://github.com/googleapis/googleapis/discussions/1153),
[the HEAD trick](https://blog.quadmeup.com/2023/03/31/how-to-check-if-youtube-video-is-a-short/)

### Shorts do not embed from their own URL

`youtube.com/shorts/<id>` will not load in an iframe. It must be rewritten to
`youtube.com/embed/<id>`, at a 9:16 aspect ratio. The player normalizes this in
one place so no caller has to remember.

We use `youtube-nocookie.com` and load nothing until the user clicks play — the
panel shows a thumbnail until then. That keeps it silent by default and avoids
six third-party frames the user did not ask for.

### No-key fallbacks

For people who will not create a Google Cloud project:

- **yt-dlp** — `ytsearchN:<query> --flat-playlist --dump-json`. No key, no
  quota, a few seconds per search, depends on yt-dlp tracking YouTube's changes.
- **Piped** — public instances are volatile (Invidious' public instance list has
  collapsed to a handful under IP blocking). Fine for a first try, self-host for
  anything real.

Both replace *discovery* only; playback still uses YouTube's official player,
which is what the API Terms require.

Sources: [yt-dlp](https://github.com/yt-dlp/yt-dlp),
[Invidious/Piped status 2026](https://sumguy.com/invidious-piped-redlib-nitter-2026/)

### Terms of service

Relevant obligations, all reflected in the implementation:

- **Playback must use the official embedded player.** We never download or
  proxy video; every provider ends at a YouTube iframe.
- **Cached API data must be refreshed or dropped within 30 days.** `MAX_TTL_MS`
  is a hard 30-day ceiling that config cannot exceed.
- **Attribution.** Title, channel and a link to the canonical watch URL are shown
  on every card.

Source: [YouTube API Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

---

## 3. Is it actually usable, or just a distraction machine?

This was the part most likely to sink the idea, and it deserved more thought than
the plumbing.

**The failure mode is obvious.** A tool that offers videos during focused work is
a tool that breaks focus. Someone mid-migration does not need a feed. If we get
this wrong, the honest outcome is that the tool is worse than nothing.

**The insight that makes it defensible:** the user is *already* context-switching.
The forty seconds after submitting a prompt is not focused work — it is dead
time, and it is currently being spent on Twitter. We are not competing with
concentration. We are competing with the alt-tab.

That reframing produces the design rules:

| Risk | Mitigation |
|---|---|
| Interrupting focused work | Only surface after the model has been busy `minThinkingMs` (default 8s). A fast answer shows nothing, ever. |
| Becoming a feed | One batch per topic, 90s cooldown, per-session cap, no repeated video or topic. |
| Suggesting noise | Confidence threshold plus explicit suppression of chores ("yes", "rerun", "commit"). |
| Hijacking attention | Nothing autoplays. Nothing loads from YouTube until a click. No sound by default. |
| Pulling into the YouTube rabbit hole | The panel shows a fixed batch. There is no infinite scroll, no recommendations, no "up next". |
| Leaking work context | Redact-then-derive; credentials abort the turn entirely. |

**Where it genuinely helps:** unfamiliar concepts in a long task ("what *is* a
materialized view"), orientation before reading a doc, and the "I keep nodding
along to this term" problem.

**Where it does not:** deep work you are already inside, and anything where a
60-second video would mislead. Shorts are for orientation, not understanding —
the README says this out loud rather than overselling.

---

## 4. Prior art

Searched thoroughly. The existing Claude/YouTube projects all point the other
way — they let *Claude* watch videos:

- `claudetube`, `claude-video-vision`, `claude-watch` — feed video to the model
  via yt-dlp, frame extraction and transcripts
- `claude-youtube` — a skill for YouTube *creators*

Nothing suggests videos to the *human* during model latency. The gap is real.

---

## 5. Verdict

**Feasible**, with one hard constraint and one soft one.

- **Hard:** 100 YouTube searches/day. Solved by topic-level caching and gating;
  it is why those exist rather than being nice-to-haves.
- **Soft:** heuristic topic extraction is imperfect. Mitigated by making it
  inspectable (`shorts topic`), tunable (`minConfidence`), and cheap to override.

**Usable**, but only because the trigger is dead time rather than every message.
That single rule is what separates this from a distraction machine, and it is the
part to protect in any future change.

The riskiest remaining dependency is the browser extension's DOM observation,
which is why it avoids site-specific selectors. The Claude Code path — the
primary one — rests entirely on documented, supported APIs.
