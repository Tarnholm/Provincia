// RTW:R install/mod path resolution + localized-text dictionary helpers,
// extracted verbatim from main.js (2026-07-17). Exports findRtwInstallRoot,
// getVanillaDataDir (with its _vanillaDataDir cache), getIconSearchRoots
// (with ICON_SEARCH_ROOTS), findRelatedModDirs, getEdbSourceFiles,
// readTextDictionary (with _textDictCache, exported so clear-mod-caches in
// main.js can clear it), and getMergedTextDictionary. Logic unchanged.
"use strict";
const fs = require("fs");
const path = require("path");
const { parseTextDictionary } = require("./mainUtils.js");

// Locate the RTW:R install root. Tries common Steam install paths first,
// then falls back to the Steam library config to resolve non-default
// library locations (users with Steam on a secondary drive).
// Locate the RTW:R install ROOT (the folder — or Mac .app bundle — that
// contains `Contents/Resources/Data/data`). Auto-detects across:
//   • Windows Steam: common drive letters, the Steam path from the registry,
//     and every library in libraryfolders.vdf (Steam on a secondary drive).
//   • Windows Epic Games.
//   • macOS (Feral): /Applications and ~/Applications.
// Returns a path consumed as `${root}/Contents/Resources/Data/...`, so the
// Mac entry is the .app bundle itself (NOT .../Contents/Resources/Data).
function findRtwInstallRoot() {
  const REL = "Total War ROME REMASTERED";
  // Steam install/library dirs to probe for /steamapps/common/<REL>.
  const steamDirs = [];
  for (const drive of ["C:", "D:", "E:", "F:", "G:", "H:"]) {
    steamDirs.push(`${drive}/Program Files (x86)/Steam`, `${drive}/Program Files/Steam`, `${drive}/Steam`, `${drive}/SteamLibrary`);
  }
  // Steam install dir straight from the Windows registry (catches custom dirs).
  try {
    if (process.platform === "win32") {
      const { execSync } = require("child_process");
      const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) steamDirs.unshift(m[1].trim().replace(/\\/g, "/"));
    }
  } catch {}
  // Expand each Steam dir's libraryfolders.vdf into extra library roots.
  for (const sdir of [...steamDirs]) {
    const vdfPath = `${sdir}/steamapps/libraryfolders.vdf`;
    try {
      if (!fs.existsSync(vdfPath)) continue;
      const text = fs.readFileSync(vdfPath, "utf8");
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(text)) !== null) steamDirs.push(m[1].replace(/\\\\/g, "/").replace(/\\/g, "/"));
    } catch {}
  }
  const candidates = [];
  for (const s of steamDirs) candidates.push(`${s}/steamapps/common/${REL}`);
  // Epic Games (Windows).
  for (const drive of ["C:", "D:", "E:"]) {
    candidates.push(`${drive}/Program Files/Epic Games/TotalWarRomeRemastered`);
    candidates.push(`${drive}/Program Files/Epic Games/${REL}`);
  }
  // macOS (Feral) — the .app bundle is the root.
  candidates.push(`/Applications/${REL}.app`);
  if (process.env.HOME) candidates.push(`${process.env.HOME}/Applications/${REL}.app`);
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

// Cached vanilla RTW:R `…/data` dir (the one containing `ui/`), derived from
// the detected install root. null when no install is found. Logged once so
// provincia.log shows whether the auto-detect succeeded — when portraits/icons
// fail to resolve, this line tells you if it's the vanilla fallback that's
// missing. See [resolve-portrait] NO PORTRAIT diagnostics.
let _vanillaDataDir; // undefined = not computed yet
function getVanillaDataDir() {
  if (_vanillaDataDir !== undefined) return _vanillaDataDir;
  _vanillaDataDir = null;
  try {
    const root = findRtwInstallRoot();
    if (root) {
      const dd = path.join(root, "Contents", "Resources", "Data", "data");
      if (fs.existsSync(dd)) _vanillaDataDir = dd;
    }
  } catch {}
  try { console.log(`[rtw-detect] vanilla RTW:R data dir: ${_vanillaDataDir || "(not found — auto-detect failed; portrait/icon vanilla fallback unavailable)"}`); } catch {}
  return _vanillaDataDir;
}

