// Building/unit info + icon-resolution IPC handlers, extracted from main.js
// (2026-07-15). register(ipcMain, deps) wires get-unit-ownership / get-unit-stats
// / get-unit-upkeep-map / get-building-recruits / get-building-display-names /
// resolve-building-icon(+bulk) / replace-building-icon / revert-building-icon /
// resolve-building-banner / resolve-unit-info / resolve-unit-card, plus the
// helpers getUnitUpkeepMap / parseDescrUiBuildings / resolveBuildingIconCore that
// travel with them. All caches stay declared in main.js and are INJECTED (single
// instances, so clear-mod-caches keeps working). activeModDataDir is read via the
// injected getter. Logic unchanged from the inline handlers.
"use strict";
const fs = require("fs");
const path = require("path");
const { encodeTga32BGRA } = require("./tgaCodec.js");
const pathSafety = require("./pathSafety.js");

function registerIconHandlers(ipcMain, { _unitOwnershipCache, _unitStatsCache, _unitUpkeepMapCache, _buildingRecruitsCache, _buildingDisplayCache, _iconDirCache, _uiBuildingsCache, getEdbSourceFiles, findRelatedModDirs, getIconSearchRoots, nativeImage, getActiveModDataDir }) {
ipcMain.handle("get-unit-ownership", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_unitOwnershipCache.has(cacheKey)) return _unitOwnershipCache.get(cacheKey);
  const out = {}; // { unitName: [faction, ...] }
  const dictByType = {}; // { unitName: dictionary }
  const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      let curUnit = null;
      for (const rawLine of lines) {
        const s = stripComments(rawLine).trim();
        if (!s) continue;
        const tm = s.match(/^type\s+(.+)$/);
        if (tm) { curUnit = tm[1].trim(); continue; }
        if (!curUnit) continue;
        const dm = s.match(/^dictionary\s+(.+)$/);
        if (dm) {
          dictByType[curUnit] = dm[1].trim();
          continue;
        }
        const om = s.match(/^ownership\s+(.+)$/);
        if (om) {
          const owners = om[1].split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
          if (owners.length > 0) out[curUnit] = owners;
          curUnit = null;
        }
      }
    } catch (e) { console.warn("[unit-ownership]", src, e.message); }
  }
  out.__dictionary = dictByType;
  _unitOwnershipCache.set(cacheKey, out);
  return out;
});

// IPC: parse the full stat block for a single unit from
// export_descr_unit.txt. Returns the most useful in-game numbers in a
// flat object so InfoPopup can show them next to the unit-info art.
// Cached per (modDataDir, unitName).
ipcMain.handle("get-unit-stats", async (_event, modDataDir, unitName) => {
  if (!unitName) return null;
  const target = String(unitName).toLowerCase();
  const cacheKey = (modDataDir || "") + "|" + target;
  if (_unitStatsCache.has(cacheKey)) return _unitStatsCache.get(cacheKey);
  const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  // Mod-last-wins: keep parsing all sources; the last block found for the
  // target unit name wins (mods override vanilla stats).
  let stats = null;
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      let curUnit = null;
      let block = null;
      for (const rawLine of lines) {
        const s = stripComments(rawLine).trim();
        if (!s) continue;
        const tm = s.match(/^type\s+(.+)$/);
        if (tm) {
          if (curUnit === target && block) stats = block;
          curUnit = tm[1].trim().toLowerCase();
          block = (curUnit === target) ? { name: curUnit } : null;
          continue;
        }
        if (!block) continue;
        // Capture the rest of the line after the keyword for each stat.
        const m = s.match(/^(\w+)\s+(.+)$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === "soldier") {
          // soldier <type>, <count>, <officers?>, <mass>
          const p = val.split(",").map(x => x.trim());
          block.soldierCount = parseInt(p[1]) || 0;
          block.soldierMass = parseFloat(p[3]) || 0;
        } else if (key === "officer") {
          block.officers = (block.officers || 0) + 1;
        } else if (key === "category") block.category = val;
        else if (key === "class") block.classType = val;
        else if (key === "stat_health") {
          const p = val.split(",").map(x => parseInt(x.trim()));
          block.hp = p[0] || 1;
          block.mountHp = p[1] || 0;
        } else if (key === "stat_pri") {
          // stat_pri <attack>, <charge_bonus>, <missile>, <range>, <ammo>, <weapon_type>, <ap?>, <skill>, <sound>, <delay>
          const p = val.split(",").map(x => x.trim());
          block.priAttack = parseInt(p[0]);
          block.priCharge = parseInt(p[1]);
          block.priMissile = p[2] || "";
          // Range / ammo are only meaningful for missile units; non-missile
          // units leave them as 0 in EDU and we want to render "Missile Range"
          // / "Ammo" bars as empty rather than mid-value bars.
          block.priRange = parseInt(p[3]) || 0;
          block.priAmmo = parseInt(p[4]) || 0;
          block.priWeapon = p[5] || "";
        } else if (key === "stat_sec") {
          const p = val.split(",").map(x => x.trim());
          if (p[2] && p[2] !== "no") {
            block.secAttack = parseInt(p[0]);
            block.secCharge = parseInt(p[1]);
            block.secMissile = p[2] || "";
            block.secRange = parseInt(p[3]) || 0;
            block.secAmmo = parseInt(p[4]) || 0;
            block.secWeapon = p[5] || "";
          }
        } else if (key === "stat_pri_armour") {
          const p = val.split(",").map(x => x.trim());
          block.armour = parseInt(p[0]);
          block.defenseSkill = parseInt(p[1]);
          block.shield = parseInt(p[2]);
        } else if (key === "stat_mental") {
          const p = val.split(",").map(x => x.trim());
          block.morale = parseInt(p[0]);
          block.discipline = p[1] || "";
        } else if (key === "stat_charge_dist") block.chargeDist = parseInt(val);
        else if (key === "stat_cost") {
          const p = val.split(",").map(x => parseInt(x.trim()));
          block.recruitTurns = p[0];
          block.recruitCost = p[1];
          block.upkeep = p[2];
        } else if (key === "stat_food") {
          const p = val.split(",").map(x => parseInt(x.trim()));
          block.foodCost = p[0];
        } else if (key === "stat_stl") {
          // stat_stl <men>,<turns> — replenishment per turn
          block.replenishMen = parseInt((val.split(",")[0] || "0").trim());
        } else if (key === "attributes") block.attributes = val;
        else if (key === "formation") block.formation = val;
        else if (key === "armour_ug_levels") block.armourUpgrades = val;
        else if (key === "weapon_lvl") block.weaponLvl = parseInt(val);
        else if (key === "voice_type") block.voiceType = val;
        else if (key === "category") block.category = val;
        else if (key === "ownership") block.owners = val.split(",").map(x => x.trim());
      }
      if (curUnit === target && block) stats = block;
    } catch (e) { console.warn("[unit-stats]", src, e.message); }
  }
  _unitStatsCache.set(cacheKey, stats);
  return stats;
});

