// Building/unit EDB+EDU query handlers, extracted from main.js (2026-07-15).
// register(ipcMain, { getEdbSourceFiles, getMergedTextDictionary,
// _buildingStatsCache, _chainLevelsCache }) wires get-building-stats /
// get-building-description / get-building-chain-levels / find-edb-chain /
// find-edu-type. The _findInFile + _firstExisting helpers are defined + used
// only here so they travel inside the module; the two caches stay in main.js
// (an external clear-caches handler .clear()s them) and are injected. Logic
// unchanged from the inline handlers.
"use strict";
const fs = require("fs");
const path = require("path");

function registerBuildingInfoHandlers(ipcMain, { getEdbSourceFiles, getMergedTextDictionary, findRelatedModDirs, getIconSearchRoots, _buildingStatsCache, _chainLevelsCache }) {
ipcMain.handle("get-building-stats", async (_event, modDataDir, levelName, chainName) => {
  if (!levelName || !chainName) return null;
  const cacheKey = (modDataDir || "") + "|" + chainName + "|" + levelName;
  if (_buildingStatsCache.has(cacheKey)) return _buildingStatsCache.get(cacheKey);
  const sources = getEdbSourceFiles(modDataDir, "export_descr_buildings.txt");
  // Mod-first: reverse so the override wins on first match.
  for (const src of sources.slice().reverse()) {
    if (!fs.existsSync(src)) continue;
    let text;
    try {
      const buf = fs.readFileSync(src);
      text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le", 2) : buf.toString("utf8");
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    const stripComments = (s) => { const idx = s.indexOf(";"); return idx >= 0 ? s.slice(0, idx) : s; };
    let i = 0;
    const chainRe = new RegExp(`^\\s*building\\s+${chainName}\\b`);
    while (i < lines.length && !chainRe.test(lines[i])) i++;
    if (i >= lines.length) continue;
    // Capture the chain's `levels` list — the canonical tier ladder.
    let chainLadder = null;
    for (let j = i + 1; j < Math.min(i + 80, lines.length); j++) {
      const t = stripComments(lines[j]).trim();
      if (!t || t === "{" || t === "}") continue;
      const lm = t.match(/^levels\s+(.+)$/);
      if (lm) { chainLadder = lm[1].trim().split(/\s+/).filter(Boolean); break; }
      if (/^building\b/.test(t)) break;
    }
    // Find the level header inside the chain block.
    const levelRe = new RegExp(`^\\s*${levelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+requires\\b`);
    while (i < lines.length && !levelRe.test(lines[i])) i++;
    if (i >= lines.length) continue;
    i++;
    // Walk to the level body's opening brace.
    while (i < lines.length && stripComments(lines[i]).trim() !== "{") i++;
    if (i >= lines.length) continue;
    i++;
    // Extract everything inside the level body using brace balance.
    let depth = 1;
    const body = [];
    while (i < lines.length && depth > 0) {
      const raw = lines[i];
      for (const ch of raw) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth > 0) body.push(raw);
      i++;
    }
    // Parse the body.
    let cost = null, construction = null, settlementMin = null;
    const capabilities = [];
    const recruits = []; // { unit, requires } — what THIS level adds
    let inCap = false, capDepth = 0;
    // RIS (and most modern RTW mods) use the `dummy <key> bonus N
    // [requires ...]` capability syntax. The engine ignores `dummy`
    // at runtime, but the building browser displays the human string
    // keyed by `<key>` in text/expanded_bi.txt. Resolve those keys
    // server-side so the popup shows what the in-game UI would show.
    const expandedDict = getMergedTextDictionary(modDataDir, "text/expanded_bi.txt");
    for (const raw of body) {
      const s = stripComments(raw).trim();
      if (!s) continue;
      if (!inCap) {
        if (/^capability\b/.test(s)) { inCap = true; capDepth = 0; continue; }
        const cm = s.match(/^cost\s+(\d+)/);
        if (cm) { cost = parseInt(cm[1], 10); continue; }
        const tm = s.match(/^construction\s+(\d+)/);
        if (tm) { construction = parseInt(tm[1], 10); continue; }
        const sm = s.match(/^settlement_min\s+(\S+)/);
        if (sm) { settlementMin = sm[1]; continue; }
      } else {
        for (const ch of s) {
          if (ch === "{") capDepth++;
          else if (ch === "}") { capDepth--; if (capDepth <= 0) { inCap = false; capDepth = 0; } }
        }
        if (s === "{" || s === "}") continue;
        const rm = s.match(/^recruit\s+"([^"]+)"\s*(?:\d+)?(?:\s+requires\s+(.+))?$/);
        if (rm) { recruits.push({ unit: rm[1], requires: rm[2] || null }); continue; }
        // Try to resolve a dummy-capability key against expanded_bi.txt.
        // Format: `dummy <key> bonus <N> [requires ...]`. Some mods also
        // omit `bonus` for boolean-flag style keys.
        const dm = s.match(/^dummy\s+(\S+)(?:\s+bonus\s+(-?\d+))?(?:\s+requires\s+(.+))?$/);
        let resolved = null;
        if (dm) {
          const key = dm[1];
          const bonus = dm[2] != null ? parseInt(dm[2], 10) : null;
          const text = expandedDict[key];
          if (text) {
            resolved = bonus != null ? `${text} (×${bonus})` : text;
          }
        }
        capabilities.push({ raw: s, resolved });
      }
    }
    const tierIndex = chainLadder ? chainLadder.indexOf(levelName) : -1;
    const result = {
      cost, construction, settlementMin,
      capabilities,
      recruits,
      chainLadder,
      tierIndex,
      tierMax: chainLadder ? chainLadder.length : null,
    };
    _buildingStatsCache.set(cacheKey, result);
    return result;
  }
  _buildingStatsCache.set(cacheKey, null);
  return null;
});

