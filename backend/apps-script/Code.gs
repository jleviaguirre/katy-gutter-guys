/**
 * Gutter Guys of Katy - Google Apps Script backend
 * ---------------------------------------------------------------------------
 * Serves page content stored in a Google Sheet ("Modules" tab: module, html,
 * title, navLabel, order, showInNav - any extra columns are passed through
 * as-is), serves the "landing page" tab (section, content, assets) used to
 * build the home page from composable sections, and accepts form
 * submissions from the site, storing them in a "Submissions" tab and
 * optionally uploading attached files to Google Drive.
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

/**
 * GET /exec                    -> { modules: [...] }  (all modules)
 * GET /exec?module=foo         -> { modules: [...] }  (filtered to module "foo")
 * GET /exec?view=landing       -> { sections: [...] } (the "landing page" tab,
 *                                  in row order, with assets resolved to a
 *                                  usable embed URL + detected type)
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    if (params.view === 'landing') {
      return jsonOutput_({ ok: true, sections: getLandingSections_() });
    }

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
