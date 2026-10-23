/**
 * Gutter Guys of Katy - Google Apps Script backend
 * ---------------------------------------------------------------------------
 * Serves page content stored in a Google Sheet ("Modules" tab: module, html,
 * title, navLabel, order, showInNav, role, description - any extra columns
 * are passed through as-is), serves the "landing page" tab (section,
 * content, assets) used to
 * build the home page from composable sections, accepts form submissions
 * from the site (storing them in a "Submissions" tab and optionally
 * uploading attached files to Google Drive), and runs a passwordless,
 * email-code login system against a "Users" tab (see the "Passwordless
 * login" section below and /docs/SETUP.md).
 *
 * This script is only ever called server-to-server by the Cloudflare Worker
 * proxy, so it does not need to worry about CORS.
 *
 * Deployment: Extensions > Apps Script (bound to the Sheet) or a standalone
 * project with SPREADSHEET_ID set as a Script Property. Deploy > New
 * deployment > Web app, "Execute as: Me", "Who has access: Anyone".
 * See /docs/SETUP.md for full instructions.
 */

var MODULES_SHEET_NAME = 'Modules';
var SUBMISSIONS_SHEET_NAME = 'Submissions';
var LANDING_SHEET_NAME = 'landing page';
var USERS_SHEET_NAME = 'Users';
var SESSIONS_SHEET_NAME = 'Sessions';
var SURVEY_SHEET_NAME = 'GutterSurvey'; // shared by gutter-survey/-sketch/-canvas, and the account Quotes/Quote Viewer modules
var LOGIN_CODE_COOLDOWN_MS = 30 * 1000; // min time between code requests for the same email
var LOGIN_MAX_FAILED_ATTEMPTS = 5; // wrong-code attempts allowed before a fresh code is required