// 0.9.860: bulk EDU upkeep map for the economy/Financial-Overview feature.
// Parses export_descr_unit.txt ONCE into { <unit type name>: upkeep } (the
// stat_cost 3rd field — same value the per-unit get-unit-stats returns as
// block.upkeep). Cached per modDataDir. Used to compute a faction's total
// per-turn unit upkeep = Σ over its units of upkeep[unit.name]. Mod-last-wins
// so RIS overrides vanilla. Returns {} on failure (caller shows "—", never 0).
function getUnitUpkeepMap(modDataDir) {
  const cacheKey = modDataDir || "";
  if (_unitUpkeepMapCache.has(cacheKey)) return _unitUpkeepMapCache.get(cacheKey);
  const map = {};
  const sources = getEdbSourceFiles(modDataDir, "export_descr_unit.txt");
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      let curUnit = null;
      for (const rawLine of text.split(/\r?\n/)) {
        const s = stripComments(rawLine).trim();
        if (!s) continue;
        const tm = s.match(/^type\s+(.+)$/);
        if (tm) { curUnit = tm[1].trim().toLowerCase(); continue; }
        if (!curUnit) continue;
        const cm = s.match(/^stat_cost\s+(.+)$/i);
        if (cm) {
          const p = cm[1].split(",").map((x) => parseInt(x.trim(), 10));
          if (p.length >= 3 && Number.isFinite(p[2])) map[curUnit] = p[2]; // mod-last-wins
        }
      }
    } catch (e) { console.warn("[unit-upkeep-map]", src, e.message); }
  }
  _unitUpkeepMapCache.set(cacheKey, map);
  return map;
}
ipcMain.handle("get-unit-upkeep-map", async (_event, modDataDir) => getUnitUpkeepMap(modDataDir));

// IPC: parse recruit capabilities from EDB. Inside each level's block:
//   <level> requires factions { … } {
//     capability { recruit "unit name" <tier>  [requires factions { … }] }
//   }
// We return {<chainName>: {<levelName>: [{unit, factions?}, …]}} so the
// renderer can intersect the recruit list with the settlement's faction.
ipcMain.handle("get-building-recruits", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_buildingRecruitsCache.has(cacheKey)) return _buildingRecruitsCache.get(cacheKey);
  const out = {};
  const sources = getEdbSourceFiles(modDataDir, "export_descr_buildings.txt");
  const stripComments = (line) => {
    const i = line.indexOf(";");
    return i >= 0 ? line.slice(0, i) : line;
  };
  // Parse ALIAS definitions in EDB so the renderer can evaluate
  // tier-style requirements (mic_tier_2, gov_tier_1, colony_tier_1, etc.)
  // against the city's actually-built buildings instead of blanket-
  // dropping recruits that mention them. Each alias maps to one or more
  // [chain, minLevel] clauses ORed together.
  const aliases = {};
  // LAST-WINS per (chain, level): each source overwrites any recruit list
  // a prior source had for the same chain+level. Crucially this also
  // applies when the mod redefines a level with ZERO recruit lines (RIS
  // strips peasants from governors_villa by leaving the recruit list out
  // entirely) — without that, vanilla's recruits leaked through.
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const local = {}; // chain → level → [recruits] (may be empty array)
    const definedLevels = new Set(); // "chain|level" the source touched at all
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      // First pass: capture aliases.
      {
        let curAlias = null, curReq = "";
        for (const rawLine of lines) {
          const r = stripComments(rawLine).trim();
          if (!r) continue;
          const am = r.match(/^alias\s+(\w+)/);
          if (am) { curAlias = am[1]; curReq = ""; continue; }
          if (curAlias) {
            const rm = r.match(/^requires\s+(.+)$/);
            if (rm) curReq = rm[1].trim();
            if (r === "}") {
              if (curReq) {
                // Split on `or` — each branch is one OR clause.
                const branches = curReq.split(/\s+or\s+/);
                const out2 = [];
                for (const b of branches) {
                  const m2 = b.match(/building_present_min_level\s+(\S+)\s+(\S+)/);
                  if (m2) { out2.push({ chain: m2[1], level: m2[2] }); continue; }
                  // Bare `building_present X` (no level) — chain at ANY level
                  // satisfies. Captured with level=null, evaluated as wildcard
                  // in the renderer's hasMinLevel.
                  const m3 = b.match(/^\s*building_present\s+(\S+)\s*$/);
                  if (m3) out2.push({ chain: m3[1], level: null });
                }
                if (out2.length > 0) aliases[curAlias] = out2;
              }
              curAlias = null; curReq = "";
            }
          }
        }
      }
      let curChain = null, curLevel = null, inCapability = false, depth = 0;
      for (let i = 0; i < lines.length; i++) {
        const raw = stripComments(lines[i]).trim();
        if (!raw) continue;
        const cm = raw.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        if (cm) { curChain = cm[1]; curLevel = null; inCapability = false; depth = 0; continue; }
        if (!curChain) continue;
        const lm = raw.match(/^([a-z_][a-z0-9_]*(?:\+\d+)?)\s+requires\b/);
        if (lm && !inCapability) {
          curLevel = lm[1];
          definedLevels.add(curChain + "|" + curLevel);
          if (!local[curChain]) local[curChain] = {};
          if (!local[curChain][curLevel]) local[curChain][curLevel] = [];
          continue;
        }
        if (raw === "capability" && curLevel) { inCapability = true; continue; }
        if (inCapability) {
          if (raw.startsWith("{")) { depth++; continue; }
          if (raw.startsWith("}")) { depth--; if (depth <= 0) { inCapability = false; depth = 0; } continue; }
          const rm = raw.match(/^recruit\s+"([^"]+)"/);
          if (rm) {
            const fm = raw.match(/requires\s+factions\s*\{\s*([^}]*)\}/);
            const factions = fm ? fm[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
            // Capture the FULL requires clause so the renderer can evaluate
            // additional constraints (major_event, hidden_resource, mic_tier_X,
            // etc.) and avoid showing recruits the player can't actually train.
            const ridx = raw.indexOf("requires");
            const requires = ridx >= 0 ? raw.slice(ridx + "requires".length).trim() : null;
            local[curChain][curLevel].push({ unit: rm[1], factions, requires });
          }
        }
      }
    } catch (e) { console.warn("[building-recruits]", src, e.message); continue; }
    // Merge: every (chain, level) the source DEFINED replaces whatever was
    // in `out` — including replacing-with-empty (RIS removes peasants from
    // governors_villa by defining the level with no recruit lines).
    for (const key of definedLevels) {
      const [chain, lvl] = key.split("|");
      if (!out[chain]) out[chain] = {};
      out[chain][lvl] = (local[chain] && local[chain][lvl]) || [];
    }
  }
  // Stash aliases on the recruits object — the renderer pulls both via
  // the same IPC. Using a non-conflicting key (chain names never start
  // with `__`).
  out.__aliases = aliases;
  _buildingRecruitsCache.set(cacheKey, out);
  return out;
});

