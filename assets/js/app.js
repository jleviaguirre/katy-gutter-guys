/**
 * RainGuard - app shell logic
 * ---------------------------------------------------------------------------
 * Fetches page content (modules) from the Cloudflare Worker, renders a hash
 * router over them, executes any <script> tags embedded in that content
 * (sheet-authored HTML is trusted - see /docs/SETUP.md), and exposes a small
 * helper, window.RainGuard.submitForm(), that embedded scripts/forms can use
 * to post data back through the same Worker.
 */

const { API_BASE_URL, DEFAULT_MODULE } = window.APP_CONFIG;

const appEl = document.getElementById('app');
const navEl = document.getElementById('site-nav');
const toastEl = document.getElementById('toast');

/** module name (lowercase) -> module row from the sheet */
let modulesByKey = new Map();
let orderedModules = [];

init();

async function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  registerServiceWorker();
  wireRemoteForms();

  try {
    const modules = await fetchModules();
    indexModules(modules);
    renderNav();
    window.addEventListener('hashchange', renderCurrentRoute);
    renderCurrentRoute();
  } catch (err) {
    renderFatalError(err);
  }
}

async function fetchModules() {
  const response = await fetch(`${API_BASE_URL}/`, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Backend responded with ${response.status}`);
  }
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Unknown backend error');
  }
  return data.modules || [];
}

function indexModules(modules) {
  orderedModules = modules.slice().sort((a, b) => {
    const orderA = Number(a.order ?? 0);
    const orderB = Number(b.order ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.navLabel || a.module).localeCompare(String(b.navLabel || b.module));
  });
  modulesByKey = new Map(
    modules.map((row) => [String(row.module).toLowerCase(), row])
  );
}

function renderNav() {
  navEl.innerHTML = '';
  orderedModules
    .filter((row) => !isFalsy(row.showInNav))
    .forEach((row) => {
      const link = document.createElement('a');
      link.href = `#${row.module}`;
      link.textContent = row.navLabel || row.module;
      navEl.appendChild(link);
    });
  highlightActiveNav();
}

function isFalsy(value) {
  return value === false || String(value).toLowerCase() === 'false';
}

function currentModuleKey() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return (hash || DEFAULT_MODULE).toLowerCase();
}

function renderCurrentRoute() {
  const key = currentModuleKey();
  const row = modulesByKey.get(key);

  if (!row) {
    renderNotFound(key);
    highlightActiveNav();
    return;
  }

  document.title = row.title ? `RainGuard - ${row.title}` : 'RainGuard';
  appEl.innerHTML = row.html || '';
  executeEmbeddedScripts(appEl);
  highlightActiveNav();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function highlightActiveNav() {
  const key = currentModuleKey();
  navEl.querySelectorAll('a').forEach((link) => {
    const isActive = link.getAttribute('href') === `#${key}`;
    link.toggleAttribute('aria-current', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
  });
}

function renderNotFound(key) {
  appEl.innerHTML = `
    <div class="error-state">
      <h1>Page not found</h1>
      <p>We couldn't find a module named "${escapeHtml(key)}".</p>
    </div>
  `;
}

function renderFatalError(err) {
  console.error(err);
  appEl.innerHTML = `
    <div class="error-state">
      <h1>Unable to load content</h1>
      <p>Please check your connection and try again shortly.</p>
    </div>
  `;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

/**
 * innerHTML does not execute <script> tags. This re-creates each script
 * node (preserving attributes like src, type, module) so sheet-authored
 * content can rely on embedded <script> behaving normally.
 */
function executeEmbeddedScripts(container) {
  container.querySelectorAll('script').forEach((oldScript) => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });
    newScript.textContent = oldScript.textContent;
    oldScript.replaceWith(newScript);
  });
}

/** Lets embedded inline scripts post form data back through the Worker. */
async function submitForm(module, formId, fields) {
  const response = await fetch(`${API_BASE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, formId, fields })
  });
  const data = await response.json().catch(() => ({ ok: false, error: 'Invalid response' }));
  if (!data.ok) {
    throw new Error(data.error || 'Submission failed');
  }
  return data;
}

/** Convenience: any <form class="js-remote-form"> auto-submits via the API. */
function wireRemoteForms() {
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form.js-remote-form');
    if (!form) return;
    event.preventDefault();

    const module = form.dataset.module || currentModuleKey();
    const formId = form.dataset.formId || form.id || 'default';
    const fields = Object.fromEntries(new FormData(form).entries());

    try {
      await submitForm(module, formId, fields);
      showToast('Thanks! Your submission was received.');
      form.reset();
    } catch (err) {
      console.error(err);
      showToast('Something went wrong submitting the form.', 'error');
    }
  });
}

function showToast(message, variant = 'info') {
  toastEl.textContent = message;
  toastEl.dataset.variant = variant;
  toastEl.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW registration failed', err));
  }
}

window.RainGuard = { submitForm, showToast };
