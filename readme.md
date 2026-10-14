# Gutter Guys of Katy

A low-traffic PWA whose page content is authored in a Google Sheet instead
of being hardcoded in this repo. This repository hosts only the generic,
stable pieces:

- `index.html`, `manifest.json`, `sw.js` - the installable PWA shell
- `assets/js/app.js` - hash router that renders content fetched from the backend
- `config.js` - the one file you edit to point the shell at your deployed backend
- `backend/apps-script/` - Google Apps Script web app that reads/writes the Sheet (and Drive)
- `backend/cloudflare-worker/` - Cloudflare Worker that adds CORS, edge caching, and optional rate limiting in front of Apps Script

See `docs/SETUP.md` for full deployment instructions (Sheet structure, Apps
Script deployment, Worker deployment, GitHub Pages setup).