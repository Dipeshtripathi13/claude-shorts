/**
 * Reads the page the user is already looking at, and nothing else.
 *
 * Two signals are needed: what was just asked, and whether the model is still
 * working. Both are taken without depending on any site-specific class name,
 * because chat UIs get redesigned constantly and a selector-based scraper is
 * broken by the next deploy:
 *
 *   what was asked -> read the composer's own text at the moment of submit
 *   still working  -> watch for DOM churn; a quiet period means it finished
 *
 * The text goes to the local daemon and nowhere else. Only a short derived
 * search phrase ever leaves the machine, and only to YouTube.
 */
(function () {
  'use strict';

  const QUIET_MS = 2500;      // no DOM churn this long means the reply finished
  const MIN_CHARS = 12;

  const site = location.hostname.includes('claude.ai') ? 'claude-web' : 'chatgpt-web';
  let idleTimer = null;
  let armed = false;          // true between submit and quiet
  let lastSent = '';
  let lastSentAt = 0;

  function sessionId() {
    // One conversation per URL path; new chat means new session and fresh cooldowns.
    const m = location.pathname.match(/\/(?:chat|c)\/([\w-]+)/);
    return site + ':' + (m ? m[1] : 'new');
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(Object.assign({ source: site, sessionId: sessionId() }, msg));
    } catch (e) {
      // Extension reloaded out from under the page; nothing to do.
    }
  }

  /** The composer is the focused editable, or the largest one on the page. */
  function composerText(el) {
    const node = el && isEditable(el) ? el : findComposer();
    if (!node) return '';
    const text = node.value !== undefined ? node.value : node.innerText;
    return (text || '').trim();
  }

  function isEditable(el) {
    if (!el || !el.tagName) return false;
    return el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  function findComposer() {
    const nodes = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    let best = null, bestArea = 0;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = n; }
    }
    return best;
  }

  function onSubmit(text) {
    const clean = (text || '').trim();
    if (clean.length < MIN_CHARS) return;
    // Guard against the same turn arriving via both keydown and click.
    if (clean === lastSent && Date.now() - lastSentAt < 3000) return;
    lastSent = clean;
    lastSentAt = Date.now();

    armed = true;
    send({ type: 'turn', role: 'user', text: clean, state: 'thinking' });
    resetIdle();
  }

  function resetIdle() {
    if (!armed) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      armed = false;
      send({ type: 'turn', role: 'assistant', text: '', state: 'idle' });
    }, QUIET_MS);
  }

  // Enter in the composer submits on both sites (Shift+Enter is a newline).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!isEditable(e.target)) return;
    const text = composerText(e.target);
    // Read before the site clears the box.
    setTimeout(() => onSubmit(text), 0);
  }, true);

  // Send button: any button click while the composer holds text.
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (!btn) return;
    const text = composerText(null);
    if (!text) return;
    setTimeout(() => onSubmit(text), 0);
  }, true);

  // While a reply streams, the DOM churns constantly. Silence means done.
  const mo = new MutationObserver(() => { if (armed) resetIdle(); });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.addEventListener('pagehide', () => mo.disconnect());
})();