ipcMain.handle("get-building-display-names", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_buildingDisplayCache.has(cacheKey)) return _buildingDisplayCache.get(cacheKey);
  const map = {};
  // Load order matters: LAST source overwrites earlier ones. We want:
  //   game defaults (loaded FIRST, become base) ← parent mod ← submod (LAST = wins)
  // so mod overrides the vanilla/Alexander defaults.
  const sources = [];
  // 1. Game installs first (base defaults).
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "text", "export_buildings.txt"));
  }
  // 2. Then mod dirs. findRelatedModDirs returns innermost-first (submod,
  // then parent). Reverse so submod is loaded LAST and its entries win.
  for (const d of findRelatedModDirs(modDataDir, "text/export_buildings.txt").reverse()) {
    sources.push(path.join(d, "text", "export_buildings.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\{([^}]+)\}\s*(.+)$/);
        if (!m) continue;
        const key = m[1].trim();
        const value = m[2].trim();
        if (!value) continue;
        if (key.endsWith("_desc") || key.endsWith("_desc_short")) continue;
        // LAST entry in the file wins. Alexander's expanded_bi.txt contains
        // generic defaults at the top and Alexander-specific overrides below
        // an "ALEXANDER TEXT BEGINS HERE" marker — those overrides need to
        // take precedence (PARTHIA → Persia, GERMANS → Illyria, etc.).
        map[key] = value;
      }
    } catch (e) { console.warn("[display-names]", src, e.message); }
  }
  _buildingDisplayCache.set(cacheKey, map);
  return map;
});

// Parse `descr_ui_buildings.txt` — the authoritative file RTW uses for
// icon lookup. Contains a single `lookup_variants { ... }` block with two
// kinds of space-separated pairs inside:
//   1. Culture fallback chain: `<culture_without_art> <fallback_culture>`
//      e.g., `roman eastern` → when roman art missing, try eastern first.
//      Multiple entries per culture define order of preference.
//   2. Level-name alias: `<mod_level> <vanilla_level>`
//      e.g., `temple_of_battle_shrine shrine` → use the `shrine` icon.
// Returned shape: { cultureFallbacks: { roman: [eastern, greek, ...], ... },
//                   levelAliases: { temple_of_battle_shrine: "shrine", ... } }
// Directory-listing cache for icon resolution (2026-07-15). The icon resolver
// probes the same ~40 candidate dirs for EVERY icon; with fs.existsSync per
// candidate file that was hundreds of thousands of syscalls when warming ~900
// icons (the startup icon-lag bottleneck on Windows, where existsSync is slow).
// Instead we readdir each dir ONCE and answer file lookups from an in-memory
// Map<lowercased filename → actual filename> (Windows FS is case-insensitive,
// so this matches the resolver's multi-casing attempts exactly). Cleared for a
// dir after an icon is written there (replace/revert), and wholesale on mod
// switch, so freshly-dropped icons still resolve.
// Singleton over node fs; logic + tests live in src/iconDirCache.js.
const iconDirFiles = (dir) => _iconDirCache.files(dir);
const clearIconDirCache = (dir) => _iconDirCache.clear(dir);

function parseDescrUiBuildings(modDataDir) {
  const cacheKey = modDataDir || "";
  if (_uiBuildingsCache.has(cacheKey)) return _uiBuildingsCache.get(cacheKey);
  const sources = [];
  // Vanilla/Alexander first so mod entries override via last-wins.
  for (const root of getIconSearchRoots()) sources.push(path.join(root, "descr_ui_buildings.txt"));
  for (const d of findRelatedModDirs(modDataDir, "descr_ui_buildings.txt").reverse()) {
    sources.push(path.join(d, "descr_ui_buildings.txt"));
  }
  const cultureFallbacks = {};
  const levelAliases = {};
  // Known RTW culture folder names — used to distinguish culture-fallback
  // pairs from level-alias pairs. A pair is a culture fallback only when
  // BOTH tokens are known cultures.
  const CULTURES = new Set([
    "roman", "greek", "eastern", "egyptian", "barbarian", "carthaginian",
    "nomad", "parthian", "scythian", "german",
    "e_hellenistic", "w_hellenistic",
    "anatolian", "arab", "brittonic", "celtiberian", "dacian", "ethiopian",
    "germanic", "iberian", "illyrian", "indian", "iranian", "libyan",
    "thracian",
  ]);
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      let inBlock = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/;.*$/, "").trim();
        if (!line) continue;
        if (line === "lookup_variants") { inBlock = true; continue; }
        if (line === "{") continue;
        if (line === "}") { inBlock = false; continue; }
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

