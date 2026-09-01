/**
 * The side panel does not reimplement the UI: it frames the panel the daemon
 * already serves, so the browser, VS Code and a plain tab all show the same
 * thing and there is one place to fix a bug.
 */
const $ = (id) => document.getElementById(id);

async function init() {
  const s = await chrome.runtime.sendMessage({ type: 'settings' });
  if (s?.token) return show(s.port, s.token);
  $('setup').hidden = false;
  $('port').value = s?.port ?? 8787;
}

function show(port, token) {
  const frame = $('panel');
  frame.src = `http://127.0.0.1:${port}/panel?token=${encodeURIComponent(token)}`;
  frame.hidden = false;
  $('setup').hidden = true;
}

$('pair').addEventListener('click', async () => {
  const port = Number($('port').value) || 8787;
  $('err').textContent = '';
  const res = await chrome.runtime.sendMessage({ type: 'pair', port });
  if (res?.ok) {
    const s = await chrome.runtime.sendMessage({ type: 'settings' });
    show(s.port, s.token);
  } else {
    $('err').textContent = res?.error ?? 'pairing failed';
  }
});

init();
