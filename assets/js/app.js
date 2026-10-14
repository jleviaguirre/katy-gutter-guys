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
const menuEl = document.getElementById('site-menu');
const menuLinksEl = document.getElementById('site-menu-links');
const menuToggleEl = document.getElementById('site-menu-toggle');
const loginBtnEl = document.getElementById('site-login-btn');

/** module name (lowercase) -> module row from the sheet */
let modulesByKey = new Map();

init();

async function init() {
  //document.getElementById('year').textContent = new Date().getFullYear();
  registerServiceWorker();
  wireRemoteForms();
  wireMenuToggle();
  wireLoginPlaceholder();

  try {
    const [modules, sections] = await Promise.all([fetchModules(), fetchLandingSections()]);
    indexModules(modules);
    renderSiteMenu(sections);
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

/**
 * The site menu's items are authored as the "Masthead" row of the landing
 * page sheet tab, even though (unlike the rest of that tab) they render
 * into the fixed shell header rather than into #app. Fails soft (empty
 * menu) rather than blocking the whole page if this fetch has a problem.
 */
async function fetchLandingSections() {
  try {
    const response = await fetch(`${API_BASE_URL}/?view=landing`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.ok ? data.sections || [] : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

function indexModules(modules) {
  modulesByKey = new Map(
    modules.map((row) => [String(row.module).toLowerCase(), row])
  );
}

/** Renders the "Masthead" landing-page row's content as the fixed header's
 * menu. Its links use data-scroll-to (not href="#id") to avoid colliding
 * with the module router - see wireMenuScroll(). */
function renderSiteMenu(sections) {
  if (!menuLinksEl) return;
  const masthead = sections.find((s) => String(s.section || '').trim().toLowerCase() === 'masthead');
  menuLinksEl.innerHTML = masthead ? masthead.content || '' : '';
  executeEmbeddedScripts(menuLinksEl);
  wireMenuScroll();
}

/**
 * Smooth-scrolls to an in-page section for [data-scroll-to] elements. If
 * the target isn't on the current page (e.g. clicking "Services" while
 * viewing the RFQ module), navigates to the home module first and scrolls
 * once its content has rendered.
 */
function wireMenuScroll() {
  menuLinksEl.querySelectorAll('[data-scroll-to]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      closeMenu();
      const targetId = el.getAttribute('data-scroll-to');
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (currentModuleKey() !== DEFAULT_MODULE) {
        window.location.hash = DEFAULT_MODULE;
        const scrollWhenReady = () => {
          const el2 = document.getElementById(targetId);
          if (el2) {
            el2.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        };
        window.setTimeout(scrollWhenReady, 150);
      }
    });
  });
}

function wireMenuToggle() {
  if (!menuToggleEl || !menuEl) return;
  menuToggleEl.addEventListener('click', () => {
    menuEl.classList.toggle('is-open');
  });
}

function closeMenu() {
  if (menuEl) menuEl.classList.remove('is-open');
}

function wireLoginPlaceholder() {
  if (!loginBtnEl) return;
  loginBtnEl.addEventListener('click', () => {
    showToast('Login is coming soon.');
  });
}

function currentModuleKey() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return (hash || DEFAULT_MODULE).toLowerCase();
}

function renderCurrentRoute() {
  closeMenu();
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
