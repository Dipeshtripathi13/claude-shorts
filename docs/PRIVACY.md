# Privacy

## The short version

A few words derived from your prompt go to YouTube, so it can return videos.
Nothing else leaves your machine, and nothing goes to us — there is no "us"
server, no account, no telemetry.

## What is sent, exactly

For a prompt like:

> I'm partway through migrating our billing DB and `psql -h prod-billing-01`
> keeps timing out at /var/lib/postgresql/data — how do I do this migration with
> zero downtime?

YouTube receives:

```
database migration postgres explained
```

That is the entire outbound payload. Not the prompt, not the hostname, not the
path, not the repo.

Check it yourself for any input — this command searches nothing:

```bash
shorts topic "<your text>"
```

## How that reduction happens

Before anything is derived, the redactor removes:

fenced and inline code · diff hunks · stack frames · URLs · email addresses ·
filesystem paths · filenames with code extensions · hex and base64 blobs ·
IPv4 addresses · environment variables · angle-bracket placeholders

Then, if the remaining text contains anything shaped like a credential, the turn
is **abandoned entirely** — no topic, no search:

`sk-…` / `pk-…` keys · `ghp_`/`gho_`/`ghs_` GitHub tokens · `AKIA…` AWS keys ·
`xox…` Slack tokens · PEM private keys · JWTs · `password:` / `api_key=` /
`secret=` assignments

Add your own with `privacy.denyPatterns`:

```json
{ "privacy": { "denyPatterns": ["acme-corp", "project-[a-z]+-internal"] } }
```

A turn matching any of them is dropped the same way.

## What is stored, and where

Everything is a plain file under `~/.config/claude-shorts/` (or `$SHORTS_HOME`),
mode `0600`:

| File | Contents | Lifetime |
|---|---|---|
| `config.json` | Your settings, including the API key | Until you delete it |
| `cache.json` | Search results keyed by topic phrase | `cache.ttlHours`, hard-capped at 30 days |
| `quota.json` | A per-day search counter | Rolls at midnight Pacific |
| `token` | The daemon's bearer token | Until you delete it |

The cache holds **topic phrases and video metadata** — `"database migration
postgres explained"` and the titles it returned. It does not hold your prompts.

Session state — cooldowns, which clips you have seen — lives in memory only and
is dropped when the daemon stops, or after six idle hours.

Clear things at any time:

```bash
shorts cache clear
rm -rf ~/.config/claude-shorts     # everything, including the token
```

## Who can reach the daemon

It binds to `127.0.0.1` — never a routable interface — and requires a bearer
token on every endpoint except `/health` and `/pair`. It validates the `Host`
header (blocking DNS rebinding, where a hostile page resolves a name to loopback)
and allowlists origins to extension, VS Code webview and loopback schemes.

Other users on a shared machine could read your config directory if they are
root. Nothing here defends against root.

## The browser extension

It runs only on `claude.ai`, `chatgpt.com` and `chat.openai.com`, and it reads
only the conversation page you already have open.

- It requests **no** access to your Claude or OpenAI account, cookies or session
- Its only host permissions are `127.0.0.1` and `localhost`
- The content script holds no token; only the service worker talks to the daemon
- Text goes to your local daemon and nowhere else

It does read what you type into the chat box. That is the feature. If you would
rather it did not on a given day, close the side panel or disable the extension —
with no token stored, the service worker drops events silently.

## Third parties

**YouTube.** Search requests reach Google with your API key and IP, subject to
Google's privacy policy. Playback embeds use `youtube-nocookie.com`, and the
panel loads nothing from YouTube until you click play — a thumbnail is all that
renders otherwise.

**yt-dlp / Piped providers.** `yt-dlp` contacts YouTube directly from your
machine, no key involved. `piped` sends your search phrase to whichever instance
you configure — a third party you should choose deliberately, or self-host.

**Nobody else.** No analytics, no crash reporting, no update pings.
