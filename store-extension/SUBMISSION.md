# Chrome Web Store submission

Everything you need to paste into the developer dashboard, plus the checks that
matter before you click publish. Brave installs from the Chrome Web Store, so
this one submission covers both browsers.

---

## Before you start

- [ ] **Register as a developer** — one-time $5 fee, at
      [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
- [ ] **Turn on 2FA** for that Google account (required to publish)
- [x] **Privacy policy is hosted** at
      `https://dipeshtripathi13.github.io/claude-shorts/privacy.html` — paste
      this into the dashboard's Privacy policy URL field.
- [x] **Homepage** for the listing:
      `https://dipeshtripathi13.github.io/claude-shorts/`
- [ ] **Check the name is free** — search the store for "Tangent". If it is
      taken, change `name` in `manifest.json` and the headings in the UI files.

## Build the upload

```bash
cd store-extension
npm install
npm test          # 12 self-tests, no API key needed
npm run package   # -> dist/tangent-1.0.0.zip
```

Test it locally first: `chrome://extensions` → Developer mode → **Load unpacked**
→ select `load-unpacked`.

---

## Listing copy

**Name** (45 char limit)

```
Tangent — Explainers for AI Chats
```

**Short description** (132 char limit)

```
Spots the concept in your AI chat message and finds YouTube Shorts that explain it. Nothing is searched until you click.
```

**Detailed description** — the full text is in `listing-description.txt`,
which is the file to paste. Summarised here:

```
Tangent notices when you ask an AI assistant about something worth
understanding, and pulls up YouTube Shorts that explain it.

Ask Claude to plan a database migration, and a button appears in the side
panel: "Find explainers: database migration." Click it and you get a handful
of 15-90 second Shorts on that exact topic, ranked for brevity and relevance
and playable right there beside the conversation. Ignore it and nothing
happens at all.

WHY IT IS NOT A DISTRACTION

Nothing plays unless you ask. A message raises a button, not a video.
Working out the topic happens on your own device and costs nothing, so
ignoring the button is free and is the normal case.

It knows a question from a chore. "What is photosynthesis" gets a button.
"Rerun the tests", "commit this", "yes" get nothing at all.

No feed. A fixed set of results, no autoplay, no sound, no recommendations,
no "up next". Nothing ever plays until you press play.

PRIVACY

Tangent reads only the message you just typed, and only on AI chat sites. Any
of them can be switched off individually in settings.

Before anything is searched, code, file paths, URLs, email addresses and
anything shaped like an API key or password is stripped out. If a message
looks like it contains a credential, Tangent discards it and offers nothing.

What reaches YouTube is a short phrase like "database migration postgres
explained" — never your message. There is no Tangent server, no analytics
and no account.

SETUP

Tangent searches with your own free YouTube Data API key, so your usage is
yours and nothing is routed through anyone else's service. Settings walks
you through creating one; it takes a few minutes.

Open source, MIT licensed:
https://github.com/Dipeshtripathi13/claude-shorts

Not affiliated with Google, YouTube, Anthropic or OpenAI.
```

**Do not list the supported sites by name in the public description.** The
first submission was rejected under Keyword Spam (reference "Yellow Argon") for
exactly that: an enumerated run of third-party product names reads as keyword
stuffing whatever the intent. Describe the capability instead, and let the
declared permissions and the extension's own settings show which sites.

Naming them is still correct — and expected — in the two places that are
disclosure rather than marketing: the host permission justification and the
privacy policy.

**Note on the host list.** Sixteen chat sites means a broad install warning.
Expect a reviewer to ask why; the answer is that they are all the same single
purpose and each is individually switchable in settings.

**Homepage URL:** `https://dipeshtripathi13.github.io/claude-shorts/`
**Privacy policy URL:** `https://dipeshtripathi13.github.io/claude-shorts/privacy.html`
**Support email:** tripathidipesh13@gmail.com

**Category:** Productivity
**Language:** English

---

## Permission justifications

Paste these into the dashboard. Reviewers now cross-check these against actual
behaviour, so keep them accurate.

| Item | Justification |
|---|---|
| `scripting` | Injects the content script into a chat tab that was already open when the extension was installed or reloaded, so the toolbar button works without the user having to reload the page. Only ever into the declared chat sites. |
| `storage` | Stores the user's own YouTube API key, their preferences, and a short-lived cache of search results so the same topic is not searched twice. All local; nothing is synced or transmitted. |
| `host_permissions: googleapis.com` | The extension calls the YouTube Data API directly with the user's own API key to find videos. This is the only outbound request the extension makes. |
| `host_permissions` + content scripts on the AI chat sites | The extension reads the message the user just typed into the chat box on these sites in order to determine the topic, and injects its own panel to display suggestions. It does not read the conversation, the assistant's replies, or history. Each site can be switched off individually in settings. The list is limited to AI chat assistants, which is the extension's single purpose: claude.ai, chatgpt.com, chat.openai.com, gemini.google.com, aistudio.google.com, grok.com, chat.deepseek.com, chat.qwen.ai, kimi.com, kimi.moonshot.cn, perplexity.ai, chat.mistral.ai, copilot.microsoft.com, poe.com, meta.ai, and huggingface.co/chat. |
| Remote code | None. All executable code ships in the package. The only external resources are YouTube video embeds and thumbnail images, loaded only after the user presses play. |

**Single purpose statement**

```
Tangent has one purpose: to suggest short explainer videos about the topic of
the message a user just sent to an AI chat assistant.
```

---

## Data-use disclosures

In the **Privacy practices** tab, declare:

- [x] **Personally identifiable information** — No
- [x] **Health information** — No
- [x] **Financial and payment information** — No
- [x] **Authentication information** — No
- [x] **Personal communications** — **Yes.** Declare this honestly: the message
      a user types into a chat is a personal communication. State that it is
      processed on-device, that only a derived search phrase is transmitted, and
      only after an explicit click.
- [x] **Location** — No
- [x] **Web history** — No
- [x] **User activity** — No
- [x] **Website content** — **Yes**, limited to the composer text on the three
      declared chat sites.

Then certify all three:

- [x] Data is not sold to third parties
- [x] Data is not used for purposes unrelated to the single purpose
- [x] Data is not used to determine creditworthiness or for lending

Declaring "personal communications" will slow review. Declaring it falsely is
far worse — the August 2026 policy update requires all collection to be
disclosed whether or not it is core to the single purpose, and reviewers compare
disclosures against what the code actually does.

---

## Assets you still need

The packager builds the icons. These have to be made by hand:

- [ ] **Screenshots** — 1280×800 or 640×400 PNG, at least one, up to five.
      Worth capturing: the button appearing after a real question; the results
      with a clip playing; the settings page. Blur anything private in the chat.
- [ ] **Small promo tile** — 440×280 PNG (optional but improves placement)
- [ ] **Marquee promo tile** — 1400×560 PNG (optional)

---

## Known limitations to disclose in the listing

Being straight about these prevents one-star reviews:

- **Requires a free YouTube API key.** Google allows 100 searches per day per
  key; Tangent stops at 90 and caches aggressively.
- **Brave** installs this from the Chrome Web Store and it works, because the
  panel is injected into the page rather than using Chrome's side panel API
  (which Brave does not reliably support).
- **No need to reload an already-open chat tab** — clicking the toolbar button
  injects the content script if the tab predates the install.
- **Clips play inline via a small hosted page.** YouTube requires a Referer
  header that Chrome does not send from extension pages (error 153), so the
  panel frames a page on GitHub Pages that does nothing but embed the official
  player. The URL is a setting; clearing it opens clips in a window instead.

---

## After submitting

Review usually takes a few days and can take longer for anything that reads page
content. If you are rejected:

- **"Blue Argon" / remote code** should not apply — everything ships in the
  package. If it is cited, point to the fact that the only external loads are
  YouTube embeds and thumbnails, after user action.
- **Requesting more permissions than needed** — the four host permissions are
  each used; the justifications above explain where.
- **Reviewer cannot test it** — supply a test YouTube API key in the reviewer
  notes field, plus the reload-the-tab instruction.