/**
 * GET /exec                    -> { modules: [...] }  (all modules)
 * GET /exec?module=foo         -> { modules: [...] }  (filtered to module "foo")
 * GET /exec?view=landing       -> { sections: [...] } (the "landing page" tab,
 *                                  in row order, with assets resolved to a
 *                                  usable embed URL + detected type)
 *
 * GET is cached at the Cloudflare edge by full URL (see worker.js), so it
 * never takes/trusts a session token (tokens don't belong in a cacheable,
 * loggable URL) - it only ever returns modules whose `role` column is
 * blank (public). Logged-in users get their full, role-filtered module
 * list from the POST "listModules" action below instead, which is never
 * edge-cached.
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    if (params.view === 'landing') {
      return jsonOutput_({ ok: true, sections: getLandingSections_() });
    }

    var sheet = getSheet_(MODULES_SHEET_NAME);
    var modules = sheetToObjects_(sheet).filter(function (row) {
      return row.module && canViewModule_(row.role, null); // skip blank rows + non-public modules
    });

    if (params.module) {
      modules = modules.filter(function (row) {
        return String(row.module).toLowerCase() === String(params.module).toLowerCase();
      });
    }

    return jsonOutput_({ ok: true, modules: modules });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * POST /exec
 * Body (JSON): { module: "contact", formId: "contact-form", fields: { ... },
 *                sheetName: "RFQ" (optional) }
 * By default submissions are appended to the shared "Submissions" tab. Pass
 * `sheetName` to route a form's data to its own dedicated tab instead (it is
 * auto-created with dynamic headers the same way "Submissions" is).
 * Any field whose value looks like { fileName, mimeType, data (base64) } is
 * uploaded to Drive and replaced with the resulting file URL before saving.
 * Pass `folderName` to nest those uploads inside a named subfolder of
 * `DRIVE_FOLDER_ID` (created on first use, reused after that) instead of
 * dropping them in the root folder - e.g. one subfolder per customer visit.
 *
 * POST /exec with { action: "uploadAsset", module, folderName, file }
 * Uploads a single file to Drive (optionally nested under `folderName`) and
 * returns { ok: true, url } WITHOUT appending a sheet row. Used by modules
 * that capture several photos/videos/audio clips per visit (e.g. the
 * Gutter Survey module) so each asset can be uploaded as its own small
 * request/retry instead of bundling everything into one large payload.
 *
 * POST /exec with { action: "listModules", token? } -> { ok: true, modules }
 * Role-filtered module list for the signed-in nav menu - see doGet's docs
 * for why this is a separate, uncached POST action instead of a query
 * param on GET.
 *
 * POST /exec with { action: "requestCode" | "verifyCode" | "whoAmI" |
 * "touchSession" | "logout", ... } - passwordless login. See the
 * "Passwordless login" section below each handler, and /docs/SETUP.md.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing request body');
    }
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'uploadAsset') {
      return handleUploadAsset_(body);
    }
    if (body.action === 'listModules') {
      return handleListModules_(body);
    }
    if (body.action === 'checkEmail') {
      return handleCheckEmail_(body);
    }
    if (body.action === 'requestCode') {
      return handleRequestCode_(body);
    }
    if (body.action === 'verifyCode') {
      return handleVerifyCode_(body);
    }
    if (body.action === 'whoAmI') {
      return handleWhoAmI_(body);
    }
    if (body.action === 'touchSession') {
      return handleTouchSession_(body);
    }
    if (body.action === 'logout') {
      return handleLogout_(body);
    }
    if (body.action === 'updateProfile') {
      return handleUpdateProfile_(body);
    }
    if (body.action === 'listMyQuotes') {
      return handleListMyQuotes_(body);
    }
    if (body.action === 'getQuote') {
      return handleGetQuote_(body);
    }

    var module = body.module || 'unknown';
    var formId = body.formId || 'default';
    var fields = body.fields || {};
    var sheetName = body.sheetName || SUBMISSIONS_SHEET_NAME;
    var submitterIdentity = resolveViewerIdentity_(body.token); // optional - set automatically by app.js's submitForm when logged in

    var processedFields = {};
    Object.keys(fields).forEach(function (key) {
      var value = fields[key];
      if (value && typeof value === 'object' && value.data && value.fileName) {
        processedFields[key] = saveFileToDrive_(value, module, body.folderName) || '(upload failed)';
      } else {
        processedFields[key] = value;
      }
    });

    // submittedByEmail is never trusted from client-sent fields - only ever
    // the signed-in session's own email, same rule as everywhere else.
    if (submitterIdentity) {
      processedFields.submittedByEmail = submitterIdentity.email;
    }
    if (sheetName === SURVEY_SHEET_NAME) {
      if (!processedFields.quoteId) processedFields.quoteId = generateQuoteId_();
      if (!processedFields.status) processedFields.status = 'New';
    }

    var sheet = getSheet_(sheetName, true);
    var row = Object.assign(
      {
        timestamp: new Date(),
        module: module,
        formId: formId
      },
      processedFields
    );
    appendObjectAsRow_(sheet, row);

    return jsonOutput_({ ok: true });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Uploads one file to Drive (see doPost's `action: "uploadAsset"` docs) and
 * returns its URL without touching the Sheet. Errors propagate to doPost's
 * try/catch so the caller gets a normal { ok: false, error } response.
 */
function handleUploadAsset_(body) {
  var file = body.file;
  if (!file || !file.data || !file.fileName) {
    throw new Error('Missing file data for upload');
  }
  var url = saveFileToDrive_(file, body.module, body.folderName);
  if (!url) {
    throw new Error('DRIVE_FOLDER_ID is not configured; cannot upload files.');
  }
  return jsonOutput_({ ok: true, url: url });
}

/** POST { action: "listModules", token? } -> { ok: true, modules: [...] }.
 * Role-filtered equivalent of GET /exec for logged-in users: the token is
 * never put in a cacheable/loggable URL (see doGet's docs), and the result
 * is never edge-cached, so it can safely be personalized per viewer. */
function handleListModules_(body) {
  var viewerRole = resolveViewerRole_(body.token);
  var sheet = getSheet_(MODULES_SHEET_NAME);
  var modules = sheetToObjects_(sheet).filter(function (row) {
    return row.module && canViewModule_(row.role, viewerRole);
  });
  return jsonOutput_({ ok: true, modules: modules });
}

