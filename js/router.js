// ====================================================
// No-build-step client-side router. Self-initializes on first import (module
// top-level code runs exactly once per tab, no matter how many times a page's
// own inline script re-imports this file across navigations).
//
// Swaps document.body + a single page-style <style> tag instead of doing a
// full browser navigation, then re-executes the target page's inline
// <script type="module"> (scripts inserted via innerHTML never execute per
// HTML spec, so this is done by explicitly creating fresh <script> elements).
//
// document-print.html is intentionally excluded — it has no shared shell and
// is already opened via window.open(..., '_blank') as a standalone tab.
// ====================================================

const ROUTABLE_FILES = new Set([
  'index.html', 'documents.html', 'document-editor.html', 'customers.html',
  'products.html', 'settings.html', 'plan.html', 'admin.html',
]);

const cleanups = [];
export function registerCleanup(fn) { cleanups.push(fn); }
function runCleanups() { while (cleanups.length) cleanups.pop()(); }

// Every go() bumps this. A page's async loaders (Firestore reads that resolve after
// the user has already navigated away) capture the generation at mount time and check
// it before writing to the DOM — otherwise a slow, now-stale read can resolve after a
// navigation and overwrite the new page's freshly-rendered content with outdated data.
let generation = 0;
export function currentGeneration() { return generation; }
export function isCurrent(gen) { return gen === generation; }

let styleTag = document.getElementById('router-page-style');
if (!styleTag) {
  styleTag = document.createElement('style');
  styleTag.id = 'router-page-style';
  document.head.appendChild(styleTag);
}

export async function go(url, { push = true } = {}) {
  const target = new URL(url, window.location.href);
  const res = await fetch(target.href);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

  runCleanups();
  generation++;

  document.title = doc.title;
  const newStyle = doc.querySelector('style');
  styleTag.textContent = newStyle ? newStyle.textContent : '';

  // pushState BEFORE the new page's script runs — several pages (document-editor.html
  // most critically) read window.location.search synchronously during init to get
  // ?id=/?customerId=/?docType=. If the script ran first, it would read the OLD url.
  if (push) history.pushState({}, '', target.href);

  document.body.innerHTML = doc.body.innerHTML;   // inert <script> tags here are harmless no-ops

  doc.querySelectorAll('script[type="module"]').forEach(oldScript => {
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = oldScript.textContent;
    document.body.appendChild(s);                 // this is what actually executes the new page
  });

  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => go(location.href, { push: false }));

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.getAttribute('href'), window.location.href);
  if (url.origin !== window.location.origin) return;
  const file = url.pathname.split('/').pop() || 'index.html';
  if (!ROUTABLE_FILES.has(file)) return;
  e.preventDefault();
  go(url.href);
});
