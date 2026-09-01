/**
 * The panel UI, served at GET /panel.
 *
 * Deliberately a single self-contained document with no build step and no
 * dependencies: the VS Code webview, the browser side panel and a plain tab all
 * load the same bytes, so there is exactly one UI to maintain.
 *
 * The flow is opt-in end to end. A prompt raises a *button* naming the topic —
 * free, because extracting it is local. Only a click searches. And even then,
 * nothing loads from YouTube until the user presses play on a specific clip.
 */
export function panelHtml(): string {
  return HTML;
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shorts while you wait</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfaf9; --panel: #ffffff; --ink: #1b1a18; --muted: #6b6862;
    --line: #e6e2dc; --accent: #c85c2e; --accent-ink: #ffffff; --ok: #2f7d5a;
    --radius: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17161a; --panel: #201f24; --ink: #eceaf0; --muted: #9a96a3;
      --line: #322f38; --accent: #e0764a; --accent-ink: #17161a; --ok: #6cc79a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 13px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }
  header {
    padding: 10px 12px; border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  }
  .topic { font-weight: 650; font-size: 14px; letter-spacing: -0.01em; }
  .badge {
    font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
    padding: 2px 6px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted);
  }
  .why { color: var(--muted); font-size: 11.5px; width: 100%; }
  main { flex: 1; overflow-y: auto; padding: 12px; }

  /* ---- the offer: a button, not a video ---- */
  .offer { text-align: center; padding: 26px 14px; }
  .offer .kicker {
    font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); margin-bottom: 10px;
  }
  .offer .subject {
    font-size: 17px; font-weight: 650; line-height: 1.3;
    margin-bottom: 4px; letter-spacing: -0.01em; text-wrap: balance;
  }
  .offer .q { color: var(--muted); font-size: 11.5px; margin-bottom: 16px; }
  .find {
    font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer;
    padding: 9px 20px; border-radius: 8px; border: 1px solid var(--accent);
    background: var(--accent); color: var(--accent-ink);
  }
  .find:hover { filter: brightness(1.06); }
  .find:disabled { opacity: .6; cursor: default; }
  .find:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .cost { display: block; margin-top: 10px; font-size: 11px; color: var(--muted); }
  .dismiss {
    display: block; margin: 12px auto 0; font: inherit; font-size: 11.5px;
    background: none; border: 0; color: var(--muted); cursor: pointer; text-decoration: underline;
  }

  /* ---- results ---- */
  .stage { position: relative; width: 100%; max-width: 300px; margin: 0 auto 12px; }
  .frame {
    position: relative; aspect-ratio: 9 / 16; width: 100%;
    border-radius: var(--radius); overflow: hidden; background: #000;
    border: 1px solid var(--line);
  }
  .frame iframe, .frame img { width: 100%; height: 100%; border: 0; display: block; object-fit: cover; }
  .play {
    position: absolute; inset: 0; display: grid; place-items: center;
    background: linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.55));
    border: 0; cursor: pointer; color: #fff; font: inherit;
  }
  .play span {
    width: 54px; height: 54px; border-radius: 99px; display: grid; place-items: center;
    background: rgba(255,255,255,.92); color: #111; font-size: 20px; padding-left: 4px;
  }
  .meta { margin-top: 8px; }
  .meta h2 { font-size: 13px; margin: 0 0 2px; font-weight: 600; line-height: 1.35; }
  .meta p { margin: 0; color: var(--muted); font-size: 11.5px; }
  .row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  button.act {
    font: inherit; font-size: 11.5px; padding: 4px 9px; border-radius: 6px;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer;
  }
  button.act:hover { border-color: var(--accent); color: var(--accent); }
  button.act.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
  .strip button {
    flex: 0 0 62px; padding: 0; border-radius: 7px; overflow: hidden; cursor: pointer;
    border: 2px solid transparent; background: none; line-height: 0;
  }
  .strip button[aria-current="true"] { border-color: var(--accent); }
  .strip img { width: 62px; height: 92px; object-fit: cover; }

  .empty { color: var(--muted); text-align: center; padding: 34px 16px; }
  .empty h2 { font-size: 14px; color: var(--ink); margin: 0 0 6px; }
  .empty code { background: var(--panel); border: 1px solid var(--line); padding: 1px 5px; border-radius: 4px; font-size: 11px; }

  .spinner {
    width: 22px; height: 22px; margin: 0 auto 12px; border-radius: 99px;
    border: 2px solid var(--line); border-top-color: var(--accent);
    animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }

  footer {
    border-top: 1px solid var(--line); padding: 6px 12px; color: var(--muted);
    font-size: 11px; display: flex; gap: 10px; align-items: center; justify-content: space-between;
  }
  .dot { width: 7px; height: 7px; border-radius: 99px; background: var(--muted); display: inline-block; }
  .dot.live { background: var(--ok); }
  .kbd { color: var(--muted); font-size: 10.5px; }