/** Resolves a token to the Users-tab `role` of the account it belongs to.
 * Returns null for a missing/invalid/expired token (treated as a guest -
 * public modules only), or '' for a valid but unverified (blank-role)
 * account, which is treated the same as "customer" by canViewModule_. */
function resolveViewerRole_(token) {
  var identity = resolveViewerIdentity_(token);
  return identity ? identity.role : null;
}

/** Resolves a token to { email, role }, or null for a missing/invalid/
 * expired token - the same lookup resolveViewerRole_ does, but also
 * returning the email so handlers can scope data to "my own rows". */
function resolveViewerIdentity_(token) {
  var session = findSessionByToken_(token);
  if (!session) return null;
  var usersSheet = getUsersSheet_();
  var rowIndex = findRowIndexByColumn_(usersSheet, 'email', session.email);
  if (rowIndex === -1) return null;
  var user = rowToObjectAt_(usersSheet, rowIndex);
  return { email: session.email, role: user.role || '' };
}

/** Role hierarchy for the Modules tab's `role` column: blank = public
 * (everyone, including guests); otherwise admin sees everything, a
 * technician sees everything except admin-only modules, and a
 * customer/blank-role account sees everything except technician- and
 * admin-only modules. Keep in sync with assets/js/app.js's copy. */
var MODULE_ROLE_RANK_ = { customer: 1, technician: 2, admin: 3 };

function canViewModule_(moduleRole, viewerRole) {
  var required = String(moduleRole || '').trim().toLowerCase();
  if (!required) return true; // public module
  if (viewerRole === null || viewerRole === undefined) return false; // guest
  var viewerRank = MODULE_ROLE_RANK_[String(viewerRole).toLowerCase()] || 1; // blank/unrecognized role = customer-level
  return viewerRank >= (MODULE_ROLE_RANK_[required] || 0);
}


/**
 * Passwordless login
 * ---------------------------------------------------------------------------
 * A "Users" tab (email, role, code - plus codeIssuedAt/lastLogin/
 * failedAttempts, added automatically on first use) is the source of truth
 * for who can log in and with what role ("" (blank) | "customer" |
 * "technician" | "admin"). Any email can request a code; unknown emails
 * are auto-created with a blank role (unverified - they can log in once
 * they verify their email via the code, but are not yet a recognized
 * "customer") - someone must manually set their role to "customer" (or
 * "technician"/"admin") in the sheet to grant any access beyond the
 * default blank-role experience; this code never assigns or upgrades a
 * role itself.
 *
 * A requested code has no time-based expiry - it stays valid until it is
 * used, or until a newer code is requested for the same email (which
 * immediately invalidates the old one). Since that trades a time limit for
 * an open-ended window, brute force is bounded a different way instead:
 * codes are single-use, requests are cooled down per email
 * (LOGIN_CODE_COOLDOWN_MS), and repeated wrong guesses lock out further
 * attempts until a fresh code is requested (LOGIN_MAX_FAILED_ATTEMPTS).
 *
 * On success, a "Sessions" tab row (token, email, createdAt, lastSeenAt) is
 * created and its token is handed back to the browser to store (e.g. in
 * localStorage) and send on later requests. Multiple sessions per email are
 * allowed on purpose (one per device). The session token is an opaque
 * random value only - it never carries a role - so whoAmI_ always re-reads
 * the role fresh from the Users tab, meaning a role can only ever be
 * changed by editing the sheet, never by anything the browser sends.
 */

/** POST { action: "checkEmail", email } -> { ok: true, exists } so the
 * front end knows whether to show the login code step directly or collect
 * name/phone/address first for a brand-new account. */
function handleCheckEmail_(body) {
  var email = normalizeEmail_(body.email);
  if (!isValidEmail_(email)) {
    throw new Error('Please enter a valid email address.');
  }
  var sheet = getUsersSheet_();
  var rowIndex = findRowIndexByColumn_(sheet, 'email', email);
  return jsonOutput_({ ok: true, exists: rowIndex !== -1 });
}

