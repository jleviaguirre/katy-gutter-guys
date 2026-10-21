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
const loginBtnEl = document.getElementById('site-login-btn');
const navWrapperEl = document.getElementById('site-nav-wrapper');
const navToggleEl = document.getElementById('site-nav-toggle');
const subnavInnerEl = document.getElementById('site-subnav-inner');

const SESSION_TOKEN_KEY = 'rg-session-token';
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const SCROLL_HIDE_THRESHOLD_PX = 80; // don't hide the nav until scrolled past this

/** module name (lowercase) -> module row from the sheet */
let modulesByKey = new Map();

/** { email, role } when logged in, else null. Role always comes from a
 * fresh whoAmI call to the backend - never trusted from localStorage - see
 * /docs/SETUP.md's "Passwordless login" section for why. */
let session = null;
let pendingLoginEmail = '';
let heartbeatTimer = null;

init();

async function init() {
  //document.getElementById('year').textContent = new Date().getFullYear();
  registerServiceWorker();
  wireRemoteForms();
  wireLogin();
  wireAccountMenu();
  wireSiteNav();
  await restoreSession();

  try {
    await reloadModules();
    window.addEventListener('hashchange', () => {
      renderCurrentRoute();
      renderSiteNav();
    });
    renderCurrentRoute();
  } catch (err) {
    renderFatalError(err);
  }
}

/**
 * Logged-out visitors use the plain cached GET (only public, blank-`role`
 * modules - see Code.gs's doGet docs). Logged-in users go through the
 * "listModules" POST action instead, which is never edge-cached and
 * returns every module their role is allowed to see - the token never
 * travels in a cacheable/loggable GET query string.
 */
async function fetchModules() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (token) {
    const data = await authRequest('listModules', { token });
    return data.modules || [];
  }
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

/** Re-fetches the (role-filtered) module list and rebuilds the sub-nav -
 * called on initial load and again after login/logout, since the set of
 * modules a viewer can see depends on who's signed in. */
async function reloadModules() {
  const modules = await fetchModules();
  indexModules(modules);
  renderSiteNav();
}

function indexModules(modules) {
  modulesByKey = new Map(
    modules.map((row) => [String(row.module).toLowerCase(), row])
  );
}

/**
 * Passwordless login (email -> one-time code, registering new emails with a
 * name/phone/address first). See Code.gs's "Passwordless login" section for
 * the backend half and /docs/SETUP.md for the full design. The browser only
 * ever stores an opaque session token; the role/profile shown/used anywhere
 * in the UI comes from whoAmI, re-read from the Users sheet on every page
 * load - never from a value the client could tamper with.
 */