// Core icon resolver (synchronous file lookups). Extracted from the IPC
// handler so the single AND bulk handlers share one implementation. Returns
// { buffer, path, mime } or null.
function resolveBuildingIconCore(modDataDir, culture, levelName, chainName) {
  if (!culture || !levelName) return null;
  const c = String(culture).toLowerCase();
  const l = String(levelName).toLowerCase();
  const { cultureFallbacks, levelAliases } = parseDescrUiBuildings(modDataDir);
  // RTW convention: for chains like `temple_of_zoroaster_shrine`, the game
  // uses a shared icon keyed by the chain suffix (`shrine`) — there is no
  // `#eastern_temple_of_zoroaster_shrine.tga`, only `#eastern_shrine.tga`.
  // Generate progressively shorter suffixes by trimming tokens from the
  // left; the full name is still tried first.
  const levelTokens = l.split("_");
  const levelCandidates = [];
  for (let start = 0; start < levelTokens.length; start++) {
    const suffix = levelTokens.slice(start).join("_");
    if (suffix && !levelCandidates.includes(suffix)) levelCandidates.push(suffix);
  }
  // `descr_ui_buildings.txt` aliases mod level names to vanilla ones
  // (e.g., temple_of_battle_shrine → shrine). Walk the alias chain so
  // transitive aliases resolve.
  if (levelAliases) {
    let cur = l;
    const seen = new Set([cur]);
    for (let i = 0; i < 8; i++) {
      const next = levelAliases[cur];
      if (!next || seen.has(next)) break;
      if (!levelCandidates.includes(next)) levelCandidates.push(next);
      // Also add trimmed suffixes of the alias so `temple_of_battle_shrine`
      // → `shrine` picks up `#<c>_shrine.tga` directly.
      const aliasTokens = next.split("_");
      for (let s = 1; s < aliasTokens.length; s++) {
        const suf = aliasTokens.slice(s).join("_");
        if (suf && !levelCandidates.includes(suf)) levelCandidates.push(suf);
      }
      seen.add(next);
      cur = next;
    }
  }
  // The game ships two TGA variants per building:
  //   - `#<c>_<l>.tga`                (~156×124) — small square icon for UI lists
  //   - `#<c>_<l>_constructed.tga`    (~361×163) — WIDE banner for the detail
  //     panel. Squashed into a 52×52 square, a banner looks wrong.
  // Resolver priority: icons first, THEN banners as a last-resort visual.
  const dirs = [];
  if (modDataDir && fs.existsSync(modDataDir)) {
    dirs.push(path.join(modDataDir, "ui", c, "buildings"));
    dirs.push(path.join(modDataDir, "ui", c, "buildings", "construction"));
    // `plugins/` holds vanilla-era icons that RTW:R never merged into
    // `buildings/` — treasury tiers, aqueducts, shrines, etc.
    dirs.push(path.join(modDataDir, "ui", c, "plugins"));
    // `construction/` (peer of `buildings/`, not the nested one) is where
    // some per-culture icons live. E.g. greek market lives at
    // ui/greek/construction/#greek_market.tga instead of
    // ui/greek/buildings/. Still the same culture's own art — not a
    // cross-culture fallback.
    dirs.push(path.join(modDataDir, "ui", c, "construction"));
  }
  for (const root of getIconSearchRoots()) {
    dirs.push(path.join(root, "ui", c, "buildings"));
    dirs.push(path.join(root, "ui", c, "buildings", "construction"));
    dirs.push(path.join(root, "ui", c, "plugins"));
    dirs.push(path.join(root, "ui", c, "construction"));
  }
  const romanDirs = [];
  if (c !== "roman") {
    if (modDataDir && fs.existsSync(modDataDir)) {
      romanDirs.push(path.join(modDataDir, "ui", "roman", "buildings"));
      romanDirs.push(path.join(modDataDir, "ui", "roman", "buildings", "construction"));
      romanDirs.push(path.join(modDataDir, "ui", "roman", "plugins"));
      romanDirs.push(path.join(modDataDir, "ui", "roman", "construction"));
    }
    for (const root of getIconSearchRoots()) {
      romanDirs.push(path.join(root, "ui", "roman", "buildings"));
      romanDirs.push(path.join(root, "ui", "roman", "buildings", "construction"));
      romanDirs.push(path.join(root, "ui", "roman", "plugins"));
      romanDirs.push(path.join(root, "ui", "roman", "construction"));
    }
  }
  // Cross-culture fallback — use the order declared in
  // `descr_ui_buildings.txt` lookup_variants (e.g., `roman eastern / roman
  // greek / roman egyptian`). This matches the game's own preference order
  // per culture. Falls back to a sensible default if the file is missing.
  const declaredOrder = (cultureFallbacks && cultureFallbacks[c]) || [];
  const FALLBACK_CULTURES = declaredOrder.length ? declaredOrder : [
    "greek", "e_hellenistic", "w_hellenistic", "barbarian", "carthaginian",
    "eastern", "egyptian", "iberian", "celtiberian", "thracian", "dacian",
    "scythian", "iranian", "anatolian", "germanic", "brittonic", "illyrian",
    "arab", "indian", "ethiopian", "libyan",
  ];
  const otherCultureDirs = [];
  for (const oc of FALLBACK_CULTURES) {
    if (oc === c || oc === "roman") continue;
    if (modDataDir && fs.existsSync(modDataDir)) {
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "buildings") });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "buildings", "construction") });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "plugins") });
      otherCultureDirs.push({ culture: oc, dir: path.join(modDataDir, "ui", oc, "construction") });
    }
    for (const root of getIconSearchRoots()) {
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "buildings") });
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "buildings", "construction") });
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "plugins") });
      otherCultureDirs.push({ culture: oc, dir: path.join(root, "ui", oc, "construction") });
    }
  }
  // Vanilla ships identical placeholder TGAs under `ui/<non-roman>/plugins/`
  // for chains it doesn't have proper per-culture art for (paved_roads,
  // mines, treasury, roads, etc — all 2567 bytes, same MD5). It also ships
  // small ~78×62 "construction-queue thumbnail" variants under
  // `ui/<non-roman>/construction/` (e.g., #greek_market.tga at 78×62) which
  // look pixelated in a card-sized slot when a 156×124 alternative exists.
  // The `strict` flag rejects both placeholders and undersized thumbnails;
  // it's enabled for per-culture passes (so the roman pass can win with
  // proper artwork) and disabled for roman/wide-banner passes (where the
  // file we find is the only option, even if small).
  const VANILLA_PLACEHOLDER_SIZE = 2567;
  const MIN_CARD_DIMENSION = 100;
  const readTga = (dir, fn, strict) => {
    // Cached directory listing → in-memory membership test (see iconDirFiles).
    const files = iconDirFiles(dir);
    if (!files) return null;
    const actual = files.get(fn.toLowerCase());
    if (!actual) return null;
    const full = path.join(dir, actual);
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
        mime: "image/x-tga",
      };
    } catch { return null; }
  };
  // Resolution order is built around two preferences:
  //   1. Specific (per-level) beats generic (per-chain).
  //   2. Square icon (`#<c>_<x>.tga`, ~156×124) beats wide `_constructed`
  //      banner (~361×163). Banners squashed to a square card look stretched.
  // Roman is checked alongside per-culture (not as a last-resort fallback)
  // because mods like RIS often ship the per-level art ONLY under roman/
  // (e.g. `#roman_temple_dorian_1.tga`, `#roman_governors_palace.tga`),
  // and vanilla greek often only ships the wide `_constructed` banner.
  let chainCandidates = [];
  if (chainName) {
    const ch = String(chainName).toLowerCase();
    const chainTokens = ch.split("_");
    for (let start = 0; start < chainTokens.length; start++) {
      const suffix = chainTokens.slice(start).join("_");
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
  // Pass 1 — per-culture square icon, strict (skip placeholders and
  // 78×62 thumbnails so the roman pass can serve the proper 156×124 card).
  for (const lc of levelCandidates) {
    const r = tryNames([`#${c}_${lc}.tga`, `#${c.toUpperCase()}_${lc}.tga`, `#${lc}.tga`, `${c}_${lc}.tga`], dirs, true);
    if (r) return r;
  }
  // Pass 2 — roman per-level (non-strict; accept whatever's there since
  // roman is the canonical asset path for missing per-culture art).
  if (c !== "roman" && romanDirs.length) {
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
  if (c !== "roman" && romanDirs.length) {
    for (const cc of chainCandidates) {
      const r = tryNames([`#roman_${cc}.tga`, `#ROMAN_${cc}.tga`, `roman_${cc}.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Pass 5 — per-culture small/thumbnail icon (non-strict). Accept the
  // 78×62 thumbnail now if no proper card was found anywhere.
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
  if (c !== "roman" && romanDirs.length) {
    for (const lc of levelCandidates) {
      const r = tryNames([`#roman_${lc}_constructed.tga`], romanDirs, false);
      if (r) return r;
    }
    for (const cc of chainCandidates) {
      const r = tryNames([`#roman_${cc}_constructed.tga`], romanDirs, false);
      if (r) return r;
    }
  }
  // Per-culture chain `_constructed` as final visual.
  for (const cc of chainCandidates) {
    const r = tryNames([`#${c}_${cc}_constructed.tga`], dirs, false);
    if (r) return r;
  }
  // Final pass — cross-culture lookup. Some chains/levels exist as art
  // ONLY under specific cultures (e.g., #greek_gov1.tga but no roman or
  // italic version). Searches a prioritised list of cultures for the level
  // name, then chain name, then `_constructed` variants. Better than a
  // blank card.
  for (const lc of levelCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${lc}.tga`, false); if (r) return r;
    }
  }
  for (const cc of chainCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${cc}.tga`, false); if (r) return r;
    }
  }
  for (const lc of levelCandidates) {
    for (const { culture: oc, dir } of otherCultureDirs) {
      const r = readTga(dir, `#${oc}_${lc}_constructed.tga`, false); if (r) return r;
    }
  }
  // Final fallback — RTW's own generic building card, shown by the game
  // when no per-culture/per-level art exists. 78×62, same dimensions as
  // the per-level card icons. This is what the in-game UI shows for
  // chains like Weavery that ship no building art at all.
  const genericRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) genericRoots.push(path.join(modDataDir, "ui", "generic"));
  for (const root of getIconSearchRoots()) genericRoots.push(path.join(root, "ui", "generic"));
  for (const dir of genericRoots) {
    const got = readTga(dir, "generic_building.tga", false);
    if (got) return got;
  }
  // Genuinely missing — log via the renderer's MISSING ICON line so they
  // can be added deliberately.
  return null;
}

ipcMain.handle("resolve-building-icon", async (_event, modDataDir, culture, levelName, chainName) =>
  resolveBuildingIconCore(modDataDir, culture, levelName, chainName));

// IPC: resolve MANY building icons in ONE round-trip (2026-07-15). The
// per-icon handler cost one IPC hop each; warming ~900 settlement icons that
// way was the startup icon-lag bottleneck. The renderer chunks its warm list
// and calls this so N icons resolve in one call. `list` = [{culture, level,
// chain}]; returns [{culture, level, buffer|null, path|null}] in the same
// order. Buffers are transferable ArrayBuffers (structured-clone as usual).
ipcMain.handle("resolve-building-icons-bulk", async (_event, modDataDir, list) => {
  if (!Array.isArray(list)) return [];
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || !it.culture || !it.level) { out[i] = null; continue; }
    const r = resolveBuildingIconCore(modDataDir, it.culture, it.level, it.chain || null);
    out[i] = { culture: it.culture, level: it.level, buffer: r ? r.buffer : null, path: r ? r.path : null };
  }
  return out;
});

