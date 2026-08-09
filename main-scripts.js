// ── Settlement Processor Suite, embedded in Provincia ───────────────────
// Ported from the standalone Suite's electron-gui/main.js. Registered onto
// Provincia's ipcMain under the `sps:` channel namespace (see registerScriptSuite
// at the bottom) so it never collides with Provincia's own channels. The Suite's
// own updater + app lifecycle are removed — Provincia owns those. Python is the
// bundled runtime (resolvePython), and the working dir lives under userData.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const pathSafety = require('./src/pathSafety.js');

// The Scripts child window (created on demand) and a getter for Provincia's
// currently-loaded mod (wired by registerScriptSuite).
let scriptsWin = null;
let hostModGetter = () => null;

// Stream an event to the Scripts window under the sps: namespace.
function sendToScripts(channel, payload) {
  if (scriptsWin && !scriptsWin.isDestroyed()) {
    scriptsWin.webContents.send('sps:' + channel, payload);
  }
}
// Parent for native dialogs invoked from the Scripts window.
function dialogParent() {
  return (scriptsWin && !scriptsWin.isDestroyed()) ? scriptsWin : null;
}

// Where the bundled .py + default config live, and the writable working dir.
//   dev:      scripts-suite-py/   (in the Provincia repo)
//   packaged: resources/app_data/ (electron-builder extraResources)
const SCRIPTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app_data')
  : path.join(__dirname, 'scripts-suite-py');

// Writable working dir (config/, processed_output/, rule_profiles/, .gui_prefs.json).
// Always under userData so it survives updates and isn't inside the asar.
const PROJECT_ROOT = path.join(app.getPath('userData'), 'scripts-suite', 'project');

// Containment check for renderer-supplied paths (mirrors main.js resolveInside).
// Every path the Suite renderer passes to read-file/write-file/read-output-file
// originates from OUR listings (list-scripts / list-config-files /
// get-latest-output), and those all hand out paths under PROJECT_ROOT — the
// .py scripts are seeded into it, config lives in config/, outputs in
// processed_output/. Mod-dir work goes through dedicated dataDir handlers, and
// save-file-as gets user consent via a dialog. So anything outside
// PROJECT_ROOT here is a forged/compromised-renderer request: reject it.
function insideProject(p) {
  return pathSafety.containedPath(PROJECT_ROOT, p);
}

// Resolve the Python interpreter for the .py pipeline.
// PACKAGED: the bundled runtime, falling back to PATH `python` — UNCHANGED
// legacy behavior (the runtime ships as an extraResource, so the fallback
// only ever triggers on a broken install).
// DEV (pinned 2026-07-15): a bare PATH `python` fallback silently picks up
// whatever shadows that name (wrong version, a venv, or a planted binary), so
// resolution is now explicit, in order:
//   1) repo python-runtime/ (populate via `npm run fetch-runtime`),
//   2) PROVINCIA_PYTHON env var (explicit pin to an interpreter path),
//   3) the Windows `py -3` launcher's registered interpreter (absolute path),
//   4) well-known absolute python3 locations (POSIX dev),
// and otherwise throws a clear error (surfaces to the Suite console via the
// rejected run-step IPC) instead of spawning an unpinned PATH lookup.
let cachedPython = null;
function resolvePython() {
  if (cachedPython) return cachedPython;
  const exe = process.platform === 'win32' ? 'python.exe' : path.join('bin', 'python3');
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'python-runtime', exe)
    : path.join(__dirname, 'python-runtime', exe);
  if (fs.existsSync(bundled)) return (cachedPython = bundled);
  if (app.isPackaged) return (cachedPython = 'python');
  const pinned = process.env.PROVINCIA_PYTHON;
  if (pinned && fs.existsSync(pinned)) return (cachedPython = pinned);
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('py', ['-3', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 10000 }).trim();
      if (out && fs.existsSync(out)) return (cachedPython = out);
    } catch { /* py launcher not installed — fall through to the error */ }
  } else {
    for (const p of ['/usr/local/bin/python3', '/opt/homebrew/bin/python3', '/usr/bin/python3']) {
      if (fs.existsSync(p)) return (cachedPython = p);
    }
  }
  throw new Error(
    'No Python interpreter found for the scripts suite. Run `npm run fetch-runtime` ' +
    'to fetch the bundled runtime, or set PROVINCIA_PYTHON to a python executable path.'
  );
}

// Seed the working dir from the bundle: refresh .py every launch (match the
// installed version) and add any missing default config files.
function seedProject() {
  try {
    if (!fs.existsSync(PROJECT_ROOT)) fs.mkdirSync(PROJECT_ROOT, { recursive: true });
    if (!fs.existsSync(SCRIPTS_DIR)) return;
    for (const file of fs.readdirSync(SCRIPTS_DIR)) {
      if (file.endsWith('.py')) {
        fs.copyFileSync(path.join(SCRIPTS_DIR, file), path.join(PROJECT_ROOT, file));
      }
    }
    const srcConfig = path.join(SCRIPTS_DIR, 'config');
    const destConfig = path.join(PROJECT_ROOT, 'config');
    if (fs.existsSync(srcConfig)) {
      if (!fs.existsSync(destConfig)) fs.mkdirSync(destConfig, { recursive: true });
      for (const file of fs.readdirSync(srcConfig)) {
        const dest = path.join(destConfig, file);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(srcConfig, file), dest);
      }
    }
  } catch (e) {
    console.warn('[scripts-suite] seed failed:', e.message);
  }
}

// Pipeline step definitions
const PIPELINE_STEPS = [
  { id: 'remove_defunct', name: 'Remove Defunct Buildings', script: 'remove_defunct.py', color: '#a8a29e' },
  { id: 'migrate_chain', name: 'Migrate Building Chain', script: 'migrate_chain.py', color: '#c084fc' },
  { id: 'hidden_resources', name: 'Hidden Resources', script: 'hidden_resources.py', color: '#e879f9' },
  { id: 'farms', name: 'Farms', script: 'farms.py', color: '#4ade80' },
  { id: 'heavy_industry', name: 'Heavy Industry', script: 'heavy_industry.py', color: '#9ca3af' },
  { id: 'sanitation', name: 'Sanitation', script: 'sanitation_healers.py', color: '#60a5fa' },
  { id: 'military', name: 'Military', script: 'mics.py', color: '#f87171' },
  { id: 'homelands', name: 'Homelands', script: 'homelands.py', color: '#c084fc' },
  { id: 'rural_exploits', name: 'Rural Exploits', script: 'rural_exploits.py', color: '#fb923c' },
  { id: 'urban_exploits', name: 'Urban Exploits', script: 'urban_exploits.py', color: '#facc15' },
  { id: 'port_authority', name: 'Port Authority', script: 'port_authority.py', color: '#38bdf8' },
  { id: 'settlement_processor', name: 'Core Buildings', script: 'settlement_processor.py', color: '#a78bfa' },
  { id: 'temples', name: 'Temples', script: 'temples.py', color: '#fbbf24' },
  { id: 'civic', name: 'Civic Buildings', script: 'civic.py', color: '#34d399' },
  { id: 'grain_exports', name: 'Grain Exports', script: 'grain_exports.py', color: '#eab308' },
  { id: 'starting_treasury', name: 'Starting Treasury', script: 'starting_treasury.py', color: '#10b981' },
  { id: 'slave_placer', name: 'Slave Placer', script: 'slave_placer.py', color: '#f472b6' },
  { id: 'port_mercenaries', name: 'Port Mercenaries', script: 'port_mercenaries.py', color: '#2dd4bf' },
];

// Create (or focus) the Scripts child window. Loads the Suite renderer that
// ships bundled at scripts-suite/index.html, via the namespaced preload.
function openScriptsWindow() {
  if (scriptsWin && !scriptsWin.isDestroyed()) { scriptsWin.show(); scriptsWin.focus(); return; }
  scriptsWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Settlement Processor — Provincia',
    // Match the renderer's light/dark theme (it follows prefers-color-scheme)
    // so there's no flash of the wrong ground on load, and the native
    // min/max/close glyphs stay readable in both modes. Dark uses the main
    // window's slate (#181a1b ground, #cfd6e0 glyphs — same as main.js).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181a1b' : '#ece2c8',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#26262800',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#cfd6e0' : '#6b5327',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload-scripts.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox on (2026-07-15): preload-scripts.js requires only "electron".
      sandbox: true,
    },
  });
  scriptsWin.setMenuBarVisibility(false);
  // Live-update the native overlay glyph colour when the OS theme flips
  // while the window is open (the renderer restyles itself via media query).
  const onThemeFlip = () => {
    if (!scriptsWin || scriptsWin.isDestroyed()) return;
    try {
      scriptsWin.setTitleBarOverlay({
        color: '#26262800',
        symbolColor: nativeTheme.shouldUseDarkColors ? '#cfd6e0' : '#6b5327',
        height: 40,
      });
    } catch (e) { /* not supported on this platform — renderer theme still applies */ }
  };
  nativeTheme.on('updated', onThemeFlip);
  scriptsWin.on('closed', () => nativeTheme.removeListener('updated', onThemeFlip));
  // Defense-in-depth: the Scripts window never opens child windows or
  // navigates away from its bundled document.
  scriptsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  scriptsWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });
  scriptsWin.loadFile(path.join(__dirname, 'scripts-suite', 'index.html'));
  scriptsWin.on('closed', () => { scriptsWin = null; });
  // Replay any pending sps:jump-to once the renderer is up — supports the
  // "click an EDB link in the main app and the Scripts window opens + jumps
  // straight to that line" flow in a single user action.
  scriptsWin.webContents.once('did-finish-load', () => {
    if (_pendingScriptsJump) {
      scriptsWin.webContents.send('sps:jump-to', _pendingScriptsJump);
      _pendingScriptsJump = null;
    }
  });
}

// ── IPC Handlers ──

ipcMain.handle('sps:get-pipeline-steps', () => PIPELINE_STEPS);
ipcMain.handle('sps:get-project-root', () => PROJECT_ROOT);

// 0.9.637: open a config file in the Scripts window's Monaco editor and
// optionally scroll to the first match of `searchText`. Used by the main
// Provincia app's "Open in editor" entry points (dev pill → EDB button,
// per-card jump-to buttons, etc.). If the Scripts window isn't open yet,
// the request is queued and replayed once the renderer is ready — so the
// first-open + jump-to path works in one click.
let _pendingScriptsJump = null;
// 0.9.641: Cross-reference scan. "Where is this used?" Given a token
// (chain name, level name, trait name, ancillary name, region name, …),
// walks every config file loaded into config/ and returns every line that
// matches it as a whole word. Used by the X-Ref dev-pill modal AND by the
// upcoming mod-validation dashboard to find dangling references.
ipcMain.handle('sps:xref-find', async (_, name) => {
  const empty = { byFile: {}, totalMatches: 0 };
  if (!name || typeof name !== 'string') return empty;
  const configDir = path.join(PROJECT_ROOT, 'config');
  // Loaded by MOD_FILE_MAP (+ migration extras). Each file gets its own
  // grouping in the result so the UI can show file → lines hierarchy.
  const FILES = [
    'export_descr_buildings.txt',
    'descr_strat.txt',
    'export_descr_character_traits.txt',
    'export_descr_ancillaries.txt',
    'export_buildings.txt',             // text/export_buildings.txt (localization)
    'descr_sm_factions.txt',
    'descr_regions.txt',
    'descr_win_conditions.txt',
    'chain_migration.txt',
    'defunct_buildings.txt',
  ];
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Token names use [A-Za-z0-9_]; \b works. Case-sensitive to match RTW's
  // own treatment (engines are case-sensitive on these tokens).
  const re = new RegExp(`\\b${safe}\\b`);
  const byFile = {};
  let total = 0;
  for (const f of FILES) {
    const p = path.join(configDir, f);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        // Strip leading whitespace, trim long lines so the UI stays scannable.
        const text = lines[i].replace(/^\s+/, '');
        hits.push({ line: i + 1, text: text.length > 220 ? text.slice(0, 217) + '…' : text });
      }
    }
    if (hits.length) { byFile[f] = hits; total += hits.length; }
  }
  return { byFile, totalMatches: total };
});

// 0.9.642: Mod-validation dashboard scanner — one pass that finds the
// most common consistency bugs across the loaded mod and groups them
// for the UI. Each issue carries a `file`/`line` pair so the dashboard
// can hand it off to scriptsJumpTo for a click-through fix.
//
// Checks (MVP):
//   1. Dangling EDB chain refs   — `building_present[_min_level] <X>` where
//                                   <X> has no `building <X>` block.
//   2. Dangling EDB level refs   — `building_present_min_level <chain> <lvl>`
//                                   where <chain> exists but <lvl> isn't one
//                                   of its declared levels.
//   3. descr_strat settlement    — `building { type <chain> <lvl> }` where
//      type errors                 <chain> doesn't exist OR <lvl> isn't a
//                                   level of <chain>.
//   4. Missing localization      — every declared EDB level whose `{<lvl>}`
//                                   key is missing from text/export_buildings.txt.
//   5. Orphaned chains           — `building <X>` blocks with zero external
//                                   refs AND zero descr_strat prebuilts
//                                   (candidates for removal).
// Encoding-aware mod-file reader (2026-08-03, user report). The engine's
// text/*.txt localisation files are UTF-16 LE **with BOM**, while the rule
// files (EDB, descr_strat, …) are 8-bit. Reading a UTF-16 file as UTF-8 yields
// a string where every character is followed by NUL, so `text.includes('{key}')`
// is false for EVERY key — that made the building-localisation audit report all
// 637 keys missing when they were present. Sniff the BOM and decode properly.
function readModText(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^﻿/, '');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { // UTF-16 BE: swap to LE, then decode
    const sw = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i + 1 < buf.length; i += 2) { sw[i] = buf[i + 1]; sw[i + 1] = buf[i]; }
    return sw.toString('utf16le').replace(/^﻿/, '');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  // No BOM: a UTF-16 LE file still shows NUL in every other byte of ASCII text.
  const probe = buf.slice(0, 512);
  let nulOdd = 0;
  for (let i = 1; i < probe.length; i += 2) if (probe[i] === 0) nulOdd++;
  if (probe.length > 8 && nulOdd > probe.length / 4) return buf.toString('utf16le');
  return buf.toString('utf8');
}

ipcMain.handle('sps:validate-mod', async (_evt, modDataDir) => {
  // Two sources for the validator's input files:
  //   (1) configDir: where the script suite's Scripts panel stages files.
  //       This is the historical source. Empty unless you've used Scripts.
  //   (2) modDataDir: the LIVE mod data dir (passed in from the dashboard
  //       useEffect — same path the other validators use). Falls back here
  //       when configDir doesn't have the file, so users who imported via
  //       the regular dev-pill Import flow (not Scripts) still get a full
  //       audit. Was a recurring teammate report.
  const configDir = path.join(PROJECT_ROOT, 'config');
  const read = (n) => {
    const cp = path.join(configDir, n);
    if (fs.existsSync(cp)) return readModText(cp);
    if (modDataDir) {
      // Most files live at modDataDir/<name>; descr_strat / win_conditions
      // live under world/maps/campaign/imperial_campaign/.
      const candidates = [
        path.join(modDataDir, n),
        path.join(modDataDir, 'world', 'maps', 'campaign', 'imperial_campaign', n),
        path.join(modDataDir, 'text', n),
      ];
      for (const p of candidates) if (fs.existsSync(p)) return readModText(p);
    }
    return null;
  };
  const summary = { danglingChains: 0, danglingLevels: 0, stratErrors: 0, missingLocale: 0, orphanedChains: 0, vcMalformed: 0, vcOrphanFactions: 0 };
  const out = { summary, danglingChains: [], danglingLevels: [], stratErrors: [], missingLocale: [], orphanedChains: [], vcMalformed: [], vcOrphanFactions: [] };
  try {
    const edb = read('export_descr_buildings.txt');
    if (!edb) return { ...out, error: 'export_descr_buildings.txt not loaded — open the Scripts panel to import the mod, or use the regular Import dialog with a modDataDir set.' };
    const buildings = parseEDB(edb);
    // Index chains + levels.
    const chainLevels = {};      // chain → Set<level>
    const chainLine = {};        // chain → declaration line number
    for (const b of buildings) {
      const lvls = b.rawLevelsLine ? b.rawLevelsLine.split(/\s+/).filter(Boolean) : b.levels.map(l => l.name);
      chainLevels[b.name] = new Set(lvls);
      chainLine[b.name] = b.line;
    }

    // Scan EDB lines for building_present[_min_level] refs.
    const edbLines = edb.split(/\r?\n/);
    const refsByChain = {};                                            // chain → ref count (for orphan detection)
    const chainSet = new Set(Object.keys(chainLevels));
    let currentBlock = null;
    let braceDepth = 0;
    for (let i = 0; i < edbLines.length; i++) {
      const raw = edbLines[i];
      const code = raw.split(';', 1)[0];
      // Track which chain block we're inside (so we can skip self-refs in
      // the orphan-detection ref count).
      const bm = code.match(/^\s*building\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (bm && braceDepth === 0) currentBlock = bm[1];
      braceDepth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
      if (braceDepth === 0) currentBlock = null;

      const mMl = code.match(/building_present_min_level\s+([A-Za-z_][A-Za-z0-9_+]*)\s+(\S+)/);
      if (mMl) {
        const [, chain, lvl] = mMl;
        if (!chainSet.has(chain)) {
          out.danglingChains.push({ chain, file: 'export_descr_buildings.txt', line: i + 1, text: code.trim().slice(0, 200) });
        } else {
          if (!chainLevels[chain].has(lvl)) {
            out.danglingLevels.push({ chain, level: lvl, file: 'export_descr_buildings.txt', line: i + 1, text: code.trim().slice(0, 200) });
          }
          if (chain !== currentBlock) refsByChain[chain] = (refsByChain[chain] || 0) + 1;
        }
        continue;
      }
      const mB = code.match(/building_present\s+([A-Za-z_][A-Za-z0-9_+]*)\b/);
      if (mB) {
        const chain = mB[1];
        if (!chainSet.has(chain)) {
          out.danglingChains.push({ chain, file: 'export_descr_buildings.txt', line: i + 1, text: code.trim().slice(0, 200) });
        } else if (chain !== currentBlock) {
          refsByChain[chain] = (refsByChain[chain] || 0) + 1;
        }
      }
    }

    // descr_strat settlement type errors + prebuilt counts (also feeds orphan check).
    const strat = read('descr_strat.txt');
    const prebuiltsByChain = {};
    if (strat) {
      const sLines = strat.split(/\r?\n/);
      let currentRegion = '(unknown)';
      for (let i = 0; i < sLines.length; i++) {
        const rm = sLines[i].match(/^\s*region\s+(\S+)/);
        if (rm) { currentRegion = rm[1]; continue; }
        const tm = sLines[i].match(/^\s*type\s+(\S+)\s+(\S+)/);
        if (!tm) continue;
        const [, chain, level] = tm;
        prebuiltsByChain[chain] = (prebuiltsByChain[chain] || 0) + 1;
        if (!chainSet.has(chain)) {
          out.stratErrors.push({ region: currentRegion, chain, level, issue: 'chain not in EDB', file: 'descr_strat.txt', line: i + 1, text: sLines[i].trim().slice(0, 200) });
        } else if (!chainLevels[chain].has(level)) {
          out.stratErrors.push({ region: currentRegion, chain, level, issue: `level not in chain's declared levels`, file: 'descr_strat.txt', line: i + 1, text: sLines[i].trim().slice(0, 200) });
        }
      }
    }

    // Localization gaps: every declared level should have a `{<level>}` key.
    const text = read('export_buildings.txt');
    if (text) {
      for (const [chain, lvls] of Object.entries(chainLevels)) {
        for (const lvl of lvls) {
          if (!text.includes(`{${lvl}}`)) out.missingLocale.push({ chain, level: lvl });
        }
      }
    }

    // Orphaned chains: declared, no EDB refs outside their own block, no prebuilts.
    for (const chain of chainSet) {
      const refs = refsByChain[chain] || 0;
      const prebuilts = prebuiltsByChain[chain] || 0;
      if (refs === 0 && prebuilts === 0) {
        out.orphanedChains.push({ chain, file: 'export_descr_buildings.txt', line: chainLine[chain] });
      }
    }

    // descr_win_conditions.txt: flag any non-canonical directive. Athens-style
    // `hold_region,` (singular, typo for hold_regions) silently kills every
    // faction's VC from that line onward in-game — RTW's parser bails. Anything
    // that isn't blank, a `;` comment, a bare lowercase faction-header, the
    // canonical `hold_regions ` / `take_regions ` / `short_campaign ` lines, or
    // the outlive-list line (multiple bare lowercase tokens) goes here.
    const wc = read('descr_win_conditions.txt');
    // Reuse the same descr_strat content the strat-errors check loaded above
    // (variable `strat`). If that pass didn't run for some reason, fall back
    // to reading it now — we need its faction list for the orphan check.
    const stratForFactions = (typeof strat !== 'undefined' && strat) ? strat : read('descr_strat.txt');
    if (wc) {
      const lines = wc.split(/\r?\n/);
      // Build the set of REAL playable factions from descr_strat — every
      // `faction <name>, ai_<...>` line — so we can flag any VC block whose
      // header doesn't correspond to a real faction. Indo_greeks-style orphans
      // make RTW's VC parser silently abandon the rest of the file → every
      // faction below the orphan loses its VC in-game.
      const stratFactions = new Set();
      if (stratForFactions) {
        for (const ln of stratForFactions.split(/\r?\n/)) {
          const m = ln.match(/^faction[ \t]+([a-z_0-9]+)[, \t]/);
          if (m) stratFactions.add(m[1]);
        }
      }
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const t = raw.trim();
        if (!t) continue;
        if (t.startsWith(';')) continue;
        // Faction header — but if descr_strat is loaded, ALSO verify it's a real faction.
        if (/^[a-z_0-9]+$/.test(t)) {
          if (stratFactions.size > 0 && !stratFactions.has(t)) {
            // Confirm it's actually a header (next non-blank line is hold_regions / take_regions),
            // so we don't false-flag a lone-faction outlive-list token.
            let next = '';
            for (let j = i + 1; j < lines.length; j++) { const nt = lines[j].trim(); if (nt) { next = nt; break; } }
            if (next.startsWith('hold_regions') || next.startsWith('take_regions')) {
              out.vcOrphanFactions.push({ faction: t, file: 'descr_win_conditions.txt', line: i + 1 });
            }
          }
          continue;
        }
        if (/^[a-z_0-9 ]+$/.test(t)) continue;                // outlive list
        if (/^hold_regions\s/.test(t)) continue;
        if (/^take_regions\s/.test(t)) continue;
        if (/^short_campaign\s/.test(t)) continue;
        out.vcMalformed.push({ file: 'descr_win_conditions.txt', line: i + 1, text: t.slice(0, 200) });
      }
    }

    summary.danglingChains = out.danglingChains.length;
    summary.danglingLevels = out.danglingLevels.length;
    summary.stratErrors = out.stratErrors.length;
    summary.missingLocale = out.missingLocale.length;
    summary.orphanedChains = out.orphanedChains.length;
    summary.vcMalformed = out.vcMalformed.length;
    summary.vcOrphanFactions = out.vcOrphanFactions.length;
    return out;
  } catch (e) {
    return { ...out, error: e.message };
  }
});