function wireLogin() {
  const modalEl = document.getElementById('login-modal');
  const backdropEl = document.getElementById('login-modal-backdrop');
  const closeBtnEl = document.getElementById('login-modal-close');
  const emailFormEl = document.getElementById('login-email-form');
  const emailInputEl = document.getElementById('login-email-input');
  const emailErrorEl = document.getElementById('login-email-error');
  const registerFormEl = document.getElementById('login-register-form');
  const registerEmailEl = document.getElementById('login-register-email');
  const registerNameEl = document.getElementById('login-register-name');
  const registerPhoneEl = document.getElementById('login-register-phone');
  const registerAddressEl = document.getElementById('login-register-address');
  const registerErrorEl = document.getElementById('login-register-error');
  const registerChangeEmailBtnEl = document.getElementById('login-register-change-email-btn');
  const codeFormEl = document.getElementById('login-code-form');
  const codeInputEl = document.getElementById('login-code-input');
  const codeErrorEl = document.getElementById('login-code-error');
  const codeEmailEl = document.getElementById('login-code-email');
  const resendBtnEl = document.getElementById('login-resend-btn');
  const changeEmailBtnEl = document.getElementById('login-change-email-btn');

  if (!loginBtnEl || !modalEl) return;

  loginBtnEl.addEventListener('click', () => {
    if (session) return; // account dropdown handles the logged-in case
    openModal();
  });

  backdropEl.addEventListener('click', closeModal);
  closeBtnEl.addEventListener('click', closeModal);
  changeEmailBtnEl.addEventListener('click', showEmailStep);
  registerChangeEmailBtnEl.addEventListener('click', showEmailStep);

  emailFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError(emailErrorEl);
    const email = emailInputEl.value.trim();
    if (!email) return;
    setFormBusy(emailFormEl, true);
    setSubmitBusy(emailFormEl, 'Checking...');
    try {
      const { exists } = await authRequest('checkEmail', { email });
      pendingLoginEmail = email;
      if (exists) {
        setSubmitBusy(emailFormEl, 'Sending code...');
        await authRequest('requestCode', { email });
        showCodeStep(email);
        startResendCooldown(resendBtnEl);
      } else {
        showRegisterStep(email);
      }
    } catch (err) {
      showError(emailErrorEl, err.message);
    } finally {
      setFormBusy(emailFormEl, false);
      setSubmitBusy(emailFormEl, false);
    }
  });

  registerFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError(registerErrorEl);
    const name = registerNameEl.value.trim();
    if (!name) return;
    setFormBusy(registerFormEl, true);
    setSubmitBusy(registerFormEl, 'Sending code...');
    try {
      await authRequest('requestCode', {
        email: pendingLoginEmail,
        name,
        phone: registerPhoneEl.value.trim(),
        address: registerAddressEl.value.trim()
      });
      showCodeStep(pendingLoginEmail);
      startResendCooldown(resendBtnEl);
    } catch (err) {
      showError(registerErrorEl, err.message);
    } finally {
      setFormBusy(registerFormEl, false);
      setSubmitBusy(registerFormEl, false);
    }
  });

  codeFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError(codeErrorEl);
    const code = codeInputEl.value.trim();
    if (!code) return;
    setFormBusy(codeFormEl, true);
    setSubmitBusy(codeFormEl, 'Verifying...');
    try {
      const data = await authRequest('verifyCode', { email: pendingLoginEmail, code });
      applySession(data.token, data);
      closeModal();
      showToast(`Logged in as ${data.email}.`);
      await reloadModules();
      renderCurrentRoute();
    } catch (err) {
      showError(codeErrorEl, err.message);
    } finally {
      setFormBusy(codeFormEl, false);
      setSubmitBusy(codeFormEl, false);
    }
  });

  resendBtnEl.addEventListener('click', async () => {
    hideError(codeErrorEl);
    try {
      await authRequest('requestCode', { email: pendingLoginEmail });
      showToast('Code resent.');
      startResendCooldown(resendBtnEl);
    } catch (err) {
      showError(codeErrorEl, err.message);
    }
  });

  function openModal() {
    showEmailStep();
    modalEl.hidden = false;
    emailInputEl.focus();
  }

  function closeModal() {
    modalEl.hidden = true;
  }

  function showEmailStep() {
    emailFormEl.hidden = false;
    registerFormEl.hidden = true;
    codeFormEl.hidden = true;
    hideError(emailErrorEl);
    hideError(registerErrorEl);
    hideError(codeErrorEl);
    emailFormEl.reset();
    registerFormEl.reset();
    codeFormEl.reset();
  }

  function showRegisterStep(email) {
    emailFormEl.hidden = true;
    registerFormEl.hidden = false;
    codeFormEl.hidden = true;
    registerEmailEl.textContent = email;
    registerNameEl.focus();
  }

  function showCodeStep(email) {
    emailFormEl.hidden = true;
    registerFormEl.hidden = true;
    codeFormEl.hidden = false;
    codeEmailEl.textContent = email;
    codeInputEl.focus();
  }
}

/** Avatar button dropdown (Profile/Account/Log out) shown once logged in. */
function wireAccountMenu() {
  const menuEl = document.getElementById('account-menu');
  const dropdownEl = document.getElementById('account-menu-dropdown');
  const logoutBtnEl = document.getElementById('account-menu-logout');
  if (!menuEl || !dropdownEl || !loginBtnEl) return;

  loginBtnEl.addEventListener('click', () => {
    if (!session) return; // wireLogin handles the logged-out case
    dropdownEl.hidden = !dropdownEl.hidden;
  });

  dropdownEl.querySelectorAll('a.account-menu-item').forEach((link) => {
    link.addEventListener('click', () => { dropdownEl.hidden = true; });
  });

  logoutBtnEl.addEventListener('click', () => {
    dropdownEl.hidden = true;
    if (confirm(`Log out of ${session.email}?`)) logout();
  });

  document.addEventListener('click', (event) => {
    if (!dropdownEl.hidden && !menuEl.contains(event.target)) dropdownEl.hidden = true;
  });
}

/**
 * The sub-nav (built in renderSiteNav) collapses behind the hamburger
 * toggle on mobile (see styles.css's "max-width: 768px" block) instead of
 * always showing as its own line - this wires that toggle plus the
 * shared hide-on-scroll-down/show-on-scroll-up behavior for the header +
 * sub-nav, which always move together as one unit.
 */
