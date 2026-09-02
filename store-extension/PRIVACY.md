# Privacy policy — Tangent

**Last updated:** 1 September 2026
**Contact:** killredps@gmail.com

Tangent is an open-source browser extension. Its full source is at
<https://github.com/Dipeshtripathi13/claude-shorts>, and everything below can be
verified by reading it.

## The short version

Tangent reads **one thing**: the message you just typed into an AI chat, on the
three sites listed below. It uses that message, **on your own device**, to work
out a short search phrase.

**Nothing is transmitted anywhere until you click "Find explainers."** When you
do, a phrase such as `database migration postgres explained` is sent to the
YouTube Data API using **your own** API key.

Your message is never transmitted. There is no Tangent server. No analytics, no
tracking, no advertising, no accounts.

## What is collected

| Data | Where it goes | Why |
|---|---|---|
| The message you just typed | Stays in your browser | To work out what the topic is |
| A short derived phrase (a few words) | YouTube, **only when you click** | To find videos on that topic |
| Your YouTube API key | Stays in your browser | To make that request as you |
| Search results (titles, thumbnails, ids) | Stays in your browser | So the same topic is not searched twice |

Tangent does **not** collect or transmit: your name, email, location, browsing
history, the AI assistant's replies, your conversation history, your files, your
credentials, or your activity on any other website.

## Where Tangent runs

Content scripts run only on these AI chat sites:

- `claude.ai` · `chatgpt.com` · `chat.openai.com`
- `gemini.google.com` · `aistudio.google.com`
- `grok.com` · `chat.deepseek.com` · `chat.qwen.ai`
- `kimi.com` · `kimi.moonshot.cn`
- `perplexity.ai` · `chat.mistral.ai` · `copilot.microsoft.com`
- `poe.com` · `meta.ai` · `huggingface.co/chat`

On every other site, Tangent does nothing at all. You can switch off any
individual site in settings, and Tangent will ignore it entirely.

## What is removed before anything is sent

Before your message is used to build a search phrase, the following are stripped
out: code blocks, diffs, stack traces, file paths, filenames, URLs, email
addresses, IP addresses, hashes, base64 blobs, and environment variables.

If what remains contains anything shaped like a credential — an API key, an
access token, an AWS key, a JWT, a private key, or a `password:` assignment —
Tangent **discards the message entirely** and offers nothing.

You can add your own patterns to block in the extension's settings.

## What is stored, and for how long

Everything is stored locally using the browser's own extension storage. Nothing
is synced to any server.

| Stored | Lifetime |
|---|---|
| Your settings, including the API key | Until you change or remove them |
| Cached search results | 7 days by default; never more than 30, as YouTube's developer policies require |
| Daily search counter | Resets each day |
| The pending suggestion, and clips already shown | Cleared when you close the browser |

Clear cached results any time in settings. Removing the extension deletes all of
it.

## Third parties

**YouTube / Google.** When you click "Find explainers," a request goes to the
YouTube Data API containing your search phrase and your API key. Your IP address
is visible to Google, as with any web request. This is governed by
[Google's Privacy Policy](https://policies.google.com/privacy).

When results are shown, the player for the clip on screen is embedded from
`youtube-nocookie.com`, as on any page with an embedded video. **It does not
play until you press YouTube's play button.** The other results in the row stay
thumbnails until you select them.

Earlier versions loaded nothing from YouTube until you pressed play, but that
cost two clicks to start a video, because a browser will not let a frame created
after your click inherit it. Clearing the player page in settings restores the
old behaviour: nothing is embedded, and clips open in a separate window.

**The player page.** To play a clip inside the panel, Tangent frames a small
page hosted on GitHub Pages whose only job is to embed the official YouTube
player. YouTube refuses to play inside a browser extension panel without an
HTTP `Referer`, which Chrome does not send from extension pages; framing a page
on a real website is the only way around it. That page contains no analytics and
no logic, receives only a video id, and its source is `docs/player.html` in the
repository. GitHub sees the request as it would any page view. You can point the
extension at your own copy, or clear the field in settings to disable inline
playback entirely and open clips in a separate window instead.

**Nobody else.** Tangent runs no server of its own and sends your data to no
other party.

## Your choices

- **Don't click.** A suggestion you ignore transmits nothing.
- **Hide the panel** with the toolbar icon.
- **Remove the API key** in settings, and nothing can be searched at all.
- **Uninstall**, which removes every stored item.

## Children

Tangent is not directed at children under 13 and collects no data from anyone
knowingly.

## Changes

Material changes to this policy will be published in the repository and
reflected in the extension's store listing before they take effect.

## Not affiliated

Tangent is an independent project. It is not affiliated with, endorsed by, or
sponsored by Google, YouTube, Anthropic, or OpenAI.
