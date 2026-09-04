# Product Hunt launch kit

Everything to paste, plus the parts that have to be made by hand.

Links, all verified live:

- **Chrome Web Store** — https://chromewebstore.google.com/detail/kagpgdldipdgmplebhgohaojbigdnpje
- **Website** — https://dipeshtripathi13.github.io/tangent/
- **Source** — https://github.com/Dipeshtripathi13/tangent

---

## Name

```
Tangent
```

## Tagline (60 characters)

Pick one. Lengths measured.

| | Tagline | Chars |
|---|---|---|
| **A** | Short explainers for whatever you just asked an AI | 50 |
| B | Ask an AI anything, get a 60-second explainer of it | 51 |
| C | Your AI chat, with a "explain this to me" button | 48 |
| D | Turn AI chat questions into 60-second explainers | 48 |

**A** is the recommendation: it says what it does and where it lives, and it
does not oversell. B is the most concrete if you want the mechanic up front.

## Description (260 characters)

```
Tangent spots the concept in the message you just sent an AI assistant and
finds YouTube Shorts that explain it. A button appears — click it and you get
a handful of 15-90 second explainers. Ignore it and nothing happens. Nothing
is ever searched until you click.
```

## Topics

Pick four or five:

`Chrome Extensions` · `Productivity` · `Artificial Intelligence` ·
`Education` · `Developer Tools` · `Learning`

---

## The maker's first comment

This is the part that actually matters. Post it immediately after launching.
Do not sell — explain why it exists and be honest about the limits.

```
Hi Product Hunt 👋

I built Tangent because of a habit I couldn't break. I'd ask Claude something
substantial — plan a zero-downtime database migration, explain the CAP theorem —
and while it thought, I'd alt-tab. Forty seconds of waiting reliably became four
minutes of not-waiting.

The obvious version of this idea is bad. A thing that offers you videos while
you work is a distraction machine, and I nearly didn't build it for that reason.
What changed my mind was realising I wasn't competing with concentration. I was
competing with the alt-tab. That gap is already lost.

So Tangent is built to be ignorable:

• It raises a button, never a video. Working out the topic happens on your own
  device and costs nothing, so ignoring the button is free — and it is the
  normal case.
• It knows a question from a chore. "What is photosynthesis" gets a button.
  "Rerun the tests", "commit this", "yes" get nothing at all.
• No feed. A fixed set of clips about one topic, then it stops. No autoplay,
  no recommendations, no "up next".

One constraint shaped the whole architecture: YouTube grants 100 searches per
day per key. Not 10,000 — 100. That is why searching is opt-in rather than
automatic. A heavy day might raise fifty buttons and spend three searches,
because you only clicked three times. The limitation made the product better
than I would have designed it otherwise.

On privacy: it reads only the message you just typed, only on AI chat sites.
Before anything is searched it strips code, file paths, URLs and anything shaped
like an API key — and if a message looks like it contains a credential it drops
it entirely. What reaches YouTube is a phrase like "database migration postgres
explained", never your message. There's no server, no analytics, no account.

Honest caveats:
• You need your own free YouTube API key. There's no shared key, by design.
• The topic extractor is a heuristic, not a model. It's wrong sometimes — so
  the phrase it will search sits in an editable box you can correct before
  clicking.
• Shorts are for orientation, not understanding. This is for the gap in your
  attention, not a substitute for reading the docs.

It's MIT licensed and the whole thing is readable, including the parts I got
wrong on the way:
https://github.com/Dipeshtripathi13/tangent

Happy to answer anything — especially if you think the premise is wrong.
```

---

## Assets to make by hand

- [ ] **Thumbnail** — 240×240. The extension icon works; `store-extension/icons/icon128.png` upscaled, or redraw the same mark at 240.
- [ ] **Gallery images** — 1270×760, three or four. The order that tells the story:
      1. The button appearing right after a real question — this is the whole product in one frame
      2. Results, with a clip playing beside the conversation
      3. The editable search field, mid-edit — shows you are not stuck with the guess
      4. A chore message producing *nothing* — the restraint is the selling point
- [ ] **Demo video** *(optional, high impact)* — 30–60s screen recording: type a question, button appears, click, clip plays. No narration needed.

---

## Timing

- Launches run **12:01 AM Pacific to 11:59 PM Pacific**. Post at 12:01 AM PT to get the full day.
- **Tuesday to Thursday** are the most-trafficked days; weekends are quiet.
- Be around for the first six hours. Replying to comments matters more than anything you can prepare.

## Before you press launch

- [ ] Install from the store on a clean browser profile and go through setup as a stranger would
- [ ] Check the landing page on a phone
- [ ] Have the API key steps ready to paste — it will be the most common question
- [ ] Decide your answer to "why not just use YouTube search?"
      (Because you would have to know what to search, stop what you are doing,
      and leave the page. The point is that you do none of those.)
