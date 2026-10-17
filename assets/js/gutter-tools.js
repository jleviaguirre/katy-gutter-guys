/**
 * Gutter Guys of Katy - shared helpers for camera/sketch survey modules
 * ---------------------------------------------------------------------------
 * Google Sheets limits a cell to 50,000 characters, and sheet-authored
 * modules (docs/modules/*.html) are pasted whole into one cell - so any
 * logic reused across more than one module belongs here instead, as a
 * normal (uncapped) static asset loaded once via <script src>.
 *
 * Exposes window.GutterTools. Depends only on window.APP_CONFIG
 * (config.js) for API_BASE_URL - load this after config.js.
 */
(function (scope) {
  'use strict';

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var result = reader.result || '';
        var comma = String(result).indexOf(',');
        resolve(comma === -1 ? '' : result.slice(comma + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('Could not read file')); };
      reader.readAsDataURL(blob);
    });
  }

  /** Uploads one file to Drive via the Apps Script `uploadAsset` action
   * (see Code.gs) and resolves with its shareable URL. `folderName`, if
   * given, nests it inside a per-visit subfolder instead of the Drive
   * root. */
  function uploadAsset(file, folderName, moduleName) {
    return blobToBase64(file.blob).then(function (base64) {
      return fetch(scope.APP_CONFIG.API_BASE_URL + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'uploadAsset',
          module: moduleName || 'unknown',
          folderName: folderName,
          file: { fileName: file.fileName, mimeType: file.mimeType, data: base64 }
        })
      });
    }).then(function (response) {
      return response.json().catch(function () { return { ok: false, error: 'Invalid server response' }; });
    }).then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Upload failed');
      return data.url;
    });
  }

  /** Builds a readable, filesystem-safe per-visit Drive subfolder name from
   * a contact's name/phone and a short unique suffix. */
  function folderNameFor(name, phone, suffix) {
    var datePart = new Date().toISOString().slice(0, 10);
    var raw = (name || 'Customer') + ' - ' + (phone || 'no-phone') + ' - ' + datePart + ' - ' + suffix;
    return raw.replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
  }

  /** Best-effort one-shot geolocation lookup; resolves { lat, lng } or
   * rejects with a human-readable message. Never prompts until called. */
  function getLocation() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('Location is not supported by this browser.')); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        function (err) { reject(new Error(err && err.message ? err.message : 'Could not get your location.')); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  /** Reads whoever the page considers "logged in" (set by the auth system
   * as window.RainGuard.currentUser - a string, or an object with a
   * name/email), defaulting to '' when nobody is logged in. */
  function currentUserLabel() {
    var user = scope.RainGuard && scope.RainGuard.currentUser;
    if (!user) return '';
    if (typeof user === 'string') return user;
    return user.name || user.email || '';
  }

  function saveLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage full/unavailable - ignore */ }
  }

  function loadLocal(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  scope.GutterTools = {
    uid: uid,
    escapeHtml: escapeHtml,
    blobToBase64: blobToBase64,
    uploadAsset: uploadAsset,
    folderNameFor: folderNameFor,
    getLocation: getLocation,
    currentUserLabel: currentUserLabel,
    saveLocal: saveLocal,
    loadLocal: loadLocal
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
