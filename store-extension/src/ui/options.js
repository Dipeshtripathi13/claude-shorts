const $ = (id) => document.getElementById(id);

const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e?.message }));

const FIELDS = ['minConfidence', 'count', 'maxDurationSec', 'regionCode', 'relevanceLanguage', 'safeSearch', 'playerBase'];

function status(el, text, kind) {
  el.textContent = text;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

async function load() {
  const res = await send({ type: 'settings' });
  if (!res?.ok) return;
  const s = res.settings;

  $('apiKey').value = s.apiKey;
  $('minConfidence').value = s.minConfidence;
  $('count').value = s.count;
  $('maxDurationSec').value = s.maxDurationSec;
  $('regionCode').value = s.regionCode;
  $('relevanceLanguage').value = s.relevanceLanguage;
  $('safeSearch').value = s.safeSearch;
  $('playerBase').value = s.playerBase ?? '';
  $('limitLabel').textContent = String(s.dailySearches);
  paintConfidence();

  if (s.apiKey) status($('keyStatus'), 'A key is saved.', 'ok');

  const state = await send({ type: 'get-state' });
  if (state?.ok) {
    status($('cacheStatus'), `${state.cache.entries} topic${state.cache.entries === 1 ? '' : 's'} saved · ${state.quota.remaining}/${state.quota.limit} searches left today`);
  }
}

function paintConfidence() {
  const v = Number($('minConfidence').value);
  const word = v >= 0.65 ? 'only clear concepts' : v >= 0.45 ? 'balanced' : 'offer freely';
  $('confLabel').textContent = `${Math.round(v * 100)}% — ${word}`;
}

/* --------------------------------------------------------------- actions */

$('minConfidence').addEventListener('input', paintConfidence);

$('btnReveal').addEventListener('click', () => {
  const el = $('apiKey');
  const hidden = el.type === 'password';
  el.type = hidden ? 'text' : 'password';
  $('btnReveal').textContent = hidden ? 'Hide' : 'Show';
});

$('btnSave').addEventListener('click', async () => {
  const patch = { apiKey: $('apiKey').value.trim() };
  for (const f of FIELDS) {
    const el = $(f);
    patch[f] = el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value.trim();
  }
  const res = await send({ type: 'save-settings', patch });
  status($('keyStatus'), res?.ok ? 'Saved.' : `Could not save: ${res?.error}`, res?.ok ? 'ok' : 'bad');
});

$('btnTest').addEventListener('click', async () => {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) { status($('keyStatus'), 'Paste a key first.', 'bad'); return; }
  status($('keyStatus'), 'Checking…');
  const res = await send({ type: 'verify-key', apiKey });
  status(
    $('keyStatus'),
    res?.ok ? 'That key works.' : `That key was rejected: ${res?.error ?? 'unknown error'}`,
    res?.ok ? 'ok' : 'bad',
  );
});

$('btnClearCache').addEventListener('click', async () => {
  const res = await send({ type: 'clear-cache' });
  status($('cacheStatus'), res?.ok ? `Cleared ${res.removed} saved topic${res.removed === 1 ? '' : 's'}.` : 'Could not clear.', res?.ok ? 'ok' : 'bad');
});

load();
