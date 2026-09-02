/**
 * Panel logic. Ships inside the package: no remotely hosted code, which
 * Manifest V3 requires and the Chrome Web Store checks for.
 *
 * Nothing loads from YouTube until the viewer presses play on a specific clip.
 * Until then a card is a thumbnail, so the panel stays silent and pulls in no
 * third-party frames the user did not ask for.
 */

const $ = (id) => document.getElementById(id);

const PANES = ['paneSetup', 'paneIdle', 'paneOffer', 'paneLoading', 'paneResults', 'paneError'];

let offer = null;
let result = null;
let hasKey = false;
let index = 0;

function show(pane) {
  for (const p of PANES) $(p).hidden = p !== pane;
}

function say(text) {
  $('why').textContent = text;
}

/* ---------------------------------------------------------------- offers */

function renderOffer(next) {
  offer = next;
  result = null;
  say(`Spotted in your message · ${Math.round(next.topic.confidence * 100)}% confident`);

  // Without a key we cannot search, but hiding what we found makes the
  // extension look broken. Name the topic on the setup screen instead.
  if (!hasKey) {
    const el = $('setupTopic');
    el.innerHTML = '';
    el.append('Found in your message: ');
    const strong = document.createElement('strong');
    strong.textContent = next.topic.label;
    el.append(strong, '. Add a key and this becomes a search.');
    el.hidden = false;
    show('paneSetup');
    return;
  }

  $('offerSubject').textContent = next.topic.label;
  $('offerQuery').textContent = `would search “${next.topic.query}”`;
  $('offerCost').textContent = next.cached
    ? 'Already saved from an earlier search — costs nothing.'
    : 'Uses one of today’s searches.';
  $('btnFind').disabled = false;
  show('paneOffer');
}

async function accept() {
  if (!offer) return;
  $('btnFind').disabled = true;
  $('loadingText').textContent = `Searching for “${offer.topic.query}”…`;
  show('paneLoading');

  // The reply already carries the videos. Rendering from the broadcast alone
  // meant one lost message left the panel spinning forever, with the answer
  // sitting unread in a variable. The broadcast is now only how *other* open
  // panels find out.
  let res;
  try {
    res = await withTimeout(send({ type: 'accept' }), 25_000);
  } catch (e) {
    fail(`The search did not come back (${e.message}). The extension's background worker may have been suspended — try again.`);
    return;
  }

  if (res?.ok && res.result) { renderResults(res.result); return; }
  if (res?.error === 'no-key') { show('paneSetup'); return; }
  fail(res?.error ?? 'The search failed.');
}

function fail(message) {
  $('errorText').textContent = message;
  $('btnFind').disabled = false;
  show('paneError');
}

/** A promise that can never leave the panel spinning indefinitely. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

/* --------------------------------------------------------------- results */

function renderResults(next) {
  // A duplicate from the broadcast must not reset the clip the user is watching,
  // but it must still render if the results pane is not the one showing.
  if (result && next?.topic?.key === result.topic?.key && !$('paneResults').hidden) return;
  result = next;
  offer = null;
  index = 0;
  playing = false;
  say(`Searched “${next.topic.query}” · ${next.cached ? 'from your saved results' : 'fresh'}`);
  show('paneResults');
  try {
    paint();
  } catch (e) {
    fail(`Could not draw the results: ${e.message}`);
  }
}

function paint() {
  if (!result?.videos?.length) return;
  const v = result.videos[index];

  const frame = $('frame');
  frame.textContent = '';

  const img = document.createElement('img');
  img.src = v.thumbnail;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';

  if (playing && playerBase) {
    const f = document.createElement('iframe');
    f.src = `${playerBase}?v=${encodeURIComponent(v.id)}`;
    f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; web-share';
    f.allowFullscreen = true;
    f.title = v.title;
    frame.appendChild(f);
  } else {
    const btn = document.createElement('button');
    btn.className = 'play';
    btn.setAttribute('aria-label', `Play: ${v.title}`);
    const glyph = document.createElement('span');
    glyph.textContent = '▶';
    btn.appendChild(glyph);
    btn.addEventListener('click', () => {
      if (playerBase) { playing = true; paint(); } else { playVideo(v); }
    });
    frame.append(img, btn);
  }

  $('vtitle').textContent = v.title;
  $('vmeta').textContent = [v.channel, fmtDuration(v.durationSec), fmtViews(v.viewCount)]
    .filter(Boolean).join(' · ');

  const strip = $('strip');
  strip.textContent = '';
  result.videos.forEach((vid, i) => {
    const b = document.createElement('button');
    b.setAttribute('aria-current', String(i === index));
    b.title = vid.title;
    const t = document.createElement('img');
    t.src = vid.thumbnail;
    t.alt = '';
    t.loading = 'lazy';
    t.referrerPolicy = 'no-referrer';
    b.appendChild(t);
    b.addEventListener('click', () => { index = i; playing = false; paint(); });
    strip.appendChild(b);
  });
}