// IPC: replace a building icon by dropping a PNG / JPG / TGA file onto its
// card in the dev-mode region editor. Resolves the same destination filename
// that `resolve-building-icon` would have read, copies/converts the dropped
// file into place, and backs up the previous TGA to `_backup/`. RTW only
// loads TGA so PNG/JPG are decoded via Electron's nativeImage and re-encoded
// as uncompressed 32-bit BGRA TGAs.
//
// Args:
//   modDataDir   — active mod data dir (where data/ui/<culture>/buildings lives)
//   culture      — building's culture (greek, roman, eastern, ...)
//   levelName    — EDB level (e.g. "city_barracks"), used for filename derivation
//   chainName    — EDB chain name (e.g. "barracks"), used as a fallback suffix
//   sourceFile   — absolute path of the dropped file on disk
//
// Returns: { ok: true, destPath, backupPath } or { ok: false, error }.
// encodeTga32BGRA moved to src/tgaCodec.js (pure, imported at top).

ipcMain.handle("replace-building-icon", async (_event, modDataDir, culture, levelName, chainName, sourceFile) => {
  console.log(`[icon-replace] IPC invoked: culture=${culture} level=${levelName} chain=${chainName || "(none)"} src=${sourceFile || "(none)"}`);
  if (!culture || !levelName || !sourceFile) {
    return { ok: false, error: "missing culture / level / source" };
  }
  if (!fs.existsSync(sourceFile)) {
    return { ok: false, error: `source not found: ${sourceFile}` };
  }
  // The mod's own data/ui/<culture>/buildings/ is the canonical destination
  // — that's where the user wants their replacement to live (so it overrides
  // the Steam fallback). If the mod doesn't have a buildings dir yet, create
  // it. Filename matches whichever variant the resolver was reading.
  const c = String(culture).toLowerCase();
  const l = String(levelName).toLowerCase();
  const ch = chainName ? String(chainName).toLowerCase() : null;
  // Filename candidates (no path) — same order the resolver tries first
  // (per-culture per-level square icon). Whichever filename actually exists
  // in the mod's buildings dir is the one we overwrite; if NONE exist there,
  // we fall back to the engine-canonical `#<c>_<level>.tga` so the new file
  // beats the Steam fallback path.
  const candidates = [
    `#${c}_${l}.tga`,
    `#${c.toUpperCase()}_${l}.tga`,
    `${c}_${l}.tga`,
  ];
  if (ch) {
    candidates.push(`#${c}_${ch}.tga`);
    candidates.push(`${c}_${ch}.tga`);
  }
  if (!modDataDir || !fs.existsSync(modDataDir)) {
    return { ok: false, error: "active mod data dir missing — drop into vanilla Steam install is not allowed" };
  }
  const destDir = path.join(modDataDir, "ui", c, "buildings");
  try { fs.mkdirSync(destDir, { recursive: true }); } catch {}
  // Find existing icon (if any) to back up; otherwise use the canonical name.
  let destFn = null;
  for (const fn of candidates) {
    const full = path.join(destDir, fn);
    if (fs.existsSync(full)) { destFn = fn; break; }
  }
  if (!destFn) destFn = candidates[0]; // engine-canonical fallback
  const destPath = path.join(destDir, destFn);
  // Backup existing icon (if present).
  let backupPath = null;
  if (fs.existsSync(destPath)) {
    try {
      const backupDir = path.join(destDir, "_backup");
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(backupDir, `${destFn}.bak.${stamp}`);
      fs.copyFileSync(destPath, backupPath);
      console.log(`[icon-replace] backup-saved: ${backupPath}`);
    } catch (e) {
      console.warn(`[icon-replace] backup failed: ${e.message}`);
      // Continue — losing the backup is worse than failing the whole replace,
      // but the user can also just re-drop the original file.
    }
  }
  // Convert source to TGA (or copy directly if already TGA).
  const ext = path.extname(sourceFile).toLowerCase();
  try {
    if (ext === ".tga") {
      fs.copyFileSync(sourceFile, destPath);
      console.log(`[icon-replace] success (tga-copy): ${sourceFile} → ${destPath}`);
    } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
      // nativeImage decodes PNG/JPG and gives us BGRA via toBitmap().
      const img = nativeImage.createFromPath(sourceFile);
      if (img.isEmpty()) throw new Error("nativeImage decode produced empty image");
      const size = img.getSize();
      if (!size.width || !size.height) throw new Error(`invalid size ${size.width}x${size.height}`);
      const bgra = img.toBitmap(); // BGRA, top-down
      const tga = encodeTga32BGRA(size.width, size.height, bgra);
      fs.writeFileSync(destPath, tga);
      console.log(`[icon-replace] success (png/jpg→tga ${size.width}x${size.height}): ${sourceFile} → ${destPath}`);
    } else {
      return { ok: false, error: `unsupported extension: ${ext} (expected .png / .jpg / .tga)` };
    }
  } catch (e) {
    console.warn(`[icon-replace] failed: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
  clearIconDirCache(path.dirname(destPath)); // new/updated icon → refresh listing cache
  return { ok: true, destPath, backupPath, destFilename: destFn };
});

// IPC: revert a previous icon replacement by restoring the backed-up TGA.
// Called from App.js's revertOnePending when the user removes an icon-replace
// entry from the pending log. If no backup exists, deletes the dropped icon
// so the resolver falls back to the original Steam vanilla file.
ipcMain.handle("revert-building-icon", async (_event, destPath, backupPath) => {
  console.log(`[icon-replace] revert IPC: dest=${destPath || "(none)"} backup=${backupPath || "(none)"}`);
  if (!destPath) return { ok: false, error: "no destination path" };
  // CONTAINMENT (2026-07-15): both paths are a write+delete primitive. They
  // were produced by replace-building-icon, which only ever writes under the
  // active mod's ui tree — so require them to resolve inside getActiveModDataDir().
  // Without this a compromised renderer could pass any paths to copy/unlink.
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  const safeDest = pathSafety.containedPath(getActiveModDataDir(), destPath);
  if (!safeDest) { console.warn(`[icon-replace] revert refused (dest outside mod): ${destPath}`); return { ok: false, error: "destination outside the active mod dir" }; }
  const safeBackup = backupPath ? pathSafety.containedPath(getActiveModDataDir(), backupPath) : null;
  if (backupPath && !safeBackup) { console.warn(`[icon-replace] revert refused (backup outside mod): ${backupPath}`); return { ok: false, error: "backup outside the active mod dir" }; }
  try {
    if (safeBackup && fs.existsSync(safeBackup)) {
      fs.copyFileSync(safeBackup, safeDest);
      try { fs.unlinkSync(safeBackup); } catch {}
      clearIconDirCache(path.dirname(safeDest));
      console.log(`[icon-replace] revert-restored: ${safeBackup} → ${safeDest}`);
      return { ok: true, restored: true };
    }
    if (fs.existsSync(safeDest)) {
      fs.unlinkSync(safeDest);
      clearIconDirCache(path.dirname(safeDest));
      console.log(`[icon-replace] revert-deleted (no backup): ${safeDest}`);
      return { ok: true, restored: false, deleted: true };
    }
    return { ok: true, restored: false, deleted: false };
  } catch (e) {
    console.warn(`[icon-replace] revert failed: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
});

// IPC: resolve the WIDE `_constructed` building banner (for the right-click
// info popup). Normal icon resolution picks the small square card — the
// popup wants the big ~361×163 banner shown in-game's info panel. Priority:
//   1. Culture's `#<c>_<level>_constructed.tga`
//   2. Same with progressively shorter suffixes (temple_of_X_shrine → shrine)
//   3. Roman's `_constructed` variant (roman ships the full set)
ipcMain.handle("resolve-building-banner", async (_event, modDataDir, culture, levelName, chainName) => {
  if (!levelName) return null;
  // Default to roman when the caller didn't give us a culture — roman ships
  // the complete building set, so the banner almost always exists there.
  const c = String(culture || "roman").toLowerCase();
  const l = String(levelName).toLowerCase();
  const { cultureFallbacks, levelAliases } = parseDescrUiBuildings(modDataDir);
  const tokens = l.split("_");
  const suffixes = [];
  for (let start = 0; start < tokens.length; start++) {
    const s = tokens.slice(start).join("_");
    if (s && !suffixes.includes(s)) suffixes.push(s);
  }
  // Apply descr_ui_buildings.txt level aliases (temple_of_battle_shrine → shrine).
  if (levelAliases) {
    let cur = l;
    const seen = new Set([cur]);
    for (let i = 0; i < 8; i++) {
      const next = levelAliases[cur];
      if (!next || seen.has(next)) break;
      if (!suffixes.includes(next)) suffixes.push(next);
      const at = next.split("_");
      for (let s = 1; s < at.length; s++) {
        const suf = at.slice(s).join("_");
        if (suf && !suffixes.includes(suf)) suffixes.push(suf);
      }
      seen.add(next);
      cur = next;
    }
  }
  const tryRead = (dir, fn) => {
    if (!fs.existsSync(dir)) return null;
    const full = path.join(dir, fn);
    if (!fs.existsSync(full)) return null;
    try {
      const buf = fs.readFileSync(full);
      return {
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        path: full,
        mime: "image/x-tga",
      };
    } catch { return null; }
  };
  const collectDirs = (fac) => {
    const dirs = [];
    if (modDataDir && fs.existsSync(modDataDir)) {
      dirs.push(path.join(modDataDir, "ui", fac, "buildings"));
      dirs.push(path.join(modDataDir, "ui", fac, "buildings", "construction"));
    }
    for (const root of getIconSearchRoots()) {
      dirs.push(path.join(root, "ui", fac, "buildings"));
      dirs.push(path.join(root, "ui", fac, "buildings", "construction"));
    }
    return dirs;
  };
  const dirs = collectDirs(c);
  for (const suf of suffixes) {
    for (const dir of dirs) {
      const r = tryRead(dir, `#${c}_${suf}_constructed.tga`);
      if (r) return r;
    }
  }
  // Culture fallback chain from descr_ui_buildings.txt (roman → eastern,
  // greek, egyptian — or whatever the file declares). Fall back to roman
  // if the file is missing.
  const fallbackCultures = (cultureFallbacks && cultureFallbacks[c]) || (c !== "roman" ? ["roman"] : []);
  for (const fc of fallbackCultures) {
    if (fc === c) continue;
    const rDirs = collectDirs(fc);
    for (const suf of suffixes) {
      for (const dir of rDirs) {
        const r = tryRead(dir, `#${fc}_${suf}_constructed.tga`);
        if (r) return r;
      }
    }
  }
  // Final fallback — RTW's generic `_constructed` banner (360×160) for
  // chains that ship no per-culture art. Matches what the in-game
  // right-click detail panel shows for Weavery etc.
  const genericDirs = [];
  if (modDataDir && fs.existsSync(modDataDir)) genericDirs.push(path.join(modDataDir, "ui", "generic"));
  for (const root of getIconSearchRoots()) genericDirs.push(path.join(root, "ui", "generic"));
  for (const dir of genericDirs) {
    const r = tryRead(dir, "generic_constructed_building.tga");
    if (r) return r;
  }
  return null;
});

// IPC: resolve the LARGE unit info panel (for right-click popup). RTW
// stores these at `data/ui/unit_info/<faction>/<unit>_info.tga` — much
// bigger and more detailed than the small card.
ipcMain.handle("resolve-unit-info", async (_event, modDataDir, faction, unitName, dictionary) => {
  if (!faction || !unitName) return null;
  const f = String(faction).toLowerCase().replace(/\s+/g, "_");
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const uBase = scrub(unitName);
  // Same priority as resolve-unit-card: dictionary > raw type > variants.
  const uVariants = [];
  const pushUnique = (v) => { if (v && !uVariants.includes(v)) uVariants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...uVariants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [f, "mercs"];
  if (f === "greeks") factions.unshift("greek_cities");
  const dirs = [];
  for (const fac of factions) {
    if (modDataDir && fs.existsSync(modDataDir)) {
      dirs.push(path.join(modDataDir, "ui", "unit_info", fac));
    }
    for (const root of getIconSearchRoots()) {
      dirs.push(path.join(root, "ui", "unit_info", fac));
    }
  }
  for (const uv of uVariants) {
    const fn = `${uv}_info.tga`;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const full = path.join(dir, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return {
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          path: full,
          mime: "image/x-tga",
        };
      } catch {}
    }
  }
  // Fallback: scan every faction folder under ui/unit_info/* for any of our
  // _info.tga candidates. Matches the same fallback in resolve-unit-card.
  const fallbackRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) fallbackRoots.push(modDataDir);
  for (const root of getIconSearchRoots()) fallbackRoots.push(root);
  const fnSet = new Set(uVariants.map(uv => `${uv}_info.tga`));
  for (const root of fallbackRoots) {
    const base = path.join(root, "ui", "unit_info");
    let entries;
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const facDir of entries) {
      const facPath = path.join(base, facDir);
      try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
      for (const fn of fnSet) {
        const full = path.join(facPath, fn);
        if (!fs.existsSync(full)) continue;
        try {
          const buf = fs.readFileSync(full);
          return {
            buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            path: full,
            mime: "image/x-tga",
          };
        } catch {}
      }
    }
  }
  return null;
});

