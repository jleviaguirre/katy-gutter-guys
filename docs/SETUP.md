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
| `navLabel`  | no       | sub-nav link text (defaults to `title`, then `module`)      |
| `order`     | no       | numeric sort order for the sub-nav (blank sorts last, alphabetically) |
| `showInNav` | no       | set to `TRUE`/`yes`/`1`/`x` to show this module as a sub-nav link (still routable either way) |
| `role`      | no       | who can see/load this module: blank = everyone (incl. logged-out visitors); `customer` = any logged-in account; `technician` = technician/admin only; `admin` = admin only (see "Passwordless login" below for the role hierarchy) |
| `description` | no     | sub-nav link tooltip (`title` attribute)                    |

The sub-nav is built from these columns every time the module list loads/
changes (including right after login/logout, since `role` affects which
rows a viewer gets back at all - see the `role` column and "Passwordless
login" below). There's no separate hamburger button: logged-out visitors
don't get a modules menu at all (the avatar button just opens the login
modal), and once logged in, the same avatar button opens a single dropdown
with the sub-nav links on top and Profile/Account/Log out below (see
`styles.css`'s `.account-menu-dropdown` and `.account-menu-modules`).
`module = profile` / `module = account` rows are optional: if present they
replace the built-in default Profile/Account page HTML (the actual field
values are always filled in client-side from the logged-in session, never
from the sheet). [`docs/modules/profile.html`](/docs/modules/profile.html)
is a ready-to-paste Profile page (name/email/phone/address, wired by
app.js's `hydrateProfileForm`/`wireProfileForm` - Code.gs's
`handleUpdateProfile_` already rejects an email already used by another
account).

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
   named `DRIVE_FOLDER_ID` the same way as step 3. Uploads can optionally be
   nested into a subfolder per submission (e.g. one folder per customer
   visit) - see "Gutter Survey module" below.
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

## Gutter Survey module (photos/video/audio -> diagram + quote totals)

[`docs/modules/gutter-survey.html`](/docs/modules/gutter-survey.html) lets a
technician (on site, with a tape measure) or a homeowner (just walking
around with their phone) capture photos, short videos (up to 30 seconds,
stoppable anytime), and audio notes while walking the roofline, and turns
that into a labeled gutter/downspout diagram plus totals (gutter linear
feet, downspout count/LF, corner count) - a digital version of the
hand-sketched proposals the business already uses. To use it:

1. Copy the entire contents of that file into the `html` column of a
   `Modules` row with `module = Survey` (`navLabel` "Photo Survey" or
   similar, `title`/`order` as you like).
2. Make sure `DRIVE_FOLDER_ID` is configured (step 4 above) - each visit
   uploads its photos/videos/audio into its own subfolder, named from the
   contact's name/phone/date, nested inside that folder.
3. Submissions land in their own `GutterSurvey` tab (auto-created with
   dynamic headers): contact info, computed totals, a `diagramUrl` link to
   a generated PNG diagram, and a `segmentsJson` column with the full
   per-segment breakdown (direction, length, attached media URLs).
4. Captured media is kept on the device (IndexedDB) until the visit is
   submitted, so nothing is lost to a flaky connection or an accidental
   reload mid-walkaround; each file uploads as its own request (not
   bundled into one giant payload) with per-file retry on failure.
5. This module relies on two small additions already present in
   [`Code.gs`](/backend/apps-script/Code.gs): a `folderName` option on file
   uploads (nests them in a named subfolder instead of the Drive root) and
   a `POST { action: "uploadAsset", module, folderName, file }` endpoint
   that uploads one file and returns its URL without writing a Sheet row.
   Both are backward compatible - existing forms that don't send
   `folderName`/`action` behave exactly as before.

## Gutter Sketch module (draw/drag a polygon -> diagram + quote totals)

[`docs/modules/gutter-sketch.html`](/docs/modules/gutter-sketch.html) is a
second, generic (no technician/homeowner split) way to produce the same
kind of gutter diagram, aimed at using more of the screen on a phone/tablet:
instead of typing a direction + length for each run, you draw directly on a
canvas with your mouse or finger.

1. Copy the entire contents of that file into the `html` column of a
   `Modules` row with `module = GutterSketch` (`navLabel`/`title`/`order`
   as you like).
2. Three modes, switched with the toolbar icons: **Draw** (tap to add
   points; tap the first point again to close the shape into a polygon),
   **Select** (tap a point to toggle a downspout there or delete it, or tap
   a line to type its exact length - the endpoint snaps along the same
   direction to match), **Edit** (drag a point to reposition it; adjacent
   segment lengths update live).
3. It also captures a service address, an optional GPS location (via a
   "Use my current location" button - never prompted automatically), an
   optional RFQ number (for linking a sketch back to an earlier quote
   request), and `submittedBy` (read from `window.RainGuard.currentUser` if
   your auth sets it - a string, or an object with `name`/`email` - left
   blank when nobody is logged in).
4. Submissions land in the **same `GutterSurvey` tab** as
   `gutter-survey.html` (sheetName is shared on purpose, so both tools feed
   one list) with the same `segmentsJson`-style structured breakdown.
5. Only photos are supported here (no video/audio, and no per-segment
   media - just a single photo gallery for the whole visit) to keep the
   module small; progress (contact/address/sketch/notes, not photos) is
   saved to `localStorage` as you go.

### Shared helpers and the Sheet's 50,000-character cell limit

A Google Sheets cell tops out at 50,000 characters, and a sheet-authored
module's entire `html` column is one cell - so logic reused by more than
one module belongs in a plain static asset instead of being duplicated in
every module. [`assets/js/gutter-tools.js`](/assets/js/gutter-tools.js)
holds that shared logic (`uploadAsset`, `blobToBase64`, geolocation, local
storage helpers, etc. - exposed as `window.GutterTools`) for the gutter
modules on this page, and is loaded once, globally, by `index.html` (the
same way `config.js`/`app.js` already are) rather than per-module - a
module's own inline `<script>` can rely on `window.GutterTools` already
being ready by the time it runs, with no load-order code of its own to
write. If you add another module that needs the same kind of helpers, reuse
this file (or add to it) instead of copy-pasting logic into the Sheet cell;
keep an eye on your module's own character count (e.g. "Copy to clipboard"
the cell content and check its length) if it grows a lot of
module-specific markup.

