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
finds YouTube Shorts that explain it. A button appears — click it for a
handful of 15-90 second explainers. Ignore it and nothing happens. Nothing is
searched until you click.
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
Hi PH 👋

I kept asking Claude something big, waiting 40 seconds while it thought, and
alt tabbing. Then looking up four minutes later.

So I built Tangent. Ask an AI something worth understanding and a button shows
up: "Find explainers: cap theorem". Click it and you get a few 15 to 90 second
YouTube Shorts on exactly that. Don't click and nothing happens.

I almost didn't build it. Offering videos while you work sounds like a
distraction machine. But I wasn't competing with focus, I was competing with
the alt tab. That time was already gone.

So it's easy to ignore. It shows a button, not a video. It stays quiet for
chores like "rerun the tests" or "commit this". No feed, no autoplay, no up
next.

One thing shaped the whole build: YouTube gives you 100 searches a day, not
10,000. That's why nothing is searched until you click. A busy day might show
50 buttons and spend 3 searches.

On privacy, it only reads the message you just typed, and only on AI chat
sites. It strips code, file paths and anything that looks like a key before
searching. YouTube sees a phrase like "cap theorem explained", never your
message. No server, no analytics, no account.

Two honest caveats. You need your own free YouTube API key. And the topic
guesser is just heuristics, so it gets things wrong sometimes, which is why you
can edit the phrase before you search.

Open source: https://github.com/Dipeshtripathi13/tangent

Happy to answer anything, especially if you think the idea is wrong.
```

---

## Assets to make by hand

- [x] **Thumbnail** — 240×240, generated: `store-extension/icons/product-hunt-240.png`.
      Regenerate with `npm run build:icons` from `store-extension/`.
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