/** POST { action: "requestCode", email, name?, phone?, address? } ->
 * { ok: true }. name/phone/address are only required (and only used) when
 * `email` isn't already in the Users tab - see handleCheckEmail_, which the
 * front end calls first to decide whether to collect them. */
function handleRequestCode_(body) {
  var email = normalizeEmail_(body.email);
  if (!isValidEmail_(email)) {
    throw new Error('Please enter a valid email address.');
  }

  var sheet = getUsersSheet_();
  var rowIndex = findRowIndexByColumn_(sheet, 'email', email);
  var now = new Date();

  if (rowIndex !== -1) {
    var existing = rowToObjectAt_(sheet, rowIndex);
    var lastIssued = existing.codeIssuedAt ? new Date(existing.codeIssuedAt).getTime() : 0;
    if (lastIssued && (now.getTime() - lastIssued) < LOGIN_CODE_COOLDOWN_MS) {
      throw new Error('Please wait a bit before requesting another code.');
    }
  }

  var code = generateLoginCode_();
  var fields = { email: email, code: code, codeIssuedAt: now, failedAttempts: 0 };
  if (rowIndex === -1) {
    var name = String(body.name || '').trim();
    if (!name) {
      throw new Error('Name is required.');
    }
    // role is left blank on purpose - a brand-new signup is unverified until
    // someone manually marks them "customer" (or higher) in the sheet.
    fields.name = name;
    fields.phone = String(body.phone || '').trim();
    fields.address = String(body.address || '').trim();
    fields.lastLogin = '';
    appendObjectAsRow_(sheet, fields);
  } else {
    updateRowFields_(sheet, rowIndex, fields);
  }

  sendLoginCodeEmail_(email, code);
  return jsonOutput_({ ok: true });
}

/** POST { action: "verifyCode", email, code } ->
 * { ok: true, token, email, role } on success. */
function handleVerifyCode_(body) {
  var email = normalizeEmail_(body.email);
  var code = String(body.code || '').trim();
  if (!email || !code) {
    throw new Error('Email and code are required.');
  }

  var sheet = getUsersSheet_();
  var rowIndex = findRowIndexByColumn_(sheet, 'email', email);
  if (rowIndex === -1) {
    throw new Error('Invalid or expired code.');
  }
  var user = rowToObjectAt_(sheet, rowIndex);

  var failedAttempts = Number(user.failedAttempts || 0);
  if (failedAttempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
    throw new Error('Too many attempts. Please request a new code.');
  }
  if (!user.code || String(user.code).trim() !== code) {
    updateRowFields_(sheet, rowIndex, { failedAttempts: failedAttempts + 1 });
    throw new Error('Invalid or expired code.');
  }

  var now = new Date();
  updateRowFields_(sheet, rowIndex, { code: '', failedAttempts: 0, lastLogin: now });

  var token = generateSessionToken_();
  appendObjectAsRow_(getSessionsSheet_(), { token: token, email: email, createdAt: now, lastSeenAt: now });

  return jsonOutput_({
    ok: true,
    token: token,
    email: email,
    role: user.role || '',
    name: user.name || '',
    phone: user.phone || '',
    address: user.address || ''
  });
}

/** POST { action: "whoAmI", token } -> { ok: true, email, role }. The only
 * thing the front end should ever trust for a user's role - always re-read
 * from the Users tab, never cached/trusted from the client. */
function handleWhoAmI_(body) {
  var session = findSessionByToken_(body.token);
  if (!session) {
    throw new Error('Not logged in.');
  }
  var usersSheet = getUsersSheet_();
  var userRowIndex = findRowIndexByColumn_(usersSheet, 'email', session.email);
  if (userRowIndex === -1) {
    throw new Error('Not logged in.');
  }
  var user = rowToObjectAt_(usersSheet, userRowIndex);
  return jsonOutput_({
    ok: true,
    email: session.email,
    role: user.role || '',
    name: user.name || '',
    phone: user.phone || '',
    address: user.address || ''
  });
}