## Gutter Canvas module (gesture-first sketch tool)

[`docs/modules/gutter-canvas.html`](/docs/modules/gutter-canvas.html) is a
third take on the same idea, built around direct manipulation instead of a
mode toolbar, to use more of the screen (especially on phones) and support
multiple separate, disconnected runs the way a technician actually sketches
a roofline by hand:

1. Copy the entire contents of that file into the `html` column of a
   `Modules` row with `module = GutterCanvas`. **Do not hand-edit this
   file** - see "Source file and minified build" below; edit
   `gutter-canvas.src.html` instead and regenerate it.
2. Just two floating buttons sit on top of the canvas: **Gutters** and
   **Downspouts**, plus a small gear icon for grid settings. In Gutters
   mode, tap blank canvas to place a point, tap blank again to extend it
   into a line (keeps chaining while you keep tapping); tap an existing
   line's open end to arm it so the next blank tap resumes *that* line
   instead (works on any earlier, disconnected line, not just the most
   recent one); tap the already-active Gutters button to "lift the pen"
   and start a fresh, disconnected line; tap a mid-point to select it
   (deleting a point bridges/reconnects its neighbors, like normal
   polyline editing); tap a segment's body to select it (shows a length
   field, a "Remove" button, and a photo-attach button - the segment
   highlights so it's clear which one a photo will link to; deleting a
   *segment* does **not** bridge - it splits the line into independent
   fragments around the gap, discarding any fragment left with under 2
   points). Dragging a point moves just that point; dragging a segment's
   body slides the whole run without changing its length. In Downspouts
   mode, tap blank canvas to drop a marker anywhere (it doesn't have to
   touch a line); tap/drag an existing one to select/move it.
