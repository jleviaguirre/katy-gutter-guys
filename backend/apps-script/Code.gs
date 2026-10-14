/**
 * RainGuard - Google Apps Script backend
 * ---------------------------------------------------------------------------
 * Serves page content stored in a Google Sheet ("Modules" tab: module, html,
 * title, navLabel, order, showInNav - any extra columns are passed through
 * as-is) and accepts form submissions from the site, storing them in a
 * "Submissions" tab and optionally uploading attached files to Google Drive.
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

/**
 * GET /exec            -> { modules: [...] }               (all modules)
 * GET /exec?module=foo  -> { modules: [...] } (filtered to module "foo")
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var sheet = getSheet_(MODULES_SHEET_NAME);
    var modules = sheetToObjects_(sheet).filter(function (row) {
      return row.module; // skip blank rows
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
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing request body');
    }
    var body = JSON.parse(e.postData.contents);
    var module = body.module || 'unknown';
    var formId = body.formId || 'default';
    var fields = body.fields || {};
    var sheetName = body.sheetName || SUBMISSIONS_SHEET_NAME;

    var processedFields = {};
    Object.keys(fields).forEach(function (key) {
      var value = fields[key];
      if (value && typeof value === 'object' && value.data && value.fileName) {
        processedFields[key] = saveFileToDrive_(value, module) || '(upload failed)';
      } else {
        processedFields[key] = value;
      }
    });

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
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headerRange = sheet.getRange(1, 1, 1, lastColumn);
  var headers = headerRange.getValues()[0].map(function (h) { return String(h).trim(); });

  var newKeys = Object.keys(obj).filter(function (key) { return headers.indexOf(key) === -1; });
  if (newKeys.length) {
    headers = headers.concat(newKeys);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  var row = headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(obj, header) ? obj[header] : '';
  });
  sheet.appendRow(row);
}

/**
 * Saves a base64-encoded file to a Drive folder (DRIVE_FOLDER_ID script
 * property). Returns the shareable file URL, or null if no folder is
 * configured.
 */
function saveFileToDrive_(fileObj, context) {
  var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!folderId) return null;

  var folder = DriveApp.getFolderById(folderId);
  var blob = Utilities.newBlob(
    Utilities.base64Decode(fileObj.data),
    fileObj.mimeType || 'application/octet-stream',
    (context ? context + '-' : '') + fileObj.fileName
  );
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
