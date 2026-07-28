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

## The RIS wiki

The wiki markdown lives in the mod repo at `C:/RIS/RIS/wiki`; the tools that generate,
serve and export it live here.

```sh
npm run wiki:site      # export the wiki as a standalone static site
npm run wiki:check     # verify the export: links, fragments, images, orphans
npm run wiki:probe     # open the export over file:// in a real browser and report
```

`wiki:site` writes to **`C:/dev/ris-wiki-site`** — beside this checkout, not inside it,
and outside the mod repo entirely. That is deliberate: the export is derived output,
rebuilt from the markdown in about two minutes and roughly the same size as the wiki it
comes from, so committing it would nearly double a repo that already holds the original.
Living outside both working trees is what makes that a fact rather than a good intention —
no `git add -A` in either repo can reach it.

**To send the wiki to someone:**

```sh
npm run wiki:site                 # → C:/dev/ris-wiki-site  (~215 MB, ~171 MB zipped)
```

Zip that folder and send it. They unzip it and double-click `index.html` — no Node, no
install, no internet, nothing to trust. Search, the theme toggle, nav and breadcrumbs all
work offline.

At ~171 MB zipped it is past every mail provider's attachment limit, so use a file host
(WeTransfer, Drive, Dropbox). If it has to be smaller:

```sh
npm run wiki:site -- --without cards      # → ~117 MB, ~73 MB zipped
```

That drops the 2,263 unit portrait cards — 98 MB of PNGs that do not compress — and
nothing else. Every page, table, stat and link survives; the unit pages just show a
missing image where the portrait was. Run `npm run wiki:check -- --without cards` to
verify that build, which skips the card links rather than reporting 6,727 of them broken.

The same folder is a GitHub Pages site as it stands — which is option (e) of
[docs/wiki-lfs-pages-decision.md](docs/wiki-lfs-pages-decision.md), and better than that
brief assumed: a static export has no LFS pointers to materialise, because the images are
copied as real files.

| Script | Does |
|---|---|
| `scripts/gen-ris-wiki*.js` | Generate the wiki markdown and the sortable HTML views |
| `scripts/verify-ris-wiki.js` | Verify the **markdown**: collisions, links, anchors, orphans |
| `scripts/serve-ris-wiki.js` | Local preview server; **owns the renderer**, which the exporter requires rather than reimplements |
| `scripts/build-ris-wiki-site.js` | Export to a standalone static site |
| `scripts/check-ris-wiki-site.js` | Verify the **export** the way `verify-ris-wiki.js` verifies the markdown |
| `scripts/probe-ris-wiki-site.js` | Load the export over `file://` in Chromium and report what really rendered |

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
