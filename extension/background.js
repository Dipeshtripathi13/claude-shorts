/**
 * Service worker: the only part of the extension that talks to the daemon.
 *
 * Content scripts stay dumb on purpose — they observe and forward, and hold no
 * token. If a page ever managed to reach one, there is nothing there to steal.
 */

const DEFAULTS = { port: 8787, token: '' };

async function settings() {
  return await chrome.storage.local.get(DEFAULTS);
}

function base(port) {
  return `http://127.0.0.1:${port}`;
}

chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'turn') {
    void forward(msg);
    return false;
  }
  if (msg?.type === 'pair') {
    pair(msg.port).then(sendResponse);
    return true;   // async response
  }
  if (msg?.type === 'settings') {
    settings().then(sendResponse);
    return true;
  }
  return false;
});

async function forward(msg) {
  const { port, token } = await settings();
  if (!token) return;   // not paired yet; stay silent rather than erroring
  try {
    await fetch(`${base(port)}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source: msg.source,
        sessionId: msg.sessionId,
        role: msg.role,
        text: msg.text ?? '',
        state: msg.state,
      }),
    });
  } catch {
    // Daemon not running. The side panel surfaces that; no need to nag here.
  }
}

/** Exchange a short-lived pairing window for the daemon's token. */
async function pair(port) {
  try {
    const res = await fetch(`${base(port)}/pair`, { method: 'POST' });
    const body = await res.json();
    if (!res.ok || !body.token) {
      return { ok: false, error: body.error || `daemon returned ${res.status}` };
    }
    await chrome.storage.local.set({ token: body.token, port });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `could not reach the daemon on port ${port} — is it running?` };
  }
}
