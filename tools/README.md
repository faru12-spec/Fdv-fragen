# Werkzeuge
- Fragen liegen in `data/<register>.json` (Register in `tools/registers.json`). `index.html`, `app.js`, `data/manifest.json` werden von `tools/build.py` erzeugt - nicht von Hand aendern.
- App-Quelltext: `src/app.jsx`. Nach Aenderungen: `python3 tools/build.py` (braucht node + `npm i @babel/core @babel/preset-react terser` in `tools/`, `NODE_PATH` auf dessen node_modules).
- Neue Fragen: `tools/helper.py` (siehe Docstring), danach `python3 tools/validate.py`.
- Backup aller Fragen vom 2026-11-03: `backup/fragen_backup_2026-11-03.json`, Git-Tag `backup-2026-11-03`.
