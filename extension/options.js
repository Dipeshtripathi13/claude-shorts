const $ = (id) => document.getElementById(id);

function say(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
}

chrome.storage.local.get({ port: 8787, token: '' }).then((s) => {
  $('port').value = s.port;
  $('token').value = s.token;
  if (s.token) say('Paired.', true);
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    port: Number($('port').value) || 8787,
    token: $('token').value.trim(),
  });
  say('Saved.', true);
});

$('pair').addEventListener('click', async () => {
  const port = Number($('port').value) || 8787;
  const res = await chrome.runtime.sendMessage({ type: 'pair', port });
  if (res?.ok) {
    const s = await chrome.storage.local.get({ token: '' });
    $('token').value = s.token;
    say('Paired.', true);
  } else {
    say(res?.error ?? 'Pairing failed.', false);
  }
});