// IPC: resolve a unit portrait/card tga. RTW ships small cards at
// `data/ui/units/<faction>/#<unit_name>.tga` (spaces → underscores) and
// larger info panels at `data/ui/unit_info/<faction>/<unit_name>_info.tga`.
// Caller passes the unit's faction (from settlement ownership) and name.
// Returns { buffer, path, mime } or null.
function resolveUnitCardSync(modDataDir, faction, unitName, dictionary) {
  if (!faction || !unitName) return null;
  const f = String(faction).toLowerCase().replace(/\s+/g, "_");
  // Strip apostrophes (e.g. "general's" → "generals"), keep word chars and
  // underscores only. RTW TGAs use the scrubbed form.
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const uBase = scrub(unitName);
  // Build name candidates in priority order:
  //   1. EDU dictionary (e.g. "aestian_clubmen") — canonical for icon files,
  //      especially AOR / merc variants whose type starts with "aor "/"merc ".
  //   2. The type-derived form (uBase).
  //   3. Plural-stripped versions of both ("naval biremes" → "naval_bireme").
  //   4. Type-derived with "aor_"/"merc_" prefix stripped, in case dictionary
  //      isn't available but the icon file is keyed without the prefix.
  const uVariants = [];
  const pushUnique = (v) => { if (v && !uVariants.includes(v)) uVariants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...uVariants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [f];
  // Remastered split some vanilla factions; try a couple of aliases.
  if (f === "greeks") factions.push("greek_cities");
  if (f === "romans_julii" || f === "romans_brutii" || f === "romans_scipii" || f === "romans_senate") factions.push("romans");
  // Mercenary units live under ui/units/mercs/ regardless of who hired them.
  factions.push("mercs");
  const filenames = [];
  for (const uv of uVariants) { filenames.push(`#${uv}.tga`); filenames.push(`${uv}_info.tga`); }
  const dirs = [];
  for (const fac of factions) {
    if (modDataDir && fs.existsSync(modDataDir)) {
      dirs.push(path.join(modDataDir, "ui", "units", fac));
      dirs.push(path.join(modDataDir, "ui", "unit_info", fac));
    }
    for (const root of getIconSearchRoots()) {
      dirs.push(path.join(root, "ui", "units", fac));
      dirs.push(path.join(root, "ui", "unit_info", fac));
    }
  }
  for (const fn of filenames) {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const full = path.join(dir, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return {
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          path: full,
          mime: "image/x-tga",
        };
      } catch {}
    }
  }
  // Fallback: brute-force scan every faction folder under ui/units/* and
  // ui/unit_info/* for any of our filename candidates. AOR units often have
  // their icon under a "natural-owner" faction folder (e.g. "aor roman
  // rorarii" → romans_julii/#roman_rorarii.tga) rather than mercs/ or the
  // recruiting faction's folder. The audit script flagged ~700 such combos.
  const fallbackRoots = [];
  if (modDataDir && fs.existsSync(modDataDir)) fallbackRoots.push(modDataDir);
  for (const root of getIconSearchRoots()) fallbackRoots.push(root);
  const fnSet = new Set(filenames);
  for (const root of fallbackRoots) {
    for (const subdir of ["units", "unit_info"]) {
      const base = path.join(root, "ui", subdir);
      let entries;
      try { entries = fs.readdirSync(base); } catch { continue; }
      for (const facDir of entries) {
        const facPath = path.join(base, facDir);
        try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
        for (const fn of fnSet) {
          const full = path.join(facPath, fn);
          if (!fs.existsSync(full)) continue;
          try {
            const buf = fs.readFileSync(full);
            return {
              buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
              path: full,
              mime: "image/x-tga",
            };
          } catch {}
        }
      }
    }
  }
  return null;
}