function wireSiteNav() {
  if (navToggleEl && navWrapperEl) {
    navToggleEl.addEventListener('click', () => {
      const isOpen = navWrapperEl.classList.toggle('site-nav-open');
      navToggleEl.setAttribute('aria-expanded', String(isOpen));
    });
  }

  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!navWrapperEl) return;
    const currentScrollY = window.scrollY;
    const isNavOpen = navWrapperEl.classList.contains('site-nav-open');
    if (!isNavOpen) {
      if (currentScrollY > lastScrollY && currentScrollY > SCROLL_HIDE_THRESHOLD_PX) {
        navWrapperEl.classList.add('site-nav-collapsed');
      } else {
        navWrapperEl.classList.remove('site-nav-collapsed');
      }
    }
    lastScrollY = currentScrollY;
  }, { passive: true });
}

/** `showInNav` comes from a Sheet cell, so accept any of the common
 * spreadsheet-ish truthy spellings instead of just a strict boolean. */
function isTruthyCell(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return ['true', 'yes', 'y', '1', 'x'].includes(normalized);
}

/**
 * Builds the sub-nav from the Modules sheet: sorted by `order`, limited to
 * rows with `showInNav` checked, labeled with `navLabel` (falling back to
 * `title`/the module key) and tooltipped with `description`. Modules the
 * current viewer isn't allowed to see never even reach the browser (see
 * Code.gs's listModules/doGet role filtering), so no extra role check is
 * needed here - whatever is in modulesByKey is already visible to them.
 */
function renderSiteNav() {
  if (!subnavInnerEl) return;
  const currentKey = currentModuleKey();

  const parseOrder = (value) => (value === '' || value == null ? NaN : Number(value));
  const items = Array.from(modulesByKey.values())
    .filter((row) => isTruthyCell(row.showInNav))
    .sort((a, b) => {
      const orderA = parseOrder(a.order);
      const orderB = parseOrder(b.order);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) return orderA - orderB;
      if (Number.isFinite(orderA) !== Number.isFinite(orderB)) return Number.isFinite(orderA) ? -1 : 1;
      return String(a.navLabel || a.module).localeCompare(String(b.navLabel || b.module));
    });

  subnavInnerEl.innerHTML = '';
  items.forEach((row) => {
    const link = document.createElement('a');
    const key = String(row.module).toLowerCase();
    link.className = 'site-subnav-link' + (key === currentKey ? ' is-active' : '');
    link.href = `#${row.module}`;
    link.textContent = row.navLabel || row.title || row.module;
    if (row.description) link.title = row.description;
    link.addEventListener('click', () => {
      navWrapperEl?.classList.remove('site-nav-open');
      navToggleEl?.setAttribute('aria-expanded', 'false');
    });
    subnavInnerEl.appendChild(link);
  });
}

function startResendCooldown(buttonEl) {
  let secondsLeft = Math.ceil(RESEND_COOLDOWN_MS / 1000);
  buttonEl.disabled = true;
  const label = buttonEl.textContent.replace(/ \(\d+s\)$/, '');
  buttonEl.textContent = `${label} (${secondsLeft}s)`;
  const timer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(timer);
      buttonEl.disabled = false;
      buttonEl.textContent = label;
    } else {
      buttonEl.textContent = `${label} (${secondsLeft}s)`;
    }
  }, 1000);
}

function setFormBusy(formEl, busy) {
  formEl.querySelectorAll('button').forEach((btn) => { btn.disabled = busy; });
}

/** Relabels a form's submit button while a request is in flight (e.g.
 * "Continue" -> "Sending code...") so it's obvious something is happening
 * and there's nothing left to click - pass `false` to restore its original
 * label. Submit buttons are already disabled by setFormBusy; this is just
 * the visible feedback on top of that. */
function setSubmitBusy(formEl, busyLabel) {
  const btn = formEl.querySelector('button[type="submit"]');
  if (!btn) return;
  if (busyLabel) {
    if (btn.dataset.defaultLabel === undefined) btn.dataset.defaultLabel = btn.textContent;
    btn.textContent = busyLabel;
  } else if (btn.dataset.defaultLabel !== undefined) {
    btn.textContent = btn.dataset.defaultLabel;
  }
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
}