// IPC: return long-form building description from text/export_buildings.txt.
// RTW keys these by level NAME with `_desc` / `_desc_short` suffixes (note:
// units use `_descr` / `_descr_short` — buildings drop the second `r`).
// Culture variants are common: `{governors_house_barbarian_desc}` etc., so
// we try `<level>_<culture>` → `<level>` → `<chain>_<culture>` → `<chain>`
// for the displayName, and the `_desc`/`_desc_short` siblings of whichever
// key resolves first. This matches the in-game lookup order.
ipcMain.handle("get-building-description", async (_event, modDataDir, levelName, chainName, culture) => {
  if (!levelName && !chainName) return null;
  const dict = getMergedTextDictionary(modDataDir, "text/export_buildings.txt");
  const candidates = [];
  for (const base of [levelName, chainName].filter(Boolean)) {
    if (culture) candidates.push(base + "_" + culture);
    candidates.push(base);
  }
  for (const key of candidates) {
    const displayName = dict[key];
    const short = dict[key + "_desc_short"];
    const long = dict[key + "_desc"];
    if (displayName || short || long) {
      return { displayName: displayName || null, short: short || null, long: long || null };
    }
  }
  return null;
});

// IPC: return the merged building display-name map from the mod + game
// export_buildings.txt files. Format: { "<levelname>": "Display Name",
// "<levelname>_<culture>": "Culture-Specific Name" }.
// Caller should look up `<level>_<culture>` first, then `<level>`, then the
// bundled fallback.
// IPC: parse export_descr_buildings.txt from the mod + game installs and
// return the chain → [level1, level2, …] map. This is the source of truth
// for building tiers — the `levels` line inside `building <chainName> { … }`
// lists the ladder in order, so the 1-based index is the tier. Last-wins
// merge (mod wins over game; Alex wins over BI wins over vanilla).
ipcMain.handle("get-building-chain-levels", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_chainLevelsCache.has(cacheKey)) return _chainLevelsCache.get(cacheKey);
  const map = {};
  const sources = getEdbSourceFiles(modDataDir, "export_descr_buildings.txt");
  const stripComments = (line) => {
    // Strip `;...` (comment to EOL) but leave quoted content alone — EDB uses
    // `;` for comments; no multi-line comments to worry about.
    const i = line.indexOf(";");
    return i >= 0 ? line.slice(0, i) : line;
  };
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      let curChain = null;
      for (let i = 0; i < lines.length; i++) {
        const raw = stripComments(lines[i]).trim();
        if (!raw) continue;
        // `building <chainName>` begins a new chain block.
        const cm = raw.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        if (cm) { curChain = cm[1]; continue; }
        if (!curChain) continue;
        // `levels level_a level_b level_c …` — space-separated, optional
        // trailing `{`. Can appear on its own line; sometimes followed by `{`
        // on the next line.
        const lm = raw.match(/^levels\s+(.+?)\s*\{?\s*$/);
        if (lm) {
          const levels = lm[1].split(/\s+/).filter(Boolean);
          if (levels.length > 0) map[curChain] = levels;
          curChain = null; // one levels line per chain
        }
      }
    } catch (e) { console.warn("[chain-levels]", src, e.message); }
  }
  _chainLevelsCache.set(cacheKey, map);
  return map;
});

// IPC: parse export_descr_unit.txt for unit → list of factions that own it.
// Alex's EDB allows units broadly per-building-level, but EDU's ownership
// line is the ground truth for "can this faction actually recruit this unit".
//
// Returns { unitName: [faction, ...] } as before, but also injects a special
// key `__dictionary` mapping unitName → dictionary (icon basename). AOR units
// have type "aor X Y" but icons are keyed by dictionary "X_Y" — the renderer
// uses this to resolve the right icon path.
const _unitOwnershipCache = new Map();
// Locate a building chain in export_descr_buildings.txt and a unit type in
// export_descr_unit.txt. Returns the absolute path + 1-based line number.
// Used by the dev right-click "Show in EDB / EDU" menu items.
function _findInFile(srcPath, regex) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  try {
    const buf = fs.readFileSync(srcPath);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return { path: srcPath, line: i + 1 };
    }
  } catch {}
  return null;
}
function _firstExisting(modDataDir, fileName) {
  if (modDataDir) {
    const p = path.join(modDataDir, fileName);
    if (fs.existsSync(p)) return p;
  }
  for (const d of (findRelatedModDirs ? findRelatedModDirs(modDataDir, fileName) : [])) {
    const p = path.join(d, fileName);
    if (fs.existsSync(p)) return p;
  }
  for (const root of getIconSearchRoots()) {
    const p = path.join(root, fileName);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
ipcMain.handle("find-edb-chain", async (_event, modDataDir, chainName) => {
  if (!chainName) return null;
  const src = _firstExisting(modDataDir, "export_descr_buildings.txt");
  return _findInFile(src, new RegExp(`^\\s*building\\s+${chainName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "m"))
    || (src ? { path: src, line: 1 } : null);
});
ipcMain.handle("find-edu-type", async (_event, modDataDir, unitType) => {
  if (!unitType) return null;
  const src = _firstExisting(modDataDir, "export_descr_unit.txt");
  // EDU `type` lines aren't quoted; match exactly.
  return _findInFile(src, new RegExp(`^\\s*type\\s+${unitType.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`))
    || (src ? { path: src, line: 1 } : null);
});
}

module.exports = { registerBuildingInfoHandlers };
