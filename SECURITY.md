# Security

## Reporting a vulnerability

Please open a [private security advisory](../../security/advisories/new) rather
than a public issue. I will acknowledge within a few days.

## What this software touches

`claude-shorts` reads the text you type into an AI chat, runs a local HTTP
daemon, and makes outbound requests to YouTube. That is a meaningful surface, so
the threat model is written down rather than assumed.

### The local daemon

Binds to `127.0.0.1` only and requires a bearer token on every endpoint except
`/health` and `/pair`. It validates the `Host` header, which blocks DNS
rebinding (a hostile page resolving its own hostname to loopback), and
allowlists request origins to extension, VS Code webview and loopback schemes.
Request bodies are capped at 512 KB. The token is compared with
`timingSafeEqual` and stored mode `0600`.

`/pair` returns the token only inside a two-minute window opened by
`shorts pair`, so pairing never requires copy-pasting a secret.

### What is explicitly out of scope

- **A local attacker running as your user, or as root.** They can read
  `~/.config/claude-shorts/` directly; nothing here defends against that.
- **The content of the videos suggested.** Ranking penalises engagement bait,
  and `safeSearch` defaults to `moderate`, but YouTube results are not vetted.

### Prompt text

Text is redacted before any of it influences a search, and anything shaped like
a credential aborts the turn entirely. In the default `manual` mode nothing
leaves the machine at all until you click. See [docs/PRIVACY.md](docs/PRIVACY.md)
for exactly what is sent and stored.

If you find a way to make a prompt's raw text, a file path, or a credential
reach the network, that is a vulnerability — please report it.