/** POST { action: "updateProfile", token, name, email, phone, address } ->
 * { ok: true, email, name, phone, address }. Email is the Users tab's
 * primary key, so changing it moves the existing row to the new key and
 * repoints any of this user's Sessions rows (so sessions survive an email
 * change instead of being silently orphaned). */
function handleUpdateProfile_(body) {
  var session = findSessionByToken_(body.token);
  if (!session) {
    throw new Error('Not logged in.');
  }

  var usersSheet = getUsersSheet_();
  var rowIndex = findRowIndexByColumn_(usersSheet, 'email', session.email);
  if (rowIndex === -1) {
    throw new Error('Not logged in.');
  }

  var newEmail = normalizeEmail_(body.email);
  if (!isValidEmail_(newEmail)) {
    throw new Error('Please enter a valid email address.');
  }
  var name = String(body.name || '').trim();
  if (!name) {
    throw new Error('Name is required.');
  }
  var phone = String(body.phone || '').trim();
  var address = String(body.address || '').trim();

  if (newEmail !== session.email && findRowIndexByColumn_(usersSheet, 'email', newEmail) !== -1) {
    throw new Error('That email is already in use by another account.');
  }

  updateRowFields_(usersSheet, rowIndex, { email: newEmail, name: name, phone: phone, address: address });

  if (newEmail !== session.email) {
    retargetSessionsEmail_(session.email, newEmail);
  }

  return jsonOutput_({ ok: true, email: newEmail, name: name, phone: phone, address: address });
}

/** Updates every Sessions row for `oldEmail` to `newEmail` (see
 * handleUpdateProfile_), so other logged-in devices keep working under the
 * new email instead of being logged out by the change. */
function retargetSessionsEmail_(oldEmail, newEmail) {
  var sheet = getSessionsSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var emailCol = headers.indexOf('email');
  if (emailCol === -1) return;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailCol] || '').trim().toLowerCase() === oldEmail) {
      sheet.getRange(i + 1, emailCol + 1).setValue(newEmail);
    }
  }
}

/**
 * Account "Quotes" module support
 * ---------------------------------------------------------------------------
 * Every submission routed to the shared `GutterSurvey` tab (from any of the
 * three capture tools - Photo Survey, Sketch, Canvas) is auto-stamped by
 * doPost with `submittedByEmail` (the signed-in submitter, never trusted
 * from client fields) and, if missing, a `quoteId` (generateQuoteId_) and a
 * default `status` of "New". That's what lets a customer's Quotes list
 * (handleListMyQuotes_) find "their" rows, and the Quote Viewer module
 * (handleGetQuote_) load one specific row by its quoteId - an admin sees/
 * opens every row regardless of who submitted it. `status` is otherwise
 * just a plain cell meant to be updated by hand in the Sheet (e.g. "New" ->
 * "Quoted" -> "Scheduled" -> "Completed") as a visit is worked.
 */

/** Short, readable, unique id stamped onto a GutterSurvey row that didn't
 * already carry one - used to look up that exact row later (handleGetQuote_)
 * without depending on `rfqNumber`, which not every capture tool collects. */
