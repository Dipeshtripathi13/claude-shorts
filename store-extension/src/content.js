/**
 * Reads the chat page the user already has open, and hosts the panel.
 *
 * Deliberately free of site-specific selectors. Chat UIs are redesigned
 * constantly, and a scraper keyed to class names breaks on the next deploy.
 * Both signals we need can be had generically:
 *
 *   what was asked - read the composer's own text at the moment of submit
 *   nothing else   - we do not read the conversation, the replies, or history
 *
 * The panel is an extension page in an iframe rather than markup injected into
 * the host document. That keeps the page's CSS and the panel's completely
 * isolated in both directions, and lets the panel embed YouTube's player under
 * the extension's own CSP rather than the site's.
 */
(function () {
  'use strict';

  const MIN_CHARS = 12;
  const PANEL_ID = 'tangent-panel-host';

  let lastSent = '';
  let lastSentAt = 0;
  let host = null;
  let visible = false;

  /* ------------------------------------------------------------ reading */

  function isEditable(el) {
    return !!el && !!el.tagName && (el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  /** The composer is the focused editable, or the largest one on the page. */
  function findComposer() {
    const nodes = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    let best = null;
    let bestArea = 0;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = n; }
    }
    return best;
  }

  function composerText(el) {
    const node = isEditable(el) ? el : findComposer();
    if (!node) return '';
    const text = node.value !== undefined ? node.value : node.innerText;
    return (text || '').trim();
  }

  function onSubmit(text) {
    const clean = (text || '').trim();
    if (clean.length < MIN_CHARS) return;
    // The same turn can arrive from both the keydown and the click handler.
    if (clean === lastSent && Date.now() - lastSentAt < 3000) return;
    lastSent = clean;
    lastSentAt = Date.now();

    send({ type: 'turn', text: clean, href: location.href });
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      // Extension reloaded or updated underneath the page; nothing to do.
    }
  }

  // Enter submits on both sites; Shift+Enter is a newline.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!isEditable(e.target)) return;
    const text = composerText(e.target);
    setTimeout(() => onSubmit(text), 0);   // read before the site clears the box
  }, true);

  // Send button: any button click while the composer holds text.
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button');
    if (!btn) return;
    const text = composerText(null);
    if (!text) return;
    setTimeout(() => onSubmit(text), 0);
  }, true);

  /* ------------------------------------------------------------- panel */

  function ensurePanel() {
    if (host && document.body.contains(host)) return host;

    host = document.createElement('div');
    host.id = PANEL_ID;
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: '340px',
      height: '100vh',
      zIndex: '2147483647',
      border: '0',
      boxShadow: '0 0 28px rgba(0,0,0,.18)',
      display: 'none',
      colorScheme: 'normal',
    });

    const frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('src/ui/panel.html');
    frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    frame.title = 'Tangent';
    Object.assign(frame.style, { width: '100%', height: '100%', border: '0', display: 'block' });

    host.appendChild(frame);
    document.body.appendChild(host);
    return host;
  }

  function setVisible(next) {
    visible = next;
    ensurePanel().style.display = next ? 'block' : 'none';
    // Nudge the page over so the panel does not cover the conversation.
    document.documentElement.style.transition = 'margin-right .15s ease';
    document.documentElement.style.marginRight = next ? '340px' : '';
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'toggle-panel') {
      setVisible(!visible);
      sendResponse({ ok: true, visible });
      return false;
    }
    if (msg?.type === 'close-panel') {
      setVisible(false);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // The panel asks to be closed from its own header button. Accept that only
  // from our own iframe, never from the host page or a third-party frame.
  window.addEventListener('message', (e) => {
    if (e.data?.tangent !== 'close') return;
    const frame = host?.firstElementChild;
    if (!frame || e.source !== frame.contentWindow) return;
    setVisible(false);
  });

  window.addEventListener('pagehide', () => {
    document.documentElement.style.marginRight = '';
  });
})();
