# Provincia

**Provincia** is a desktop viewer and editor for *Rome: Total War Remastered*
campaigns — an interactive province map with faction/culture/religion/economy
overlays, deep settlement panels, family trees, save-game inspection and
editing, and a reverse-engineered model of the game's economy.

> **RIS engine-law reference:** [docs/LAWS.md](docs/LAWS.md) — the complete catalog of
> cracked RTW:Remastered economy & public-order laws (farming/wages/army
> upkeep/taxes + H roll/admin/corruption/sea & land trade/tribute/AI tiers/PO), with
> probe evidence. Earlier income spec: [docs/INCOME_MODEL.md](docs/INCOME_MODEL.md).
> Trade connectivity model: [docs/TRADE_MODEL.md](docs/TRADE_MODEL.md).

## Stack

- **Electron** (`main.js`, `preload.js`) — main process owns save parsing,
  file IO, mod-data loading, watchers, and auto-update.
- **React 18 + Vite** (`src/`) — the renderer. Source uses plain `.js` files
  containing JSX (CRA convention); `vite.config.js` forces the esbuild `jsx`
  loader for all `.js`.
- **Embedded Python** (`python-runtime/`, `scripts-suite-py/`) — the
  "Settlement Processor" Scripts suite (`main-scripts.js`), run through a
  bundled interpreter fetched by `scripts/fetch-runtime.js`.
- **Vitest** — unit tests for the parser/model layer (`src/*.test.js`).

## Development

```sh
npm install

# Simple loop: build the renderer, then launch Electron against build/
npm run build
npm run electron

# HMR loop: Vite dev server on :3000 + Electron pointed at it
npm start                        # terminal 1 (vite)
DEV_USE_SERVER=1 npm run electron  # terminal 2 (PowerShell: $env:DEV_USE_SERVER="1"; npm run electron)
```

`npm test` runs the Vitest suite. Some accuracy suites need local calibration
saves (not committed) and skip without them.

## Building & releasing

```sh
npm run dist:win     # NSIS installer  → dist/
npm run dist:mac     # DMG (x64 + arm64)
npm run dist:linux   # AppImage
```

`prebuild` runs automatically before `build`:

- `scripts/bundle-mod-data.js` — bundles RIS mod data files into `public/`
- `scripts/fetch-runtime.js` — fetches the embeddable Python runtime + Monaco

Release flow: the Windows installer is built locally with `npm run dist:win`
and published as a GitHub release; the `build-mac.yml` GitHub Action then
builds and attaches the mac DMG when the release is created. Auto-updates are
served from GitHub Releases via `electron-updater`.

## Repository layout

| Path | Purpose |
|---|---|
| `main.js` | Electron main process: IPC handlers, save cracking, watchers |
| `main-scripts.js` | Scripts window backend (Python pipeline, `sps:*` IPC) |
| `preload.js` / `preload-scripts.js` | contextBridge APIs for the two windows |
| `src/` | React renderer + save parsers + economy/PO/growth models |
| `docs/` | Cracked engine-law documentation and ground-truth corpora |
| `scripts/` | Build scripts (`bundle-mod-data`, `fetch-runtime`, …) and research scratch |
| `scripts-suite-py/` | Python Settlement Processor suite (bundled as `app_data`) |
| `bundled-mod/` | Minimal mod data shipped inside the installer |
