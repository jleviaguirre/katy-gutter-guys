/**
 * Gutter Guys of Katy - app shell logic
 * ---------------------------------------------------------------------------
 * Fetches page content (modules) from the Cloudflare Worker, renders a hash
 * router over them, executes any <script> tags embedded in that content
 * (sheet-authored HTML is trusted - see /docs/SETUP.md), and exposes a small
 * helper, window.RainGuard.submitForm(), that embedded scripts/forms can use
 * to post data back through the same Worker.
 */

const { API_BASE_URL, DEFAULT_MODULE } = window.APP_CONFIG;

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');

/** module name (lowercase) -> module row from the sheet */
let modulesByKey = new Map();

init();

async function init() {
  document.getElementById('year').textContent = new Date().getFullYear();
  registerServiceWorker();
  wireRemoteForms();

  try {
    const modules = await fetchModules();
    indexModules(modules);
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
  modulesByKey = new Map(
    modules.map((row) => [String(row.module).toLowerCase(), row])
  );
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
    return;
  }

  document.title = row.title ? `Gutter Guys of Katy - ${row.title}` : 'Gutter Guys of Katy';
  appEl.innerHTML = row.html || '';
  executeEmbeddedScripts(appEl);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
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

/**
 * Lets embedded inline scripts post form data back through the Worker.
 * `options.sheetName` routes the submission to its own Sheet tab (auto-
 * created with dynamic headers) instead of the shared "Submissions" tab.
 */
async function submitForm(module, formId, fields, options = {}) {
  const response = await fetch(`${API_BASE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, formId, fields, sheetName: options.sheetName })
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
      await submitForm(module, formId, fields, { sheetName: form.dataset.sheetName });
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