// Extra mod-data validators. Runs alongside the existing validate-mod IPC
// (which works from the config snapshot) but operates on the LIVE dataDir,
// so it sees the user's actual current state for things the snapshot
// doesn't cover. Returns parallel result sections; the UI can render each
// independently and the failure of one doesn't block the rest.
ipcMain.handle('sps:validate-mod-extra', async (_, dataDir) => {
  const out = {
    namelistEmpty: { issues: [], error: null },
    namelistSingle: { issues: [], error: null },
    stratTraitRefs: { issues: [], error: null },
    stratAncillaryRefs: { issues: [], error: null },
    stratUnitRefs: { issues: [], error: null },
    factionCulture: { issues: [], error: null },
    charSharedCoords: { issues: [], error: null },
    charNearCityTile: { issues: [], error: null },
    error: null,
  };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  const readUtf8 = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const readUtf16 = (p) => { try { return fs.readFileSync(p, 'utf16le').replace(/^﻿/, ''); } catch { return null; } };

  // ── 1+2. Namelist coverage: empty + single-entry lists that are referenced
  // by descr_sm_factions. (Single-entry _men/_women trigger random(0,0)
  // → min<=max Failed on captain auto-spawn.)
  try {
    const namelistText = readUtf8(path.join(dataDir, 'descr_namelists.txt'));
    const smText = readUtf8(path.join(dataDir, 'descr_sm_factions.txt'));
    if (namelistText && smText) {
      const nlSizes = {};
      {
        const lines = namelistText.split(/\r?\n/);
        let cur = null, inNames = false;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          const idM = ln.match(/^\s*"([a-z][a-z0-9_]*)"\s*:\s*$/i);
          if (idM && idM[1] !== 'namelists' && idM[1] !== 'names') {
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
              if (/^\s*\{/.test(lines[j])) { cur = idM[1]; nlSizes[cur] = 0; break; }
            }
            continue;
          }
          if (/^\s*"names"\s*:/.test(ln)) { inNames = true; continue; }
          if (inNames) {
            if (/^\s*\]/.test(ln)) { inNames = false; continue; }
            if (/^\s*"([^"]+)"/.test(ln) && cur) nlSizes[cur]++;
          }
        }
      }
      const facUses = {};  // namelistId → [{ faction, slot }]
      {
        const lines = smText.split(/\r?\n/);
        let cur = null, inNL = false;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          const fm = ln.match(/^\t"([a-z_0-9]+)":/);
          if (fm) { cur = fm[1]; inNL = false; continue; }
          if (/^\s*"namelists"\s*:/.test(ln)) { inNL = true; continue; }
          if (inNL) {
            if (/^\s*\}/.test(ln)) { inNL = false; continue; }
            const kv = ln.match(/^\s*"(men|women|surnames)"\s*:\s*"([^"]+)"/);
            if (kv && cur) {
              facUses[kv[2]] = facUses[kv[2]] || [];
              facUses[kv[2]].push({ faction: cur, slot: kv[1] });
            }
          }
        }
      }
      for (const [name, count] of Object.entries(nlSizes)) {
        const uses = facUses[name];
        if (!uses || uses.length === 0) continue; // unused, not a runtime bug
        if (count === 0) {
          out.namelistEmpty.issues.push({
            namelist: name,
            usedBy: uses.length,
            uses: uses.slice(0, 6),
          });
        } else if (count === 1) {
          out.namelistSingle.issues.push({
            namelist: name,
            usedBy: uses.length,
            uses: uses.slice(0, 6),
          });
        }
      }
    } else {
      if (!namelistText) out.namelistEmpty.error = 'descr_namelists.txt not found';
      if (!smText) out.namelistEmpty.error = (out.namelistEmpty.error || '') + ' descr_sm_factions.txt not found';
      out.namelistSingle.error = out.namelistEmpty.error;
    }
  } catch (e) {
    out.namelistEmpty.error = e.message;
    out.namelistSingle.error = e.message;
  }

  // ── 3+4+5. descr_strat references vs EDCT/EDA/EDU
  // We parse descr_strat for trait/ancillary/unit names and cross-check.
  const stratPath = path.join(dataDir, 'world', 'maps', 'campaign', 'imperial_campaign', 'descr_strat.txt');
  const stratText = readUtf8(stratPath);
  const loadTraitSet = () => {
    const t = readUtf8(path.join(dataDir, 'export_descr_character_traits.txt'));
    if (!t) return null;
    const set = new Set();
    for (const ln of t.split(/\r?\n/)) {
      const m = ln.match(/^\s*Trait\s+(\S+)/);
      if (m) set.add(m[1]);
    }
    return set;
  };
  const loadAncSet = () => {
    const t = readUtf8(path.join(dataDir, 'export_descr_ancillaries.txt'));
    if (!t) return null;
    const set = new Set();
    for (const ln of t.split(/\r?\n/)) {
      const m = ln.match(/^Ancillary\s+(\S+)/);
      if (m) set.add(m[1]);
    }
    return set;
  };
  const loadUnitSet = () => {
    const t = readUtf8(path.join(dataDir, 'export_descr_unit.txt'));
    if (!t) return null;
    const set = new Set();
    for (const ln of t.split(/\r?\n/)) {
      const m = ln.match(/^type\s+(.+?)\s*$/);
      if (m) set.add(m[1].trim());
    }
    return set;
  };
  try {
    if (stratText) {
      const stratLines = stratText.split(/\r?\n/);
      const traits = loadTraitSet();
      const ancs = loadAncSet();
      const units = loadUnitSet();
      // Walk descr_strat
      let currentFaction = null, currentChar = null;
      for (let i = 0; i < stratLines.length; i++) {
        const ln = stratLines[i];
        const fm = ln.match(/^faction\s+(\w+)/);
        if (fm) { currentFaction = fm[1]; currentChar = null; continue; }
        const cm = ln.match(/^character\s*,?\s*([^,]+),/);
        if (cm) { currentChar = cm[1].trim(); continue; }
        const tm = ln.match(/^\s*traits\s+(.+)$/);
        if (tm && traits) {
          for (const part of tm[1].split(',')) {
            const m = part.trim().match(/^(\S+)\s+\d+/);
            if (m && !traits.has(m[1])) {
              out.stratTraitRefs.issues.push({
                trait: m[1], faction: currentFaction, character: currentChar,
                file: 'descr_strat.txt', line: i + 1,
              });
            }
          }
        }
        const am = ln.match(/^\s*ancillaries\s+(.+)$/);
        if (am && ancs) {
          for (const part of am[1].split(',')) {
            const name = part.trim();
            if (name && !ancs.has(name)) {
              out.stratAncillaryRefs.issues.push({
                ancillary: name, faction: currentFaction, character: currentChar,
                file: 'descr_strat.txt', line: i + 1,
              });
            }
          }
        }
        const um = ln.match(/^\s*unit\s+(.+?)\s+exp\s+\d+/);
        if (um && units) {
          const unit = um[1].trim();
          if (!units.has(unit)) {
            out.stratUnitRefs.issues.push({
              unit, faction: currentFaction, character: currentChar,
              file: 'descr_strat.txt', line: i + 1,
            });
          }
        }
      }
      if (!traits) out.stratTraitRefs.error = 'export_descr_character_traits.txt not found';
      if (!ancs) out.stratAncillaryRefs.error = 'export_descr_ancillaries.txt not found';
      if (!units) out.stratUnitRefs.error = 'export_descr_unit.txt not found';
    } else {
      const err = 'descr_strat.txt not found at ' + stratPath;
      out.stratTraitRefs.error = err;
      out.stratAncillaryRefs.error = err;
      out.stratUnitRefs.error = err;
    }
  } catch (e) {
    const err = e.message;
    out.stratTraitRefs.error = out.stratTraitRefs.error || err;
    out.stratAncillaryRefs.error = out.stratAncillaryRefs.error || err;
    out.stratUnitRefs.error = out.stratUnitRefs.error || err;
  }

  // ── 6. Faction → culture cross-ref: each faction's culture must exist in descr_cultures
  try {
    const smText = readUtf8(path.join(dataDir, 'descr_sm_factions.txt'));
    const cultText = readUtf8(path.join(dataDir, 'descr_cultures.txt'));
    if (smText && cultText) {
      const knownCultures = new Set();
      {
        const lines = cultText.split(/\r?\n/);
        let cur = null;
        for (let i = 0; i < lines.length; i++) {
          const idM = lines[i].match(/^\s*"([a-z][a-z0-9_]*)"\s*:\s*$/i);
          if (idM && idM[1] !== 'cultures') {
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
              if (/^\s*\{/.test(lines[j])) { knownCultures.add(idM[1]); break; }
            }
          }
        }
      }
      const lines = smText.split(/\r?\n/);
      let cur = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^\t"([a-z_0-9]+)":/);
        if (fm) { cur = fm[1]; continue; }
        const cm = lines[i].match(/"culture"\s*:\s*"([a-z_0-9]+)"/);
        if (cm && cur && !knownCultures.has(cm[1])) {
          out.factionCulture.issues.push({
            faction: cur, culture: cm[1],
            file: 'descr_sm_factions.txt', line: i + 1,
          });
        }
      }
    } else {
      out.factionCulture.error = 'descr_sm_factions.txt or descr_cultures.txt not found';
    }
  } catch (e) { out.factionCulture.error = e.message; }

  // ── Characters sharing a map tile: two descr_strat characters at the same x,y
  // make the engine shift one at spawn — breaking governor-by-coordinates binding
  // and merging army stacks unpredictably. (User rule 2026-06-11.)
  try {
    const stratPath = path.join(dataDir, 'world', 'maps', 'campaign', 'imperial_campaign', 'descr_strat.txt');
    let stratText = null;
    try { stratText = fs.readFileSync(stratPath, 'latin1'); } catch { stratText = null; }
    if (stratText) {
      let fac = null;
      const byXY = {};
      for (const ln of stratText.split(/\r?\n/)) {
        const fm = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
        if (fm) { fac = fm[1]; continue; }
        if (!/^character,/.test(ln)) continue;
        const xm = ln.match(/x\s+(\d+)/), ym = ln.match(/y\s+(\d+)/);
        if (!xm || !ym) continue;
        const parts = ln.split(',').map(t => t.trim());
        const idx = /^sub_faction/.test(parts[1] || '') ? 2 : 1;
        const key = xm[1] + ',' + ym[1];
        (byXY[key] = byXY[key] || []).push({ faction: fac, name: parts[idx] || '?', type: (parts[idx + 1] || '').trim() });
      }
      for (const [xy, chars] of Object.entries(byXY)) {
        if (chars.length > 1) out.charSharedCoords.issues.push({ xy, characters: chars });
      }
      // MULTIPLE GENERALS IN ONE SETTLEMENT AT START (user rule 2026-06-11: a
      // settlement may hold only ONE general at campaign start — a second one gets
      // displaced by the engine and starts FLEEING, as seen with Armenia's Gorniai
      // and Thospia governors). City tile = the descr_regions city pixel
      // (buildRegionCoords, verified against ~800 rebel governors mod-wide).
      // ERROR: ≥2 named characters on one city tile. WARNING: a second same-faction
      // general within 1 tile of an occupied city tile (footprint collision risk).
      try {
        const dsg = require('./src/descrStratGeneral.js');
        const rtxt = fs.readFileSync(path.join(dataDir, 'world', 'maps', 'base', 'descr_regions.txt'), 'latin1');
        const { regionToCity, rgbToRegion } = dsg.parseDescrRegions(rtxt);
        const coords = dsg.buildRegionCoords(fs.readFileSync(path.join(dataDir, 'world', 'maps', 'base', 'map_regions.tga')), rgbToRegion);
        for (const r of Object.keys(coords)) {
          const ct = { city: regionToCity[r], x: coords[r].x, y: coords[r].y };
          const onTile = [], near = [];
          for (const [xy, chars] of Object.entries(byXY)) {
            const [cx, cy] = xy.split(',').map(Number);
            const d = Math.max(Math.abs(cx - ct.x), Math.abs(cy - ct.y));
            if (d === 0) onTile.push(...chars.map(c => ({ ...c, xy })));
            else if (d === 1) near.push(...chars.map(c => ({ ...c, xy })));
          }
          if (onTile.length > 1) {
            out.charNearCityTile.issues.push({ severity: 'error', city: ct.city, cityTile: ct.x + ',' + ct.y, characters: onTile, problem: onTile.length + ' generals inside at start (max 1 allowed — engine displaces the rest, they start FLEEING)' });
          } else if (onTile.length === 1 && near.some(n => n.faction === onTile[0].faction)) {
            out.charNearCityTile.issues.push({ severity: 'warning', city: ct.city, cityTile: ct.x + ',' + ct.y, characters: [...onTile, ...near.filter(n => n.faction === onTile[0].faction)], problem: 'second same-faction general adjacent to an occupied city tile' });
          }
        }
      } catch (e) { out.charNearCityTile.error = String((e && e.message) || e); }
    } else out.charSharedCoords.error = 'descr_strat not found';
  } catch (e) { out.charSharedCoords.error = String((e && e.message) || e); }

  return out;
});