3. The canvas supports **pan and zoom** independent of the drawing
   gestures: mouse wheel zooms (anchored at the cursor), dragging on
   blank canvas pans, and on touch devices a two-finger pinch zooms
   (anchored at the pinch midpoint) while a one-finger drag on blank
   space still pans. Because panning/zooming is available, the view
   never auto re-centers after the first load (except after "Start
   over") - so the user's own pan/zoom position is never fought by the
   app.
4. Measurement labels rotate to run alongside their segment (not always
   horizontal), so a near-vertical gutter run's length reads vertically
   instead of being squashed/overlapping the line.
5. The gear icon opens a small popup for **snap-to-grid**, **show/hide
   gridlines**, and **grid size in feet** (accepts whole numbers or
   fractions, e.g. `0.5`). Snap and show-gridlines both default to *on*.
6. Workflow is **sketch first, contact details last** (the opposite order
   from the other two modules) - you draw first, then the Details step
   (name/phone/email - email required - service address/optional
   GPS/Submit) appears once you tap Continue. There's no user-typed quote
   number; one is auto-generated and shown on the success screen instead.
7. Photos attach only to whatever is currently selected (a segment or a
   downspout) - there is no general "whole visit" photo slot - so
   `segmentsJson` includes each segment's own `photoUrls`, letting a
   reviewer see exactly which photo goes with which run.
8. Submissions land in the same `GutterSurvey` tab as the other two
   modules. `submittedBy` and the 50,000-character-limit/shared-helpers
   notes above apply here too. The submitted diagram PNG is built from an
   independent, freshly-created offscreen canvas (not the live/interactive
   one, which may already be detached from the DOM by submit time) so it
   stays populated and accurate.

### Source file and minified build

`gutter-canvas.src.html` has grown complex enough (pan/zoom, grid
snapping, rotated labels, per-segment photos, etc.) that keeping it
readable and staying under the Sheet's 50,000-character cell limit pulled
in opposite directions. This module now uses a two-file convention instead
of hand-trimming comments every time it changes:

- **`docs/modules/gutter-canvas.src.html`** - the readable source of
  truth. Make all edits here. Not meant to be pasted into the Sheet
  directly (it's larger than 50,000 characters).
- **`docs/modules/gutter-canvas.html`** - the production file, generated
  from the source by minifying its `<style>` and `<script>` blocks and
  collapsing whitespace in the static markup. This is the file you copy
  into the Sheet.

To regenerate the production file after editing the source (PowerShell,
from the repo root):

```powershell
$src = Get-Content -Raw 'docs\modules\gutter-canvas.src.html'
$styleMatch = [regex]::Match($src, '(?s)<style>(.*?)</style>')
$scriptMatch = [regex]::Match($src, '(?s)<script>(.*?)</script>')
$before = $src.Substring(0, $styleMatch.Index)
$between = $src.Substring($styleMatch.Index + $styleMatch.Length, $scriptMatch.Index - ($styleMatch.Index + $styleMatch.Length))
$after = $src.Substring($scriptMatch.Index + $scriptMatch.Length)

Set-Content "$env:TEMP\s.css" $styleMatch.Groups[1].Value -NoNewline
Set-Content "$env:TEMP\s.js" $scriptMatch.Groups[1].Value -NoNewline
npx --yes clean-css-cli -o "$env:TEMP\s.min.css" "$env:TEMP\s.css"
npx --yes terser "$env:TEMP\s.js" -c -m -o "$env:TEMP\s.min.js"

$beforeCollapsed = ([regex]::Replace($before, '>\s+<', '><') -replace '\s{2,}', ' ').Trim()
$final = $beforeCollapsed + "`n<style>" + (Get-Content -Raw "$env:TEMP\s.min.css") + "</style>" + $between +
  "<script>" + (Get-Content -Raw "$env:TEMP\s.min.js") + "</script>" + $after
Set-Content 'docs\modules\gutter-canvas.html' $final -NoNewline -Encoding UTF8
```

Then spot-check the result (`node --check` on the extracted `<script>`
block, a quick load in a browser) before pasting it into the Sheet. If any
future module hits the same comment-trimming pain, this is the template
to follow for it too.

## Fixed site header

The header (logo, phone number, "Get a Free Quote"/"Login" buttons) is
**fixed shell markup** in `index.html` - present on every page, the same
way `#site-footer` is, and not sheet-driven at all.

- Edit the logo text, phone number, or the "Get a Free Quote"/"Login"
  buttons directly in `index.html`.
- "Login" opens the passwordless email-code modal described below (wired
  up in `app.js`'s `wireLogin()`); it is no longer a placeholder.
- The in-page menu (Services/How It Works/etc.) is intentionally **not**
  part of this fixed header - it lives on the home page itself, as the
  `Masthead` row described below, so it only appears where its targets do.

## Passwordless login (email one-time code)

Clicking "Login" opens a small modal (markup lives in `index.html`,
styled in `assets/css/styles.css`, wired in `assets/js/app.js`) that asks
for an email, emails a one-time code, then asks for that code - no
password, ever. The backend half lives in `Code.gs`'s "Passwordless
login" section.

**Sheets involved**
- **`Users`** tab: `email | role | name | phone | address | code |
  codeIssuedAt | lastLogin | failedAttempts` (every column past `email` is
  added automatically the first time it's needed). `role` is one of blank
  (unverified), `customer`, `technician`, or `admin`. Any email can request
  a code; an email that isn't already a row is auto-created with a
  **blank** role and the name/phone/address it submitted on the
  registration step - it can log in (after verifying the emailed code) but
  is not yet a recognized customer. **Someone must manually set `role` to
  `customer` (or `technician`/`admin`) in the sheet** to grant it anything
  beyond the default blank-role experience - the login code itself never
  assigns or upgrades a role. These are also the exact values the `Modules`
  tab's `role` column uses to gate each module: `admin` sees every module;
  `technician` sees everything except `admin`-only modules; a blank-role or
  `customer` account sees everything except `technician`/`admin`-only
  modules; logged-out visitors only ever see blank-`role` (public) modules.
  This is enforced server-side in `Code.gs` (`doGet`/`listModules`), so a
  restricted module's HTML is never even sent to a browser that isn't
  allowed to see it - not just hidden from the nav.
- **`Sessions`** tab (auto-created): `token | email | createdAt |
  lastSeenAt` - one row per logged-in device. Deleting a row here force-logs-out
  that one device; deleting all rows for an email logs it out everywhere.

**Why a code with no time limit is still safe enough**
A code stays valid until it's used, or until a newer one is requested for
the same email (which immediately invalidates the old one) - useful since
field techs/homeowners don't always open the email right away. Instead of
a time limit, brute force is bounded by: codes being single-use, a cooldown
between requests per email (`LOGIN_CODE_COOLDOWN_MS` in `Code.gs`), and a
wrong-guess lockout that requires a fresh code after a few failed attempts
(`LOGIN_MAX_FAILED_ATTEMPTS`).

**Why a tampered `localStorage` can't grant a role**
The browser only ever stores an opaque random session token (in
`localStorage`, key `rg-session-token`) - never a role. On every page
load, `app.js` calls `action: "whoAmI"` with that token, and the backend
looks the token up in `Sessions`, then re-reads the *current* role from
`Users` fresh, every time - that round trip result (`window.RainGuard.currentUser = { email, role }`) is the only thing the UI ever
trusts. Editing `localStorage`'s role (there isn't one to edit) or any
in-memory JS state does nothing, because nothing reads a client-supplied
role; any future role-gated backend action must do the same re-check
server-side rather than trusting a role sent in the request.

**Other actions used by the flow**: `requestCode` (send a code),
`verifyCode` (consume it, create a session), `touchSession` (a periodic
heartbeat from the open tab, keeping `lastSeenAt`/`lastLogin` current
while the app is in use, not just at login), `logout` (removes one
session row only, leaving other devices logged in).

## Section-based home page (the "landing page" tab)

The home page is built from a **second** sheet tab named **`landing page`**
(columns: `section`, `content`, `assets`) instead of a single `html` cell -
each row renders one section of the page (menu bar, hero, services,
footer, etc.), concatenated top to bottom in row order. This lets you
reorder, add, or remove whole sections of the home page just by
reordering/adding/deleting sheet rows.

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
   (a ready-made, generic gutter-company page: menu bar, hero, trust bar,
   services, how-it-works, gallery, testimonials, FAQ, CTA banner, footer) -
   or write your own rows following the same pattern.
3. Paste the entire contents of
   [`docs/modules/home.html`](/docs/modules/home.html) into the `html`
   column of the `Modules` row with `module = home`. This is the shared
   bootstrap: it fetches the `landing page` tab, resolves placeholders, and
   assembles/styles the page - you only need to touch it if you want to
   change the shared CSS framework (`.lp-*` classes) or how placeholders
   are resolved.
4. Replace the placeholder stock-photo URLs in the Hero/Gallery rows'
   `assets` with your own (e.g. links into your Drive assets folder).

In-page navigation (the menu bar and footer quick links to other sections,
like "Services" or "FAQ") uses `data-scroll-to="target-id"` +
smooth-scrolling, **not** `href="#target-id"` - the app's router already
treats any `#hash` change as "go to this module", so a plain in-page anchor
link would be misread as navigating to a (nonexistent) module. Since the
menu bar only appears on the home page, its targets are always present
when it's clicked. Links that should actually change pages, like "Get a
Free Quote", still use a normal `href="#rfq"`.

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