function generateQuoteId_() {
  return 'Q-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** POST { action: "listMyQuotes", token } -> { ok: true, quotes: [...] }.
 * Trimmed-down GutterSurvey rows (request date, quote #, name, status,
 * quoteId to link to the Quote Viewer) for the signed-in user, or every
 * row for an admin - see the "Account Quotes module support" notes above. */
function handleListMyQuotes_(body) {
  var identity = resolveViewerIdentity_(body.token);
  if (!identity) {
    throw new Error('Not logged in.');
  }

  var sheet;
  try {
    sheet = getSheet_(SURVEY_SHEET_NAME);
  } catch (err) {
    return jsonOutput_({ ok: true, quotes: [] }); // no surveys submitted yet
  }

  var quotes = sheetToObjects_(sheet)
    .filter(function (row) {
      return identity.role === 'admin' ||
        String(row.submittedByEmail || '').trim().toLowerCase() === identity.email;
    })
    .map(function (row) {
      return {
        quoteId: row.quoteId || '',
        rfqNumber: row.rfqNumber || row.quoteId || '',
        name: row.contactName || '',
        status: row.status || 'New',
        requestDate: row.timestamp || ''
      };
    });

  quotes.sort(function (a, b) { return new Date(b.requestDate) - new Date(a.requestDate); });
  return jsonOutput_({ ok: true, quotes: quotes });
}

/** POST { action: "getQuote", token, quoteId } -> { ok: true, quote: {...} }.
 * The full GutterSurvey row (every column, whichever capture tool produced
 * it) for the Quote Viewer module - "Quote not found" (rather than a
 * forbidden-style error) for anything the signed-in user doesn't own, so a
 * guessed quoteId can't be used to confirm another customer's quote exists. */
function handleGetQuote_(body) {
  var identity = resolveViewerIdentity_(body.token);
  if (!identity) {
    throw new Error('Not logged in.');
  }
  var quoteId = String(body.quoteId || '').trim();
  if (!quoteId) {
    throw new Error('Missing quote id.');
  }

  var sheet = getSheet_(SURVEY_SHEET_NAME);
  var rowIndex = findRowIndexByColumn_(sheet, 'quoteId', quoteId);
  if (rowIndex === -1) {
    throw new Error('Quote not found.');
  }
  var row = rowToObjectAt_(sheet, rowIndex);
  if (identity.role !== 'admin' && String(row.submittedByEmail || '').trim().toLowerCase() !== identity.email) {
    throw new Error('Quote not found.');
  }

  return jsonOutput_({ ok: true, quote: row });
}

/** POST { action: "touchSession", token } -> { ok: true }. Called
 * periodically while the app is open so lastSeenAt/lastLogin reflect
 * actual use, not just the moment of logging in. */
function handleTouchSession_(body) {
  var sessionsSheet = getSessionsSheet_();
  var sessionRowIndex = findRowIndexByColumn_(sessionsSheet, 'token', body.token);
  if (sessionRowIndex === -1) {
    throw new Error('Not logged in.');
  }
  var session = rowToObjectAt_(sessionsSheet, sessionRowIndex);
  var now = new Date();
  updateRowFields_(sessionsSheet, sessionRowIndex, { lastSeenAt: now });

  var usersSheet = getUsersSheet_();
  var userRowIndex = findRowIndexByColumn_(usersSheet, 'email', session.email);
  if (userRowIndex !== -1) {
    updateRowFields_(usersSheet, userRowIndex, { lastLogin: now });
  }
  return jsonOutput_({ ok: true });
}

/** POST { action: "logout", token } -> { ok: true }. Removes only this one
 * device's session row; other devices stay logged in. */
function handleLogout_(body) {
  var sheet = getSessionsSheet_();
  var rowIndex = findRowIndexByColumn_(sheet, 'token', body.token);
  if (rowIndex !== -1) {
    sheet.deleteRow(rowIndex);
  }
  return jsonOutput_({ ok: true });
}

function findSessionByToken_(token) {
  token = String(token || '').trim();
  if (!token) return null;
  var sheet = getSessionsSheet_();
  var rowIndex = findRowIndexByColumn_(sheet, 'token', token);
  if (rowIndex === -1) return null;
  return rowToObjectAt_(sheet, rowIndex);
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Six-digit numeric code - friendly to type/read aloud. Not a cryptographic
 * secret on its own; see the "Passwordless login" notes above for how
 * brute force is bounded without a time-based expiry. */
function generateLoginCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Opaque session token - two concatenated UUIDv4s for comfortable margin
 * over brute-forcing a single token. */
function generateSessionToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function sendLoginCodeEmail_(email, code) {
  var subject = 'Your Gutter Guys of Katy login code';
  var body = 'Your login code is: ' + code + '\n\n' +
    'Enter it on the site to sign in. This code stays valid until you use ' +
    'it or request a new one - request a new one any time if you lose it.\n\n' +
    'If you did not request this, you can safely ignore this email.';
  MailApp.sendEmail(email, subject, body);
}

/** Run manually from the editor dropdown to trigger the mail-scope auth prompt. */
function testAuthorizeMailScope() {
  MailApp.sendEmail('YOUR-EMAIL@example.com', 'Auth test', 'If you got this, mail scope is authorized.');
}

/** Gets (creating if needed) the "Users" tab backing passwordless login. */
function getUsersSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.appendRow(['email', 'role', 'name', 'phone', 'address', 'code', 'codeIssuedAt', 'lastLogin', 'failedAttempts']);
  }
  return sheet;
}