// descr_sm_factions structural completeness. Each faction declaration
// should carry: namelists{men, women, surnames}, logos, colours, culture,
// movies. Missing any of these surfaces as engine warnings (silent
// fallback) or load errors. Reports per faction.
ipcMain.handle('sps:validate-sm-factions', async (_, dataDir) => {
  const out = { incomplete: [], summary: { total: 0, complete: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const smPath = path.join(dataDir, 'descr_sm_factions.txt');
    if (!fs.existsSync(smPath)) { out.error = 'descr_sm_factions.txt not found'; return out; }
    const lines = fs.readFileSync(smPath, 'utf8').split(/\r?\n/);
    const facBlocks = [];
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^\t"([a-z_0-9]+)":/);
      if (fm) facBlocks.push({ name: fm[1], start: i });
    }
    facBlocks.push({ start: lines.length });
    for (let i = 0; i < facBlocks.length - 1; i++) {
      const fac = facBlocks[i];
      out.summary.total++;
      const blockText = lines.slice(fac.start, facBlocks[i + 1].start).join('\n');
      const present = {
        culture: /"culture"\s*:/.test(blockText),
        men: /"men"\s*:\s*"\w+"/.test(blockText),
        women: /"women"\s*:\s*"\w+"/.test(blockText),
        surnames: /"surnames"\s*:\s*"\w+"/.test(blockText),
        logos: /"logos"\s*:/.test(blockText),
        colours: /"colours"\s*:/.test(blockText),
        movies: /"movies"\s*:/.test(blockText),
      };
      const missing = Object.entries(present).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length === 0) out.summary.complete++;
      else out.incomplete.push({ faction: fac.name, missing, line: fac.start + 1 });
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Log-noise scan. Reads RTW's message_log.txt and counts the
// engine-side / cosmetic patterns that aren't directly actionable but
// are useful to see at a glance. Also extracts the list of UNDEFINED
// script toggles the engine warned about (one of the few actionable
// log-only items — fix is to add console_command declarations).
ipcMain.handle('sps:scan-log-warnings', async (_, logPath) => {
  const out = {
    counts: {}, undefinedToggles: [], lostLocStrings: [], lastModified: null, error: null,
  };
  // Auto-pick the message log if not given.
  if (!logPath) {
    const candidates = [
      "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/logs/message_log.txt",
    ];
    for (const c of candidates) if (fs.existsSync(c)) { logPath = c; break; }
  }
  if (!logPath || !fs.existsSync(logPath)) { out.error = `message_log.txt not found (path=${logPath || 'auto'})`; return out; }
  try {
    out.lastModified = fs.statSync(logPath).mtime.toISOString();
    const text = fs.readFileSync(logPath, 'utf8');
    // Don't split into lines for the big patterns — count via regex matchAll
    // which is faster on multi-MB logs.
    const PATTERNS = {
      "min <= max Failed": /min <= max Failed/g,
      "recipient_get (AI diplomacy)": /recipient_get\(\) ==/g,
      "n < N Failed (array bounds)": /n < N Failed/g,
      "lowest_lod_id Failed": /lowest_lod_id Failed/g,
      "flee_dx assertion": /flee_dx >= -1/g,
      "uni_char_string length": /uni_char_string->length Failed/g,
      "income >= 0 Failed": /income >= 0 Failed/g,
      "STANDARD_TEXTUREs mip-map warning": /STANDARD_TEXTUREs do not support mip-map/g,
      "Building image missing (base)": /^Building image missing /gm,
      "Building constructed image missing": /Building constructed image missing/g,
      "Building preconstruction image missing": /Building preconstruction image missing/g,
      "Unit info image missing": /Unit info image .* missing/g,
      "Unit card image missing": /Unit card image .* missing/g,
      "Missing unit type string": /Missing unit type string/g,
      "record.m_card_path.is_valid Failed (CRASH-CLASS)": /record\.m_card_path\.is_valid\(\) Failed/g,
      "is_valid() Failed (CRASH-CLASS)": /^is_valid\(\) Failed$/gm,
    };
    for (const [label, re] of Object.entries(PATTERNS)) {
      out.counts[label] = (text.match(re) || []).length;
    }
    // Undefined script toggles
    const seen = new Set();
    for (const m of text.matchAll(/Toggle:\s*"([^"]+)"\s*is undefined/g)) seen.add(m[1]);
    out.undefinedToggles = [...seen].sort();
    // Missing localised strings (one-offs, but valid mod-side fix)
    const lost = new Set();
    for (const m of text.matchAll(/Warning:\s*localised string\s+(\S+)\s+does not exist/g)) lost.add(m[1]);
    out.lostLocStrings = [...lost].sort();
  } catch (e) { out.error = e.message; }
  return out;
});

// Texture dimensions check. RTW's STANDARD_TEXTUREs warning fires when a
// TGA isn't power-of-2. Mostly cosmetic (engine still loads them) but
// surface so the modder can resize. Scans data/ui/ancillaries_cards/
// and data/ui/<culture>/buildings/ since those are the main offenders.
ipcMain.handle('sps:validate-texture-dimensions', async (_, dataDir) => {
  const out = { nonPow2: [], summary: { scanned: 0, bad: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const uiDir = path.join(dataDir, 'ui');
    if (!fs.existsSync(uiDir)) { out.error = 'ui dir not found'; return out; }
    const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
    const readTgaDims = (filepath) => {
      try {
        const fd = fs.openSync(filepath, 'r');
        const buf = Buffer.alloc(18);
        fs.readSync(fd, buf, 0, 18, 0);
        fs.closeSync(fd);
        const w = buf.readUInt16LE(12);
        const h = buf.readUInt16LE(14);
        return { w, h };
      } catch { return null; }
    };
    // Scan dirs we care about
    const scanDirs = [
      path.join(uiDir, 'ancillaries_cards'),
      path.join(uiDir, 'ancillaries'),
    ];
    // Also each culture's buildings/
    try {
      for (const ent of fs.readdirSync(uiDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const skip = ['ancillaries','ancillaries_cards','captain banners','captain_banners','faction_icons','generic','pips','resources','unit_info','units','EVENTPICS'];
        if (skip.includes(ent.name)) continue;
        scanDirs.push(path.join(uiDir, ent.name, 'buildings'));
      }
    } catch {}
    for (const d of scanDirs) {
      if (!fs.existsSync(d)) continue;
      let files; try { files = fs.readdirSync(d); } catch { continue; }
      for (const f of files) {
        if (!/\.tga$/i.test(f)) continue;
        const full = path.join(d, f);
        const dims = readTgaDims(full);
        if (!dims) continue;
        out.summary.scanned++;
        if (!isPow2(dims.w) || !isPow2(dims.h)) {
          out.summary.bad++;
          if (out.nonPow2.length < 200) out.nonPow2.push({ file: f, dir: path.relative(dataDir, d).replace(/\\/g, '/'), w: dims.w, h: dims.h });
        }
      }
    }
    out.nonPow2.sort((a, b) => a.dir.localeCompare(b.dir) || a.file.localeCompare(b.file));
  } catch (e) { out.error = e.message; }
  return out;
});

// Unit image coverage. The engine looks per-faction for:
//   * `data/ui/unit_info/<faction>/<unit>_info.tga` — battle UI info panel
//   * `data/ui/units/<faction>/<unit>.tga`         — campaign UI unit card
// When a faction recruits/owns a unit that lacks its image, the engine
// logs "Unit info image ... missing" / "Unit card image ... missing".
// Surfaces dozens per save in RIS during AI auto-recruit. Validator lists
// gaps; auto-fix copies from any other faction that has the same unit.
ipcMain.handle('sps:validate-unit-images', async (_, dataDir) => {
  const out = { missingInfo: [], missingCard: [], summary: { totalUnits: 0, missingInfoCount: 0, missingCardCount: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const eduPath = path.join(dataDir, 'export_descr_unit.txt');
    const uiInfoDir = path.join(dataDir, 'ui', 'unit_info');
    const uiUnitsDir = path.join(dataDir, 'ui', 'units');
    if (!fs.existsSync(eduPath)) { out.error = 'export_descr_unit.txt not found'; return out; }
    // Parse EDU for type → ownership (factions)
    const eduText = fs.readFileSync(eduPath, 'utf8');
    const lines = eduText.split(/\r?\n/);
    const unitsByFaction = {}; // faction → Set of unitName (dictionary key)
    let curType = null, curDict = null;
    for (const ln of lines) {
      const tm = ln.match(/^type\s+(.+?)\s*$/);
      if (tm) { curType = tm[1].trim(); curDict = null; continue; }
      const dm = ln.match(/^dictionary\s+(\S+)/);
      if (dm) curDict = dm[1].trim();
      const om = ln.match(/^ownership\s+(.+)$/);
      if (om && curDict) {
        for (const f of om[1].split(',').map(s => s.trim()).filter(Boolean)) {
          if (f === 'slave' || f === 'mercenary' || f === 'all') continue;
          unitsByFaction[f] = unitsByFaction[f] || new Set();
          unitsByFaction[f].add(curDict);
        }
      }
    }
    // For each (faction, unit), check info + card files
    for (const [faction, units] of Object.entries(unitsByFaction)) {
      const fInfoDir = path.join(uiInfoDir, faction);
      const fCardDir = path.join(uiUnitsDir, faction);
      const infoSet = fs.existsSync(fInfoDir) ? new Set(fs.readdirSync(fInfoDir)) : new Set();
      const cardSet = fs.existsSync(fCardDir) ? new Set(fs.readdirSync(fCardDir)) : new Set();
      for (const u of units) {
        out.summary.totalUnits++;
        const infoFile = `${u}_info.tga`;
        const cardFile = `${u}.tga`;
        if (!infoSet.has(infoFile)) {
          out.missingInfo.push({ faction, unit: u, expected: `unit_info/${faction}/${infoFile}` });
          out.summary.missingInfoCount++;
        }
        if (!cardSet.has(cardFile)) {
          out.missingCard.push({ faction, unit: u, expected: `units/${faction}/${cardFile}` });
          out.summary.missingCardCount++;
        }
      }
    }
    out.missingInfo.sort((a, b) => a.faction.localeCompare(b.faction) || a.unit.localeCompare(b.unit));
    out.missingCard.sort((a, b) => a.faction.localeCompare(b.faction) || a.unit.localeCompare(b.unit));
  } catch (e) { out.error = e.message; }
  return out;
});

// Auto-fix: copy <unit>_info.tga and <unit>.tga from any faction that has
// them to factions that don't. Cross-faction crossover; modder can re-art
// later. Skips units with no source anywhere.
ipcMain.handle('sps:autofix-unit-images', async (_, dataDir) => {
  const out = { copied: 0, copies: [], skipped: [], error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const eduPath = path.join(dataDir, 'export_descr_unit.txt');
    const uiInfoDir = path.join(dataDir, 'ui', 'unit_info');
    const uiUnitsDir = path.join(dataDir, 'ui', 'units');
    if (!fs.existsSync(eduPath)) { out.error = 'export_descr_unit.txt not found'; return out; }
    const eduText = fs.readFileSync(eduPath, 'utf8');
    const lines = eduText.split(/\r?\n/);
    const unitsByFaction = {};
    let curDict = null;
    for (const ln of lines) {
      const tm = ln.match(/^type\s+(.+?)\s*$/);
      if (tm) { curDict = null; continue; }
      const dm = ln.match(/^dictionary\s+(\S+)/);
      if (dm) curDict = dm[1].trim();
      const om = ln.match(/^ownership\s+(.+)$/);
      if (om && curDict) {
        for (const f of om[1].split(',').map(s => s.trim()).filter(Boolean)) {
          if (f === 'all') continue;
          unitsByFaction[f] = unitsByFaction[f] || new Set();
          unitsByFaction[f].add(curDict);
        }
      }
    }
    // Build a per-unit donor index for info + card.
    const infoDonors = {}; // unitName → fullPath
    const cardDonors = {};
    if (fs.existsSync(uiInfoDir)) {
      for (const fac of fs.readdirSync(uiInfoDir)) {
        const dir = path.join(uiInfoDir, fac);
        try { for (const f of fs.readdirSync(dir)) {
          const m = f.match(/^(.+)_info\.tga$/i);
          if (m && !infoDonors[m[1]]) infoDonors[m[1]] = path.join(dir, f);
        } } catch {}
      }
    }
    if (fs.existsSync(uiUnitsDir)) {
      for (const fac of fs.readdirSync(uiUnitsDir)) {
        const dir = path.join(uiUnitsDir, fac);
        try { for (const f of fs.readdirSync(dir)) {
          const m = f.match(/^(.+)\.tga$/i);
          if (m && !cardDonors[m[1]]) cardDonors[m[1]] = path.join(dir, f);
        } } catch {}
      }
    }
    for (const [faction, units] of Object.entries(unitsByFaction)) {
      const fInfoDir = path.join(uiInfoDir, faction);
      const fCardDir = path.join(uiUnitsDir, faction);
      for (const u of units) {
        const infoFile = `${u}_info.tga`;
        const cardFile = `${u}.tga`;
        const infoDst = path.join(fInfoDir, infoFile);
        const cardDst = path.join(fCardDir, cardFile);
        if (!fs.existsSync(infoDst)) {
          if (infoDonors[u]) {
            try {
              if (!fs.existsSync(fInfoDir)) fs.mkdirSync(fInfoDir, { recursive: true });
              fs.copyFileSync(infoDonors[u], infoDst);
              out.copied++;
              if (out.copies.length < 50) out.copies.push({ to: `unit_info/${faction}/${infoFile}`, from: infoDonors[u] });
            } catch {}
          } else {
            out.skipped.push({ faction, unit: u, type: 'info' });
          }
        }
        if (!fs.existsSync(cardDst)) {
          if (cardDonors[u]) {
            try {
              if (!fs.existsSync(fCardDir)) fs.mkdirSync(fCardDir, { recursive: true });
              fs.copyFileSync(cardDonors[u], cardDst);
              out.copied++;
              if (out.copies.length < 50) out.copies.push({ to: `units/${faction}/${cardFile}`, from: cardDonors[u] });
            } catch {}
          } else {
            out.skipped.push({ faction, unit: u, type: 'card' });
          }
        }
      }
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Building image coverage. THREE classes of missing images:
//   (1) base `#<culture>_<chain>.tga` exists, but the `_constructed.tga`
//       variant is missing → engine logs "Building constructed image missing"
//   (2) base `#<culture>_<chain>.tga` exists, but the under-construction
//       variant at `buildings/construction/#<culture>_<chain>.tga` is
//       missing → "Building preconstruction image missing"
//   (3) the base file ITSELF is missing for this culture (the chain exists
//       in EDB and a same-culture faction tries to build it) → "Building
//       image missing". Auto-fix needs a different-culture donor for the
//       same chain.
// Live log surfaced all three on the all-AI Dummies run.
ipcMain.handle('sps:validate-building-images', async (_, dataDir) => {
  const out = { missing: [], summary: { totalChecked: 0, missingConstructed: 0, missingPreconstruction: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const uiDir = path.join(dataDir, 'ui');
    if (!fs.existsSync(uiDir)) { out.error = `ui dir not found`; return out; }
    const cultures = fs.readdirSync(uiDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !['ancillaries','ancillaries_cards','captain banners','captain_banners','faction_icons','generic','pips','resources','unit_info','units','EVENTPICS'].includes(e.name))
      .map(e => e.name);
    for (const culture of cultures) {
      const bDir = path.join(uiDir, culture, 'buildings');
      if (!fs.existsSync(bDir)) continue;
      let files;
      try { files = fs.readdirSync(bDir); } catch { continue; }
      const set = new Set(files);
      // Preconstruction dir is buildings/construction/
      const preDir = path.join(bDir, 'construction');
      let preSet = new Set();
      if (fs.existsSync(preDir)) {
        try { preSet = new Set(fs.readdirSync(preDir)); } catch {}
      }
      for (const f of files) {
        const m = f.match(new RegExp(`^#${culture}_(.+)\\.tga$`, 'i'));
        if (!m || /_constructed$/.test(m[1])) continue;
        out.summary.totalChecked++;
        const constructed = `#${culture}_${m[1]}_constructed.tga`;
        const missingC = !set.has(constructed) && !set.has(constructed.toLowerCase());
        const preconstructed = `#${culture}_${m[1]}.tga`;
        const missingP = !preSet.has(preconstructed) && !preSet.has(preconstructed.toLowerCase());
        if (missingC) out.summary.missingConstructed++;
        if (missingP) out.summary.missingPreconstruction++;
        if (missingC || missingP) {
          out.missing.push({
            culture, chain: m[1],
            missingConstructed: missingC,
            missingPreconstruction: missingP,
          });
        }
      }
    }
    out.missing.sort((a, b) => a.culture.localeCompare(b.culture) || a.chain.localeCompare(b.chain));
  } catch (e) { out.error = e.message; }
  return out;
});

// Auto-fix: three-class building-image seeder.
//   (1) Missing _constructed slot → copy from base #<culture>_<chain>.tga (same culture)
//   (2) Missing buildings/construction/ slot → copy from base (same culture)
//   (3) Missing base image entirely → find any OTHER culture with that
//       chain's image and copy it (cosmetic crossover, modder can re-art
//       later). Skips chains absent in every culture (engine doesn't want
//       those for any faction).
ipcMain.handle('sps:autofix-building-images', async (_, dataDir) => {
  const out = { copied: 0, copies: [], error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const uiDir = path.join(dataDir, 'ui');
    if (!fs.existsSync(uiDir)) { out.error = `ui dir not found`; return out; }
    const cultures = fs.readdirSync(uiDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !['ancillaries','ancillaries_cards','captain banners','captain_banners','faction_icons','generic','pips','resources','unit_info','units','EVENTPICS'].includes(e.name))
      .map(e => e.name);
    // First pass: build the UNION of all <chain>s that any culture has.
    // Also remember which cultures have each chain (donor candidates for #3).
    const chainDonors = {}; // chain → [{culture, path}, ...]
    for (const culture of cultures) {
      const bDir = path.join(uiDir, culture, 'buildings');
      if (!fs.existsSync(bDir)) continue;
      let files; try { files = fs.readdirSync(bDir); } catch { continue; }
      for (const f of files) {
        const m = f.match(new RegExp(`^#${culture}_(.+)\\.tga$`, 'i'));
        if (!m || /_constructed$/.test(m[1])) continue;
        const chain = m[1];
        chainDonors[chain] = chainDonors[chain] || [];
        chainDonors[chain].push({ culture, path: path.join(bDir, f) });
      }
    }
    // Pass 2: for each culture, seed missing constructed + preconstruction
    // for its OWN base images, plus copy from donor culture for any chain
    // absent in this culture but present elsewhere.
    for (const culture of cultures) {
      const bDir = path.join(uiDir, culture, 'buildings');
      if (!fs.existsSync(bDir)) {
        // Skip cultures that have no buildings dir at all — unlikely to
        // be a real culture that needs auto-seeded crossovers.
        continue;
      }
      let files; try { files = fs.readdirSync(bDir); } catch { continue; }
      const set = new Set(files);
      const preDir = path.join(bDir, 'construction');
      let preSet = new Set();
      if (fs.existsSync(preDir)) { try { preSet = new Set(fs.readdirSync(preDir)); } catch {} }
      // (1) + (2) — for existing base images in this culture.
      for (const f of files) {
        const m = f.match(new RegExp(`^#${culture}_(.+)\\.tga$`, 'i'));
        if (!m || /_constructed$/.test(m[1])) continue;
        const constructed = `#${culture}_${m[1]}_constructed.tga`;
        if (!set.has(constructed)) {
          try {
            fs.copyFileSync(path.join(bDir, f), path.join(bDir, constructed));
            out.copied++;
            if (out.copies.length < 50) out.copies.push({ from: f, to: constructed });
          } catch {}
        }
        const preconstructed = `#${culture}_${m[1]}.tga`;
        if (!preSet.has(preconstructed)) {
          try {
            if (!fs.existsSync(preDir)) fs.mkdirSync(preDir, { recursive: true });
            fs.copyFileSync(path.join(bDir, f), path.join(preDir, preconstructed));
            out.copied++;
            if (out.copies.length < 50) out.copies.push({ from: f, to: `construction/${preconstructed}` });
          } catch {}
        }
      }
      // (3) — for chains this culture doesn't have, but another does.
      for (const [chain, donors] of Object.entries(chainDonors)) {
        const expected = `#${culture}_${chain}.tga`;
        if (set.has(expected)) continue; // already there
        const donor = donors.find(d => d.culture !== culture);
        if (!donor) continue;
        try {
          fs.copyFileSync(donor.path, path.join(bDir, expected));
          out.copied++;
          if (out.copies.length < 50) out.copies.push({ from: `${donor.culture}/${path.basename(donor.path)}`, to: `${culture}/buildings/${expected}` });
          // Also seed its constructed + preconstruction since base is brand-new.
          const constructed = `#${culture}_${chain}_constructed.tga`;
          try { fs.copyFileSync(donor.path, path.join(bDir, constructed)); out.copied++; } catch {}
          try {
            if (!fs.existsSync(preDir)) fs.mkdirSync(preDir, { recursive: true });
            fs.copyFileSync(donor.path, path.join(preDir, expected));
            out.copied++;
          } catch {}
        } catch {}
      }
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Unit localization coverage. CORRECTED 2026-08-03 (user report): the lookup
// key is the EDU entry's `dictionary` line, NOT its `type` line. `type` is the
// internal unit id (spaces, referenced by descr_strat/EDB); `dictionary` names
// the text/export_units.txt entry supplying {key}, {key_descr}, {key_descr_short}
// — i.e. the unit's name, description and unit card. Auditing by `type` flagged
// every unit on this mod (1691 false positives on RIS, 3 real) because no type
// with spaces can match a token. Several types legitimately SHARE one dictionary
// (e.g. "roman leves" and "aor roman leves" both use roman_leves), so findings
// are grouped by dictionary key with the types listed, not repeated per type.
ipcMain.handle('sps:validate-unit-localization', async (_, dataDir) => {
  const out = { missing: [], summary: { totalUnits: 0, totalKeys: 0, missingNames: 0, missingDescr: 0, missingDescrShort: 0, noDictionary: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const eduPath = path.join(dataDir, 'export_descr_unit.txt');
    const locPath = path.join(dataDir, 'text', 'export_units.txt');
    if (!fs.existsSync(eduPath)) { out.error = 'export_descr_unit.txt not found'; return out; }
    if (!fs.existsSync(locPath)) { out.error = 'text/export_units.txt not found'; return out; }
    const eduText = fs.readFileSync(eduPath, 'utf8');
    // Walk entries: `type <id>` opens one, the FIRST following `dictionary <key>`
    // belongs to it. Comments after the key (`dictionary roman_leves ; Leves`)
    // are excluded by matching a non-space run.
    const entries = [];
    let cur = null;
    for (const ln of eduText.split(/\r?\n/)) {
      let m = ln.match(/^type\s+(.+?)\s*$/);
      if (m) { cur = { type: m[1].trim(), dict: null }; entries.push(cur); continue; }
      m = ln.match(/^dictionary\s+(\S+)/);
      if (m && cur && !cur.dict) cur.dict = m[1].trim();
    }
    out.summary.totalUnits = entries.length;
    // export_units.txt is UTF-16 LE. Extract every {token} into a Set.
    const locText = readModText(locPath); // UTF-16 LE w/ BOM in practice; sniffed
    const locTokens = new Set();
    for (const m of locText.matchAll(/\{([^}]+)\}/g)) locTokens.add(m[1]);
    // Group the types that share each dictionary key.
    const byKey = new Map();
    for (const e of entries) {
      if (!e.dict) { out.summary.noDictionary++; continue; } // no dictionary line = nothing to resolve
      const g = byKey.get(e.dict) || (byKey.set(e.dict, []), byKey.get(e.dict));
      g.push(e.type);
    }
    out.summary.totalKeys = byKey.size;
    // Near-miss suggestion: a missing key is usually a TYPO on one side rather
    // than an absent string (RIS: EDU wants legio_vii_paterna_macedonica_early,
    // the text file spells it ...macedonia_early). Offer the closest existing
    // base token so the fix is obvious. Only computed for the few missing keys.
    const baseTokens = [...locTokens].filter((t) => !/_descr(_short)?$/.test(t));
    const editDist = (a, b, cap) => {
      if (Math.abs(a.length - b.length) > cap) return cap + 1;
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const row = [i]; let best = i;
        for (let j = 1; j <= b.length; j++) {
          const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          row.push(v); if (v < best) best = v;
        }
        if (best > cap) return cap + 1;
        prev = row;
      }
      return prev[b.length];
    };
    for (const [key, types] of byKey) {
      const missingParts = [];
      if (!locTokens.has(key)) { missingParts.push('name'); out.summary.missingNames++; }
      if (!locTokens.has(key + '_descr')) { missingParts.push('descr'); out.summary.missingDescr++; }
      if (!locTokens.has(key + '_descr_short')) { missingParts.push('descr_short'); out.summary.missingDescrShort++; }
      if (missingParts.length === 0) continue;
      let suggest = null;
      if (!locTokens.has(key)) {
        const CAP = Math.max(2, Math.min(4, Math.floor(key.length / 6)));
        let bestD = CAP + 1;
        for (const t of baseTokens) {
          const d = editDist(key, t, CAP);
          if (d < bestD) { bestD = d; suggest = t; if (d === 1) break; }
        }
        if (bestD > CAP) suggest = null;
      }
      out.missing.push({ unit: key, key, types, missing: missingParts, suggest });
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// EDB hidden_resource cross-ref. EDB recruitment uses `hidden_resource X`
// to gate recruit lines on tile state. If X is `aor_thracian` but descr_regions
// has no `aor_thracian` tag (e.g. typo, faction renamed), the recruit line
// is dead code — silently never fires. Surface as warnings.
ipcMain.handle('sps:validate-edb-resources', async (_, dataDir) => {
  const out = { missingResources: [], summary: { totalRefs: 0, missingCount: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const regsPath = path.join(dataDir, 'world', 'maps', 'base', 'descr_regions.txt');
    const edbPath = path.join(dataDir, 'export_descr_buildings.txt');
    if (!fs.existsSync(regsPath)) { out.error = 'descr_regions.txt not found'; return out; }
    if (!fs.existsSync(edbPath)) { out.error = 'export_descr_buildings.txt not found'; return out; }
    // Build set of valid hidden_resource names from BOTH descr_regions
    // AND descr_sm_resources.txt. The latter declares the canonical
    // resource list (terrain types, hidden tags, mineable goods, etc.);
    // descr_regions just references them per-tile.
    const regsText = fs.readFileSync(regsPath, 'utf8');
    const validRes = new Set();
    for (const m of regsText.matchAll(/\b(aor_\w+|homeland_\w+|rel_\w+)\b/g)) validRes.add(m[1]);
    for (const m of regsText.matchAll(/^\t([a-z_0-9, ]+)$/gm)) {
      for (const tok of m[1].split(/\s*,\s*/)) if (tok && /^[a-z_0-9]+$/.test(tok)) validRes.add(tok);
    }
    // descr_sm_resources.txt: each `"<name>": {` is a top-level resource.
    const smResPath = path.join(dataDir, 'descr_sm_resources.txt');
    if (fs.existsSync(smResPath)) {
      const smResText = fs.readFileSync(smResPath, 'utf8');
      const smLines = smResText.split(/\r?\n/);
      for (let i = 0; i < smLines.length; i++) {
        const idM = smLines[i].match(/^\s*"([a-z][a-z0-9_]*)"\s*:\s*$/i);
        if (idM && idM[1] !== "resources") {
          for (let j = i + 1; j < Math.min(i + 4, smLines.length); j++) {
            if (/^\s*\{/.test(smLines[j])) { validRes.add(idM[1]); break; }
          }
        }
      }
    }
    // Whitelist engine-builtin resource names that don't appear in either
    // descr_regions or descr_sm_resources (RTW provides these implicitly).
    const isBuiltin = (res) => /^farm(\d+)?$/.test(res);
    // Walk EDB, find every hidden_resource X.
    const edbText = fs.readFileSync(edbPath, 'utf8');
    const seen = new Map();  // resource → [lines]
    const edbLines = edbText.split(/\r?\n/);
    for (let i = 0; i < edbLines.length; i++) {
      const ln = edbLines[i];
      const code = ln.split(';', 1)[0];
      for (const m of code.matchAll(/hidden_resource\s+([a-z_0-9]+)/g)) {
        out.summary.totalRefs++;
        const res = m[1];
        if (!validRes.has(res) && !isBuiltin(res)) {
          seen.set(res, seen.get(res) || []);
          seen.get(res).push(i + 1);
        }
      }
    }
    for (const [res, lines] of seen) {
      out.missingResources.push({ resource: res, refCount: lines.length, firstLine: lines[0] });
      out.summary.missingCount += lines.length;
    }
    out.missingResources.sort((a, b) => b.refCount - a.refCount || a.resource.localeCompare(b.resource));
  } catch (e) { out.error = e.message; }
  return out;
});

// AOR coverage report. Scans descr_regions for all `aor_X` tags, counts
// how many regions each covers, and returns the list. The renderer
// compares against its PRIMARY_AOR_TO_FACTION + SECONDARY_AOR_TO_FACTION
// constants to surface uncovered tags. Provincia-side decision (which to
// promote to primary), so we just enumerate; classification is the
// renderer's job.
ipcMain.handle('sps:aor-coverage', async (_, dataDir) => {
  const out = { aors: [], error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const regsPath = path.join(dataDir, 'world', 'maps', 'base', 'descr_regions.txt');
    if (!fs.existsSync(regsPath)) { out.error = 'descr_regions.txt not found'; return out; }
    const text = fs.readFileSync(regsPath, 'utf8');
    const counts = {};
    const re = /aor_(\w+)/g;
    let m;
    while ((m = re.exec(text)) !== null) counts[m[1]] = (counts[m[1]] || 0) + 1;
    out.aors = Object.entries(counts).map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  } catch (e) { out.error = e.message; }
  return out;
});

// descr_regions consistency check. Three classes of issues:
//   1. Regions in descr_strat that don't exist in descr_regions
//   2. Settlements in descr_strat that don't match the named settlement of
//      their declared region in descr_regions
//   3. Duplicate region pixel-colors in descr_regions (engine crash on load)
ipcMain.handle('sps:validate-descr-regions', async (_, dataDir) => {
  const out = { stratMissingRegion: [], stratWrongSettlement: [], duplicateColors: [], orphanRegions: [], error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const regsPath = path.join(dataDir, 'world', 'maps', 'base', 'descr_regions.txt');
    const stratPath = path.join(dataDir, 'world', 'maps', 'campaign', 'imperial_campaign', 'descr_strat.txt');
    if (!fs.existsSync(regsPath)) { out.error = `descr_regions.txt not found at ${regsPath}`; return out; }
    if (!fs.existsSync(stratPath)) { out.error = `descr_strat.txt not found at ${stratPath}`; return out; }

    // Parse descr_regions blocks. Format: each region is 5 non-blank lines —
    // region_name, settlement_name, faction, hidden_resources, tile_color_rgb.
    const regs = {};  // regionName → { settlement, color, line }
    const regsLines = fs.readFileSync(regsPath, 'utf8').split(/\r?\n/);
    let i = 0;
    while (i < regsLines.length) {
      const ln = regsLines[i];
      if (!ln || ln.startsWith(';') || ln.startsWith('\t')) { i++; continue; }
      // Non-tab line = region name. Walk to gather subsequent tabbed lines.
      const name = ln.trim();
      const block = { settlement: null, color: null, line: i + 1 };
      let j = i + 1;
      let tabIdx = 0;
      while (j < regsLines.length && (regsLines[j].startsWith('\t') || !regsLines[j].trim() || regsLines[j].startsWith(';'))) {
        const t = regsLines[j].trim();
        if (t && !t.startsWith(';')) {
          if (tabIdx === 0) block.settlement = t;
          else if (tabIdx === 3) block.color = t;  // 4th tabbed entry is color
          tabIdx++;
        }
        j++;
      }
      if (name && name !== 'Terra_Incognita') regs[name] = block;
      i = j;
    }
    // Duplicate color detection
    const colorMap = {};
    for (const [name, r] of Object.entries(regs)) {
      if (!r.color) continue;
      colorMap[r.color] = colorMap[r.color] || [];
      colorMap[r.color].push({ region: name, line: r.line });
    }
    for (const [col, regions] of Object.entries(colorMap)) {
      if (regions.length > 1) {
        out.duplicateColors.push({ color: col, regions });
      }
    }
    // descr_strat region/settlement cross-check
    const stratLines = fs.readFileSync(stratPath, 'utf8').split(/\r?\n/);
    let curRegion = null;
    const stratRegionUsage = new Set();
    for (let k = 0; k < stratLines.length; k++) {
      const ln = stratLines[k];
      const rm = ln.match(/^\s*region\s+(\S+)/);
      if (rm) {
        curRegion = rm[1];
        stratRegionUsage.add(curRegion);
        if (!regs[curRegion]) {
          out.stratMissingRegion.push({ region: curRegion, file: 'descr_strat.txt', line: k + 1 });
        }
        continue;
      }
      // settlement under `creator <faction>` then `region <name>` is usually
      // followed by `; <CityName>` and `	settlement / { city <Name>` etc.
      // For a quick check, look at lines like `\t\tcity <Name>` after `region`.
      const cm = ln.match(/^\s*city\s+(\S+)/);
      if (cm && curRegion && regs[curRegion] && regs[curRegion].settlement && cm[1] !== regs[curRegion].settlement) {
        out.stratWrongSettlement.push({
          region: curRegion,
          stratSays: cm[1],
          regionsExpects: regs[curRegion].settlement,
          file: 'descr_strat.txt', line: k + 1,
        });
      }
    }
    // Orphan regions: in descr_regions but not used by descr_strat
    for (const name of Object.keys(regs)) {
      if (!stratRegionUsage.has(name)) {
        out.orphanRegions.push({ region: name, settlement: regs[name].settlement, file: 'descr_regions.txt', line: regs[name].line });
      }
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Check that every settlement in descr_strat has `building { type
// hinterland_region region_base }`. The engine doesn't loudly complain when
// it's missing, but the region scroll then renders without the base
// siege/blockade/empire-size effects — easy to ship a region with the
// building stripped during edits.
ipcMain.handle('sps:validate-region-scrolls', async (_, dataDir) => {
  const out = { missing: [], total: 0, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const stratPath = path.join(dataDir, 'world', 'maps', 'campaign', 'imperial_campaign', 'descr_strat.txt');
    if (!fs.existsSync(stratPath)) { out.error = `descr_strat.txt not found at ${stratPath}`; return out; }
    const lines = fs.readFileSync(stratPath, 'utf8').split(/\r?\n/);
    // Walk settlement blocks. A settlement starts with `settlement` and ends
    // at the next matching closing brace; capture region name + scan for the
    // `type hinterland_region region_base` line within.
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (!/^\s*settlement\b/.test(ln)) { i++; continue; }
      // Walk to opening brace, then track depth to find the matching close.
      let j = i + 1;
      while (j < lines.length && !/^\s*\{/.test(lines[j])) j++;
      if (j >= lines.length) break;
      let depth = 1; j++;
      const blockStart = i;
      let region = null;
      let hasRegionBase = false;
      for (; j < lines.length && depth > 0; j++) {
        const t = lines[j];
        if (/\{/.test(t)) depth += (t.match(/\{/g) || []).length;
        if (/\}/.test(t)) depth -= (t.match(/\}/g) || []).length;
        if (depth < 0) break;
        const rm = t.match(/^\s*region\s+(\S+)/);
        if (rm) region = rm[1];
        // Match `type hinterland_region region_base` regardless of leading
        // whitespace. We don't require it to be on its own line because
        // RTW's parser tolerates both.
        if (/\btype\s+hinterland_region\s+region_base\b/.test(t)) hasRegionBase = true;
      }
      out.total++;
      if (!hasRegionBase) {
        out.missing.push({ region: region || '(unknown region)', line: blockStart + 1 });
      }
      i = j;
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Auto-fix: seed `data/ui/<target>/portraits/portraits/{young,old}/` for
// every broken target culture by copying tgas from any culture that has
// them populated. Mirrors the manual fix run earlier. Backs up nothing —
// pure copy-if-missing.
ipcMain.handle('sps:autofix-portraits', async (_, dataDir) => {
  const out = { copied: 0, sources: [], missingDonor: [], error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const uiDir = path.join(dataDir, 'ui');
    const cultDir = path.join(dataDir, 'descr_cultures.txt');
    if (!fs.existsSync(uiDir)) { out.error = `ui dir not found at ${uiDir}`; return out; }
    if (!fs.existsSync(cultDir)) { out.error = `descr_cultures.txt not found`; return out; }
    // Parse target cultures (portrait mapping targets)
    const text = fs.readFileSync(cultDir, 'utf8');
    const lines = text.split(/\r?\n/);
    const mapping = {};
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const code = lines[i].split(';;', 1)[0];
      const idM = code.match(/^\s*"([a-z][a-z0-9_]*)"\s*:\s*$/i);
      if (idM && idM[1] !== "cultures") {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (/^\s*\{/.test(lines[j])) { cur = idM[1]; break; }
        }
        continue;
      }
      const pmM = code.match(/"portrait mapping"\s*:\s*"([a-z][a-z0-9_]*)"/i);
      if (pmM && cur) mapping[cur] = pmM[1];
    }
    const targets = [...new Set(Object.values(mapping))];
    // Find a donor culture with populated young/old dirs (case-tolerant).
    const findPopulated = () => {
      for (const ent of fs.readdirSync(uiDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        // Try both "portraits" and "Portraits"
        for (const p of ['portraits', 'Portraits']) {
          const young = path.join(uiDir, ent.name, p, 'portraits', 'young');
          const old = path.join(uiDir, ent.name, p, 'portraits', 'old');
          if (fs.existsSync(young) && fs.existsSync(old)) {
            const yCount = fs.readdirSync(young).filter(f => /\.tga$/i.test(f)).length;
            const oCount = fs.readdirSync(old).filter(f => /\.tga$/i.test(f)).length;
            if (yCount > 0 && oCount > 0) return { culture: ent.name, youngDir: young, oldDir: old };
          }
        }
        // Also try scythian-style 1portraits/cards
        const cardsY = path.join(uiDir, ent.name, '1portraits', 'cards', 'young', 'generals');
        const cardsO = path.join(uiDir, ent.name, '1portraits', 'cards', 'old', 'generals');
        if (fs.existsSync(cardsY) && fs.existsSync(cardsO)) {
          const yCount = fs.readdirSync(cardsY).filter(f => /\.tga$/i.test(f)).length;
          const oCount = fs.readdirSync(cardsO).filter(f => /\.tga$/i.test(f)).length;
          if (yCount > 0 && oCount > 0) return { culture: ent.name, youngDir: cardsY, oldDir: cardsO };
        }
      }
      return null;
    };
    const donor = findPopulated();
    if (!donor) { out.error = 'no culture has populated young/old portraits to use as donor'; return out; }
    out.donor = { culture: donor.culture, youngDir: donor.youngDir, oldDir: donor.oldDir };
    for (const target of targets) {
      const tgtYoung = path.join(uiDir, target, 'portraits', 'portraits', 'young');
      const tgtOld = path.join(uiDir, target, 'portraits', 'portraits', 'old');
      fs.mkdirSync(tgtYoung, { recursive: true });
      fs.mkdirSync(tgtOld, { recursive: true });
      let copied = 0;
      for (const f of fs.readdirSync(donor.youngDir)) {
        if (!/\.tga$/i.test(f)) continue;
        const dst = path.join(tgtYoung, f);
        if (fs.existsSync(dst)) continue;
        fs.copyFileSync(path.join(donor.youngDir, f), dst);
        copied++;
      }
      for (const f of fs.readdirSync(donor.oldDir)) {
        if (!/\.tga$/i.test(f)) continue;
        const dst = path.join(tgtOld, f);
        if (fs.existsSync(dst)) continue;
        fs.copyFileSync(path.join(donor.oldDir, f), dst);
        copied++;
      }
      out.sources.push({ target, copied });
      out.copied += copied;
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Auto-fix: seed missing captain banner files from a same-culture donor
// faction. Mirrors the manual fix run earlier on RIS (104 missing factions
// → 395 files copied from same-culture donors). Backs up nothing — pure
// copy-if-missing, never overwrites. Returns { copied: N, copies: [...],
// noDonor: [...], error }.
ipcMain.handle('sps:autofix-captain-banners', async (_, dataDir) => {
  const out = { copied: 0, copies: [], noDonor: [], error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const cbDir = path.join(dataDir, 'ui', 'captain banners');
    const smPath = path.join(dataDir, 'descr_sm_factions.txt');
    if (!fs.existsSync(cbDir)) { out.error = `captain banners dir not found at ${cbDir}`; return out; }
    if (!fs.existsSync(smPath)) { out.error = 'descr_sm_factions.txt not found'; return out; }
    const smText = fs.readFileSync(smPath, 'utf8');
    // Parse faction → culture map
    const facCulture = {};
    let cur = null;
    for (const ln of smText.split(/\r?\n/)) {
      const fm = ln.match(/^\t"([a-z_0-9]+)":/);
      if (fm) { cur = fm[1]; continue; }
      const cm = ln.match(/"culture"\s*:\s*"([a-z_0-9]+)"/);
      if (cm && cur && !facCulture[cur]) facCulture[cur] = cm[1];
    }
    // Existing files (per variant)
    const files = new Set(fs.readdirSync(cbDir));
    const facHas = (fac) => ({
      portrait: files.has(`captain_portrait_${fac}.tga.dds`),
      card: files.has(`captain_card_${fac}.tga`),
      rebelPortrait: files.has(`captain_portrait_${fac}_rebel.tga.dds`),
      rebelCard: files.has(`captain_card_${fac}_rebel.tga`),
    });
    // Donor per culture: the first faction that has ALL 4 variants. If no
    // complete donor exists for a culture, fall back to any faction with at
    // least the base portrait + card. (Earlier version of this picked any
    // faction with just a portrait, which could pick a faction that itself
    // needed seeding — copy-from-self silently no-ops.)
    const donorByCulture = {};
    const partialDonorByCulture = {};
    for (const [fac, cult] of Object.entries(facCulture)) {
      const h = facHas(fac);
      if (h.portrait && h.card && h.rebelPortrait && h.rebelCard && !donorByCulture[cult]) {
        donorByCulture[cult] = fac;
      }
      if (h.portrait && h.card && !partialDonorByCulture[cult]) {
        partialDonorByCulture[cult] = fac;
      }
    }
    const pickDonor = (cult) => donorByCulture[cult] || partialDonorByCulture[cult] || null;
    // For each faction missing any variant, copy from same-culture donor.
    // Cross-cultural fallback: if no same-culture donor, pick from any
    // culture's complete donor (better than dropping the faction).
    const anyDonor = Object.values(donorByCulture)[0] || Object.values(partialDonorByCulture)[0] || null;
    for (const fac of Object.keys(facCulture)) {
      const cult = facCulture[fac];
      const donor = pickDonor(cult) || anyDonor;
      if (!donor) { out.noDonor.push({ faction: fac, culture: cult }); continue; }
      if (donor === fac) continue; // skip self-copy (donor IS this faction)
      const variants = [
        ['captain_portrait_', '.tga.dds'],
        ['captain_card_', '.tga'],
        ['captain_portrait_', '_rebel.tga.dds'],
        ['captain_card_', '_rebel.tga'],
      ];
      for (const [pref, suf] of variants) {
        const src = path.join(cbDir, pref + donor + suf);
        const dst = path.join(cbDir, pref + fac + suf);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);
          out.copied++;
          if (out.copies.length < 50) out.copies.push({ from: pref + donor + suf, to: pref + fac + suf });
        }
      }
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Captain banner coverage. Each faction needs `data/ui/captain banners/
// captain_portrait_<faction>.tga.dds` + `captain_card_<faction>.tga` for
// the engine's auto-spawned captain UI. Missing files trigger
// record.m_card_path.is_valid() Failed cascades and eventually crash.
// This was the root cause we discovered earlier (104 missing in RIS).
ipcMain.handle('sps:validate-captain-banners', async (_, dataDir) => {
  const out = { missing: [], summary: { factionsTotal: 0, factionsOk: 0, factionsMissing: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  try {
    const smPath = path.join(dataDir, 'descr_sm_factions.txt');
    const cbDir = path.join(dataDir, 'ui', 'captain banners');
    if (!fs.existsSync(smPath)) { out.error = 'descr_sm_factions.txt not found'; return out; }
    if (!fs.existsSync(cbDir)) { out.error = `captain banners dir not found at ${cbDir}`; return out; }
    const smText = fs.readFileSync(smPath, 'utf8');
    const facs = [];
    for (const ln of smText.split(/\r?\n/)) {
      const m = ln.match(/^\t"([a-z_0-9]+)":/);
      if (m) facs.push(m[1]);
    }
    const have = new Set(fs.readdirSync(cbDir));
    for (const fac of facs) {
      out.summary.factionsTotal++;
      const portrait = `captain_portrait_${fac}.tga.dds`;
      const card = `captain_card_${fac}.tga`;
      const rebelP = `captain_portrait_${fac}_rebel.tga.dds`;
      const rebelC = `captain_card_${fac}_rebel.tga`;
      const missingFiles = [];
      if (!have.has(portrait)) missingFiles.push(portrait);
      if (!have.has(card)) missingFiles.push(card);
      if (!have.has(rebelP)) missingFiles.push(rebelP);
      if (!have.has(rebelC)) missingFiles.push(rebelC);
      if (missingFiles.length === 0) out.summary.factionsOk++;
      else {
        out.summary.factionsMissing++;
        out.missing.push({ faction: fac, missing: missingFiles });
      }
    }
  } catch (e) { out.error = e.message; }
  return out;
});

// Portrait coverage audit. Engine resolves portraits through descr_cultures'
// `"portrait mapping": "<target>"` field — so a source culture like `indian`
// may point at the `eastern` portrait pool. We:
//   1. Parse descr_cultures.txt → { sourceCulture: targetCulture }
//   2. For each unique TARGET, check data/ui/<target>/portraits/portraits/
//      {young,old} (the engine's actual lookup path).
//   3. Report per source-culture so the modder sees which sources will hit
//      record.m_card_path.is_valid() Failed because their target is empty.
ipcMain.handle('sps:validate-portraits', async (_, dataDir) => {
  const out = { sources: [], targets: [], mapping: {}, summary: { okSources: 0, brokenSources: 0, okTargets: 0, brokenTargets: 0 }, error: null };
  if (!dataDir) { out.error = 'no dataDir provided'; return out; }
  const uiDir = path.join(dataDir, 'ui');
  if (!fs.existsSync(uiDir)) { out.error = `data/ui not found at ${uiDir}`; return out; }
  // 1. Parse descr_cultures.txt for source → target portrait mapping.
  const cultPath = path.join(dataDir, 'descr_cultures.txt');
  if (!fs.existsSync(cultPath)) { out.error = `descr_cultures.txt not found at ${cultPath}`; return out; }
  let cultText;
  try { cultText = fs.readFileSync(cultPath, 'utf8'); } catch (e) { out.error = e.message; return out; }
  const cultLines = cultText.split(/\r?\n/);
  // Walk top-level `"<name>":` keys inside the cultures array, capturing
  // each block's `"portrait mapping": "<target>"` value. Tolerant of
  // tabs, comments, and the loose JSON-ish layout RR uses.
  const mapping = {};
  let currentSrc = null;
  for (let i = 0; i < cultLines.length; i++) {
    const raw = cultLines[i];
    const code = raw.split(';;', 1)[0]; // strip ;;-style comments
    const srcM = code.match(/^\s*"([a-z][a-z0-9_]*)"\s*:\s*$/i);
    if (srcM) {
      // Skip the outer "cultures" key
      if (srcM[1] === 'cultures') continue;
      // Heuristic: a culture block is followed within a few lines by `{`
      let isBlock = false;
      for (let j = i + 1; j < Math.min(i + 4, cultLines.length); j++) {
        if (/^\s*\{/.test(cultLines[j])) { isBlock = true; break; }
      }
      if (isBlock) currentSrc = srcM[1];
      continue;
    }
    const pmM = code.match(/"portrait mapping"\s*:\s*"([a-z][a-z0-9_]*)"/i);
    if (pmM && currentSrc) mapping[currentSrc] = pmM[1];
  }
  out.mapping = mapping;
  // 2. Audit each unique TARGET culture's actual portrait directory.
  const tgaCount = (d) => {
    try { return fs.readdirSync(d).filter(f => /\.tga$/i.test(f)).length; } catch { return -1; }
  };
  const auditTarget = (target) => {
    const cBase = path.join(uiDir, target);
    const facts = { target, status: 'ok', notes: [], youngCount: 0, oldCount: 0, expectedPath: `data/ui/${target}/portraits/portraits/{young,old}` };
    if (!fs.existsSync(cBase)) {
      facts.status = 'missing-culture-dir';
      facts.notes.push(`data/ui/${target}/ does not exist — no source can resolve a portrait`);
      return facts;
    }
    const portraitsBase = path.join(cBase, 'portraits');
    if (!fs.existsSync(portraitsBase)) {
      // Look for case-mismatched variants
      let alt = null;
      try {
        for (const ent of fs.readdirSync(cBase, { withFileTypes: true })) {
          if (ent.isDirectory() && ent.name.toLowerCase() === 'portraits' && ent.name !== 'portraits') { alt = ent.name; break; }
        }
      } catch {}
      facts.status = alt ? 'case-mismatch' : 'missing-portraits-dir';
      facts.notes.push(alt
        ? `data/ui/${target}/${alt}/ has wrong case — engine expects lowercase "portraits"`
        : `data/ui/${target}/portraits/ does not exist`);
      return facts;
    }
    const portraitsPortraits = path.join(portraitsBase, 'portraits');
    if (!fs.existsSync(portraitsPortraits)) {
      let alt = null;
      try {
        for (const ent of fs.readdirSync(portraitsBase, { withFileTypes: true })) {
          if (ent.isDirectory() && ent.name.toLowerCase() === 'portraits' && ent.name !== 'portraits') { alt = ent.name; break; }
        }
      } catch {}
      facts.status = alt ? 'case-mismatch' : 'missing-portraits-portraits-dir';
      facts.notes.push(alt
        ? `data/ui/${target}/portraits/${alt}/ has wrong case — engine expects lowercase "portraits"`
        : `data/ui/${target}/portraits/portraits/ does not exist (auto-spawned captains will fail)`);
      return facts;
    }
    const youngDir = path.join(portraitsPortraits, 'young');
    const oldDir = path.join(portraitsPortraits, 'old');
    facts.youngCount = tgaCount(youngDir);
    facts.oldCount = tgaCount(oldDir);
    const missingYoung = facts.youngCount < 0;
    const missingOld = facts.oldCount < 0;
    if (missingYoung && missingOld) {
      facts.status = 'no-young-old';
      facts.notes.push('both young/ and old/ directories missing');
    } else if (missingYoung || missingOld) {
      facts.status = 'partial';
      if (missingYoung) facts.notes.push('young/ directory missing');
      if (missingOld) facts.notes.push('old/ directory missing');
    } else if (facts.youngCount === 0 || facts.oldCount === 0) {
      facts.status = 'empty';
      if (facts.youngCount === 0) facts.notes.push('young/ has 0 .tga files');
      if (facts.oldCount === 0) facts.notes.push('old/ has 0 .tga files');
    } else {
      facts.status = 'ok';
    }
    return facts;
  };
  const uniqueTargets = [...new Set(Object.values(mapping))].sort();
  const targetFactsByName = {};
  for (const t of uniqueTargets) {
    const f = auditTarget(t);
    targetFactsByName[t] = f;
    out.targets.push(f);
    if (f.status === 'ok') out.summary.okTargets++;
    else out.summary.brokenTargets++;
  }
  // 3. Per-source-culture rollup.
  for (const [src, target] of Object.entries(mapping)) {
    const tFacts = targetFactsByName[target] || { status: 'unknown', notes: [] };
    const ok = tFacts.status === 'ok';
    out.sources.push({
      source: src,
      target,
      status: tFacts.status,
      youngCount: tFacts.youngCount || 0,
      oldCount: tFacts.oldCount || 0,
      notes: tFacts.notes,
    });
    if (ok) out.summary.okSources++; else out.summary.brokenSources++;
  }
  // Surface unmapped sources too (cultures present in descr_cultures but
  // without a "portrait mapping" line — engine probably falls back to
  // their own name).
  out.sources.sort((a, b) => {
    const order = { 'missing-culture-dir': 0, 'missing-portraits-dir': 1, 'missing-portraits-portraits-dir': 2, 'no-young-old': 3, 'partial': 4, 'case-mismatch': 5, 'empty': 6, 'ok': 7, 'unknown': 8 };
    return (order[a.status] - order[b.status]) || a.source.localeCompare(b.source);
  });
  return out;
});

ipcMain.handle('sps:jump-to', async (_, fileName, searchText, line) => {
  const payload = { fileName, searchText, line: typeof line === 'number' ? line : null };
  const ready = scriptsWin && !scriptsWin.isDestroyed() && !scriptsWin.webContents.isLoading();
  if (ready) {
    scriptsWin.webContents.send('sps:jump-to', payload);
  } else {
    _pendingScriptsJump = payload;
    openScriptsWindow();
  }
  return { ok: true };
});

// ── Mod / Game Import ──

const MOD_FILE_MAP = [
  { name: 'descr_strat.txt', dirs: ['campaign'] },
  { name: 'descr_regions.txt', dirs: ['campaign', 'world/maps/base'] },
  { name: 'map_regions.tga', dirs: ['campaign', 'world/maps/base'] },
  { name: 'export_descr_buildings.txt', dirs: ['.'] },
  { name: 'descr_sm_factions.txt', dirs: ['.'] },
  { name: 'descr_win_conditions.txt', dirs: ['campaign'] },
  // Loaded read-only so Migrate Building Chain can scan them for old-chain refs.
  { name: 'export_descr_character_traits.txt', dirs: ['.'] },
  { name: 'export_descr_ancillaries.txt', dirs: ['.'] },
  { name: 'export_buildings.txt', dirs: ['text'] },
];

const PREFS_FILE = path.join(PROJECT_ROOT, '.gui_prefs.json');

function loadPrefs() {
  try {
    if (fs.existsSync(PREFS_FILE)) return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
  } catch (e) {}
  return {};
}

function savePrefs(prefs) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)); } catch (e) {}
}

function findDataDir(root) {
  const candidates = [
    // root IS the data dir (e.g. selected "data/" directly)
    [root, path.dirname(root)],
    // root contains data/
    [path.join(root, 'data'), root],
  ];
  // Additional sub-paths (macOS app bundles, etc.)
  for (const sub of ['Contents/Resources/Data/data', 'Contents/Resources/Data', 'Data/data', 'Data']) {
    candidates.push([path.join(root, sub), root]);
  }

  for (const [dataDir, displayRoot] of candidates) {
    const campaignPath = path.join(dataDir, 'world', 'maps', 'campaign');
    if (fs.existsSync(campaignPath) && fs.statSync(campaignPath).isDirectory()) {
      return { dataDir, displayRoot };
    }
  }
  return null;
}

function findCampaigns(dataDir) {
  const found = new Set();

  // Standard location: data/world/maps/campaign/<name>/descr_strat.txt
  const campaignBase = path.join(dataDir, 'world', 'maps', 'campaign');
  if (fs.existsSync(campaignBase)) {
    for (const d of fs.readdirSync(campaignBase, { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(campaignBase, d.name, 'descr_strat.txt'))) {
        found.add(d.name);
      }
    }
  }

  // Also check original_overrides (Rome Remastered override system)
  const overrideBase = path.join(dataDir, 'original_overrides', 'resource_quantity', 'world', 'maps', 'campaign');
  if (fs.existsSync(overrideBase)) {
    for (const d of fs.readdirSync(overrideBase, { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(overrideBase, d.name, 'descr_strat.txt'))) {
        found.add(d.name);
      }
    }
  }

  return [...found].sort();
}

// Select mod folder — returns folder info + campaigns
ipcMain.handle('sps:select-mod-folder', async () => {
  const prefs = loadPrefs();
  const result = await dialog.showOpenDialog(dialogParent(), {
    properties: ['openDirectory'],
    title: 'Select Mod or Game Folder',
    defaultPath: prefs.lastModFolder || undefined,
  });
  if (result.canceled) return null;

  const selectedPath = result.filePaths[0];
  const found = findDataDir(selectedPath);
  if (!found) {
    return { error: 'No campaign data found. Select the mod/game root folder (the one containing "data/").' };
  }

  const campaigns = findCampaigns(found.dataDir);
  if (campaigns.length === 0) {
    return { error: 'No campaigns found in this folder.' };
  }

  // Save prefs
  prefs.lastModFolder = selectedPath;
  prefs.lastDataDir = found.dataDir;
  prefs.lastDisplayRoot = found.displayRoot;
  savePrefs(prefs);

  return {
    modFolder: selectedPath,
    dataDir: found.dataDir,
    displayName: path.basename(found.displayRoot),
    campaigns,
    selectedCampaign: prefs.lastCampaign && campaigns.includes(prefs.lastCampaign)
      ? prefs.lastCampaign : campaigns[0],
  };
});

// Load saved mod prefs on startup
ipcMain.handle('sps:get-mod-prefs', async () => {
  const prefs = loadPrefs();
  console.log('[get-mod-prefs] prefs:', JSON.stringify(prefs));
  console.log('[get-mod-prefs] PREFS_FILE:', PREFS_FILE);
  console.log('[get-mod-prefs] lastDataDir exists:', prefs.lastDataDir ? fs.existsSync(prefs.lastDataDir) : 'no path');
  if (!prefs.lastDataDir || !fs.existsSync(prefs.lastDataDir)) return null;

  const campaigns = findCampaigns(prefs.lastDataDir);
  if (campaigns.length === 0) return null;

  return {
    modFolder: prefs.lastModFolder,
    dataDir: prefs.lastDataDir,
    displayName: path.basename(prefs.lastDisplayRoot || prefs.lastModFolder),
    campaigns,
    selectedCampaign: prefs.lastCampaign && campaigns.includes(prefs.lastCampaign)
      ? prefs.lastCampaign : campaigns[0],
  };
});

// Load mod files into config dir
ipcMain.handle('sps:load-mod-files', async (_, dataDir, campaignName) => {
  if (!safeProfileSegment(campaignName)) return { success: false, error: 'invalid campaign name' };
  try {
    const configDir = path.join(PROJECT_ROOT, 'config');
    const campaignDir = path.join(dataDir, 'world', 'maps', 'campaign', campaignName);

    console.log(`[load-mod-files] PROJECT_ROOT: ${PROJECT_ROOT}`);
    console.log(`[load-mod-files] configDir: ${configDir}`);
    console.log(`[load-mod-files] dataDir: ${dataDir}`);
    console.log(`[load-mod-files] campaignDir: ${campaignDir}`);

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    const copied = [];
    const missing = [];

    const overrideCampaignDir = path.join(dataDir, 'original_overrides', 'resource_quantity', 'world', 'maps', 'campaign', campaignName);

    for (const entry of MOD_FILE_MAP) {
      const { name, dirs } = entry;
      const lookupName = entry.srcName || name;  // file to find on disk
      let found = false;
      for (const searchDir of dirs) {
        // Build candidate paths: standard location + original_overrides
        const candidates = [];
        if (searchDir === 'campaign') {
          candidates.push(path.join(campaignDir, lookupName));
          candidates.push(path.join(overrideCampaignDir, lookupName));
        } else {
          candidates.push(path.join(dataDir, searchDir, lookupName));
        }

        for (const src of candidates) {
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(configDir, name));
            copied.push(name);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) missing.push(name);
    }

    // --- Cross-campaign mercenary import ---
    // Grab descr_mercenaries.txt from ANY other campaign, plus that campaign's
    // descr_regions.txt as the source regions for the porting tool.
    // Target regions always come from world/maps/base/.
    const campaignBase = path.join(dataDir, 'world', 'maps', 'campaign');
    const baseRegions = path.join(dataDir, 'world', 'maps', 'base', 'descr_regions.txt');

    // Target regions = base map regions (what the selected campaign uses)
    if (fs.existsSync(baseRegions)) {
      fs.copyFileSync(baseRegions, path.join(configDir, 'descr_regions_target.txt'));
      copied.push('descr_regions_target.txt');
    }

    // Source mercs + source regions = from whichever OTHER campaign has descr_mercenaries.txt
    let mercFound = false;
    if (fs.existsSync(campaignBase)) {
      for (const d of fs.readdirSync(campaignBase, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name === campaignName) continue;
        const mercSrc = path.join(campaignBase, d.name, 'descr_mercenaries.txt');
        if (fs.existsSync(mercSrc)) {
          fs.copyFileSync(mercSrc, path.join(configDir, 'descr_mercenaries.txt'));
          copied.push('descr_mercenaries.txt');
          // Also grab that campaign's descr_regions.txt as source regions
          const srcRegions = path.join(campaignBase, d.name, 'descr_regions.txt');
          if (fs.existsSync(srcRegions)) {
            fs.copyFileSync(srcRegions, path.join(configDir, 'descr_regions_source.txt'));
            copied.push('descr_regions_source.txt');
          }
          console.log(`[load-mod-files] Found mercenaries in campaign: ${d.name}`);
          mercFound = true;
          break;
        }
      }
    }
    // Also check if the selected campaign itself has mercs (fallback)
    if (!mercFound) {
      const ownMercs = path.join(campaignDir, 'descr_mercenaries.txt');
      if (fs.existsSync(ownMercs)) {
        fs.copyFileSync(ownMercs, path.join(configDir, 'descr_mercenaries.txt'));
        copied.push('descr_mercenaries.txt');
      }
    }

    const prefs = loadPrefs();
    prefs.lastCampaign = campaignName;
    savePrefs(prefs);

    // New mod loaded → invalidate icon index so it rescans on next request
    _resetIconIndex();

    const criticalMissing = missing.filter(f => ![
      'descr_win_conditions.txt', 'map_regions.tga',
      // Migration-scan inputs: optional, never block import if absent.
      'export_descr_character_traits.txt', 'export_descr_ancillaries.txt', 'export_buildings.txt',
    ].includes(f));

    console.log(`[load-mod-files] copied: ${copied.length}, missing: ${missing.length}, critical: ${criticalMissing.length}`);

    return { copied, missing, criticalMissing };
  } catch (err) {
    console.error('[load-mod-files] Error:', err);
    return { copied: [], missing: [], criticalMissing: [], error: err.message };
  }
});

// Select parent mod folder (for submod fallback)
ipcMain.handle('sps:select-parent-mod', async () => {
  const prefs = loadPrefs();
  const result = await dialog.showOpenDialog(dialogParent(), {
    properties: ['openDirectory'],
    title: 'Select Parent Mod / Base Game Folder',
    defaultPath: prefs.lastParentMod || undefined,
  });
  if (result.canceled) return null;

  const selectedPath = result.filePaths[0];
  const found = findDataDir(selectedPath);
  if (!found) {
    return { error: 'No game data found in this folder.' };
  }

  prefs.lastParentMod = selectedPath;
  prefs.lastParentDataDir = found.dataDir;
  savePrefs(prefs);

  return {
    dataDir: found.dataDir,
    displayName: path.basename(found.displayRoot),
  };
});

// Load missing files from parent mod — searches all campaigns, only fills gaps
ipcMain.handle('sps:load-parent-mod-files', async (_, parentDataDir, missingFiles) => {
  const configDir = path.join(PROJECT_ROOT, 'config');
  const allCampaigns = findCampaigns(parentDataDir);

  const filled = [];
  const stillMissing = [];

  for (const fileName of missingFiles) {
    const entry = MOD_FILE_MAP.find(e => e.name === fileName);
    if (!entry) { stillMissing.push(fileName); continue; }

    let found = false;
    for (const searchDir of entry.dirs) {
      if (searchDir === 'campaign') {
        // Try every campaign in the parent
        for (const camp of allCampaigns) {
          const src = path.join(parentDataDir, 'world', 'maps', 'campaign', camp, fileName);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(configDir, fileName));
            filled.push(fileName);
            found = true;
            break;
          }
        }
      } else {
        const src = path.join(parentDataDir, searchDir, fileName);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(configDir, fileName));
          filled.push(fileName);
          found = true;
        }
      }
      if (found) break;
    }
    if (!found) stillMissing.push(fileName);
  }

  return { filled, stillMissing };
});

// Find the actual location of a game file in the mod structure
// Searches: campaign dir, original_overrides campaign dir, base dir
function findModFile(dataDir, campaignName, fileName) {
  const candidates = [
    // Standard campaign dir
    path.join(dataDir, 'world', 'maps', 'campaign', campaignName, fileName),
    // original_overrides (Rome Remastered override system)
    path.join(dataDir, 'original_overrides', 'resource_quantity', 'world', 'maps', 'campaign', campaignName, fileName),
    // base dir (shared across campaigns)
    path.join(dataDir, 'world', 'maps', 'base', fileName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Like findModFile but returns ALL existing campaign-level copies (base AND the
// original_overrides copy). A mod can ship both, and the engine may load either
// the base or the override depending on the override's scope — so when we write
// a processed file back (e.g. descr_strat with new buildings) we must update
// EVERY copy, or the game can keep loading the stale one (the "Athens still has
// marble" bug). Excludes world/maps/base for campaign-specific files.
function findAllCampaignFileLocations(dataDir, campaignName, fileName) {
  const candidates = [
    path.join(dataDir, 'world', 'maps', 'campaign', campaignName, fileName),
    path.join(dataDir, 'original_overrides', 'resource_quantity', 'world', 'maps', 'campaign', campaignName, fileName),
  ];
  return candidates.filter(p => fs.existsSync(p));
}

// Save processed files back to the mod folder
ipcMain.handle('sps:save-back-to-mod', async (_, dataDir, campaignName) => {
  // campaignName is interpolated into write paths (…/campaign/<campaignName>/…);
  // a `..` segment would let a processed file land outside the campaign tree.
  // It is always one of the fixed campaign dir names, so require a safe segment.
  if (!safeProfileSegment(campaignName)) return { success: false, error: 'invalid campaign name' };
  try {
    const configDir = path.join(PROJECT_ROOT, 'config');
    const outputDir = path.join(PROJECT_ROOT, 'processed_output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const saved = [];

    // --- Save descr_strat.txt ---
    // Prefer processed output (from pipeline run), fall back to config
    const stratFromOutput = findLatestOutputFile('descr_strat.txt');
    const stratFromConfig = path.join(configDir, 'descr_strat.txt');
    const stratSrc = stratFromOutput || stratFromConfig;
    if (!fs.existsSync(stratSrc)) {
      return { success: false, error: 'No descr_strat.txt found. Run the pipeline first.' };
    }

    const stratDests = findAllCampaignFileLocations(dataDir, campaignName, 'descr_strat.txt');
    if (stratDests.length === 0) {
      // No existing file found — create in standard campaign dir
      const fallback = path.join(dataDir, 'world', 'maps', 'campaign', campaignName, 'descr_strat.txt');
      if (!fs.existsSync(path.dirname(fallback))) {
        return { success: false, error: `Campaign directory not found for: ${campaignName}` };
      }
      fs.copyFileSync(stratSrc, fallback);
      saved.push(`descr_strat.txt → ${path.dirname(fallback)}`);
    } else {
      // Write to EVERY existing copy (base campaign dir AND original_overrides)
      // so the engine can't keep loading a stale one. Backup each first.
      for (const stratDest of stratDests) {
        const stratBackupDir = path.join(path.dirname(stratDest), '_backups');
        fs.mkdirSync(stratBackupDir, { recursive: true });
        fs.copyFileSync(stratDest, path.join(stratBackupDir, `descr_strat_${timestamp}.txt`));
        fs.copyFileSync(stratSrc, stratDest);
        saved.push(`descr_strat.txt → ${path.dirname(stratDest)}`);
        console.log(`[save-back] Saved descr_strat.txt to: ${stratDest}`);
      }
    }

    // --- Save descr_regions.txt (from hidden_resources step) ---
    const regionsSrc = findLatestOutputFile('descr_regions.txt');
    if (regionsSrc) {
      const regionsDest = findModFile(dataDir, campaignName, 'descr_regions.txt');
      if (regionsDest) {
        const regionsBackupDir = path.join(path.dirname(regionsDest), '_backups');
        fs.mkdirSync(regionsBackupDir, { recursive: true });
        fs.copyFileSync(regionsDest, path.join(regionsBackupDir, `descr_regions_${timestamp}.txt`));
        fs.copyFileSync(regionsSrc, regionsDest);
        saved.push(`descr_regions.txt → ${path.dirname(regionsDest)}`);
        console.log(`[save-back] Saved descr_regions.txt to: ${regionsDest}`);
      }
    }

    // --- Save export_descr_buildings.txt (from migrate_chain step) ---
    // EDB lives at the data root (not a campaign file). Only push it when the
    // migration produced a NEWER output than the current import, so a stale EDB
    // left in processed_output by a previous mod/import is never written back.
    const edbSrc = findLatestOutputFile('export_descr_buildings.txt');
    if (edbSrc) {
      const edbConfig = path.join(configDir, 'export_descr_buildings.txt');
      const importMtime = fs.existsSync(edbConfig) ? fs.statSync(edbConfig).mtimeMs : 0;
      if (fs.statSync(edbSrc).mtimeMs >= importMtime) {
        const edbDest = path.join(dataDir, 'export_descr_buildings.txt');
        if (fs.existsSync(edbDest)) {
          const edbBackupDir = path.join(dataDir, '_backups');
          fs.mkdirSync(edbBackupDir, { recursive: true });
          fs.copyFileSync(edbDest, path.join(edbBackupDir, `export_descr_buildings_${timestamp}.txt`));
          fs.copyFileSync(edbSrc, edbDest);
          saved.push(`export_descr_buildings.txt → ${dataDir}`);
          console.log(`[save-back] Saved export_descr_buildings.txt to: ${edbDest}`);
        }
      } else {
        console.log('[save-back] Skipped EDB (output older than current import — stale).');
      }
    }

    return { success: true, saved };
  } catch (err) {
    console.error('[save-back] Error:', err);
    return { success: false, error: err.message };
  }
});

// List config files
ipcMain.handle('sps:list-config-files', async () => {
  const configDir = path.join(PROJECT_ROOT, 'config');
  try {
    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.txt'));
    return files.map(f => ({
      name: f,
      path: path.join(configDir, f),
      size: fs.statSync(path.join(configDir, f)).size,
    }));
  } catch (e) {
    return [];
  }
});

// Read file (contained: only paths under PROJECT_ROOT — see insideProject)
ipcMain.handle('sps:read-file', async (_, filePath) => {
  const safe = insideProject(filePath);
  if (!safe) return `Error reading file: path outside the scripts-suite project dir`;
  try {
    return fs.readFileSync(safe, 'utf-8');
  } catch (e) {
    // Try other encodings
    try {
      return fs.readFileSync(safe, 'utf-16le');
    } catch (e2) {
      return `Error reading file: ${e.message}`;
    }
  }
});

// Write file (contained: only paths under PROJECT_ROOT — see insideProject)
ipcMain.handle('sps:write-file', async (_, filePath, content) => {
  const safe = insideProject(filePath);
  if (!safe) return { success: false, error: 'path outside the scripts-suite project dir' };
  try {
    fs.writeFileSync(safe, content, 'utf-8');
    // A hand-edited .py that no longer parses would fail silently here and
    // only blow up mid-pipeline. The save still succeeds (never hold work
    // hostage) but the syntax error rides back so the editor can show it.
    let syntaxError = null;
    if (safe.endsWith('.py')) {
      // The checker prints ONE clean line itself — parsing a CPython traceback
      // is a trap (its own frames also say "line N" and win a lazy regex).
      const checker = 'import ast,sys\n' +
        'try: ast.parse(open(sys.argv[1],encoding="utf-8",errors="ignore").read())\n' +
        'except SyntaxError as e: print(f"line {e.lineno}: {e.msg}"); sys.exit(1)\n';
      try {
        execFileSync(resolvePython(), ['-c', checker, safe],
          { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        syntaxError = String((e && e.stdout) || '').trim()
          || String((e && e.message) || 'syntax check failed').trim();
      }
    }
    return { success: true, syntaxError };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Save file as (for config profiles)
ipcMain.handle('sps:save-file-as', async (_, defaultName, content) => {
  const result = await dialog.showSaveDialog(dialogParent(), {
    defaultPath: path.join(PROJECT_ROOT, 'config', defaultName),
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return result.filePath;
});

// Import CSV for hidden resources
ipcMain.handle('sps:import-hidden-resources-csv', async () => {
  const result = await dialog.showOpenDialog(dialogParent(), {
    title: 'Import Hidden Resources CSV',
    filters: [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled) return { success: false };

  const src = result.filePaths[0];
  const dest = path.join(PROJECT_ROOT, 'config', 'hidden_resources.csv');
  const metaFile = path.join(PROJECT_ROOT, 'config', '.csv_import_meta.json');
  try {
    fs.copyFileSync(src, dest);
    const now = Date.now();
    fs.writeFileSync(metaFile, JSON.stringify({ importedAt: now, name: path.basename(src) }));
    return { success: true, path: src, name: path.basename(src), importedAt: now };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Import civic-buildings list (.txt) -> config/civic_buildings.txt
ipcMain.handle('sps:import-civic-list', async () => {
  const result = await dialog.showOpenDialog(dialogParent(), {
    title: 'Import Civic Buildings List',
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled) return { success: false };
  const src = result.filePaths[0];
  const dest = path.join(PROJECT_ROOT, 'config', 'civic_buildings.txt');
  try {
    fs.copyFileSync(src, dest);
    return { success: true, path: src, name: path.basename(src) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Check if hidden resources CSV exists and when it was imported
ipcMain.handle('sps:check-hidden-resources-csv', async () => {
  const csvPath = path.join(PROJECT_ROOT, 'config', 'hidden_resources.csv');
  const metaFile = path.join(PROJECT_ROOT, 'config', '.csv_import_meta.json');
  if (!fs.existsSync(csvPath)) return { exists: false };
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    return { exists: true, importedAt: meta.importedAt };
  } catch (e) {
    // No meta file — fall back to file mtime
    const stat = fs.statSync(csvPath);
    return { exists: true, importedAt: stat.mtimeMs };
  }
});

// ── Rule Profiles (save/load Python scripts) ──

const SCRIPT_FILES = PIPELINE_STEPS.map(s => s.script);

// List rule profiles
ipcMain.handle('sps:list-profiles', async () => {
  const profilesDir = path.join(PROJECT_ROOT, 'rule_profiles');
  try {
    if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
    const dirs = fs.readdirSync(profilesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        // Read description if exists
        const descFile = path.join(profilesDir, d.name, '_description.txt');
        const desc = fs.existsSync(descFile) ? fs.readFileSync(descFile, 'utf-8').trim() : '';
        return { name: d.name, description: desc };
      });
    return dirs;
  } catch (e) {
    return [];
  }
});

// A profile name must be a single path segment — no separators, no `..`, no
// drive/absolute. Rejects the traversal that turned load-profile into a
// script-overwrite → run-step RCE chain. Returns the safe name, or null.
const safeProfileSegment = pathSafety.safeSegment;

// Save rule profile (snapshot all Python scripts)
ipcMain.handle('sps:save-profile', async (_, profileName, description) => {
  const safe = safeProfileSegment(profileName);
  if (!safe) return { success: false, error: 'invalid profile name' };
  const profileDir = path.join(PROJECT_ROOT, 'rule_profiles', safe);
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    for (const script of SCRIPT_FILES) {
      const src = path.join(PROJECT_ROOT, script);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(profileDir, script));
      }
    }
    // Save description
    if (description) {
      fs.writeFileSync(path.join(profileDir, '_description.txt'), description, 'utf-8');
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Load rule profile (restore Python scripts from snapshot)
ipcMain.handle('sps:load-profile', async (_, profileName) => {
  const safe = safeProfileSegment(profileName);
  if (!safe) return { success: false, error: 'invalid profile name' };
  const profileDir = path.join(PROJECT_ROOT, 'rule_profiles', safe);
  try {
    for (const script of SCRIPT_FILES) {
      const src = path.join(profileDir, script);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(PROJECT_ROOT, script));
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Replace one pipeline script with the pristine bundled copy (the same file
// the launch-time seed writes). Scripts only — config files are user data.
ipcMain.handle('sps:reset-script', async (_, scriptName) => {
  if (!SCRIPT_FILES.includes(scriptName)) return { success: false, error: 'not a pipeline script' };
  try {
    const src = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(src)) return { success: false, error: 'bundled copy not found' };
    const dest = path.join(PROJECT_ROOT, scriptName);
    fs.copyFileSync(src, dest);
    return { success: true, content: fs.readFileSync(dest, 'utf-8') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Export a rule profile to a single portable JSON file the user picks.
ipcMain.handle('sps:export-profile', async (_, profileName) => {
  const safe = safeProfileSegment(profileName);
  if (!safe) return { success: false, error: 'invalid profile name' };
  const profileDir = path.join(PROJECT_ROOT, 'rule_profiles', safe);
  try {
    if (!fs.existsSync(profileDir)) return { success: false, error: 'profile not found' };
    const files = {};
    for (const script of SCRIPT_FILES) {
      const src = path.join(profileDir, script);
      if (fs.existsSync(src)) files[script] = fs.readFileSync(src, 'utf-8');
    }
    if (Object.keys(files).length === 0) return { success: false, error: 'profile is empty' };
    const descFile = path.join(profileDir, '_description.txt');
    const description = fs.existsSync(descFile) ? fs.readFileSync(descFile, 'utf-8').trim() : '';
    const { canceled, filePath } = await dialog.showSaveDialog(dialogParent(), {
      title: 'Export rule profile',
      defaultPath: `${safe}.rule-profile.json`,
      filters: [{ name: 'Rule Profile', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    fs.writeFileSync(filePath, JSON.stringify({
      format: 'provincia-rule-profile',
      version: 1,
      name: safe,
      description,
      exportedAt: new Date().toISOString(),
      files,
    }, null, 2), 'utf-8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Import a rule profile from a JSON file previously exported (from any machine).
// Script names are validated against the pipeline's own list — nothing outside
// SCRIPT_FILES is ever written, so a crafted file can't plant paths.
ipcMain.handle('sps:import-profile', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(dialogParent(), {
      title: 'Import rule profile',
      filters: [{ name: 'Rule Profile', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { success: false, canceled: true };
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    } catch {
      return { success: false, error: 'not a valid JSON file' };
    }
    if (!data || data.format !== 'provincia-rule-profile' || typeof data.files !== 'object' || data.files === null) {
      return { success: false, error: 'not a rule-profile export' };
    }
    const entries = Object.entries(data.files)
      .filter(([name, content]) => SCRIPT_FILES.includes(name) && typeof content === 'string');
    if (entries.length === 0) return { success: false, error: 'no recognized scripts in the file' };
    let base = safeProfileSegment(String(data.name || 'imported'));
    if (!base) base = 'imported';
    let name = base, n = 2;
    while (fs.existsSync(path.join(PROJECT_ROOT, 'rule_profiles', name))) name = `${base}-${n++}`;
    const profileDir = path.join(PROJECT_ROOT, 'rule_profiles', name);
    fs.mkdirSync(profileDir, { recursive: true });
    for (const [scriptName, content] of entries) {
      fs.writeFileSync(path.join(profileDir, scriptName), content, 'utf-8');
    }
    if (typeof data.description === 'string' && data.description) {
      fs.writeFileSync(path.join(profileDir, '_description.txt'), data.description, 'utf-8');
    }
    return { success: true, name, scripts: entries.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// List scripts (for the editor)
ipcMain.handle('sps:list-scripts', async () => {
  return SCRIPT_FILES.map(script => {
    const fullPath = path.join(PROJECT_ROOT, script);
    return {
      name: script,
      path: fullPath,
      size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0,
    };
  }).filter(f => f.size > 0);
});

// Find the most recently written descr_strat.txt in processed_output/
// Scripts may write to flat dir or timestamped subdirs
function findLatestOutputFile(fileName) {
  const outputDir = path.join(PROJECT_ROOT, 'processed_output');
  if (!fs.existsSync(outputDir)) return null;

  let best = null;
  let bestMtime = 0;

  // Check flat file
  const flat = path.join(outputDir, fileName);
  if (fs.existsSync(flat)) {
    const mt = fs.statSync(flat).mtimeMs;
    if (mt > bestMtime) { best = flat; bestMtime = mt; }
  }

  // Check subdirectories
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(outputDir, entry.name, fileName);
    if (fs.existsSync(candidate)) {
      const mt = fs.statSync(candidate).mtimeMs;
      if (mt > bestMtime) { best = candidate; bestMtime = mt; }
    }
  }
  return best;
}

// Chain support: after a step runs, copy its output strat back to config
// so the next step reads the updated version
ipcMain.handle('sps:chain-strat-output', async () => {
  const latest = findLatestOutputFile('descr_strat.txt');
  const configStrat = path.join(PROJECT_ROOT, 'config', 'descr_strat.txt');
  if (latest) {
    fs.copyFileSync(latest, configStrat);
    // Also copy to flat processed_output/ for Save to Mod
    const flatOutput = path.join(PROJECT_ROOT, 'processed_output', 'descr_strat.txt');
    if (latest !== flatOutput) fs.copyFileSync(latest, flatOutput);
    return true;
  }
  return false;
});

// For hidden_resources: copy its output descr_regions.txt to config
ipcMain.handle('sps:chain-regions-output', async () => {
  const latest = findLatestOutputFile('descr_regions.txt');
  const configRegions = path.join(PROJECT_ROOT, 'config', 'descr_regions.txt');
  if (latest) {
    fs.copyFileSync(latest, configRegions);
    const flatOutput = path.join(PROJECT_ROOT, 'processed_output', 'descr_regions.txt');
    if (latest !== flatOutput) fs.copyFileSync(latest, flatOutput);
    return true;
  }
  return false;
});

// Backup config files before a chained run, and restore after
ipcMain.handle('sps:backup-config', async () => {
  const backupDir = path.join(PROJECT_ROOT, '_config_backup');
  fs.mkdirSync(backupDir, { recursive: true });
  for (const name of ['descr_strat.txt', 'descr_regions.txt']) {
    const src = path.join(PROJECT_ROOT, 'config', name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, name));
    }
  }
  return true;
});

ipcMain.handle('sps:restore-config', async () => {
  const backupDir = path.join(PROJECT_ROOT, '_config_backup');
  if (!fs.existsSync(backupDir)) return false;
  for (const name of ['descr_strat.txt', 'descr_regions.txt']) {
    const src = path.join(backupDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(PROJECT_ROOT, 'config', name));
    }
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
  return true;
});

// Run pipeline step
ipcMain.handle('sps:run-step', async (event, stepId) => {
  const step = PIPELINE_STEPS.find(s => s.id === stepId);
  if (!step) return { success: false, error: 'Unknown step' };

  const scriptPath = path.join(PROJECT_ROOT, step.script);
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Script not found: ${step.script}` };
  }

  return new Promise((resolve) => {
    // No renderer-supplied env: letting the renderer set PYTHONSTARTUP /
    // PYTHONPATH / PATH for the child would be an injection surface, and the
    // only caller (scripts-suite/renderer.js runStep) never passed overrides.
    const proc = spawn(resolvePython(), [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      sendToScripts('step-output', { stepId, text, stream: 'stdout' });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      sendToScripts('step-output', { stepId, text, stream: 'stderr' });
    });

    proc.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr, code });
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message, stdout, stderr });
    });
  });
});

// Run full pipeline
ipcMain.handle('sps:run-pipeline', async (event, stepIds) => {
  const results = {};
  for (const stepId of stepIds) {
    sendToScripts('pipeline-step-start', stepId);
    const step = PIPELINE_STEPS.find(s => s.id === stepId);
    const scriptPath = path.join(PROJECT_ROOT, step.script);

    if (!fs.existsSync(scriptPath)) {
      results[stepId] = { success: false, error: `Script not found: ${step.script}` };
      sendToScripts('pipeline-step-done', { stepId, success: false });
      continue;
    }

    const stepResult = await new Promise((resolve) => {
      const proc = spawn(resolvePython(), [scriptPath], {
        cwd: PROJECT_ROOT,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        sendToScripts('step-output', { stepId, text, stream: 'stdout' });
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        sendToScripts('step-output', { stepId, text, stream: 'stderr' });
      });

      proc.on('close', (code) => {
        resolve({ success: code === 0, stdout, stderr, code });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message, stdout, stderr });
      });
    });

    results[stepId] = stepResult;
    sendToScripts('pipeline-step-done', {
      stepId,
      success: stepResult.success,
    });

    if (!stepResult.success) break; // Stop pipeline on failure
  }
  return results;
});

// Run comparison: run pipeline with two different rule profiles (swap scripts)
ipcMain.handle('sps:run-comparison', async (event, profileA, profileB, stepIds) => {
  const configDir = path.join(PROJECT_ROOT, 'config');

  // Backup current scripts
  const backupDir = path.join(PROJECT_ROOT, '_backup_scripts');
  fs.mkdirSync(backupDir, { recursive: true });
  for (const script of SCRIPT_FILES) {
    const src = path.join(PROJECT_ROOT, script);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, script));
    }
  }

  // Also backup descr_strat.txt since each run modifies it
  const stratPath = path.join(configDir, 'descr_strat.txt');
  const stratBackup = path.join(backupDir, 'descr_strat.txt');
  if (fs.existsSync(stratPath)) {
    fs.copyFileSync(stratPath, stratBackup);
  }

  const runWithRuleProfile = async (profileName, tag) => {
    // Restore original descr_strat.txt before each run
    if (fs.existsSync(stratBackup)) {
      fs.copyFileSync(stratBackup, stratPath);
    }

    // Swap in profile scripts if not 'current'
    if (profileName !== '__current__') {
      const profileDir = path.join(PROJECT_ROOT, 'rule_profiles', profileName);
      for (const script of SCRIPT_FILES) {
        const src = path.join(profileDir, script);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(PROJECT_ROOT, script));
        }
      }
    } else {
      // Restore originals for 'current'
      for (const script of SCRIPT_FILES) {
        const src = path.join(backupDir, script);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(PROJECT_ROOT, script));
        }
      }
    }

    const results = {};
    for (const stepId of stepIds) {
      const step = PIPELINE_STEPS.find(s => s.id === stepId);
      const scriptPath = path.join(PROJECT_ROOT, step.script);
      if (!fs.existsSync(scriptPath)) {
        results[stepId] = { success: false, error: 'Script not found' };
        continue;
      }

      const stepResult = await new Promise((resolve) => {
        const proc = spawn(resolvePython(), [scriptPath], {
          cwd: PROJECT_ROOT,
          env: { ...process.env },
        });
        let stdout = '', stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => resolve({ success: code === 0, stdout, stderr }));
        proc.on('error', (err) => resolve({ success: false, error: err.message }));
      });
      results[stepId] = stepResult;
      sendToScripts('comparison-step-done', { tag, stepId, success: stepResult.success });
      if (!stepResult.success) break;
    }

    // Read final descr_strat.txt after this run
    const finalStrat = fs.existsSync(stratPath)
      ? fs.readFileSync(stratPath, 'utf-8')
      : '';

    return { results, finalStrat };
  };

  try {
    sendToScripts('comparison-status', `Running with rules: ${profileA}...`);
    const resultA = await runWithRuleProfile(profileA, 'A');

    sendToScripts('comparison-status', `Running with rules: ${profileB}...`);
    const resultB = await runWithRuleProfile(profileB, 'B');

    // Restore original scripts
    for (const script of SCRIPT_FILES) {
      const src = path.join(backupDir, script);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(PROJECT_ROOT, script));
      }
    }
    // Restore original descr_strat.txt
    if (fs.existsSync(stratBackup)) {
      fs.copyFileSync(stratBackup, stratPath);
    }

    fs.rmSync(backupDir, { recursive: true, force: true });

    return { profileA: resultA, profileB: resultB };
  } catch (e) {
    // Restore on error
    for (const script of SCRIPT_FILES) {
      const src = path.join(backupDir, script);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(PROJECT_ROOT, script));
      }
    }
    if (fs.existsSync(stratBackup)) {
      fs.copyFileSync(stratBackup, stratPath);
    }
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
    return { error: e.message };
  }
});

// Clear all previous output before a new run
ipcMain.handle('sps:clear-stale-output', async () => {
  const outputDir = path.join(PROJECT_ROOT, 'processed_output');
  if (!fs.existsSync(outputDir)) return;
  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  for (const entry of entries) {
    const fp = path.join(outputDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(fp, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fp);
    }
  }
});

// Get latest output directory
ipcMain.handle('sps:get-latest-output', async () => {
  const outputDir = path.join(PROJECT_ROOT, 'processed_output');
  try {
    if (!fs.existsSync(outputDir)) return null;

    const entries = fs.readdirSync(outputDir, { withFileTypes: true });

    // Check for flat changelog files (written by individual step runs)
    const flatChangelogFiles = entries.filter(e =>
      e.isFile() && e.name.includes('changelog')
    );
    let flatMtime = 0;
    for (const f of flatChangelogFiles) {
      const stat = fs.statSync(path.join(outputDir, f.name));
      if (stat.mtimeMs > flatMtime) flatMtime = stat.mtimeMs;
    }

    // Find the latest full_run directory
    const fullRunDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('full_run_'))
      .map(e => e.name)
      .sort();

    let fullRunMtime = 0;
    let latestRun = null;
    if (fullRunDirs.length > 0) {
      latestRun = fullRunDirs[fullRunDirs.length - 1];
      const stat = fs.statSync(path.join(outputDir, latestRun));
      fullRunMtime = stat.mtimeMs;
    }

    // Prefer whichever is newer: flat files or latest full_run
    const useFlat = flatMtime > fullRunMtime;

    if (useFlat || fullRunDirs.length === 0) {
      const contents = {};
      // Use '.' so paths resolve to processed_output/./file = processed_output/file
      const flatFiles = entries.filter(e => e.isFile()).map(e => e.name);
      if (flatFiles.some(f => f.includes('changelog'))) {
        contents['.'] = flatFiles;
      }
      // Also include any individual step dirs
      const dirsByPrefix = {};
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('full_run_')) {
          const prefixMatch = entry.name.match(/^(.+?)_\d{8}_\d{6}$/);
          const prefix = prefixMatch ? prefixMatch[1] : entry.name;
          if (!dirsByPrefix[prefix]) dirsByPrefix[prefix] = [];
          dirsByPrefix[prefix].push(entry.name);
        }
      }
      for (const [prefix, dirs] of Object.entries(dirsByPrefix)) {
        dirs.sort();
        const latest = dirs[dirs.length - 1];
        try {
          contents[latest] = fs.readdirSync(path.join(outputDir, latest));
        } catch (e) {}
      }
      if (Object.keys(contents).length === 0) return null;
      return { dir: 'processed_output', path: outputDir, contents };
    }

    // Use the latest full_run directory
    const latestDir = path.join(outputDir, latestRun);
    const contents = {};

    const subdirs = fs.readdirSync(latestDir, { withFileTypes: true });
    for (const sd of subdirs) {
      if (sd.isDirectory()) {
        contents[sd.name] = fs.readdirSync(path.join(latestDir, sd.name));
      } else if (sd.isFile()) {
        contents[sd.name] = 'file';
      }
    }

    if (Object.keys(contents).length === 0) return null;
    return { dir: latestRun, path: latestDir, contents };
  } catch (e) {
    return null;
  }
});

// Read output file
// (contained: get-latest-output only hands out processed_output/ paths)
ipcMain.handle('sps:read-output-file', async (_, relPath) => {
  const safe = insideProject(relPath);
  if (!safe) return `Error: path outside the scripts-suite project dir`;
  try {
    return fs.readFileSync(safe, 'utf-8');
  } catch (e) {
    return `Error: ${e.message}`;
  }
});

// Open folder in explorer. Contained: only an existing DIRECTORY inside
// PROJECT_ROOT. openPath() on an arbitrary path would launch it via OS file
// association (a .exe/.bat path would execute); requiring a real subdirectory
// of the project dir removes that vector. (No renderer currently calls this.)
ipcMain.handle('sps:open-folder', async (_, folderPath) => {
  const safe = insideProject(folderPath);
  if (!safe) { console.warn('[sps] open-folder refused (outside project):', folderPath); return; }
  try { if (!fs.statSync(safe).isDirectory()) return; } catch { return; }
  shell.openPath(safe);
});

// Building chain → category mapping
const BUILDING_CATEGORIES = {
  'Farms': ['irrigated_farming', 'rainfed_farming', 'qanat_farming', 'highland_pastoralism',
    'sedentary_animal_husbandry', 'marsh_reclamation', 'wetland_pastoralism',
    'nomadic_pastoralism', 'forest_pastoralism', 'shifting_cultivation',
    'farms', 'herds'],
  'Food Storage & Grain': ['food_storage', 'grain_imports'],
  'Heavy Industry': ['smith', 'mines', 'purple_dye_production', 'marble_production',
    'jewelry', 'artisans', 'stone_quarry', 'sulphur_industry',
    'salt_production', 'pitch_gathering'],
  'Metal Exports': ['tin_industry', 'copper_industry', 'lead_industry', 'iron_industry',
    'hinterland_mines_silver',
    'tin_mine', 'lead_mine', 'silver_mine', 'gold_mine', 'copper_mine', 'iron_mine'],
  'Health & Sanitation': ['health', 'hospitals'],
  'Military': ['military_industrial_complex', 'garrison',
    'barracks', 'equestrian', 'missiles', 'siege_engineer'],
  'Government': ['governmentA', 'governmentB', 'governmentC', 'governmentD',
    'colony', 'liberation', 'core_building', 'hinterland_region'],
  'Law & Culture': ['justice_court', 'despotic_law', 'academic',
    'amphitheatres', 'racing_stadium', 'theatres', 'taverns',
    'autonomous_mint', 'centralized_mint'],
  'Rural Exploits': ['wine_industry', 'olive_cultivation', 'dates_cultivation',
    'agroforestry', 'papyrus_maker', 'honey_industry', 'hunters',
    'horse_trainer', 'timber_industry', 'camels_trade', 'hemp_cultivation'],
  'Urban Exploits': ['amber_trader', 'dyes_production', 'glass_production',
    'grain_industry', 'hides_industry', 'incense_trader', 'ivory_trade',
    'perfumes_industry', 'pottery_production', 'salted_fish', 'silk_trader',
    'slave_market', 'spices_trading', 'textiles_production'],
  'Ports': ['port', 'river_port1', 'river_port2', 'harbour', 'port_buildings', 'port_fishing', 'river_port'],
  'Settlement': ['defenses', 'hinterland_roads', 'market', 'capital_treasury'],
};

function getBuildingCategory(name) {
  for (const [cat, chains] of Object.entries(BUILDING_CATEGORIES)) {
    if (chains.includes(name)) return cat;
  }
  // Check for temple_complex_ prefix
  if (name.startsWith('temple_complex')) return 'Temples';
  return 'Other';
}

// Parse EDB building chains for the editor
ipcMain.handle('sps:parse-edb-buildings', async () => {
  const edbPath = path.join(PROJECT_ROOT, 'config', 'export_descr_buildings.txt');
  try {
    const content = fs.readFileSync(edbPath, 'utf-8');
    const buildings = parseEDB(content);
    // Attach category to each building
    for (const b of buildings) {
      b.category = getBuildingCategory(b.name);
    }
    return buildings;
  } catch (e) {
    return { error: e.message };
  }
});

function parseEDB(content) {
  // EDB shape:
  //   building <chain>
  //   {
  //       <props>
  //       levels <l1> <l2> <l3>
  //       {
  //           <l1> requires <...>
  //           {
  //               settlement_min <tier>
  //               ...
  //           }
  //           <l2> requires <...>
  //           ...
  //       }
  //   }
  //
  // Brace depth: 0 outside the chain, 1 inside the chain block, 2 inside the
  // levels block, 3 inside a single level's requires block.

  const buildings = [];
  const lines = content.split('\n');
  let currentBuilding = null;
  let currentLevel = null;
  let braceDepth = 0;

  function pushLevel() {
    if (currentLevel && currentBuilding) {
      currentBuilding.levels.push(currentLevel);
      currentLevel = null;
    }
  }
  function pushBuilding() {
    pushLevel();
    if (currentBuilding) {
      buildings.push(currentBuilding);
      currentBuilding = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip ; comments
    const ci = line.indexOf(';');
    const trimmed = (ci >= 0 ? line.slice(0, ci) : line).trim();
    if (!trimmed) continue;

    // building <name> at top level starts a new chain
    const buildingMatch = trimmed.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (buildingMatch && braceDepth === 0) {
      pushBuilding();
      currentBuilding = {
        name: buildingMatch[1],
        line: i + 1,
        levels: [],
        rawLevelsLine: '',
      };
      continue;
    }
    if (!currentBuilding) continue;

    // levels line — at braceDepth 1 (inside the chain block).
    // Some EDBs place the trailing `{` on the same line; tolerate that.
    if (braceDepth === 1) {
      const levelsMatch = trimmed.match(/^levels\s+(.+?)\s*\{?\s*$/);
      if (levelsMatch) {
        currentBuilding.rawLevelsLine = levelsMatch[1].trim();
        continue;
      }
    }

    // Brace tracking. `{` and `}` may be on their own line OR appended to a
    // declaration line ("levels foo bar {"). We scan the line for them.
    let consumedBrace = false;
    if (trimmed === '{') { braceDepth++; consumedBrace = true; }
    else if (trimmed === '}') {
      braceDepth--;
      if (braceDepth === 2) pushLevel();   // closing a level's requires block
      consumedBrace = true;
    }
    if (consumedBrace) {
      if (braceDepth === 0) pushBuilding();
      continue;
    }

    // <levelName> requires <...> begins a level definition (braceDepth === 2,
    // inside the levels block).
    if (braceDepth === 2) {
      const levelMatch = trimmed.match(/^(\S+)\s+requires/);
      if (levelMatch) {
        pushLevel();
        currentLevel = {
          name: levelMatch[1],
          line: i + 1,
          settlementMin: '',
          requires: [],
        };
        continue;
      }
    }

    // Inside a level's requires { ... } block (braceDepth === 3).
    if (braceDepth === 3 && currentLevel) {
      const sm = trimmed.match(/^settlement_min\s+(\S+)/);
      if (sm) currentLevel.settlementMin = sm[1];
      currentLevel.requires.push(trimmed);
    }
  }
  pushBuilding();
  return buildings;
}

// ── Migrate Building Chain: UI data + config read/write ─────────────────
// Backs the Scripts window's chain-picker. The Python step (migrate_chain.py)
// still reads config/chain_migration.txt as its source of truth; the UI just
// edits that file with chains/aliases discovered from the loaded EDB.

function parseMigrationConfig(text) {
  const migs = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.split(';')[0].trim();   // allow ; comments
    if (!line) continue;
    if (line.toLowerCase() === '[migration]') {
      cur = { old_chain: '', old_levels: [], new_chains: [], remap: {}, descr_strat: 'remove' };
      migs.push(cur);
      continue;
    }
    if (!cur || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const k = line.slice(0, eq).trim().toLowerCase();
    const v = line.slice(eq + 1).trim();
    if (k === 'old_chain') cur.old_chain = v;
    else if (k === 'old_levels') cur.old_levels = v.split(/\s+/).filter(Boolean);
    else if (k === 'new_chains') cur.new_chains = v.split(/\s+/).filter(Boolean);
    else if (k === 'descr_strat') cur.descr_strat = v.toLowerCase();
    else if (k === 'remap') {
      for (const p of v.split(/\s+/)) {
        const i = p.indexOf('->');
        if (i > 0) cur.remap[p.slice(0, i)] = p.slice(i + 2);
      }
    }
  }
  return migs.filter(m => m.old_chain);
}

function serializeMigrationConfig(migrations) {
  const header = [
    '; ============================================================================',
    '; Building-chain migration config  (used by the "Migrate Building Chain" step)',
    '; Edited from the Scripts UI chain picker — you can also hand-edit it here.',
    '; One [migration] block per OLD chain being retired. See migrate_chain.py.',
    '; ============================================================================',
    '',
  ].join('\n');
  const blocks = (migrations || []).filter(m => m && m.old_chain).map(m => {
    const lines = ['[migration]'];
    lines.push(`old_chain   = ${m.old_chain}`);
    lines.push(`old_levels  = ${(m.old_levels || []).join(' ')}`);
    lines.push(`new_chains  = ${(m.new_chains || []).join(' ')}`);
    const remapPairs = Object.entries(m.remap || {}).map(([a, b]) => `${a}->${b}`);
    if (remapPairs.length) lines.push(`remap       = ${remapPairs.join(' ')}`);
    lines.push(`descr_strat = ${m.descr_strat || 'remove'}`);
    return lines.join('\n');
  });
  return header + '\n' + blocks.join('\n\n') + '\n';
}

// Return EDB chains (+ their levels), `*_level_N` alias groups, and the current
// migrations parsed from config/chain_migration.txt — everything the picker needs.
ipcMain.handle('sps:migrate-get-data', async () => {
  const configDir = path.join(PROJECT_ROOT, 'config');
  const edbPath = path.join(configDir, 'export_descr_buildings.txt');
  const cfgPath = path.join(configDir, 'chain_migration.txt');
  try {
    const out = { chains: [], aliasGroups: [], migrations: [] };
    if (fs.existsSync(edbPath)) {
      const content = fs.readFileSync(edbPath, 'utf-8');
      const buildings = parseEDB(content);
      out.chains = buildings.map(b => ({
        name: b.name,
        levels: b.rawLevelsLine ? b.rawLevelsLine.split(/\s+/).filter(Boolean)
                                : b.levels.map(l => l.name),
      }));
      // alias groups: `alias <prefix>_level_<n>` (OR-of-chains helpers, e.g.
      // cropfarming_level_1..5) → usable as remap targets ("tie to all").
      const groups = {};
      const re = /^[ \t]*alias[ \t]+(\S+_level)_(\d+)[ \t]*$/gm;
      let m;
      while ((m = re.exec(content))) {
        (groups[m[1]] = groups[m[1]] || new Set()).add(parseInt(m[2], 10));
      }
      out.aliasGroups = Object.entries(groups)
        .map(([prefix, tiers]) => ({ prefix, tiers: [...tiers].sort((a, b) => a - b) }))
        .sort((a, b) => a.prefix.localeCompare(b.prefix));
    }
    if (fs.existsSync(cfgPath)) {
      out.migrations = parseMigrationConfig(fs.readFileSync(cfgPath, 'utf-8'));
    }
    return out;
  } catch (e) {
    return { error: e.message };
  }
});

// 0.9.636: Migration preview — count what would change WITHOUT touching anything.
// Counts EDB references that would be re-pointed (excluding the chain's own
// self-refs, which get removed with the block), descr_strat prebuilts that
// would be removed, and missing new-chain localization keys in the loaded
// text/export_buildings.txt. Lets the dialog show "Will re-point N refs,
// remove M prebuilts, K of L locale keys missing" before the user commits.
ipcMain.handle('sps:migrate-preview', async (_, mig) => {
  const out = {
    edbRefsTotal: 0, edbRefsByLevel: {}, edbRefsUnmappedCount: 0, unmappedLevels: [],
    stratPrebuilts: 0, missingLocaleKeys: 0, totalLocaleKeysNeeded: 0, edbBlockFound: false,
  };
  try {
    if (!mig || !mig.old_chain) return out;
    const configDir = path.join(PROJECT_ROOT, 'config');
    const old = mig.old_chain;
    const oldLevels = mig.old_levels || [];
    const remap = mig.remap || {};

    // EDB: remove the chain's own block first so internal self-refs don't count.
    const edbPath = path.join(configDir, 'export_descr_buildings.txt');
    const edb = fs.existsSync(edbPath) ? fs.readFileSync(edbPath, 'utf-8') : '';
    if (edb) {
      const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match `building <old>` ... up to next top-level `building`/`alias` or EOF.
      const blockRe = new RegExp(`^building[ \\t]+${esc}\\b[\\s\\S]*?(?=^building[ \\t]|^alias[ \\t]|$)`, 'gm');
      out.edbBlockFound = blockRe.test(edb);
      blockRe.lastIndex = 0;
      const outsideBlock = edb.replace(blockRe, '');
      // Count `building_present_min_level <old> <level>` references.
      const mlRe = new RegExp(`building_present_min_level[ \\t]+${esc}[ \\t]+(\\S+)`, 'g');
      let m;
      while ((m = mlRe.exec(outsideBlock))) {
        const lvl = m[1];
        out.edbRefsTotal++;
        out.edbRefsByLevel[lvl] = (out.edbRefsByLevel[lvl] || 0) + 1;
        if (!remap[lvl]) out.edbRefsUnmappedCount++;
      }
      // Also count bare `building_present <old>` (no _min_level form).
      const bareRe = new RegExp(`building_present[ \\t]+${esc}\\b`, 'g');
      const bareHits = (outsideBlock.match(bareRe) || []).length;
      out.edbRefsTotal += bareHits;
      if (bareHits && oldLevels.length && !remap[oldLevels[0]]) out.edbRefsUnmappedCount += bareHits;
      out.unmappedLevels = oldLevels.filter(lvl => !remap[lvl]);
    }

    // descr_strat prebuilts referencing the old chain.
    const stratPath = path.join(configDir, 'descr_strat.txt');
    if (fs.existsSync(stratPath)) {
      const strat = fs.readFileSync(stratPath, 'utf-8');
      const esc = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stratRe = new RegExp(`^\\s*type[ \\t]+${esc}[ \\t]+\\S+`, 'gm');
      out.stratPrebuilts = (strat.match(stratRe) || []).length;
    }

    // Localization: how many of the new chains' level keys are missing in
    // text/export_buildings.txt (the tool never fabricates these).
    const textPath = path.join(configDir, 'export_buildings.txt');
    if (fs.existsSync(textPath) && edb) {
      const text = readModText(textPath); // export_buildings.txt is UTF-16 LE
      const buildings = parseEDB(edb);
      const newSet = new Set(mig.new_chains || []);
      const newLevels = [];
      for (const b of buildings) {
        if (!newSet.has(b.name)) continue;
        const lvls = b.rawLevelsLine ? b.rawLevelsLine.split(/\s+/).filter(Boolean) : b.levels.map(l => l.name);
        newLevels.push(...lvls);
      }
      out.totalLocaleKeysNeeded = newLevels.length;
      out.missingLocaleKeys = newLevels.filter(l => !text.includes(`{${l}}`)).length;
    }
    return out;
  } catch (e) {
    return { ...out, error: e.message };
  }
});

// Persist the picker's migrations array back to config/chain_migration.txt.
ipcMain.handle('sps:migrate-save', async (_, migrations) => {
  try {
    const p = path.join(PROJECT_ROOT, 'config', 'chain_migration.txt');
    fs.writeFileSync(p, serializeMigrationConfig(migrations));
    return { success: true, count: (migrations || []).filter(m => m && m.old_chain).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Building icon resolver (ported from Provincia) ─────────────────────
// RTW/M2TW ship icons as `#<culture>_<level>.tga` in `data/ui/<c>/buildings/`.
// The resolver tries 7 progressively-broader passes, parsing
// `descr_ui_buildings.txt` for level aliases + culture fallbacks. Returns
// raw TGA bytes; the renderer decodes via canvas + blob URL.

const _uiBuildingsCache = new Map();   // modDataDir → { cultureFallbacks, levelAliases }

function _resetIconIndex() {
  _uiBuildingsCache.clear();
}

function parseDescrUiBuildings(modDataDir) {
  const cacheKey = modDataDir || '';
  if (_uiBuildingsCache.has(cacheKey)) return _uiBuildingsCache.get(cacheKey);

  const sources = [];
  if (modDataDir) {
    const p = path.join(modDataDir, 'descr_ui_buildings.txt');
    if (fs.existsSync(p)) sources.push(p);
  }

  const cultureFallbacks = {};
  const levelAliases = {};
  // Folder names RTW recognises as cultures — used to distinguish
  // culture-fallback entries from level-alias entries in lookup_variants.
  const CULTURES = new Set([
    'roman', 'greek', 'eastern', 'egyptian', 'barbarian', 'carthaginian',
    'nomad', 'parthian', 'scythian', 'german',
    'e_hellenistic', 'w_hellenistic',
    'anatolian', 'arab', 'brittonic', 'celtiberian', 'dacian', 'ethiopian',
    'germanic', 'iberian', 'illyrian', 'indian', 'iranian', 'libyan',
    'thracian',
  ]);

  for (const src of sources) {
    try {
      const text = fs.readFileSync(src, 'utf-8');
      let inBlock = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/;.*$/, '').trim();
        if (!line) continue;
        if (line === 'lookup_variants') { inBlock = true; continue; }
        if (line === '{') continue;
        if (line === '}') { inBlock = false; continue; }
        if (!inBlock) continue;
        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;
        const from = parts[0].toLowerCase();
        const to = parts[1].toLowerCase();
        if (CULTURES.has(from) && CULTURES.has(to)) {
          if (!cultureFallbacks[from]) cultureFallbacks[from] = [];
          if (!cultureFallbacks[from].includes(to)) cultureFallbacks[from].push(to);
        } else {
          levelAliases[from] = to;
        }
      }
    } catch {}
  }

  const result = { cultureFallbacks, levelAliases };
  _uiBuildingsCache.set(cacheKey, result);
  return result;
}

ipcMain.handle('sps:resolve-building-icon', async (_event, modDataDir, culture, levelName, chainName) => {
  if (!culture || !levelName) return null;
  const c = String(culture).toLowerCase();
  const l = String(levelName).toLowerCase();
  const { cultureFallbacks, levelAliases } = parseDescrUiBuildings(modDataDir);

  // Token-suffix candidates: trim from the left so `temple_of_zoroaster_shrine`
  // also tries `of_zoroaster_shrine`, `zoroaster_shrine`, `shrine`.
  const levelTokens = l.split('_');
  const levelCandidates = [];
  for (let start = 0; start < levelTokens.length; start++) {
    const suffix = levelTokens.slice(start).join('_');
    if (suffix && !levelCandidates.includes(suffix)) levelCandidates.push(suffix);
  }
  // Walk alias chain (e.g. temple_of_battle_shrine → shrine), and also
  // add trimmed suffixes of each alias.
  if (levelAliases) {
    let cur = l;
    const seen = new Set([cur]);
    for (let i = 0; i < 8; i++) {
      const next = levelAliases[cur];
      if (!next || seen.has(next)) break;
      if (!levelCandidates.includes(next)) levelCandidates.push(next);
      const aliasTokens = next.split('_');
      for (let s = 1; s < aliasTokens.length; s++) {
        const suf = aliasTokens.slice(s).join('_');
        if (suf && !levelCandidates.includes(suf)) levelCandidates.push(suf);
      }
      seen.add(next);
      cur = next;
    }
  }

  const dirs = [];
  if (modDataDir && fs.existsSync(modDataDir)) {
    dirs.push(path.join(modDataDir, 'ui', c, 'buildings'));
    dirs.push(path.join(modDataDir, 'ui', c, 'buildings', 'construction'));
    dirs.push(path.join(modDataDir, 'ui', c, 'plugins'));
    dirs.push(path.join(modDataDir, 'ui', c, 'construction'));
  }

  // RIS ships per-level art under roman/, even for non-roman cultures, so
  // roman is checked alongside per-culture, not as a last-resort.
  const romanDirs = [];
  if (c !== 'roman' && modDataDir && fs.existsSync(modDataDir)) {
    romanDirs.push(path.join(modDataDir, 'ui', 'roman', 'buildings'));
    romanDirs.push(path.join(modDataDir, 'ui', 'roman', 'buildings', 'construction'));
    romanDirs.push(path.join(modDataDir, 'ui', 'roman', 'plugins'));
    romanDirs.push(path.join(modDataDir, 'ui', 'roman', 'construction'));
  }

  // Cross-culture fallback order from descr_ui_buildings.txt or sensible default.
  const declaredOrder = (cultureFallbacks && cultureFallbacks[c]) || [];
  const FALLBACK_CULTURES = declaredOrder.length ? declaredOrder : [
    'greek', 'e_hellenistic', 'w_hellenistic', 'barbarian', 'carthaginian',
    'eastern', 'egyptian', 'iberian', 'celtiberian', 'thracian', 'dacian',
    'scythian', 'iranian', 'anatolian', 'germanic', 'brittonic', 'illyrian',
    'arab', 'indian', 'ethiopian', 'libyan',
  ];
  const otherCultureDirs = [];
  for (const oc of FALLBACK_CULTURES) {
    if (oc === c || oc === 'roman') continue;
    if (modDataDir && fs.existsSync(modDataDir)) {
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, 'ui', oc, 'buildings') });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, 'ui', oc, 'buildings', 'construction') });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, 'ui', oc, 'plugins') });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, 'ui', oc, 'construction') });
    }
  }

  // Strict mode rejects 2567-byte vanilla placeholders + tiny construction
  // thumbnails, so the proper-size art has a chance to win in a later pass.
  const VANILLA_PLACEHOLDER_SIZE = 2567;
  const MIN_CARD_DIMENSION = 100;
  const readTga = (dir, fn, strict) => {
    if (!fs.existsSync(dir)) return null;
    const full = path.join(dir, fn);
    if (!fs.existsSync(full)) return null;
    try {
      const buf = fs.readFileSync(full);
      if (strict) {
        if (buf.byteLength === VANILLA_PLACEHOLDER_SIZE) return null;
        if (buf.byteLength >= 18) {
          const w = buf.readUInt16LE(12);
          const h = buf.readUInt16LE(14);
          if (w > 0 && h > 0 && w < MIN_CARD_DIMENSION && h < MIN_CARD_DIMENSION) return null;
        }
      }
      return {
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        path: full,
      };
    } catch { return null; }
  };

  // Chain-name suffix candidates: same trimming logic as levels.
  const chainCandidates = [];
  if (chainName) {
    const ch = String(chainName).toLowerCase();
    const chainTokens = ch.split('_');
    for (let start = 0; start < chainTokens.length; start++) {
      const suffix = chainTokens.slice(start).join('_');
      if (suffix && !chainCandidates.includes(suffix)) chainCandidates.push(suffix);
    }
  }

  const tryNames = (names, dirSet, strict) => {
    for (const fn of names) {
      for (const dir of dirSet) {
        const r = readTga(dir, fn, strict);
        if (r) return r;
      }
    }
    return null;
  };

  // Pass 1 — per-culture, per-level, strict.
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}.tga`, `#${c.toUpperCase()}_${lc}.tga`, `#${lc}.tga`, `${c}_${lc}.tga`], dirs, true);
    if (r) return r;
  }
  // Pass 2 — roman per-level (non-strict).
  if (c !== 'roman' && romanDirs.length) {
    for (const lc of levelCandidates) {
      const r = tryNames([`#roman_${lc}.tga`, `#ROMAN_${lc}.tga`, `roman_${lc}.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Pass 3 — per-culture chain icon, strict.
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}.tga`, `#${c.toUpperCase()}_${cc}.tga`, `#${cc}.tga`, `${c}_${cc}.tga`], dirs, true);
    if (r) return r;
  }
  // Pass 4 — roman chain icon (non-strict).
  if (c !== 'roman' && romanDirs.length) {
    for (const cc of chainCandidates) {
      const r = tryNames([`#roman_${cc}.tga`, `#ROMAN_${cc}.tga`, `roman_${cc}.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Pass 5 — per-culture small/thumbnail icon (non-strict).
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}.tga`, `#${c.toUpperCase()}_${lc}.tga`, `#${lc}.tga`, `${c}_${lc}.tga`], dirs, false);
    if (r) return r;
  }
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}.tga`, `#${c.toUpperCase()}_${cc}.tga`, `#${cc}.tga`, `${c}_${cc}.tga`], dirs, false);
    if (r) return r;
  }
  // Pass 6 — per-culture wide `_constructed` banner.
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}_constructed.tga`], dirs, false);
    if (r) return r;
  }
  // Pass 7 — roman wide `_constructed` banner.
  if (c !== 'roman' && romanDirs.length) {
    for (const lc of levelCandidates) {
      const r = tryNames([`#roman_${lc}_constructed.tga`], romanDirs, false);
      if (r) return r;
    }
    for (const cc of chainCandidates) {
      const r = tryNames([`#roman_${cc}_constructed.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}_constructed.tga`], dirs, false);
    if (r) return r;
  }
  // Cross-culture fallback.
  for (const lc of levelCandidates) {
    for (const { dir } of otherCultureDirs) {
      const r = readTga(dir, `#${culture}_${lc}.tga`, false); if (r) return r;
    }
  }
  for (const cc of chainCandidates) {
    for (const { dir } of otherCultureDirs) {
      const r = readTga(dir, `#${culture}_${cc}.tga`, false); if (r) return r;
    }
  }
  for (const lc of levelCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${lc}.tga`, false); if (r) return r;
    }
  }
  // Generic fallback.
  const genericRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) {
    genericRoots.push(path.join(modDataDir, 'ui', 'generic'));
  }
  for (const dir of genericRoots) {
    const got = readTga(dir, 'generic_building.tga', false);
    if (got) return got;
  }
  return null;
});

// ── Master pipeline: building allowlist + run ──────────────────────────

const ALLOWLIST_FILE = () => path.join(PROJECT_ROOT, 'config', 'building_allowlist.json');

ipcMain.handle('sps:load-allowlist', async () => {
  try {
    const file = ALLOWLIST_FILE();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('sps:save-allowlist', async (_, data) => {
  try {
    const file = ALLOWLIST_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Returns {chains: {name: count}, levels: {chain: {level: count}}, totalBuildings, settlementCount}
// Counts how many settlements use each chain/level in the current config/descr_strat.txt.
ipcMain.handle('sps:get-strat-stats', async () => {
  const stratPath = path.join(PROJECT_ROOT, 'config', 'descr_strat.txt');
  if (!fs.existsSync(stratPath)) {
    return { chains: {}, levels: {}, totalBuildings: 0, settlementCount: 0 };
  }
  const text = fs.readFileSync(stratPath, 'utf-8');
  const chains = {};
  const levels = {};
  let totalBuildings = 0;
  let settlementCount = 0;

  const settlementBlocks = text.matchAll(/settlement\s*\{([\s\S]*?)\n\}/g);
  for (const m of settlementBlocks) {
    settlementCount++;
    const block = m[1];
    for (const tm of block.matchAll(/type\s+(\S+)\s+(\S+)/g)) {
      const chain = tm[1];
      const level = tm[2];
      chains[chain] = (chains[chain] || 0) + 1;
      if (!levels[chain]) levels[chain] = {};
      levels[chain][level] = (levels[chain][level] || 0) + 1;
      totalBuildings++;
    }
  }
  return { chains, levels, totalBuildings, settlementCount };
});

ipcMain.handle('sps:run-master', async (event) => {
  const scriptPath = path.join(PROJECT_ROOT, 'master_processor.py');
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `master_processor.py not found at ${scriptPath}` };
  }

  return new Promise((resolve) => {
    const proc = spawn(resolvePython(), [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      sendToScripts('master-output', { text, stream: 'stdout' });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      sendToScripts('master-output', { text, stream: 'stderr' });
    });

    proc.on('close', (code) => {
      const result = { success: code === 0, stdout, stderr, code };
      sendToScripts('master-done', result);
      resolve(result);
    });

    proc.on('error', (err) => {
      const result = { success: false, error: err.message, stdout, stderr };
      sendToScripts('master-done', result);
      resolve(result);
    });
  });
});

// ── Shared parsers (ported from Provincia) ───────────────────────────

// descr_regions.txt — RTW:R uses 8-line region blocks (region, city, faction,
// culture, RGB, tags, farm_level, pop_level). Original RTW added a 9th
// "ethnicities" line. Detect the variant by checking whether the line after
// pop_level looks like a new region start (non-indented name) or a value.
function parseDescrRegions(text) {
  const lines = text.split(/\r?\n/);
  const regions = {};
  const isRegionStart = (raw) => {
    if (raw == null) return false;
    if (/^\s/.test(raw)) return false;
    const t = raw.trim();
    if (!t || t.startsWith(';')) return false;
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(t);
  };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = (raw || '').trim();
    if (!line || line.startsWith(';')) { i++; continue; }
    if (i + 7 >= lines.length) break;
    const region = line;
    const city = lines[i + 1].trim();
    const faction = lines[i + 2].trim();
    const culture = lines[i + 3].trim();
    const rgbParts = lines[i + 4].trim().split(/\s+/);
    if (rgbParts.length !== 3 || !/^\d+$/.test(rgbParts[0])) { i++; continue; }
    const rgbKey = rgbParts.join(',');
    const tags = lines[i + 5].trim();
    const farm_level = lines[i + 6].trim();
    const pop_level = lines[i + 7].trim();
    let ethnicities = '';
    let step = 8;
    const nextRaw = lines[i + 8];
    if (nextRaw != null && !isRegionStart(nextRaw)) {
      const nt = (nextRaw || '').trim();
      if (nt && !nt.startsWith(';')) { ethnicities = nt; step = 9; }
    }
    regions[rgbKey] = { region, city, faction, culture, tags, farm_level, pop_level, ethnicities };
    i += step;
  }
  return regions;
}

// descr_strat.txt → which regions each faction owns.
function parseDescrStratFactions(text) {
  const lines = text.split(/\r?\n/);
  const factionRegions = {};
  let currentFaction = null;
  let inSettlement = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith(';')) continue;
    const fm = s.match(/^faction\s+(\w+)/);
    if (fm) {
      currentFaction = fm[1].toLowerCase();
      if (!factionRegions[currentFaction]) factionRegions[currentFaction] = [];
      inSettlement = false;
      continue;
    }
    if (s === 'settlement') { inSettlement = true; continue; }
    if (s === '}' && inSettlement) { inSettlement = false; continue; }
    if (inSettlement && s.startsWith('region')) {
      const rn = s.replace('region', '').trim();
      if (currentFaction && rn) factionRegions[currentFaction].push(rn);
    }
  }
  return Object.fromEntries(Object.entries(factionRegions).filter(([, v]) => v.length > 0));
}

// descr_strat.txt → faction → [{ region, level, population, faction_creator, buildings: [{type, level}] }]
function parseDescrStratBuildings(text) {
  const lines = text.split(/\r?\n/);
  let startIdx = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].includes('; >>>> start of factions section <<<<')) { startIdx = idx + 1; break; }
  }
  const getBlock = (start) => {
    let braces = 0, found = false;
    for (let j = start; j < lines.length; j++) {
      if (lines[j].includes('{')) found = true;
      if (found) {
        braces += (lines[j].match(/{/g) || []).length;
        braces -= (lines[j].match(/}/g) || []).length;
      }
      if (found && braces === 0) return { block: lines.slice(start, j + 1), end: j };
    }
    return { block: [], end: start };
  };
  const extractMeta = (block) => {
    let region = null, level = 'town', population = null, faction_creator = null;
    const buildings = [];
    let inBuilding = false;
    for (const ln of block) {
      const s = ln.trim();
      if (s.startsWith('region')) { const p = s.split(/\s+/); if (p.length >= 2) region = p[1]; }
      else if (s.startsWith('level')) { const p = s.split(/\s+/); if (p.length >= 2) level = p[1]; }
      else if (s.startsWith('population')) { const p = s.split(/\s+/); if (p.length >= 2) population = parseInt(p[1], 10) || null; }
      else if (s.startsWith('faction_creator')) { const p = s.split(/\s+/); if (p.length >= 2) faction_creator = p[1]; }
      else if (s.startsWith('building')) inBuilding = true;
      else if (inBuilding && s.startsWith('type')) { const p = s.split(/\s+/); if (p.length >= 3) buildings.push({ type: p[1], level: p[2] }); }
      else if (inBuilding && s.includes('}')) inBuilding = false;
    }
    return { region, level, population, faction_creator, buildings };
  };
  const factions = [];
  let i = startIdx;
  while (i < lines.length) {
    const s = lines[i].trim();
    const fm = s.match(/^faction\s+([^\s,]+)/);
    if (fm) {
      const factionName = fm[1];
      const settlements = [];
      i++;
      while (i < lines.length) {
        const s2 = lines[i].trim();
        if (s2.startsWith('faction') || s2.startsWith('; >>>>')) break;
        if (s2.startsWith('settlement')) { const { block, end } = getBlock(i); settlements.push(extractMeta(block)); i = end + 1; }
        else i++;
      }
      factions.push({ faction: factionName, settlements });
    } else i++;
  }
  return factions;
}

// descr_sm_factions.txt → { factionId: { primary: [r,g,b], secondary: [r,g,b] } }
function parseSmFactions(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentFaction = null;
  let braceDepth = 0;
  let wasInBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith(';;') || s.startsWith(';')) continue;
    const prevDepth = braceDepth;
    for (const ch of s) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    if (wasInBlock && braceDepth === 0) {
      currentFaction = null;
      wasInBlock = false;
    }
    if (prevDepth === 0 && braceDepth === 0) {
      const fm = s.match(/^"([^"]+)"\s*:\s*(?:;.*)?$/);
      if (fm) {
        const name = fm[1].toLowerCase();
        if (name !== 'factions') currentFaction = name;
      }
    }
    if (currentFaction && prevDepth === 0 && braceDepth === 1) wasInBlock = true;
    if (currentFaction && braceDepth >= 1) {
      const cm = s.match(/"(primary|secondary)"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (cm) {
        if (!result[currentFaction]) result[currentFaction] = {};
        result[currentFaction][cm[1]] = [parseInt(cm[2]), parseInt(cm[3]), parseInt(cm[4])];
      }
    }
  }
  return result;
}

// ── Typo detection (Levenshtein, capped — ported from Manipula) ──────

function levenshtein(a, b, maxDist) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[n];
}

function findNearMatch(query, candidates, maxDist) {
  let best = null;
  let bestDist = maxDist + 1;
  for (const c of candidates) {
    if (c === query) continue;
    const d = levenshtein(query, c, maxDist);
    if (d < bestDist) { bestDist = d; best = c; if (d === 1) break; }
  }
  return bestDist <= maxDist ? best : null;
}

// ── Validation: check output descr_strat.txt for issues ──

const TIER_ORDER = ['village', 'town', 'large_town', 'minor_city', 'city', 'large_city', 'huge_city'];
const LEVEL_TO_TIER_VAL = { village: 0, town: 1, large_town: 2, minor_city: 3, city: 3, large_city: 4, huge_city: 5 };

ipcMain.handle('sps:validate-output', async () => {
  const configDir = path.join(PROJECT_ROOT, 'config');
  const stratPath = path.join(configDir, 'descr_strat.txt');
  const edbPath = path.join(configDir, 'export_descr_buildings.txt');
  const regionsPath = path.join(configDir, 'descr_regions.txt');
  const factionsPath = path.join(configDir, 'descr_sm_factions.txt');

  if (!fs.existsSync(stratPath)) return { warnings: [], errors: [] };

  const stratContent = fs.readFileSync(stratPath, 'utf-8');
  const edbContent = fs.existsSync(edbPath) ? fs.readFileSync(edbPath, 'utf-8') : '';
  const regionsContent = fs.existsSync(regionsPath) ? fs.readFileSync(regionsPath, 'utf-8') : '';
  const factionsContent = fs.existsSync(factionsPath) ? fs.readFileSync(factionsPath, 'utf-8') : '';

  // EDB indices: chain → level names, level → chain, level → settlement_min
  const chainLevels = {};
  const levelToChain = {};
  const levelMinSettlement = {};
  const edbBuildings = parseEDB(edbContent);
  for (const b of edbBuildings) {
    chainLevels[b.name] = b.levels.map(l => l.name);
    for (const l of b.levels) {
      levelToChain[l.name] = b.name;
      if (l.settlementMin) levelMinSettlement[l.name] = l.settlementMin;
    }
  }
  const knownChains = new Set(Object.keys(chainLevels));
  const knownLevels = new Set(Object.keys(levelToChain));

  // Region index: every region declared in descr_regions.txt
  const regionsByRgb = regionsContent ? parseDescrRegions(regionsContent) : {};
  const knownRegions = new Set(Object.values(regionsByRgb).map(r => r.region).filter(Boolean));

  // Faction index from descr_sm_factions.txt (lowercased ids)
  const smFactions = factionsContent ? parseSmFactions(factionsContent) : {};
  const knownFactions = new Set(Object.keys(smFactions));

  const warnings = [];
  const errors = [];
  const seenUnknownChain = new Set();
  const seenUnknownRegion = new Set();
  const seenUnknownFaction = new Set();

  // Walk faction → settlements via Provincia parser (handles the start-of-factions
  // marker and brace-balanced settlement blocks robustly).
  const stratFactions = parseDescrStratBuildings(stratContent);

  for (const f of stratFactions) {
    const factionId = (f.faction || '').toLowerCase();
    if (factionId && knownFactions.size && !knownFactions.has(factionId)
        && !seenUnknownFaction.has(factionId)) {
      seenUnknownFaction.add(factionId);
      const near = findNearMatch(factionId, knownFactions, 2);
      errors.push({
        type: 'unknown_faction',
        region: '(faction header)',
        message: `Faction "${f.faction}" is not declared in descr_sm_factions.txt${near ? ` — did you mean "${near}"?` : ''}`,
      });
    }

    for (const s of f.settlements) {
      const region = s.region;
      const level = s.level;
      if (!region || !level) continue;
      const tier = LEVEL_TO_TIER_VAL[level] !== undefined ? LEVEL_TO_TIER_VAL[level] : 0;

      // Region must exist in descr_regions.txt
      if (knownRegions.size && !knownRegions.has(region) && !seenUnknownRegion.has(region)) {
        seenUnknownRegion.add(region);
        const near = findNearMatch(region, knownRegions, 2);
        errors.push({
          type: 'unknown_region',
          region,
          message: `${region}: region not declared in descr_regions.txt${near ? ` — did you mean "${near}"?` : ''}`,
        });
      }

      // Settlement level must be a known M2TW level keyword
      if (LEVEL_TO_TIER_VAL[level] === undefined) {
        const near = findNearMatch(level, new Set(TIER_ORDER), 2);
        errors.push({
          type: 'unknown_level',
          region,
          message: `${region}: unknown settlement level "${level}"${near ? ` — did you mean "${near}"?` : ''}`,
        });
      }

      const buildings = s.buildings || [];

      // Check 1: Duplicate chains
      const chainCounts = {};
      for (const bt of buildings) {
        chainCounts[bt.type] = (chainCounts[bt.type] || 0) + 1;
      }
      for (const [chain, count] of Object.entries(chainCounts)) {
        if (count > 1) {
          errors.push({
            type: 'duplicate_chain',
            region,
            message: `${region}: Duplicate building chain "${chain}" (${count} instances)`,
          });
        }
      }

      // Check 2: Multiple buildings from same parent chain family
      const seenChains = new Set();
      for (const bt of buildings) {
        const parentChain = levelToChain[bt.level] || bt.type;
        if (seenChains.has(parentChain)) {
          errors.push({
            type: 'duplicate_family',
            region,
            message: `${region}: Multiple buildings from chain "${parentChain}" — has both duplicate entries`,
          });
        }
        seenChains.add(parentChain);
      }

      // Check 3: Building level exceeds settlement tier
      for (const bt of buildings) {
        const minSettlement = levelMinSettlement[bt.level];
        if (minSettlement) {
          const requiredTier = LEVEL_TO_TIER_VAL[minSettlement] || 0;
          if (tier < requiredTier) {
            warnings.push({
              type: 'tier_exceeded',
              region,
              message: `${region}: Building "${bt.level}" requires ${minSettlement} (tier ${requiredTier}) but settlement is ${level} (tier ${tier})`,
              building: bt.level,
              required: minSettlement,
              actual: level,
            });
          }
        }
      }

      // Check 4: Chain referenced in strat must exist in EDB (with typo suggestion)
      if (knownChains.size) {
        for (const bt of buildings) {
          if (!knownChains.has(bt.type) && !seenUnknownChain.has(bt.type)) {
            seenUnknownChain.add(bt.type);
            const near = findNearMatch(bt.type, knownChains, 2);
            errors.push({
              type: 'unknown_chain',
              region,
              message: `${region}: building chain "${bt.type}" not declared in export_descr_buildings.txt${near ? ` — did you mean "${near}"?` : ''}`,
            });
          }
        }
      }

      // Check 5: Specific level must be valid for the chain (with typo suggestion)
      if (knownLevels.size) {
        for (const bt of buildings) {
          if (!knownLevels.has(bt.level)) continue; // unknown chain handles separately
          const expectedChain = levelToChain[bt.level];
          if (expectedChain && expectedChain !== bt.type) {
            errors.push({
              type: 'level_chain_mismatch',
              region,
              message: `${region}: level "${bt.level}" belongs to chain "${expectedChain}", not "${bt.type}"`,
            });
          }
        }
      }
    }
  }

  return { warnings, errors };
});

// ── Provincia integration handlers + registration ──────────────────────

// The mod Provincia currently has loaded, so the Scripts window can auto-source
// it instead of prompting for a folder. Returns the same shape applyModData()
// expects in the renderer: { dataDir, displayName, campaigns, selectedCampaign }
// — or null if Provincia has no mod loaded (renderer then falls back to prefs).
ipcMain.handle('sps:get-host-mod', () => {
  try {
    const host = hostModGetter();
    if (!host || !host.dataDir || !fs.existsSync(host.dataDir)) return null;
    const campaigns = findCampaigns(host.dataDir);
    if (!campaigns.length) return null;
    const selectedCampaign = campaigns.includes('imperial_campaign')
      ? 'imperial_campaign' : campaigns[0];
    const displayName = host.displayName
      || path.basename(path.dirname(host.dataDir)) || 'Provincia mod';
    return { dataDir: host.dataDir, displayName, campaigns, selectedCampaign };
  } catch {
    return null;
  }
});

// Opened from Provincia's dev pill.
ipcMain.handle('sps:open-window', () => { openScriptsWindow(); return true; });

// Called once from Provincia's main.js after the app is ready. Wires the
// host-mod getter and seeds the working dir from the bundled scripts/config.
function registerScriptSuite(opts) {
  if (opts && typeof opts.getHostMod === 'function') hostModGetter = opts.getHostMod;
  seedProject();
}

module.exports = { registerScriptSuite, openScriptsWindow };