</style>
</head>
<body>
<header>
  <span class="topic" id="topic">Nothing yet</span>
  <span class="badge" id="src">idle</span>
  <span class="why" id="why">Ask Claude or ChatGPT something, and a button appears here.</span>
</header>

<main>
  <div id="empty" class="empty">
    <h2>Waiting for your next message</h2>
    <p>Type something into Claude or ChatGPT. If there is a concept worth
       explaining, a <strong>Find shorts</strong> button shows up here.</p>
    <p style="margin-top:10px">Nothing is searched until you click it.</p>
  </div>

  <div id="offer" class="offer" hidden>
    <div class="kicker" id="offerKicker">Want a quick explainer?</div>
    <div class="subject" id="offerSubject"></div>
    <div class="q" id="offerQuery"></div>
    <button class="find" id="btnFind">Find shorts</button>
    <span class="cost" id="offerCost"></span>
    <button class="dismiss" id="btnSkip">Not now</button>
  </div>

  <div id="loading" class="empty" hidden>
    <div class="spinner"></div>
    <p id="loadingText">Searching…</p>
  </div>

  <div id="stage" class="stage" hidden>
    <div class="frame" id="frame"></div>
    <div class="meta">
      <h2 id="vtitle"></h2>
      <p id="vmeta"></p>
      <div class="row">
        <button class="act primary" id="btnPlay">Play</button>
        <button class="act" id="btnNext">Next</button>
        <button class="act" id="btnOpen">Open on YouTube</button>
        <button class="act" id="btnMute">Not useful</button>
      </div>
    </div>
    <div class="row" style="margin-top:10px"><div class="strip" id="strip"></div></div>
    <p class="kbd" style="margin-top:8px">j / k next &amp; previous &middot; Enter play &middot; o open &middot; m dismiss</p>
  </div>
</main>

<footer>
  <span><span class="dot" id="dot"></span> <span id="conn">connecting</span></span>
  <span id="quota"></span>
</footer>