/** Gets (creating if needed) the "Sessions" tab - one row per logged-in
 * device/token. */
function getSessionsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SESSIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SESSIONS_SHEET_NAME);
    sheet.appendRow(['token', 'email', 'createdAt', 'lastSeenAt']);
  }
  return sheet;
}

/** Finds a row (1-based) whose column (by header name) matches `value`
 * (trimmed, case-insensitive), or -1 if not found/column missing. */
function findRowIndexByColumn_(sheet, columnName, value) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return -1;
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var colIdx = headers.indexOf(columnName);
  if (colIdx === -1) return -1;
  var needle = String(value || '').trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIdx] || '').trim().toLowerCase() === needle) return i + 1;
  }
  return -1;
}

/** Reads a single row (1-based rowIndex) into a plain object keyed by the
 * current header row. */
function rowToObjectAt_(sheet, rowIndex) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) { return String(h).trim(); });
  var values = sheet.getRange(rowIndex, 1, 1, lastColumn).getValues()[0];
  var obj = {};
  headers.forEach(function (h, i) { if (h) obj[h] = values[i]; });
  return obj;
}

/** Grows the header row (1st row) with any of `keys` it doesn't already
 * have, returning the full up-to-date header list. Shared by
 * appendObjectAsRow_ and updateRowFields_ so both can add brand-new
 * columns on the fly without a manual schema change. */
function ensureHeaders_(sheet, keys) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) { return String(h).trim(); });
  var newKeys = keys.filter(function (key) { return headers.indexOf(key) === -1; });
  if (newKeys.length) {
    headers = headers.concat(newKeys);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

/** Updates specific columns (by header name) of an existing row (1-based
 * rowIndex) in place, leaving columns not mentioned in `fields` untouched. */
function updateRowFields_(sheet, rowIndex, fields) {
  var headers = ensureHeaders_(sheet, Object.keys(fields));
  var existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (header, i) {
    if (Object.prototype.hasOwnProperty.call(fields, header)) existingRow[i] = fields[header];
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([existingRow]);
}

/**
 * Reads the "landing page" tab (section, content, assets columns) in row
 * order. `assets` is a JSON array of plain URLs (Drive links, YouTube links,
 * or direct media URLs) which gets resolved into
 * { url, type: 'image'|'video'|'youtube'|'audio'|'pdf'|'other', resolvedUrl }
 * so the front end never has to guess how to embed each one.
 */
function getLandingSections_() {
  var sheet = getSheet_(LANDING_SHEET_NAME);
  return sheetToObjects_(sheet)
    .filter(function (row) { return row.content; }) // skip blank rows
    .map(function (row) {
      var rawAssets = [];
      if (row.assets) {
        try {
          var parsed = JSON.parse(row.assets);
          if (Array.isArray(parsed)) rawAssets = parsed;
        } catch (err) {
          rawAssets = [];
        }
      }
      return {
        section: row.section || '',
        content: row.content,
        assets: rawAssets.map(resolveAsset_)
      };
    });
}

/**
 * Detects an asset URL's type and computes a URL that's actually usable in
 * an <img>/<video>/<iframe>/<audio> tag. Drive links are resolved via
 * DriveApp (when accessible) so the real mime type decides the embed, not
 * just the URL shape; any failure falls back to a safe default rather than
 * breaking the whole section.
 */
function resolveAsset_(url) {
  url = String(url || '');

  var driveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    var fileId = driveMatch[1];
    var type = 'pdf'; // safe default for Drive docs/sheets/slides/unknown types: iframe preview
    var resolvedUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';
    try {
      var mime = DriveApp.getFileById(fileId).getMimeType();
      if (mime.indexOf('image/') === 0) {
        type = 'image';
        resolvedUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;
      } else if (mime.indexOf('audio/') === 0) {
        type = 'audio';
        resolvedUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;
      } else if (mime.indexOf('video/') === 0 || mime === 'application/pdf') {
        type = mime === 'application/pdf' ? 'pdf' : 'video';
      }
    } catch (err) {
      // Not accessible to the script's executing account, or an invalid ID -
      // keep the iframe-preview fallback above.
    }
    return { url: url, type: type, resolvedUrl: resolvedUrl };
  }

  var ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (ytMatch) {
    return { url: url, type: 'youtube', resolvedUrl: 'https://www.youtube.com/embed/' + ytMatch[1] };
  }

  // Common extension-less image CDNs (stock photos, placeholders).
  if (/images\.unsplash\.com|picsum\.photos|placehold\.co|placeholder\.com/i.test(url)) {
    return { url: url, type: 'image', resolvedUrl: url };
  }

  var ext = url.split('?')[0].split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].indexOf(ext) !== -1) {
    return { url: url, type: 'image', resolvedUrl: url };
  }
  if (['mp4', 'webm', 'mov', 'm4v'].indexOf(ext) !== -1) {
    return { url: url, type: 'video', resolvedUrl: url };
  }
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac'].indexOf(ext) !== -1) {
    return { url: url, type: 'audio', resolvedUrl: url };
  }
  if (ext === 'pdf') {
    return { url: url, type: 'pdf', resolvedUrl: url };
  }
  return { url: url, type: 'other', resolvedUrl: url };
}