/**
 * Opens the clip in a small always-on-top window rather than embedding it.
 *
 * YouTube requires an HTTP Referer to identify the embedder, and Chrome sends
 * none from a chrome-extension:// page, so an inline player fails with
 * "Video player configuration error (153)". Nothing in the extension's control
 * fixes that: referrerpolicy does not apply to the extension origin, and
 * declarativeNetRequest cannot set Referer. The only true fix is proxying
 * through a page on a real https domain, which would mean depending on a server
 * this extension deliberately does not have.
 *
 * A compact popup keeps the clip beside the conversation and always works.
 */
function playVideo(v) {
  const width = 420;
  const height = 760;
  const left = Math.max(0, Math.round((screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((screen.availHeight - height) / 2));

  if (chrome.windows?.create) {
    chrome.windows
      .create({ url: v.url, type: 'popup', width, height, left, top })
      .catch(() => openFallback(v.url, width, height, left, top));
    return;
  }
  openFallback(v.url, width, height, left, top);
}

function openFallback(url, width, height, left, top) {
  // "noopener" must not appear in the features string: browsers read that as a
  // request for an ordinary tab and throw the geometry away, which is exactly
  // how this ended up opening full-screen.
  const w = window.open(url, '_blank', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (w) w.opener = null;
}

function move(delta) {
  if (!result) return;
  index = (index + delta + result.videos.length) % result.videos.length;
  playing = false;
  paint();
}

/* ------------------------------------------------------------------ chat */

function send(msg) {
  return chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e?.message }));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'offer') renderOffer(msg.offer);
  else if (msg?.type === 'results') renderResults(msg.result);
  else if (msg?.type === 'no-offer' && !result) {
    say(`Nothing to suggest here — ${msg.reason}.`);
    show('paneIdle');
  }
  return false;
});

/* -------------------------------------------------------------- controls */

$('btnFind').addEventListener('click', accept);
$('btnSkip').addEventListener('click', async () => {
  await send({ type: 'dismiss' });
  offer = null;
  say('Skipped. Your next message raises a new one.');
  show('paneIdle');
});
$('btnPrev').addEventListener('click', () => move(-1));
$('btnNext').addEventListener('click', () => move(1));
$('btnOpen').addEventListener('click', () => {
  if (result) playVideo(result.videos[index]);
});
$('btnBack').addEventListener('click', () => show(offer ? 'paneOffer' : 'paneIdle'));
$('btnSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('btnOpenOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
// The content script frames this page and owns whether it is visible, so the
// close button asks the parent rather than trying to hide itself.
$('btnClose').addEventListener('click', () => {
  window.parent.postMessage({ tangent: 'close' }, '*');
});

document.addEventListener('keydown', (e) => {
  if (!$('paneOffer').hidden && (e.key === 'Enter' || e.key === 'f')) { accept(); e.preventDefault(); return; }
  if ($('paneResults').hidden) return;
  if (e.key === 'j' || e.key === 'ArrowDown') { move(1); e.preventDefault(); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === 'o') { $('btnOpen').click(); }
});

/* ------------------------------------------------------------------ boot */

async function init() {
  const state = await send({ type: 'get-state' });
  if (!state?.ok) { show('paneIdle'); return; }

  hasKey = state.hasKey;
  playerBase = state.playerBase ?? '';
  $('playnote').hidden = !!playerBase;
  $('quota').textContent = hasKey
    ? `${state.quota.remaining}/${state.quota.limit} searches left today`
    : 'No API key yet';

  // An offer can arrive while this await is in flight; do not clobber it.
  if (offer || result) return;

  if (state.offer) { renderOffer(state.offer); return; }
  show(hasKey ? 'paneIdle' : 'paneSetup');
}

function fmtDuration(s) {
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

function fmtViews(n) {
  if (typeof n !== 'number') return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M views`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K views`;
  return `${n} views`;
}

init();