async function authRequest(action, fields) {
  const response = await fetch(`${API_BASE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields })
  });
  const data = await response.json().catch(() => ({ ok: false, error: 'Invalid response' }));
  if (!data.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }
  return data;
}

async function restoreSession() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) {
    updateLoginUI();
    return;
  }
  try {
    const data = await authRequest('whoAmI', { token });
    applySession(token, data);
  } catch (err) {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    updateLoginUI();
  }
}

function applySession(token, profile) {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
  session = {
    email: profile.email,
    role: profile.role,
    name: profile.name || '',
    phone: profile.phone || '',
    address: profile.address || ''
  };
  window.RainGuard.currentUser = session;
  updateLoginUI();
  startHeartbeat(token);
}

async function logout() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  clearInterval(heartbeatTimer);
  localStorage.removeItem(SESSION_TOKEN_KEY);
  session = null;
  window.RainGuard.currentUser = null;
  updateLoginUI();
  showToast('Logged out.');
  if (token) authRequest('logout', { token }).catch(() => {});
  await reloadModules();
  if (currentModuleKey() === 'profile' || currentModuleKey() === 'account') {
    window.location.hash = '#home';
  } else {
    renderCurrentRoute();
  }
}

function startHeartbeat(token) {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    authRequest('touchSession', { token }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

function updateLoginUI() {
  if (!loginBtnEl) return;
  const dropdownEl = document.getElementById('account-menu-dropdown');
  if (session) {
    loginBtnEl.textContent = session.email.charAt(0).toUpperCase();
    loginBtnEl.title = `Logged in as ${session.email} (${session.role || 'unverified'}) - click for account options`;
  } else {
    loginBtnEl.textContent = '👤';
    loginBtnEl.title = 'Login';
    if (dropdownEl) dropdownEl.hidden = true;
  }
}

function currentModuleKey() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return (hash || DEFAULT_MODULE).toLowerCase();
}

function renderCurrentRoute() {
  const key = currentModuleKey();

  if (key === 'profile' || key === 'account') {
    renderAccountRoute(key);
    return;
  }

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

/** Client-rendered Profile/Account pages - both require a logged-in session
 * since they read/write the current user's own Users-tab row. Their HTML
 * comes from the Modules sheet (module = "profile"/"account", same as any
 * other module) when a row for it exists, falling back to a built-in
 * default otherwise; either way, `hydrateProfileForm` fills the actual
 * field values from `session` client-side, since sheet-authored HTML has
 * no way to know the logged-in user's data at authoring time. */
function renderAccountRoute(key) {
  if (!session) {
    window.location.hash = '#home';
    showToast('Please log in to view that page.', 'error');
    return;
  }

  const row = modulesByKey.get(key);
  document.title = row && row.title ? `Gutter Guys of Katy - ${row.title}` : `Gutter Guys of Katy - ${key === 'profile' ? 'Profile' : 'Account'}`;

  if (key === 'profile') {
    appEl.innerHTML = row ? row.html : defaultProfileHtml();
    if (row) executeEmbeddedScripts(appEl);
    hydrateProfileForm();
    wireProfileForm();
  } else {
    appEl.innerHTML = row ? row.html : defaultAccountHtml();
    if (row) executeEmbeddedScripts(appEl);
  }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function defaultProfileHtml() {
  return `
    <div class="account-page">
      <h1>Profile</h1>
      <form id="profile-form">
        <label class="login-field">
          <span>Name</span>
          <input type="text" id="profile-name-input" required autocomplete="name">
        </label>
        <label class="login-field">
          <span>Email</span>
          <input type="email" id="profile-email-input" required autocomplete="email">
        </label>
        <label class="login-field">
          <span>Phone</span>
          <input type="tel" id="profile-phone-input" autocomplete="tel">
        </label>
        <label class="login-field">
          <span>Address</span>
          <input type="text" id="profile-address-input" autocomplete="street-address">
        </label>
        <button type="submit" class="site-btn site-btn-primary login-submit">Save changes</button>
        <p class="login-error" id="profile-error" hidden></p>
      </form>
    </div>
  `;
}

function defaultAccountHtml() {
  return `
    <div class="account-page">
      <h1>Account</h1>
      <p class="login-hint">Account settings are coming soon.</p>
    </div>
  `;
}

/** Fills the profile form's current values from `session` - works whether
 * the surrounding markup came from the Modules sheet or defaultProfileHtml,
 * since both use the same field IDs. Safe to call even if some/all of
 * those fields aren't present in the markup. */
function hydrateProfileForm() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  };
  setValue('profile-name-input', session.name);
  setValue('profile-email-input', session.email);
  setValue('profile-phone-input', session.phone);
  setValue('profile-address-input', session.address);
}

function wireProfileForm() {
  const formEl = document.getElementById('profile-form');
  const errorEl = document.getElementById('profile-error');
  if (!formEl) return;

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError(errorEl);
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    const fields = {
      token,
      name: document.getElementById('profile-name-input').value.trim(),
      email: document.getElementById('profile-email-input').value.trim(),
      phone: document.getElementById('profile-phone-input').value.trim(),
      address: document.getElementById('profile-address-input').value.trim()
    };
    setFormBusy(formEl, true);
    try {
      const data = await authRequest('updateProfile', fields);
      session = { ...session, ...data };
      window.RainGuard.currentUser = session;
      updateLoginUI();
      showToast('Profile updated.');
    } catch (err) {
      showError(errorEl, err.message);
    } finally {
      setFormBusy(formEl, false);
    }
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