/** Returns the active/bound spreadsheet, or the one named by the
 * SPREADSHEET_ID script property when running as a standalone project. */
function getSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('Set a SPREADSHEET_ID script property when using a standalone Apps Script project.');
  }
  return SpreadsheetApp.openById(id);
}

/** Gets a sheet by name, optionally creating it (with no header row) if missing. */
function getSheet_(name, createIfMissing) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    if (!createIfMissing) {
      throw new Error('Sheet tab "' + name + '" was not found.');
    }
    sheet = ss.insertSheet(name);
    sheet.appendRow(['timestamp', 'module', 'formId']);
  }
  return sheet;
}

/** Reads a sheet into an array of plain objects keyed by its header row. */
function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (header, i) {
      if (!header) return;
      obj[header] = row[i];
    });
    return obj;
  });
}

/**
 * Appends an object as a new row, growing the header row with any new keys
 * so new form fields never need a manual schema change.
 */
function appendObjectAsRow_(sheet, obj) {
  var headers = ensureHeaders_(sheet, Object.keys(obj));
  var row = headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : '';
  });
  sheet.appendRow(row);
}

/**
 * Saves a base64-encoded file to a Drive folder (DRIVE_FOLDER_ID script
 * property). Returns the shareable file URL, or null if no folder is
 * configured.
 * `folderName`, if given, nests the file inside a subfolder of that name
 * (created on first use, reused on subsequent calls) instead of the root -
 * e.g. one subfolder per customer visit for the Gutter Survey module.
 */
function saveFileToDrive_(fileObj, context, folderName) {
  var rootFolderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!rootFolderId) return null;

  var rootFolder = DriveApp.getFolderById(rootFolderId);
  var folder = folderName ? getOrCreateSubfolder_(rootFolder, folderName) : rootFolder;
  var blob = Utilities.newBlob(
    Utilities.base64Decode(fileObj.data),
    fileObj.mimeType || 'application/octet-stream',
    (context ? context + '-' : '') + fileObj.fileName
  );
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/** Finds (or creates) a subfolder by exact name inside `parentFolder`, so
 * repeated uploads for the same visit/customer land in one shared folder
 * instead of creating a new one each time. */
function getOrCreateSubfolder_(parentFolder, name) {
  name = String(name || '').trim().slice(0, 120) || 'Untitled';
  var existing = parentFolder.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parentFolder.createFolder(name);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
