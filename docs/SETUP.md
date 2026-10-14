# Gutter Guys of Katy setup guide

Gutter Guys of Katy is a static PWA shell (hosted on GitHub Pages) whose page content
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

A third tab named **`landing page`** (columns: `section`, `content`,
`assets`) is used specifically to build the `home` module from composable
sections instead of a single `html` cell - see "Section-based home page"
below.

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

> **Updating Code.gs later:** editing the script in the Apps Script editor
> does NOT update your live `.../exec` URL by itself. After pasting in
> changes, go to **Deploy > Manage deployments**, click the pencil/edit icon
> on your existing Web app deployment, set Version to **New version**, and
> deploy. This keeps the same `.../exec` URL (so the Worker's
> `APPS_SCRIPT_URL` secret doesn't need to change) while running your
> updated code.

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
  tab. Add `data-sheet-name="SomeTab"` to route that form's submissions to
  their own tab instead (auto-created with dynamic headers).
- Embedded `<script>` tags in a module's `html` cell run on render; they can
  call `window.RainGuard.submitForm(module, formId, fieldsObject, { sheetName })`
  or `window.RainGuard.showToast(message)` directly if you need custom logic.
  `sheetName` is optional and defaults to the shared `Submissions` tab.

## Multi-step forms (e.g. the RFQ module)

[`docs/modules/rfq.html`](/docs/modules/rfq.html) is a ready-to-use,
self-contained step-by-step quote-request form (one question per screen,
SVG icons, required-answer validation, auto-advance on single-select
questions, optional Previous/Next). To use it:

1. Copy the entire contents of that file into the `html` column of a
   `Modules` row with `module = RFQ` (set `title`/`navLabel`/`order` as you
   like).
2. Its answers are posted with `sheetName: 'RFQ'`, so they land in their own
   `RFQ` tab in the Sheet (auto-created with dynamic headers on first
   submission) rather than the shared `Submissions` tab.
3. To build a similar step-by-step form for another module, copy that file
   as a starting point and edit the `QUESTIONS` array at the top of its
   `<script>` - each entry is either `type: 'choice'` / `'icon-choice'`
   (single-select, auto-advances) or `type: 'input'` (one or more text
   fields with a `validate(value)` function, requires clicking Next/Enter).

## Fixed site header and the "Masthead" row

Unlike the rest of the page, the header (logo, phone number, "Get a Free
Quote"/"Login" buttons) is **fixed shell markup** in `index.html` - present
on every page, the same way `#site-footer` is. Only the menu links in the
middle are data-driven: `app.js` fetches the `landing page` tab's
**`Masthead`** row specifically and injects its `content` into the
header's `#site-menu-links`, regardless of which module is currently
showing.

- Edit the logo text, phone number, or the "Get a Free Quote"/"Login"
  buttons directly in `index.html` - these aren't sheet-driven.
- Edit the `Masthead` row's `content` in the `landing page` tab to change
  the menu links themselves (add/remove/reorder items) without touching
  code. Its content is just the links - no logo, CTA, or mobile-toggle
  markup, since those already live in `index.html`.
- "Login" is currently a placeholder - clicking it shows a toast; wire it
  up to a real flow in `app.js`'s `wireLoginPlaceholder()` when ready.

## Section-based home page (the "landing page" tab)

The home page is built from a **second** sheet tab named **`landing page`**
(columns: `section`, `content`, `assets`) instead of a single `html` cell -
each row renders one section of the page (hero, services, footer, etc.),
concatenated top to bottom in row order. This lets you reorder, add, or
remove whole sections of the home page just by reordering/adding/deleting
sheet rows. The `Masthead` row is the one exception - see above, it's
rendered into the fixed header instead of the page body.

- `section` - a label for your own reference; it has no effect on rendering.
- `content` - plain HTML for that section.
- `assets` - a JSON array of media URLs for that row (Drive share links,
  YouTube links, or direct image/video/pdf/audio URLs). Each one is
  auto-resolved server-side (in `Code.gs`) into a usable embed - Drive links
  are even checked against their real Google Drive mime type, so an
  image/video/PDF in Drive embeds correctly regardless of the link format
  you paste in.

A row's `content` can reference its own `assets` with:
- `{{asset:0}}` - a fully-rendered embed tag (`<img>`/`<video>`/`<iframe>`/
  `<audio>`, whichever fits the detected type) for `assets[0]`
- `{{assetUrl:0}}` - just the resolved URL for `assets[0]`, for custom
  markup (e.g. a CSS `background-image`)
- `{{assets:grid}}` - renders **every** asset in that row as a responsive
  grid, regardless of how many there are (handy for a photo gallery row)

### Setup

1. Create the `landing page` tab with those 3 columns.
2. Paste each row's `content`/`assets` from
   [`docs/modules/landing-page-rows.md`](/docs/modules/landing-page-rows.md)
   (a ready-made, generic gutter-company page: masthead menu, hero, trust
   bar, services, how-it-works, gallery, testimonials, FAQ, CTA banner,
   footer) - or write your own rows following the same pattern.
3. Paste the entire contents of
   [`docs/modules/home.html`](/docs/modules/home.html) into the `html`
   column of the `Modules` row with `module = home`. This is the shared
   bootstrap: it fetches the `landing page` tab, resolves placeholders, and
   assembles/styles the page body (everything except the `Masthead` row) -
   you only need to touch it if you want to change the shared CSS
   framework (`.lp-*` classes) or how placeholders are resolved.
4. Replace the placeholder stock-photo URLs in the Hero/Gallery rows'
   `assets` with your own (e.g. links into your Drive assets folder).

In-page navigation (header menu links and footer quick links to other
sections, like "Services" or "FAQ") uses `data-scroll-to="target-id"` +
smooth-scrolling, **not** `href="#target-id"` - the app's router already
treats any `#hash` change as "go to this module", so a plain in-page anchor
link would be misread as navigating to a (nonexistent) module. Clicking a
menu item while on a different page (e.g. RFQ) navigates to the home
module first, then scrolls once it has rendered. Links that should
actually change pages, like "Get a Free Quote", still use a normal
`href="#rfq"`.

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