ipcMain.handle("resolve-unit-card", async (_event, modDataDir, faction, unitName, dictionary) =>
  resolveUnitCardSync(modDataDir, faction, unitName, dictionary));

// ── Unit-card filename index (2026-07-16 launch-perf fix) ─────────────────
// The first bulk warm-up resolved thousands of cards through
// resolveUnitCardSync, whose per-candidate existsSync chains and (on any
// miss) full ui/units/* directory scans blocked the main process for minutes
// (measured: 105s for 8,202 cards). One readdir sweep builds filename maps;
// every bulk lookup is then a Map.get. The index lives until the search
// roots change (mod switch). Single-card resolves keep the original
// fresh-from-disk path (dev icon replacement etc.).
let _cardIndexKey = null;
let _cardDirIndex = null;  // Map<dirPathLower, Map<fileNameLower, fullPath>>
let _cardDirOrder = null;  // dirPathLower[] in canonical scan order (fallback)
function ensureUnitCardIndex(modDataDir) {
  const roots = [];
  if (modDataDir && fs.existsSync(modDataDir)) roots.push(modDataDir);
  for (const r of getIconSearchRoots()) roots.push(r);
  const key = roots.join(";").toLowerCase();
  if (_cardIndexKey === key && _cardDirIndex) return roots;
  const t0 = Date.now();
  _cardIndexKey = key;
  _cardDirIndex = new Map();
  _cardDirOrder = [];
  for (const root of roots) {
    for (const subdir of ["units", "unit_info"]) {
      const base = path.join(root, "ui", subdir);
      let facs;
      try { facs = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const fd of facs) {
        if (!fd.isDirectory()) continue;
        const facPath = path.join(base, fd.name);
        let files;
        try { files = fs.readdirSync(facPath); } catch { continue; }
        const dirKey = facPath.toLowerCase();
        if (_cardDirIndex.has(dirKey)) continue;
        const m = new Map();
        for (const file of files) m.set(file.toLowerCase(), path.join(facPath, file));
        _cardDirIndex.set(dirKey, m);
        _cardDirOrder.push(dirKey);
      }
    }
  }
  console.log(`[unit-card-index] built ${_cardDirIndex.size} dirs in ${Date.now() - t0}ms`);
  return roots;
}
function readUnitCardFile(full) {
  try {
    const buf = fs.readFileSync(full);
    return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path: full, mime: "image/x-tga" };
  } catch { return null; }
}
// Index-backed resolve — same candidate priority as resolveUnitCardSync's
// direct path (filename-major over the per-faction dir list), and the same
// dir-major order for the brute-force fallback.
function resolveUnitCardIndexed(roots, faction, unitName, dictionary) {
  if (!faction || !unitName) return null;
  const f = String(faction).toLowerCase().replace(/\s+/g, "_");
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const uBase = scrub(unitName);
  const uVariants = [];
  const pushUnique = (v) => { if (v && !uVariants.includes(v)) uVariants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...uVariants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [f];
  if (f === "greeks") factions.push("greek_cities");
  if (f === "romans_julii" || f === "romans_brutii" || f === "romans_scipii" || f === "romans_senate") factions.push("romans");
  factions.push("mercs");
  const filenames = [];
  for (const uv of uVariants) { filenames.push(`#${uv}.tga`); filenames.push(`${uv}_info.tga`); }
  const dirKeys = [];
  for (const fac of factions) {
    for (const root of roots) {
      dirKeys.push(path.join(root, "ui", "units", fac).toLowerCase());
      dirKeys.push(path.join(root, "ui", "unit_info", fac).toLowerCase());
    }
  }
  for (const fn of filenames) {
    for (const dk of dirKeys) {
      const m = _cardDirIndex.get(dk);
      const full = m && m.get(fn);
      if (full) return readUnitCardFile(full);
    }
  }
  for (const dk of _cardDirOrder) {
    const m = _cardDirIndex.get(dk);
    for (const fn of filenames) {
      const full = m.get(fn);
      if (full) return readUnitCardFile(full);
    }
  }
  return null;
}

// Bulk variant (2026-07-16, splash unit-card warm-up): resolve a whole batch
// in ONE IPC round-trip — the per-icon hop was the bottleneck when warming
// every on-map army's unit cards behind the splash (same reasoning as
// resolve-building-icons-bulk). items: [{ faction, unit, dictionary? }].
// Returns an array aligned with items ({ buffer, path } | null each).
ipcMain.handle("resolve-unit-cards-bulk", async (_event, modDataDir, items) => {
  if (!Array.isArray(items)) return [];
  const roots = ensureUnitCardIndex(modDataDir);
  return items.map((it) =>
    it && it.faction && it.unit
      ? resolveUnitCardIndexed(roots, it.faction, it.unit, it.dictionary || null)
      : null);
});


}

module.exports = { registerIconHandlers };
