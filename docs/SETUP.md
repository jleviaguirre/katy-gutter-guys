# RainGuard setup guide

RainGuard is a static PWA shell (hosted on GitHub Pages) whose page content
lives entirely in a Google Sheet. A Cloudflare Worker proxies/caches requests
between the browser and a Google Apps Script backend, which reads/writes the
Sheet (and optionally Google Drive for file uploads).

```
GitHub Pages (static shell)        Cloudflare Worker              Google Apps Script
index.html / sw.js / app.js  --->  CORS + edge cache + rate  --->  doGet / doPost  --->  Google Sheet
                                    limiting                                      --->  Google Drive (files)
```

## 1. Set up the Google Sheet

Create (or reuse) a Sheet with a tab named **`Modules`**. Row 1 is the header
row; add any columns you like, but these are recognized by the app:

| column      | required | meaning                                                   |
|-------------|----------|------------------------------------------------------------|
| `module`    | yes      | route key, matches the URL hash, e.g. `home`, `about`      |
| `html`      | yes      | the HTML rendered into `<main id="app">` for that module   |
| `title`     | no       | sets `<title>` while that module is active                 |
| `navLabel`  | no       | nav link text (defaults to `module`)                       |
| `order`     | no       | numeric sort order for the nav                             |
| `showInNav` | no       | set to `FALSE` to hide a module from the nav (still routable) |

A second tab named **`Submissions`** is created automatically the first time
a form is submitted - you don't need to create it yourself.

## 2. Deploy the Apps Script backend

1. Open the Sheet, then **Extensions > Apps Script**. This creates a script
   "bound" to the Sheet, so it already knows which spreadsheet to read/write
   - no extra configuration needed for that part.
2. Replace the generated files with [`backend/apps-script/Code.gs`](/backend/apps-script/Code.gs)
   and [`backend/apps-script/appsscript.json`](/backend/apps-script/appsscript.json)
   (enable "Show manifest file" in Project Settings to edit the latter).
3. *(Skip this unless you started a standalone script directly at
   script.google.com instead of step 1 above.)* Standalone scripts don't
   know which spreadsheet to use, so add a
   [Script Property](https://developers.google.com/apps-script/guides/properties)
   named `SPREADSHEET_ID` (gear icon ⚙️ "Project Settings" > "Script
   Properties" > "Add script property") with the Sheet's ID - the long id
   found in its URL: `.../spreadsheets/d/<SHEET_ID>/edit`.
4. *(Skip this unless you want file-upload support.)* If a form will upload
   files to Drive, create/pick a Drive folder, copy its ID from the folder's
   URL (`.../drive/folders/<FOLDER_ID>`), and add it as a Script Property
   named `DRIVE_FOLDER_ID` the same way as step 3.
5. **Deploy > New deployment > Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the resulting `.../exec` URL - you'll need it for the Worker.

## 3. Deploy the Cloudflare Worker

```powershell
cd backend\cloudflare-worker
npm install -g wrangler   # if not already installed
wrangler login
```

Edit [`wrangler.toml`](/backend/cloudflare-worker/wrangler.toml):
- `ALLOWED_ORIGIN` -> your GitHub Pages origin, e.g.
  `https://yourusername.github.io`.
- (optional) uncomment the `RATE_LIMIT_KV` binding to enable POST rate
  limiting; create the namespace first with `wrangler kv namespace create RATE_LIMIT_KV`.

`APPS_SCRIPT_URL` is **not** set in `wrangler.toml` - it acts as a bypass
key for your backend (anyone who has it can call Apps Script directly,
skipping this Worker's CORS/cache/rate-limiting), so it must never be
committed to the public repo. Set it as an encrypted secret instead:

```powershell
wrangler secret put APPS_SCRIPT_URL
# paste the .../exec URL from step 2 when prompted
```

For local testing with `wrangler dev`, copy `.dev.vars.example` to
`.dev.vars` (already gitignored) and fill in the real URL there instead.

Then deploy:

```powershell
wrangler deploy
```

Copy the resulting `https://*.workers.dev` URL.

## 4. Point the shell at your Worker

Edit [`config.js`](/config.js) and set:

```js
API_BASE_URL: 'https://your-worker-subdomain.workers.dev',
```

Commit and push.

## 5. Enable GitHub Pages

Repo **Settings > Pages** -> Deploy from branch -> `main` / `/ (root)`.

## 6. Test it

- Visit the Pages URL. The nav and `home` module content should load from
  the Sheet.
- Add a new row to `Modules` (e.g. `module=about`), wait up to
  `CACHE_TTL_SECONDS` (default 5 minutes) for the Worker's edge cache to
  expire, then visit `#about`.
- Add a `<form class="js-remote-form" data-form-id="contact">...</form>`
  (with normal `<input name="...">` fields) to a module's `html` cell to get
  a working, no-JS-required form submission that lands in the `Submissions`
  tab.
- Embedded `<script>` tags in a module's `html` cell run on render; they can
  call `window.RainGuard.submitForm(module, formId, fieldsObject)` or
  `window.RainGuard.showToast(message)` directly if you need custom logic.

## 7. PWA install

Once served over HTTPS (GitHub Pages provides this) with a valid manifest
and service worker, browsers will offer "Install" / "Add to Home Screen".
Replace the placeholder icons in [`assets/icons/`](/assets/icons) with your
own branded `icon-192.png` / `icon-512.png` whenever you're ready.

## Notes & trust model

- The Sheet's `html` column is rendered as trusted HTML, including any
  `<script>` tags - anyone with **edit** access to the Sheet can run
  arbitrary JavaScript on your site. Restrict edit access accordingly.
- GET responses are cached both at the Cloudflare edge
  (`CACHE_TTL_SECONDS`) and in the browser's service worker (stale-while-
  revalidate), so content updates may take a short while to show up for
  everyone - acceptable for a low-traffic site, but worth knowing when
  testing content changes.