<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  var base = location.origin;
  var batch = null, index = 0, playing = false, offer = null;

  var el = function (id) { return document.getElementById(id); };
  function authHeaders() {
    return { 'content-type': 'application/json', authorization: 'Bearer ' + token };
  }

  function fmtDur(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return m > 0 ? m + 'm ' + r + 's' : r + 's';
  }
  function fmtViews(n) {
    if (!n && n !== 0) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K views';
    return n + ' views';
  }

  /** Exactly one of the four panes is ever visible. */
  function showPane(name) {
    el('empty').hidden = name !== 'empty';
    el('offer').hidden = name !== 'offer';
    el('loading').hidden = name !== 'loading';
    el('stage').hidden = name !== 'stage';
  }

  // ---- the offer -----------------------------------------------------------
  function renderOffer(o) {
    offer = o;
    batch = null;
    el('topic').textContent = o.topic.label;
    el('src').textContent = o.source.replace('-', ' ');
    el('why').textContent = 'Spotted in your message · ' +
      Math.round(o.topic.confidence * 100) + '% confident';
    el('offerSubject').textContent = o.topic.label;
    el('offerQuery').textContent = 'would search "' + o.topic.query + '"';
    el('offerCost').textContent = o.cached
      ? 'Already cached — costs nothing.'
      : 'Uses one of today\'s searches.';
    el('btnFind').disabled = false;
    el('btnFind').textContent = 'Find shorts';
    showPane('offer');
  }

  function accept() {
    if (!offer) return;
    var btn = el('btnFind');
    btn.disabled = true;
    el('loadingText').textContent = 'Searching for "' + offer.topic.query + '"…';
    showPane('loading');

    fetch(base + '/accept', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ offerId: offer.id })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        // On success the suggestion also arrives over SSE and renders there.
        if (!res.ok) {
          el('why').textContent = 'No luck: ' + (res.reason || res.error || 'search failed');
          showPane('offer');
          btn.disabled = false;
        }
      })
      .catch(function (e) {
        el('why').textContent = 'Search failed: ' + e.message;
        showPane('offer');
        btn.disabled = false;
      });
  }

  el('btnFind').onclick = accept;
  el('btnSkip').onclick = function () {
    offer = null;
    el('topic').textContent = 'Nothing yet';
    el('why').textContent = 'Skipped. The next message raises a new button.';
    showPane('empty');
  };

  // ---- results -------------------------------------------------------------
  function render() {
    if (!batch || !batch.videos.length) return;
    var v = batch.videos[index];
    showPane('stage');
    el('topic').textContent = batch.topic.label;
    el('src').textContent = batch.source.replace('-', ' ');
    el('why').textContent =
      'Searched "' + batch.topic.query + '" · ' +
      (batch.cached ? 'from cache' : 'fresh') +
      ' · ' + (index + 1) + ' of ' + batch.videos.length;

    var frame = el('frame');
    frame.textContent = '';
    if (playing) {
      var f = document.createElement('iframe');
      f.src = v.embedUrl + '&autoplay=1';
      f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; web-share';
      f.allowFullscreen = true;
      f.title = v.title;
      frame.appendChild(f);
    } else {
      var img = document.createElement('img');
      img.src = v.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      var btn = document.createElement('button');
      btn.className = 'play';
      btn.setAttribute('aria-label', 'Play ' + v.title);
      btn.innerHTML = '<span>&#9654;</span>';
      btn.onclick = function () { playing = true; render(); };
      frame.appendChild(img);
      frame.appendChild(btn);
    }

    el('vtitle').textContent = v.title;
    var bits = [v.channel, fmtDur(v.durationSec), fmtViews(v.viewCount)].filter(Boolean);
    el('vmeta').textContent = bits.join(' · ');
    el('btnPlay').textContent = playing ? 'Restart' : 'Play';

    var strip = el('strip');
    strip.textContent = '';
    batch.videos.forEach(function (vid, i) {
      var b = document.createElement('button');
      b.setAttribute('aria-current', String(i === index));
      b.title = vid.title;
      var t = document.createElement('img');
      t.src = vid.thumbnail; t.alt = ''; t.loading = 'lazy'; t.referrerPolicy = 'no-referrer';
      b.appendChild(t);
      b.onclick = function () { index = i; playing = false; render(); };
      strip.appendChild(b);
    });
  }

  function move(delta) {
    if (!batch) return;
    index = (index + delta + batch.videos.length) % batch.videos.length;
    playing = false;
    render();
  }

  el('btnPlay').onclick = function () { playing = false; render(); playing = true; render(); };
  el('btnNext').onclick = function () { move(1); };
  el('btnOpen').onclick = function () {
    if (batch) window.open(batch.videos[index].url, '_blank', 'noopener');
  };
  el('btnMute').onclick = function () {
    if (!batch) return;
    fetch(base + '/feedback', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ sessionId: batch.sessionId, videoIds: batch.videos.map(function (v) { return v.id; }) })
    }).catch(function () {});
    batch = null; playing = false;
    showPane('empty');
    el('topic').textContent = 'Dismissed';
    el('why').textContent = 'Those clips will not come back this session.';
  };

  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (!el('offer').hidden) {
      if (e.key === 'Enter' || e.key === 'f') { accept(); e.preventDefault(); }
      return;
    }
    if (!batch) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { move(1); e.preventDefault(); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { playing = true; render(); }
    else if (e.key === 'o') { el('btnOpen').click(); }
    else if (e.key === 'm') { el('btnMute').click(); }
  });

  function setConn(live, label) {
    el('dot').className = 'dot' + (live ? ' live' : '');
    el('conn').textContent = label;
  }

  function connect() {
    var es = new EventSource(base + '/events?token=' + encodeURIComponent(token));
    es.addEventListener('open', function () { setConn(true, 'listening'); });
    es.addEventListener('offer', function (m) { renderOffer(JSON.parse(m.data)); });
    es.addEventListener('suggestion', function (m) {
      batch = JSON.parse(m.data); offer = null; index = 0; playing = false; render();
    });
    es.addEventListener('status', function (m) {
      var s = JSON.parse(m.data);
      var q = s.quota;
      el('quota').textContent = s.provider === 'youtube'
        ? q.remaining + '/' + q.limit + ' searches left · ' + s.cache.entries + ' cached'
        : s.provider + ' · ' + s.cache.entries + ' cached';
    });
    es.addEventListener('skip', function (m) {
      var d = JSON.parse(m.data);
      if (!batch && !offer) el('why').textContent = 'Nothing to offer: ' + d.reason;
    });
    es.onerror = function () { setConn(false, 'reconnecting'); };
  }

  if (!token) {
    setConn(false, 'no token in URL');
    el('empty').innerHTML = '<h2>Missing token</h2><p>Open this panel with <code>shorts panel --web</code>.</p>';
  } else {
    connect();
  }
})();
</script>
</body>
</html>`;