const ICON_SEARCH_ROOTS = [];
function getIconSearchRoots() {
  if (ICON_SEARCH_ROOTS.length) return ICON_SEARCH_ROOTS;
  const root = findRtwInstallRoot();
  if (!root) return ICON_SEARCH_ROOTS;
  // Always include the vanilla + BI + Alexander game installs if present.
  // Load order matters for last-wins text-file merges (expanded_bi.txt,
  // export_buildings.txt): Alex must come AFTER BI so its expansion-specific
  // overrides (GAULS→Dahae, GERMANS→Illyria, PARTHIA→Persia, etc.) win.
  const base = `${root}/Contents/Resources/Data`;
  const tryAdd = (p) => { try { if (p && fs.existsSync(p)) ICON_SEARCH_ROOTS.push(p); } catch {} };
  tryAdd(`${base}/data`);
  tryAdd(`${base}/bi/data`);
  tryAdd(`${base}/alexander/data`);
  return ICON_SEARCH_ROOTS;
}

// Walk up from a mod data dir looking for "sibling" or "parent" data dirs
// that also contain the target relative file. Handles layered mods like RIS
// where a submod at `.../RIS/_submods/RIS_Classic/data` extends the main mod
// at `.../RIS/RIS/data` — both must be read for display names to resolve.
// Returns an ordered list: innermost/submod first, then parents.
function findRelatedModDirs(modDataDir, relPath) {
  if (!modDataDir) return [];
  const found = new Set();
  const result = [];
  const norm = modDataDir.replace(/\\/g, "/");
  // Add the user-specified dir itself first.
  if (fs.existsSync(path.join(modDataDir, relPath))) {
    result.push(modDataDir);
    found.add(path.resolve(modDataDir));
  }
  // Walk up to 5 levels and scan siblings for `*/data/<relPath>`.
  let cur = norm;
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    try {
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(parent, entry.name, "data");
        const key = path.resolve(candidate);
        if (found.has(key)) continue;
        if (fs.existsSync(path.join(candidate, relPath))) {
          found.add(key);
          result.push(candidate);
        }
      }
    } catch {}
    cur = parent;
  }
  return result;
}

// Total conversions like RIS replace vanilla wholesale; merging vanilla
// EDB/EDU into the source list with last-wins-per-(chain, level) leaks
// vanilla recruits ("hoplite") whenever the mod doesn't redefine the
// exact same chain+level pair. When a mod data dir is provided AND
// contains the requested file, return ONLY the mod sources (mod dir +
// any related submods/parents). Otherwise fall back to vanilla.
function getEdbSourceFiles(modDataDir, relPath) {
  const modDirs = findRelatedModDirs(modDataDir, relPath);
  if (modDirs.length > 0) {
    return modDirs.slice().reverse().map((d) => path.join(d, relPath));
  }
  return getIconSearchRoots().map((r) => path.join(r, relPath));
}

// Parse an RTW localized text file (text/export_units.txt /
// export_buildings.txt). Format: each entry starts with `{key}content`,
// content can span multiple lines until the next `{...}` line. UTF-16LE
// with BOM is the common encoding; falls back to UTF-8.
const _textDictCache = new Map(); // filePath -> { key: text }
function readTextDictionary(filePath) {
  if (_textDictCache.has(filePath)) return _textDictCache.get(filePath);
  if (!filePath || !fs.existsSync(filePath)) {
    _textDictCache.set(filePath, {});
    return {};
  }
  try {
    const buf = fs.readFileSync(filePath);
    let text;
    if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString("utf16le", 2);
    else if (buf[0] === 0xfe && buf[1] === 0xff) text = buf.swap16().toString("utf16le", 2);
    else text = buf.toString("utf8");
    const entries = parseTextDictionary(text); // pure parser in src/mainUtils.js
    _textDictCache.set(filePath, entries);
    return entries;
  } catch (e) {
    console.warn("[textDict]", filePath, e.message);
    _textDictCache.set(filePath, {});
    return {};
  }
}

// Merge text dictionaries from mod + game text files. Mod entries win.
function getMergedTextDictionary(modDataDir, relPath) {
  const sources = getEdbSourceFiles(modDataDir, relPath);
  const merged = {};
  for (const src of sources) {
    const dict = readTextDictionary(src);
    Object.assign(merged, dict);
  }
  return merged;
}

module.exports = {
  findRtwInstallRoot,
  getVanillaDataDir,
  getIconSearchRoots,
  findRelatedModDirs,
  getEdbSourceFiles,
  readTextDictionary,
  getMergedTextDictionary,
  _textDictCache, // exported by reference — cleared by main.js clear-mod-caches
};
