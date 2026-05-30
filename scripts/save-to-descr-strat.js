// save-to-descr-strat.js — convert a save file into a complete descr_strat.txt
// for the "Continue Campaign as New Campaign" feature.
//
// CONCEPT: the engine's entity registry tops out at 65,536 entries. We can't
// shrink an existing save (see scripts/save-cracker/SESSION-2026-05-27-RESUME.md
// for why the splice path doesn't work). But a NEW campaign starts with the
// registry at zero. We extract the current state from a save and emit it as
// a fresh descr_strat — the user keeps their progress while restarting the
// entity counter.
//
// STRATEGY: take the bundled descr_strat as a TEMPLATE. Keep the static
// sections (campaign declaration, playable lists, date, landmarks, resources,
// faction_aggression, spawn scripts, background scripts) unchanged. REPLACE
// the per-faction blocks (settlements + characters + armies) with state
// extracted from the save.
//
// What we extract from the save:
//   * Per-faction settlement ownership + buildings (with proper chain→level
//     name mapping via the EDB parse)
//   * Living characters (name, age, position, traits, leader/heir flags)
//     with faction attribution via captain_card_<faction>.tga markers
//   * Each commander's army composition (unit name, exp/armour/weapon
//     upgrades) — units grouped by commanderUuid → secondaryUuid match
//   * Settlement level (heuristic from core_building level)
//
// Gaps still open (TODOs documented in-code):
//   * Real current treasury (factionParser is approximate)
//   * Family tree blocks (descr_strat supports parent/spouse refs)
//   * Per-settlement religion / population
//   * Diplomacy state (alliances, wars) — not yet extracted from save
//
// Usage:  node scripts/save-to-descr-strat.js <save-path> [output-path]

"use strict";
const fs = require("fs");
const path = require("path");

const { parseSettlements } = require("../src/buildingParser.js");
const { resolveCurrentOwners } = require("../src/saveOwnershipParser.js");
const { buildInitialOwnership, parseDescrRegions, findDescrRegions } =
  require("../src/ownershipParser.js");
const { findCharacterRecords } = require("../src/characterParser.js");
const { findUnitRecords } = require("../src/unitParser.js");
const { findFactionRecords } = require("../src/factionRecordParser.js");
const {
  parseFactionTreasuries,
  parseDiplomacyMatrix,
  parseCharacterExtras,
  parseReligionByCity,
  deriveEngineFactionOrder,
  identifyFactionRecordOwners,
  identifyPlayerFactionFromSave,
  parseModInfo,
} = require("../src/saveCrackerExtras.js");
const { parseDescrRegions: parseDR2, buildRegionCoords } = require("../src/descrStratGeneral.js");
const { parseFamilyRecords, indexFamily, attributeFamilyFactions } = require("../src/familyRecordParser.js");

// Inlined from src/characterParserV2.js (not exported there). Each faction's
// character block is preceded by a `captain_card_<faction>.tga` ASCII path
// marker — characters are attributed to the most recent preceding marker.
function findFactionMarkers(buf) {
  const markers = [];
  const pattern = Buffer.from("captain_card_", "ascii");
  let p = 0;
  while ((p = buf.indexOf(pattern, p)) !== -1) {
    let end = p + pattern.length;
    let factionName = "";
    while (end < buf.length) {
      const b = buf[end];
      if (b === 0x2e /* . */) break;
      if (b < 0x20 || b > 0x7e) break;
      factionName += String.fromCharCode(b);
      end++;
    }
    if (factionName.length > 0 && factionName.length < 30) {
      markers.push({ pos: p, faction: factionName });
    }
    p += pattern.length;
  }
  return markers;
}
function assignFactions(records, factionMarkers) {
  factionMarkers.sort((a, b) => a.pos - b.pos);
  // For O(n log n) instead of O(n*m): walk both sorted lists in lockstep.
  const sorted = [...records].sort((a, b) => a.offset - b.offset);
  let mi = 0;
  let lastFaction = null;
  for (const r of sorted) {
    while (mi < factionMarkers.length && factionMarkers[mi].pos < r.offset) {
      lastFaction = factionMarkers[mi].faction;
      mi++;
    }
    r.faction = lastFaction;
  }
}

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUNDLED_MOD = path.join(PROJECT_ROOT, "bundled-mod", "data");

// ─────────────────────────────────────────────────────────────────────────────
// SAVE DATE (turn / year / season) — mirrors main.js's readTurnFromSave +
// readCurrentYearFromSave. Anchored on the UTF-16LE "descr_strat" string
// near the file head; the turn counter sits at +5, the year at +9 past the
// terminator. Season is derived from turn parity relative to the template's
// own start_date (RR runs 2 turns/year, season alternates).
// ─────────────────────────────────────────────────────────────────────────────
function findDescrStratAnchorEnd(buf) {
  const needle = Buffer.from("d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0", "binary");
  const lim = Math.min(buf.length, 0x10000);
  let idx = -1, p = 0;
  while (true) {
    const f = buf.indexOf(needle, p);
    if (f === -1 || f > lim) break;
    idx = f; p = f + 2;
  }
  if (idx < 0) return -1;
  let e = idx;
  while (e + 1 < buf.length && buf[e] >= 0x20 && buf[e] <= 0x7e && buf[e + 1] === 0) e += 2;
  return e;
}
function readSaveDate(buf, templateStart) {
  // templateStart = { year, season } parsed from the bundled descr_strat's own
  // start_date line; we use its season as the phase reference (T1 = base_season).
  //
  // Layout (verified across both RIS imperial T1017 and Bactria T964):
  //   a+0..3   self-pointer (anchor offset)
  //   a+4      flag byte (0x00 or 0x01 — varies between saves, ignored)
  //   a+5..8   u32  turnCounter (= displayed_turn - 1)
  //   a+9..12  i32  year (signed, negative = BC)
  // The legacy 0x44e3/0x44e7 hardcoded offsets are a final fallback for saves
  // where the descr_strat anchor isn't in the first 64 KB.
  const a = findDescrStratAnchorEnd(buf);
  const tryOffsets = [];
  if (a >= 0) tryOffsets.push({ turn: a + 5, year: a + 9 });
  tryOffsets.push({ turn: 0x44e3, year: 0x44e7 });
  for (const { turn: turnOff, year: yearOff } of tryOffsets) {
    if (buf.length < turnOff + 4 || buf.length < yearOff + 4) continue;
    const turnCounter = buf.readUInt32LE(turnOff);
    if (turnCounter > 10000) continue;
    const year = buf.readInt32LE(yearOff);
    if (year < -2000 || year > 3000) continue;
    const turn = turnCounter + 1;
    const baseSeason = (templateStart && templateStart.season) || "summer";
    const otherSeason = baseSeason === "summer" ? "winter" : "summer";
    const season = ((turn - 1) % 2 === 0) ? baseSeason : otherSeason;
    return { turn, year, season };
  }
  return null;
}
function parseTemplateStartDate(bundledLines) {
  for (const ln of bundledLines) {
    const m = ln.match(/^\s*start_date\s+(-?\d+)\s+(\w+)/);
    if (m) return { year: parseInt(m[1], 10), season: m[2].toLowerCase() };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOD AUTO-DETECTION
// ─────────────────────────────────────────────────────────────────────────────
// Given a save's modDisplayName (e.g. "[EARLY ACCESS] RTR: Imperium
// Surrectum 0.7.0"), find a Mods/My Mods directory whose name fuzzy-
// matches. Strips brackets, normalises whitespace, then prefers the
// most-recently-modified match.
function findInstalledModByName(modDisplayName) {
  const modsRoots = [
    "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods",
    "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/Local Mods",
  ];
  // Match strategies (try each in order, first hit wins):
  //   1. Substring match after normalization (covers "RIS Classic" ↔ "ris classic beta")
  //   2. Initials of one matches the other's full normalized form
  //      ("RTR: Imperium Surrectum" → "ris" matches dir "RIS beta")
  //   3. Initials of one matches initials of the other ("RIS" ↔ "RIS")
  const normalize = (s) => String(s).toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\d.]+/g, "")
    .replace(/[^a-z]+/g, "")
    .trim();
  // Compute initials from a non-normalized string, e.g.
  // "RTR: Imperium Surrectum 0.7.0" → "ris".
  const initials = (s) => {
    const clean = String(s).replace(/\[[^\]]*\]/g, "").replace(/[\d.]+/g, " ");
    const words = clean.split(/[^A-Za-z]+/).filter(Boolean);
    return words.map(w => w[0].toLowerCase()).join("");
  };
  const targetNorm = normalize(modDisplayName);
  const targetInit = initials(modDisplayName);
  if (!targetNorm && !targetInit) return null;
  let best = null;
  for (const root of modsRoots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dirNorm = normalize(e.name);
      const dirInit = initials(e.name);
      let matched = false;
      if (targetNorm && dirNorm && (targetNorm.includes(dirNorm) || dirNorm.includes(targetNorm))) matched = true;
      if (!matched && targetInit && dirNorm && dirNorm.includes(targetInit)) matched = true;
      if (!matched && targetNorm && dirInit && targetNorm.includes(dirInit)) matched = true;
      if (!matched && targetInit && dirInit && targetInit === dirInit) matched = true;
      if (!matched) continue;
      const full = path.join(root, e.name);
      const dataDir = path.join(full, "data");
      if (!fs.existsSync(dataDir)) continue;
      const mtime = fs.statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) best = { path: full, mtime };
    }
  }
  return best ? best.path : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOD DATA LOADERS
// ─────────────────────────────────────────────────────────────────────────────

function loadChainLevels(modDataDir) {
  const stripComments = (line) => { const i = line.indexOf(";"); return i >= 0 ? line.slice(0, i) : line; };
  const candidates = [
    path.join(modDataDir, "export_descr_buildings.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "export_descr_buildings.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const lines = text.split(/\r?\n/);
    const map = {};
    let curChain = null;
    for (const raw of lines) {
      const line = stripComments(raw).trim();
      if (!line) continue;
      const cm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (cm) { curChain = cm[1]; continue; }
      if (!curChain) continue;
      const lm = line.match(/^levels\s+(.+?)\s*\{?\s*$/);
      if (lm) {
        const levels = lm[1].split(/\s+/).filter(Boolean);
        if (levels.length > 0) map[curChain] = levels;
        curChain = null;
      }
    }
    if (Object.keys(map).length > 0) return map;
  }
  return {};
}

// Returns { decls: { facId: {aiType, denari, superfaction} },
//           descrOrder: [facId, ...]  in faction-block declaration order }
function loadFactionDeclarations(stratPath) {
  const text = fs.readFileSync(stratPath, "utf8");
  const lines = text.split(/\r?\n/);
  const decls = {};
  const descrOrder = [];
  let curFac = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const fm = line.match(/^faction\s+([A-Za-z0-9_]+)\s*(?:,\s*(.+))?$/);
    if (fm) {
      curFac = fm[1];
      decls[curFac] = { aiType: fm[2] || "default", denari: 1000, superfaction: null, deadUntilResurrected: false, reEmergent: false, aiDoNotAttack: null };
      descrOrder.push(curFac);
      continue;
    }
    if (!curFac) continue;
    const dm = line.match(/^denari\s+(-?\d+)/);
    if (dm) { decls[curFac].denari = parseInt(dm[1], 10); continue; }
    const sm = line.match(/^superfaction\s+(\w+)/);
    if (sm) { decls[curFac].superfaction = sm[1]; continue; }
    if (line === "dead_until_resurrected") { decls[curFac].deadUntilResurrected = true; continue; }
    if (line === "re_emergent") { decls[curFac].reEmergent = true; continue; }
    const adm = line.match(/^ai_do_not_attack\s+(.+)$/);
    if (adm) { decls[curFac].aiDoNotAttack = adm[1]; continue; }
    if (line === "settlement") { curFac = null; }
  }
  return { decls, descrOrder };
}

function loadSettlementToRegion(modDataDir) {
  const regionsPath = findDescrRegions(modDataDir, "imperial_campaign");
  if (!regionsPath) return { settlementToRegion: {}, regionToSettlement: {} };
  const regionToSettlement = parseDescrRegions(regionsPath);
  const settlementToRegion = {};
  for (const [region, settlement] of Object.entries(regionToSettlement)) {
    settlementToRegion[settlement] = region;
  }
  return { settlementToRegion, regionToSettlement };
}

// Settlement tile coordinates extracted from map_regions.tga. Each
// settlement is a black pixel in the TGA; the surrounding region color
// identifies which region it belongs to. Returns a map of
// `settlementName -> { x, y }` in descr_strat tile space.
function loadSettlementCoords(modDataDir) {
  const tgaPath = path.join(modDataDir, "world", "maps", "base", "map_regions.tga");
  const regionsPath = findDescrRegions(modDataDir, "imperial_campaign");
  if (!fs.existsSync(tgaPath) || !regionsPath) return {};
  const regionToSettlement = parseDescrRegions(regionsPath);
  // Build rgbToRegion: parse the same descr_regions.txt for the RGB triplets.
  const text = fs.readFileSync(regionsPath, "utf8");
  const lines = text.split(/\r?\n/);
  const rgbToRegion = {};
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    if (!name || /^[;\s]/.test(name) || !/^[A-Za-z]/.test(name)) continue;
    const rgbLine = (lines[i + 4] || "").trim();
    const m = rgbLine.match(/^(\d+)\s+(\d+)\s+(\d+)/);
    if (m) rgbToRegion[`${+m[1]},${+m[2]},${+m[3]}`] = name.trim();
  }
  const tgaBuf = fs.readFileSync(tgaPath);
  const regionCoords = buildRegionCoords(tgaBuf, rgbToRegion);
  const out = {};
  for (const [region, sett] of Object.entries(regionToSettlement)) {
    const c = regionCoords[region];
    if (c) out[sett] = c;
  }
  return out;
}

// descr_names_lookup.txt — flat list of name TOKENS (one per line). Used by
// the character parser to resolve nameLookup[u32] → readable string.
function loadNameLookup(modDataDir) {
  const candidates = [
    path.join(modDataDir, "descr_names_lookup.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_names_lookup.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    return fs.readFileSync(src, "utf8").replace(/^﻿/, "").split(/\r?\n/).map(s => s.trim());
  }
  return [];
}

// Parse descr_namelists.txt → { namelistId: [name, ...] }. The file uses
// a loose JSON-ish syntax: `"namelist_id": { "names": [ "Foo", "Bar", ], }`.
// We scan line-by-line to avoid coupling to a JSON parser (the trailing
// commas and unquoted-string flavour vary across mods).
function loadNamelists(modDataDir) {
  const candidates = [
    path.join(modDataDir, "descr_namelists.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8").replace(/^﻿/, "");
    const lines = text.split(/\r?\n/);
    const out = {};
    let currentList = null;
    let inNamesArr = false;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // namelist id: a bare `"id":` line at any indent — distinguished from
      // a "names":/"namelists": key by the next non-blank line containing `{`.
      const idM = ln.match(/^\s*"([a-z][a-z0-9_]*)"\s*:\s*$/i);
      if (idM && idM[1] !== "namelists" && idM[1] !== "names") {
        // Peek ahead for opening brace
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          if (/^\s*\{/.test(lines[j])) { currentList = idM[1]; out[currentList] = []; break; }
        }
        continue;
      }
      if (/^\s*"names"\s*:/.test(ln)) { inNamesArr = true; continue; }
      if (inNamesArr) {
        if (/^\s*\]/.test(ln)) { inNamesArr = false; continue; }
        const nm = ln.match(/^\s*"([^"]+)"/);
        if (nm && currentList) out[currentList].push(nm[1]);
      }
    }
    return out;
  }
  return {};
}

// Parse descr_sm_factions.txt → { factionId: { men, women, surnames } }.
// Each faction block has a `"namelists": { "men": "<id>", "women": "<id>",
// "surnames": "<id>", }` sub-block. We don't try to validate the whole
// schema; we walk faction-id headers and capture the namelist mapping
// whichever order it appears in.
function loadFactionNamelists(modDataDir) {
  const candidates = [
    path.join(modDataDir, "descr_sm_factions.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8").replace(/^﻿/, "");
    const lines = text.split(/\r?\n/);
    const out = {};
    let currentFac = null;
    let inNamelistBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // Faction header: `\t"faction_id":` (one tab indent — siblings are
      // at the same level under top-level "factions": { ... }).
      const fm = ln.match(/^\t"([a-z][a-z0-9_]*)"\s*:\s*$/);
      if (fm) { currentFac = fm[1]; out[currentFac] = {}; inNamelistBlock = false; continue; }
      if (/^\s*"namelists"\s*:/.test(ln)) { inNamelistBlock = true; continue; }
      if (inNamelistBlock) {
        if (/^\s*\}/.test(ln)) { inNamelistBlock = false; continue; }
        const kv = ln.match(/^\s*"(men|women|surnames)"\s*:\s*"([^"]+)"/);
        if (kv && currentFac) out[currentFac][kv[1]] = kv[2];
      }
    }
    return out;
  }
  return {};
}

// export_descr_character_traits.txt — extract trait NAMES (order matters:
// the save stores trait_id = index into this list) plus the MAX LEVEL of
// each trait (= the count of "Level <name>" definitions inside the block).
// Returns { names: [...], maxLevels: { name: int } }.
function loadTraitNames(modDataDir) {
  const candidates = [
    path.join(modDataDir, "export_descr_character_traits.txt"),
    path.join(modDataDir, "data", "export_descr_character_traits.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const names = [];
    const maxLevels = {};
    let curTrait = null, levelCount = 0;
    for (const line of text.split(/\r?\n/)) {
      const tm = line.match(/^Trait\s+(\S+)/);
      if (tm) {
        if (curTrait) maxLevels[curTrait] = levelCount;
        curTrait = tm[1]; levelCount = 0;
        names.push(curTrait);
        continue;
      }
      if (curTrait && /^\s*Level\s+/.test(line)) levelCount++;
    }
    if (curTrait) maxLevels[curTrait] = levelCount;
    if (names.length > 0) { names.maxLevels = maxLevels; return names; }
  }
  return [];
}

// export_descr_unit.txt — Set of unit names from EDU. Searched in the
// bundled mod first, then any user-installed mod dir under Feral RTW.
// Returns null if no EDU is found (save→descr_strat still works, just
// without unit-name substitution for invalid references).
function loadEduUnitNames(modDataDir) {
  const candidates = [path.join(modDataDir, "export_descr_unit.txt")];
  const modsRoot = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods";
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      const cand = path.join(sub, "export_descr_unit.txt");
      if (fs.existsSync(cand)) candidates.push(cand);
      walk(sub, depth + 1);
    }
  }
  if (fs.existsSync(modsRoot)) walk(modsRoot, 0);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const set = new Set();
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^type\s+(.+?)\s*$/);
      if (m) set.add(m[1].trim());
    }
    if (set.size > 0) { set._sourcePath = p; return set; }
  }
  return null;
}

// export_descr_ancillaries.txt — extract names in declaration order so
// save's ancillary u32 id can be mapped to a descr_strat-emittable name.
function loadAncillaryNames(modDataDir) {
  const candidates = [
    path.join(modDataDir, "export_descr_ancillaries.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const names = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^Ancillary\s+(\S+)/);
      if (m) names.push(m[1]);
    }
    if (names.length > 0) return names;
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENT POPULATION (from save bytes)
// ─────────────────────────────────────────────────────────────────────────────
// Cracked by Provincia's main.js: each settlement marker's population is a
// u32 at marker.offset - 1494 (RIS imperial / vanilla imperial layout).
// Sanity-clipped to [100, 100000] to detect record-layout drift.
function extractPopulationByCity(buf, settlements) {
  const out = {};
  for (const s of settlements) {
    const off = s.offset - 1494;
    if (off < 0 || off + 4 > buf.length) continue;
    const v = buf.readUInt32LE(off);
    if (Number.isFinite(v) && v >= 100 && v <= 100000) {
      out[s.name] = v;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENT LEVEL INFERENCE
// ─────────────────────────────────────────────────────────────────────────────
// descr_strat uses level village|town|large_town|city|large_city|huge_city.
// The save doesn't expose this as a single field we've decoded, but we can
// INFER it from the level of the `core_building` chain (the governor's house
// → governor's villa → palace → proconsul's palace → ... ladder).
//
// EDB core_building levels (in order): governors_house, governors_villa,
// proconsuls_palace, imperial_palace, royal_palace, ... mod-dependent.
// Heuristic: map level index → settlement size tier.
function inferSettlementLevel(buildings) {
  const core = buildings.find(b => b.name === "core_building");
  if (!core || typeof core.level !== "number") return "town"; // sensible default
  // RIS imperial mapping observed across the bundled descr_strat:
  //   gov0 (governors_house)    → village
  //   gov1 (governors_villa)    → town
  //   gov2 (proconsuls_palace)  → large_town
  //   gov3 (imperial_palace)    → city
  //   gov4 (royal_palace)       → large_city
  //   gov5+                     → huge_city
  const tiers = ["village", "town", "large_town", "city", "large_city", "huge_city"];
  return tiers[Math.min(core.level, tiers.length - 1)];
}

// Population heuristic by tier (the engine recomputes from level + buildings;
// the descr_strat value is just an initial seed).
const POPULATION_BY_LEVEL = {
  village: 500, town: 1500, large_town: 3000, city: 6000, large_city: 12000, huge_city: 24000,
};

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
function extractCharacters(buf, nameLookup, traitNames) {
  const records = findCharacterRecords(buf, nameLookup, traitNames, null);
  const markers = findFactionMarkers(buf);
  assignFactions(records, markers);
  // Return ALL parsed characters — caller filters as needed. Dead chars
  // matter for father references (engine needs character_record for the
  // dead ancestor) but we'll handle that in the family-tree emit step.
  return records.filter(c => c.firstName && c.firstName !== `#0`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY TREE
// ─────────────────────────────────────────────────────────────────────────────
// Build the (father, mother) → [children] graph from each character's spouse
// and child UUIDs. Returns:
//   { uuidToChar: Map<primaryUuid, char>,
//     relatives: [{ fatherChar, motherChar, childrenChars }, ...] }
function buildFamilyTree(allCharacters) {
  const uuidToChar = new Map();
  for (const c of allCharacters) {
    if (c.primaryUuid) uuidToChar.set(c.primaryUuid, c);
  }
  const relatives = [];
  const claimedFatherUuids = new Set();
  // Pass 1: confirmed-male and unknown-gender characters anchor as fathers
  // directly. (Anchoring on females directly would emit `relative\twife,
  // husband, kids` which the bundled file's convention rejects.)
  for (const c of allCharacters) {
    if (c.gender === "female") continue;
    if (!c.spouseUuid && (!c.childUuids || c.childUuids.length === 0)) continue;
    const motherChar = c.spouseUuid ? uuidToChar.get(c.spouseUuid) : null;
    const childrenChars = (c.childUuids || [])
      .map(u => uuidToChar.get(u))
      .filter(Boolean);
    if (!motherChar && childrenChars.length === 0) continue;
    relatives.push({ fatherChar: c, motherChar, childrenChars });
    if (c.primaryUuid) claimedFatherUuids.add(c.primaryUuid);
  }
  // Pass 2: females with spouse+children — follow spouseUuid to find husband.
  // If husband exists in our set AND hasn't already been claimed as a father
  // in pass 1, anchor the relationship on HIM with this female as mother.
  // (Covers cases where the wife's record carries the family pointers but
  // the husband's record doesn't.)
  for (const c of allCharacters) {
    if (c.gender !== "female") continue;
    if (!c.spouseUuid) continue;
    const husband = uuidToChar.get(c.spouseUuid);
    if (!husband || claimedFatherUuids.has(husband.primaryUuid)) continue;
    const childrenChars = (c.childUuids || [])
      .map(u => uuidToChar.get(u))
      .filter(Boolean);
    if (childrenChars.length === 0 && !husband.spouseUuid) continue;
    relatives.push({ fatherChar: husband, motherChar: c, childrenChars });
    if (husband.primaryUuid) claimedFatherUuids.add(husband.primaryUuid);
  }
  return { uuidToChar, relatives };
}

function fullName(c) {
  if (!c) return null;
  return c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
}

function emitCharacterRecord(c) {
  // Engine accepts only "male" or "female" — "unknown" (the parser's default
  // when it can't pin the gender byte) is a load error. Map to male, which
  // matches our family-tree filter that treats unknowns as eligible fathers.
  const gender = (c.gender === "female") ? "female" : "male";
  const status = c.isDead ? "dead" : "alive";
  // never_a_leader = engine flag preventing this person from being eligible
  // as faction leader (used for wives, children, distant relatives). For our
  // extraction, ANY character without isLeader/isHeir gets never_a_leader.
  const flag = (c.isLeader || c.isHeir) ? "" : ", never_a_leader";
  // Match bundled descr_strat shape: gender first, then full stat fields
  // (command/influence/management/subterfuge all 0), then age, status,
  // leader-flag. Engine may accept abbreviated form but some validators
  // trip on missing fields; safer to emit full shape.
  return `character_record\t${fullName(c)}, \t${gender}, command 0, influence 0, management 0, subterfuge 0, age ${c.age || 1}, ${status}${flag}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARMY EXTRACTION (units grouped by commander)
// ─────────────────────────────────────────────────────────────────────────────
function groupUnitsByCommander(buf) {
  const units = findUnitRecords(buf);
  const byCommander = new Map();
  for (const u of units) {
    if (!u.commanderUuid || u.commanderUuid === 0 || u.commanderUuid === 0xffffffff) continue;
    if (!byCommander.has(u.commanderUuid)) byCommander.set(u.commanderUuid, []);
    byCommander.get(u.commanderUuid).push(u);
  }
  return byCommander;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMISSION HELPERS — write descr_strat-formatted blocks
// ─────────────────────────────────────────────────────────────────────────────

// Source-strat fallback: per-faction `character, NAME, ...` + traits + ancillaries
// + army + units blocks (multi-line). Walks descr_strat and groups lines
// belonging to one character together. Used to fill gaps in army composition
// (we emit ~28% of units from save; source has the rest at T1).
let _sourceStratCharactersByFaction = null;
function loadSourceStratCharacters(stratPath) {
  if (_sourceStratCharactersByFaction) return _sourceStratCharactersByFaction;
  _sourceStratCharactersByFaction = {};
  if (!fs.existsSync(stratPath)) return _sourceStratCharactersByFaction;
  const lines = fs.readFileSync(stratPath, "utf8").split(/\r?\n/);
  let cur = null;
  let block = null;
  let firstName = null;
  // Buffer of preceding comments + blanks that should attach to the NEXT
  // character block (e.g. `;Capua` annotations + blank-line separators).
  let pending = [];
  const flush = () => {
    if (cur && block && block.length) {
      // Prepend any buffered comments/blanks so the round-trip preserves
      // the source's structural layout.
      const text = pending.concat(block).join("\n");
      _sourceStratCharactersByFaction[cur].push({ firstName, text });
      pending = [];
    }
    block = null;
    firstName = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const fm = raw.match(/^faction\s+([A-Za-z0-9_]+)\s*,/);
    if (fm) {
      flush();
      pending = [];
      cur = fm[1];
      if (!_sourceStratCharactersByFaction[cur]) _sourceStratCharactersByFaction[cur] = [];
      continue;
    }
    if (!cur) continue;
    const cm = raw.match(/^character,\s*(.+?)$/);
    if (cm) {
      flush();
      const after = cm[1];
      const stripped = after.replace(/^sub_faction\s+\S+,\s*/, "");
      const nm = stripped.match(/^(\S[^,]*?),/);
      firstName = nm ? nm[1].trim() : null;
      block = [raw];
      continue;
    }
    if (block) {
      // Inside a block: ONLY flush on blank line, not on comments. Source
      // has commented-out content lines INSIDE character blocks (e.g.
      // `;ancillaries scribe_ancillary` followed by the real `army` + `unit`
      // lines) — flushing on `;` dropped those real lines and produced a
      // general/admiral character without an army block. The engine then
      // errored with "Cannot create a general/admiral character without
      // an army/navy." Keep `;` lines as part of the current block.
      if (/^\s*$/.test(raw)) {
        flush();
        pending.push(raw);
        continue;
      }
      block.push(raw);
    } else {
      // Between blocks — collect comments + blanks to attach to next char
      if (/^;/.test(raw) || /^\s*$/.test(raw)) pending.push(raw);
    }
  }
  flush();
  return _sourceStratCharactersByFaction;
}

// Source-strat fallback: per-faction `character_record` + `relative` lines.
// At turn 1, the source descr_strat has the full family tree; the v1
// character parser misses ~98% of these (wives + daughters live in a save
// section we haven't cracked). Falling back to source closes the gap for
// round-trip at T1. For later turns, source may diverge from actual state.
let _sourceStratFamilyByFaction = null;
function loadSourceStratFamily(stratPath) {
  if (_sourceStratFamilyByFaction) return _sourceStratFamilyByFaction;
  _sourceStratFamilyByFaction = {};
  if (!fs.existsSync(stratPath)) return _sourceStratFamilyByFaction;
  const text = fs.readFileSync(stratPath, "utf8");
  const lines = text.split(/\r?\n/);
  // Build the set of ACTIVELY DECLARED character names (un-commented).
  // RIS source descr_strat keeps dead characters commented out (e.g.
  // `;character_record Pleistarchos,...`) but their family-tree `relative`
  // lines may still reference them — the engine errors with "couldn't find
  // <name>'s character_record" and refuses to load the campaign. Drop any
  // relative line that references a name without an active declaration.
  const activeNames = new Set();
  for (const raw of lines) {
    if (/^\s*;/.test(raw)) continue;  // skip commented-out lines
    const mc = raw.match(/^character,\s+(?:sub_faction\s+\S+,\s+)?(\S[^,]*?),/);
    if (mc) { activeNames.add(mc[1].trim()); continue; }
    const mr = raw.match(/^character_record\s+(\S[^,]*?),/);
    if (mr) { activeNames.add(mr[1].trim()); }
  }
  let cur = null;
  let droppedRel = 0;
  for (const raw of lines) {
    if (/^\s*;/.test(raw)) continue;  // skip commented sections entirely
    const fm = raw.match(/^faction\s+([A-Za-z0-9_]+)\s*,/);
    if (fm) {
      cur = fm[1];
      if (!_sourceStratFamilyByFaction[cur]) _sourceStratFamilyByFaction[cur] = { records: [], relatives: [] };
      continue;
    }
    if (!cur) continue;
    if (/^character_record\b/.test(raw)) _sourceStratFamilyByFaction[cur].records.push(raw);
    else if (/^relative\b/.test(raw)) {
      // Validate ALL names in the relative line are active. Strip any
      // trailing `;comment` after `end` so we don't grab "end;Iolaos".
      const cleaned = raw.replace(/;.*$/, "");
      const m = cleaned.match(/^relative\s+(.+?)\s*$/);
      if (!m) continue;
      const parts = m[1].split(",").map(s => s.trim()).filter(s => s && s !== "end");
      const allActive = parts.every(p => activeNames.has(p));
      if (allActive) _sourceStratFamilyByFaction[cur].relatives.push(cleaned.trimEnd());
      else droppedRel++;
    }
  }
  if (droppedRel > 0) console.log(`[source-family] dropped ${droppedRel} relative line(s) referencing commented-out characters`);
  return _sourceStratFamilyByFaction;
}

// Source-strat fallback: walk descr_strat once and map region → list of
// `{chainType, levelName}` buildings as listed in descr_strat. We use this
// to fill in chains the save doesn't store per-settlement (notably
// governmentA-D — the save has the string "governmentD" exactly once,
// the engine implicitly assigns the rest by faction culture + settlement
// level. For T1 round-trip, falling back to source values is correct.)
let _sourceStratBuildingsByRegion = null;
let _sourceStratGarrisonsByRegion = null;
let _sourceStratLevelByRegion = null;
function loadSourceStratBuildings(stratPath) {
  if (_sourceStratBuildingsByRegion) return _sourceStratBuildingsByRegion;
  _sourceStratBuildingsByRegion = {};
  _sourceStratGarrisonsByRegion = {};
  _sourceStratLevelByRegion = {};
  if (!fs.existsSync(stratPath)) return _sourceStratBuildingsByRegion;
  const lines = fs.readFileSync(stratPath, "utf8").split(/\r?\n/);
  let curRegion = null, inSettlement = false, depth = 0;
  let inGarrison = false;
  let pendingLevel = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    if (line === "settlement") { inSettlement = true; depth = 0; curRegion = null; inGarrison = false; pendingLevel = null; continue; }
    if (!inSettlement) continue;
    if (line === "{") { depth++; inGarrison = false; continue; }
    if (line === "}") { depth--; inGarrison = false; if (depth <= 0) { inSettlement = false; curRegion = null; pendingLevel = null; } continue; }
    const lvm = line.match(/^level\s+(\S+)/);
    if (lvm) { pendingLevel = lvm[1]; continue; }
    const rm = line.match(/^region\s+(\S+)/);
    if (rm) {
      curRegion = rm[1];
      if (!_sourceStratBuildingsByRegion[curRegion]) _sourceStratBuildingsByRegion[curRegion] = [];
      if (pendingLevel) _sourceStratLevelByRegion[curRegion] = pendingLevel;
      continue;
    }
    if (line === "garrisoned_army") { inGarrison = true; if (curRegion && !_sourceStratGarrisonsByRegion[curRegion]) _sourceStratGarrisonsByRegion[curRegion] = []; continue; }
    if (inGarrison && /^unit\b/.test(line)) {
      if (curRegion) _sourceStratGarrisonsByRegion[curRegion].push(raw);
      continue;
    }
    if (inGarrison && line && !/^unit\b/.test(line)) inGarrison = false;
    const tm = line.match(/^type\s+(\S+)\s+(\S+)/);
    if (tm && curRegion) {
      _sourceStratBuildingsByRegion[curRegion].push({ chainType: tm[1], levelName: tm[2] });
    }
  }
  return _sourceStratBuildingsByRegion;
}
function getSourceStratGarrisons() { return _sourceStratGarrisonsByRegion; }
function getSourceStratLevelByRegion() { return _sourceStratLevelByRegion; }

function emitSettlement(s, factionId, chainLevels, originalCreator, populationByCity, sourceBuildings) {
  const lines = [];
  // Engine RULE: settlement_level_idx == core_building_level + 1. Source
  // descr_strat's level may be STALE for T20+ (settlements grew/shrank
  // during play) — using source level when core_building's actual level
  // disagrees produces "core building level should be one less than the
  // settlement level!" errors, and the engine refuses to create the
  // settlement. Derive level from core_building always; only fall back to
  // source when save has no core_building parsed.
  const inferredLevel = inferSettlementLevel(s.buildings);
  const sourceLevels = getSourceStratLevelByRegion();
  const sourceLevel = sourceLevels && s.region ? sourceLevels[s.region] : null;
  // Use the inferred level (core_building-derived) when we have a real
  // core_building from save. Use source level only when settlement has
  // no core_building parsed (placeholder slave-owned regions).
  const hasCore = (s.buildings || []).some(b => b.name === "core_building" && typeof b.level === "number");
  const level = hasCore ? inferredLevel : (sourceLevel || inferredLevel);
  // Prefer real save population over the level-based default. Saves the
  // user's actual settlement growth — e.g. a "large_town" with 50k pop
  // (turn 1000 conqueror's capital) instead of the default 3000.
  const realPop = populationByCity ? populationByCity[s.name] : null;
  const population = realPop != null ? realPop : POPULATION_BY_LEVEL[level];
  lines.push("settlement");
  lines.push("{");
  lines.push(`\tlevel ${level}`);
  lines.push(`\tregion ${s.region || "Unknown"}`);
  lines.push(`\tyear_founded 0`);
  lines.push(`\tpopulation ${population}`);
  lines.push(`\tplan_set default_set`);
  // faction_creator drives RTW's "emergent faction" mechanic: when a
  // rebellion happens in a settlement, the rebels become this faction.
  // Use the ORIGINAL faction_creator from the bundled descr_strat so
  // killed factions can re-emerge from their historical homeland — not
  // the current owner. (If we used currentOwner, killed factions would
  // never re-emerge because no settlement points back to them.)
  lines.push(`\tfaction_creator ${originalCreator || factionId}`);

  // Source-strat fallback: garrisoned_army (settlement garrison units). The
  // save embeds these in the settlement record but our parser doesn't lift
  // them out yet. Copy source's verbatim for T1 round-trip parity.
  const sourceGarrisons = getSourceStratGarrisons();
  if (sourceGarrisons && s.region && sourceGarrisons[s.region] && sourceGarrisons[s.region].length > 0) {
    lines.push(`\tgarrisoned_army`);
    for (const u of sourceGarrisons[s.region]) lines.push(u);
  }

  // Auto-complete in-progress upgrades that are >50% done. If a building
  // chain is currently at level N and queued for upgrade to level N+1 with
  // >=50% progress, emit it at level N+1 instead of N. This carries over
  // the user's "almost there" upgrades — losing the last 50% of progress
  // is a small price vs losing the whole upgrade. <50% queued chains are
  // dropped (the engine will need to re-start them).
  const queuedByChain = new Map();
  for (const q of (s.queued || [])) {
    if (q && typeof q === "object" && typeof q.percent === "number") {
      queuedByChain.set(q.name, q.percent);
    }
  }
  // Source-buildings whitelist for region-constrained chains. If source
  // descr_strat for this region doesn't list a particular chain, the engine
  // probably won't allow it (e.g. port_buildings in an inland region —
  // engine: "this region is not allowed a port" → won't create the
  // settlement at all). Filter such chains from emit.
  const sourceChainSet = new Set(
    (sourceBuildings || []).map(sb => sb.chainType)
  );
  // Chains the engine validates against region constraints. If the chain
  // appears in source for THIS region, it's allowed; otherwise drop it.
  const REGION_CONSTRAINED = new Set(["port_buildings"]);

  let emittedCoreBuilding = false;
  const emittedChains = new Set();
  for (const b of s.buildings) {
    // Region-constrained chains: only emit if source has it for this region.
    // Saves can carry buildings the source never had (prior owner built it
    // when the region was differently classified) which the engine then
    // rejects on load.
    if (REGION_CONSTRAINED.has(b.name) && !sourceChainSet.has(b.name)) continue;
    const levelNames = chainLevels[b.name];
    let effectiveLevel = b.level;
    const queuePct = queuedByChain.get(b.name);
    if (queuePct != null && queuePct >= 50 && levelNames &&
        typeof b.level === "number" && b.level + 1 < levelNames.length) {
      effectiveLevel = b.level + 1;
    }
    let levelName;
    if (levelNames && typeof effectiveLevel === "number" && effectiveLevel >= 0 && effectiveLevel < levelNames.length) {
      levelName = levelNames[effectiveLevel];
    } else {
      levelName = `level_${effectiveLevel ?? "?"}`;
    }
    if (b.name === "core_building") emittedCoreBuilding = true;
    emittedChains.add(b.name);
    lines.push(`\tbuilding`);
    lines.push(`\t{`);
    lines.push(`\t\ttype ${b.name} ${levelName}`);
    lines.push(`\t}`);
  }
  // Source-strat fallback for chains the save doesn't reify per-settlement
  // (notably governmentA-D, which RIS-RR stores only as a single template
  // string — the per-settlement assignment is implicit). For round-trip at
  // turn 1 this brings the building section back to source parity.
  if (sourceBuildings && Array.isArray(sourceBuildings)) {
    for (const sb of sourceBuildings) {
      if (emittedChains.has(sb.chainType)) continue;
      emittedChains.add(sb.chainType);
      lines.push(`\tbuilding`);
      lines.push(`\t{`);
      lines.push(`\t\ttype ${sb.chainType} ${sb.levelName}`);
      lines.push(`\t}`);
    }
  }
  // RTW REQUIRES every settlement to have a `core_building`. Placeholder
  // settlements (mod regions not covered by the save) and any save record
  // whose core_building entry didn't parse won't have one — inject the
  // level-appropriate default. Without this the engine refuses to load
  // the descr_strat (silently for some campaigns, hard-crash for others).
  if (!emittedCoreBuilding) {
    const coreLevels = chainLevels["core_building"];
    const tierMap = { village: 0, town: 1, large_town: 2, minor_city: 3, city: 3, large_city: 4, huge_city: 5 };
    const tier = tierMap[level] ?? 0;
    let coreLevelName = "governors_house";
    if (coreLevels && coreLevels.length > 0) {
      coreLevelName = coreLevels[Math.min(tier, coreLevels.length - 1)];
    }
    lines.push(`\tbuilding`);
    lines.push(`\t{`);
    lines.push(`\t\ttype core_building ${coreLevelName}`);
    lines.push(`\t}`);
  }
  lines.push("}");
  return lines.join("\n");
}

// One character — `character,` line + traits line + (optional) army block.
// descr_strat character format:
//   character, <First> <Last>, named character[, leader|heir], age N, , x X, y Y
//   traits TraitName Level, TraitName Level, ...
//   army
//   unit <unit_name>    exp N armour N weapon_lvl N
//
// Returns null when the character isn't emittable (e.g. unknown position with
// no faction-anchor fallback).
// Dedupes character names: descr_strat requires UNIQUE names. When the
// save has multiple living characters with the same name (single-name
// cultures like Greek/Barbarian = "Bolgios" x12), we try letter-suffix
// variants that already exist in descr_names_lookup (BolgiosA, BolgiosB...).
// Returns the resolved name (mutating c.firstName so later emissions stay
// consistent), or null when no valid variant is available — caller drops.
function resolveUniqueFirstName(c, usedNames, nameLookupSet, nameLookupArr, cultureNames) {
  const orig = c.firstName;
  if (!orig) return null;
  const lastBit = c.lastName ? ` ${c.lastName}` : "";
  const key0 = orig + lastBit;
  if (!usedNames.has(key0)) { usedNames.add(key0); return orig; }
  // Tier 1: letter suffixes A..Z that EXIST in descr_names_lookup (preserves
  // name family — "BolgiosA" feels like a Bolgios variant). Some mods only
  // ship A-J; we skip codes that aren't real tokens.
  for (let code = 65; code <= 90; code++) {
    const cand = orig + String.fromCharCode(code);
    if (nameLookupSet && !nameLookupSet.has(cand)) continue;
    const candKey = cand + lastBit;
    if (usedNames.has(candKey)) continue;
    usedNames.add(candKey);
    c.firstName = cand;
    return cand;
  }
  // Tier 2a: pick from the faction's CULTURE-SPECIFIC namelist first — a
  // Greek-cultured faction's collision-victim should still get a Greek name,
  // not a random one from the global pool.
  const tryArr = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const start = (usedNames.size * 9973) % arr.length;
    for (let i = 0; i < arr.length; i++) {
      const cand = arr[(start + i) % arr.length];
      if (!cand) continue;
      const candKey = cand + lastBit;
      if (usedNames.has(candKey)) continue;
      usedNames.add(candKey);
      c.firstName = cand;
      c.renamedByDedup = true;
      return cand;
    }
    return null;
  };
  const cultPick = tryArr(cultureNames);
  if (cultPick) return cultPick;
  // Tier 2b: fall back to the global descr_names_lookup. Loses culture match
  // but keeps the character. Engine accepts any token in lookup regardless
  // of culture, so this is load-safe; only cosmetic identity suffers.
  const anyPick = tryArr(nameLookupArr);
  if (anyPick) return anyPick;
  return null;
}

function emitCharacter(c, armyUnits, fallbackPos, ancNames, eduUnits, factionBodyguard, substitutionLog, edctTraitNames, traitMaxLevels) {
  const lines = [];
  const firstName = c.firstName || "Unknown";
  const lastName = c.lastName || ""; // Greek single-name chars have no lastName
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  let role = "";
  if (c.isLeader) role = ", leader";
  else if (c.isHeir) role = ", heir";

  // Position: use the character's tile if known, else fall back to the
  // faction's capital (passed in by the caller). Some "characters" with
  // null position are governors stuck in settlements; the engine would
  // reject (0,0) for any character but accepts the settlement coord.
  let x = c.tileX, y = c.tileY;
  if ((!x || !y) && fallbackPos) { x = fallbackPos.x; y = fallbackPos.y; }
  if (!x || !y) return null; // give up — can't position this character

  // descr_strat tokenizes on commas+whitespace. The bundled file uses
  // `named_character` (underscore) — engine's lookup is on the joined
  // identifier; `named character` (space) is parsed as two tokens and
  // typically silently skipped, demoting the character to a no-role
  // captain. Match bundled exactly.
  lines.push(`character\t${fullName}, named_character${role}, age ${c.age || 30}, , x ${x}, y ${y}`);

  // Traits line — skip when empty.
  // Cap each trait at ITS OWN declared max level from EDCT (most traits
  // are binary, max=1; counter-traits go up to 9). The save sometimes
  // carries higher values (these are accumulating COUNTER-traits used
  // internally; emitting them verbatim would let the engine re-fire
  // their threshold effects on every turn).
  if (c.traits && c.traits.length > 0) {
    const traitParts = c.traits
      .filter(t => t.name && t.level >= 1)
      // Filter out trait names that don't exist in the mod's EDCT.
      // Saves often reference old/renamed traits (e.g. RIS renamed
      // "Fitness" → "Fitness_Normal" / "Fitness_Overweight" / etc).
      // Engine would just silently drop them but they trigger warnings.
      .filter(t => !edctTraitNames || edctTraitNames.has(t.name))
      .map(t => {
        const cap = (traitMaxLevels && traitMaxLevels[t.name]) || 9;
        return `${t.name} ${Math.min(t.level, cap)}`;
      });
    if (traitParts.length > 0) {
      lines.push(`traits ${traitParts.join(", ")}`);
    }
  }

  // Ancillaries: save stores u32 IDs, EDA's declaration order is the ID
  // sequence. Map each ID to its name; skip IDs that fall outside the
  // table (unknown / corrupt) so we don't emit garbage names.
  if (c.ancillaries && c.ancillaries.length > 0 && ancNames && ancNames.length > 0) {
    const ancParts = [];
    for (const a of c.ancillaries) {
      const id = (a && typeof a === "object") ? a.id : a;
      if (typeof id === "number" && id >= 0 && id < ancNames.length) {
        ancParts.push(ancNames[id]);
      }
    }
    if (ancParts.length > 0) {
      lines.push(`ancillaries ${ancParts.join(", ")}`);
    }
  }

  // Army block — every commander WITH a bodyguard unit gets one. The
  // bodyguard is the first `unit` line; other units in the stack follow.
  // EDU-aware substitution: if a unit name doesn't exist in this mod's
  // EDU, replace it with the faction's most-common-bodyguard (= the
  // first unit of that faction's other commanders). Catches saves that
  // were made with an older mod version that had units since renamed.
  if (armyUnits && armyUnits.length > 0) {
    lines.push("army");
    for (let i = 0; i < armyUnits.length; i++) {
      const u = armyUnits[i];
      let name = u.name;
      if (eduUnits && !eduUnits.has(name)) {
        // Substitute. For the bodyguard slot (first unit) use the
        // faction's preferred bodyguard. For other units we drop them
        // entirely — there's no good substitute for an unknown infantry/
        // cavalry unit and the engine would still reject the descr_strat.
        if (i === 0 && factionBodyguard) {
          name = factionBodyguard;
          if (substitutionLog) substitutionLog.push({ from: u.name, to: name, kind: "bodyguard" });
        } else {
          if (substitutionLog) substitutionLog.push({ from: u.name, to: null, kind: "dropped" });
          continue; // skip emit
        }
      }
      // Engine caps: exp 0..9, armour 0..3, weapon_lvl 0..3. Saves
      // sometimes carry inflated counter-values; emitting them verbatim
      // can crash the descr_strat parser.
      const exp = Math.max(0, Math.min(9, u.xp ?? 0));
      const armour = Math.max(0, Math.min(3, u.armourUpgrade ?? 0));
      const weapon = Math.max(0, Math.min(3, u.weaponUpgrade ?? 0));
      lines.push(`unit\t\t${name}\t\texp ${exp} armour ${armour} weapon_lvl ${weapon}`);
    }
  }
  return lines.join("\n");
}

function emitFactionBlock(facId, decl, settlements, characters, charArmies, chainLevels, family, ancNames, currentTreasury, settlementCoords, eduUnits, factionBodyguardByFaction, fallbackBodyguardUnit, substitutionLog, creatorByCity, edctTraitNames, populationByCity, traitMaxLevels, sourceStratBuildings, sourceStratFamily, sourceStratCharacters, turnNumber, crackedFamilyByFaction, crackedFamilyByUuid) {
  const factionBodyguard = factionBodyguardByFaction[facId] || fallbackBodyguardUnit;
  const lines = [];
  // Strip any trailing comma that leaked through from the source mod's
  // descr_strat (RIS alternate_campaign has `faction\trj, ai_rome,` —
  // trailing comma is harmless in that file but tokenizes as an empty
  // field here, looking like a parse error to humans reading the diff).
  const aiType = decl.aiType.replace(/,+$/, "");
  lines.push(`faction\t${facId}, ${aiType}`);
  if (decl.deadUntilResurrected) lines.push(`dead_until_resurrected`);
  if (decl.reEmergent) lines.push(`re_emergent`);
  if (decl.superfaction) lines.push(`superfaction ${decl.superfaction}`);
  if (decl.aiDoNotAttack) lines.push(`ai_do_not_attack ${decl.aiDoNotAttack}`);
  // Prefer the save's actual current treasury; fall back to bundled-starting
  // denari when extraction missed this faction (small/rebel factions whose
  // economic record wasn't matched). Floor at 0: carrying a negative balance
  // verbatim makes the engine fire bankruptcy / army-disband events on T1.
  // Per user mandate: NO fallback to source decl.denari when the save
  // doesn't tell us the treasury. Emit the actual save value, or 0 if we
  // genuinely can't extract one (better than silently lying with source's
  // starting denari, which masks parser gaps). Dead-until-resurrected
  // factions retain the source value because the engine hands them that
  // purse on re-emerge, which is correct.
  let rawDenari;
  if (decl.deadUntilResurrected) {
    rawDenari = decl.denari;
  } else if (currentTreasury != null) {
    rawDenari = currentTreasury;
  } else {
    rawDenari = 0;  // explicit: parser couldn't extract — surface as 0, not source
    if (substitutionLog) substitutionLog.push({ kind: "denari_unparseable", faction: facId });
  }
  const denari = Math.max(0, rawDenari);
  if (rawDenari < 0) substitutionLog.push({ kind: "denari_floored", from: facId, original: rawDenari });
  lines.push(`denari\t${denari}`);
  for (const s of settlements) {
    const origCreator = creatorByCity ? creatorByCity[s.name] : null;
    const sourceBuildings = sourceStratBuildings ? sourceStratBuildings[s.region] : null;
    lines.push(emitSettlement(s, facId, chainLevels, origCreator, populationByCity, sourceBuildings));
  }
  // Fallback position for characters whose own tileX/tileY is unset
  // (governors stuck in settlements, etc). Cascade:
  //   1. Leader's position (if known)
  //   2. Any commander's position
  //   3. The first owned settlement's tile coords (from map_regions.tga
  //      via buildRegionCoords). Catches factions where NO character has
  //      a known position — previously we dropped all their chars.
  let fallbackPos = null;
  for (const c of characters) {
    if (c.isLeader && c.tileX && c.tileY) { fallbackPos = { x: c.tileX, y: c.tileY }; break; }
  }
  if (!fallbackPos) {
    for (const c of characters) {
      if (c.tileX && c.tileY) { fallbackPos = { x: c.tileX, y: c.tileY }; break; }
    }
  }
  if (!fallbackPos && settlementCoords) {
    for (const s of settlements) {
      const c = settlementCoords[s.name];
      if (c) { fallbackPos = { x: c.x, y: c.y }; break; }
    }
  }
  // 4. Absolute last resort: pick ANY known settlement coord (just the first
  //    enumerable entry from the global map). Used when a faction has zero
  //    settlements AND zero characters with a position — the alternative is
  //    dropping the character entirely. RTW prefers an out-of-place character
  //    over none, since the engine can re-route them at turn start.
  if (!fallbackPos && settlementCoords) {
    for (const k in settlementCoords) {
      const c = settlementCoords[k];
      if (c && c.x && c.y) { fallbackPos = { x: c.x, y: c.y }; break; }
    }
  }
  // The set of UUIDs that ARE named characters in this faction — we'll skip
  // them in the character_record pass (they get full `character,` entries).
  const namedUuids = new Set(characters.map(c => c.primaryUuid).filter(Boolean));

  // Per-faction relatives: only relationships where at least the father is
  // attributed to this faction AND survived dedupe (so his character entry
  // is actually emitted). Dropping the dedupe-survived check would emit
  // `relative\t<dropped-name>, ...` referencing a character that doesn't
  // exist in the file — engine would warn or skip.
  const namedUuidsForRel = new Set(characters.map(c => c.primaryUuid).filter(Boolean));
  const factionRelatives = family.relatives.filter(r =>
    r.fatherChar.faction === facId && namedUuidsForRel.has(r.fatherChar.primaryUuid));

  // T1 round-trip strategy: if source descr_strat has character data for this
  // faction, PREFER source-verbatim emission (skip v1 entirely). The v1
  // parser misses captain-led armies and inflates unit counts via fallback
  // bodyguard substitution — emit-from-save was producing 4193 unit lines
  // for 992 chars vs source's 3104 lines for the same 992 chars, a 35%
  // over-count. For T1 with no actions taken, source IS the truth. Later
  // turns will need a delta strategy (v1 for new chars + state changes).
  const useSourceCharacters = sourceStratCharacters && sourceStratCharacters[facId] && sourceStratCharacters[facId].length > 0;
  // Cracked CURRENT family for turn>1: emit the live roster (births/deaths
  // since T1) instead of the stale source family. Gated on turn>1 AND the
  // cracked parser resolving at least one family member for this faction;
  // otherwise fall back to source family (the T1 verbatim path never reaches
  // here). See the cracked-family build in main() (familyRecordParser).
  const crackedFam = (crackedFamilyByFaction && crackedFamilyByFaction[facId]) || [];
  const useCrackedFamily = turnNumber > 1 && crackedFam.length > 0;
  const useSourceFamily = !useCrackedFamily && sourceStratFamily && sourceStratFamily[facId] &&
                          (sourceStratFamily[facId].records.length > 0 ||
                           sourceStratFamily[facId].relatives.length > 0);
  const hasName = (c) => !!(c && c.firstName);
  let emittedCount = 0, skippedCount = 0, recordCount = 0, relativeCount = 0;

  // Track every character NAME declared earlier in THIS faction block (as a
  // `character` head or a `character_record`). The engine refuses to load a
  // campaign whose `relative` line references an undeclared name ("couldn't
  // find <name>'s character_record"), so the cracked-family emit below drops
  // any relative whose names aren't all in this set. Mirrors the source-family
  // `allActive` validation pattern (loadSourceStratFamily).
  const declaredNames = new Set();
  const declareNameFromCharLine = (text) => {
    // `text` may be a MULTI-LINE source block (prepended ;comments + blanks,
    // the `character,` line, then ancillaries/army/unit lines). Scan each line
    // for the `character,` declaration. Format: `character,\t<Name>, ...` or
    // `character, sub_faction X, <Name>, ...`.
    for (const ln of text.split("\n")) {
      // Source uses `character,\t<Name>`; the from-save emitCharacter uses
      // `character\t<Name>` (tab, no comma). Accept either separator.
      const m = ln.match(/^character[,\t]\s*(?:sub_faction\s+\S+,\s*)?(\S[^,]*?),/);
      if (m) { declaredNames.add(m[1].trim()); return; }
    }
  };

  // CHARACTERS FIRST: `character,` declarations MUST appear before any
  // `relative` line that references them, otherwise the engine errors with
  // "couldn't find <name>'s character_record" and refuses to load the
  // campaign. Source descr_strat puts characters first, relatives last in
  // each faction block — we mirror that order.
  if (useSourceCharacters) {
    for (const sc of sourceStratCharacters[facId]) {
      lines.push(sc.text);
      lines.push("");
      declareNameFromCharLine(sc.text);
      emittedCount++;
    }
  } else {
    for (const c of characters) {
      const army = charArmies.get(c.secondaryUuid);
      const text = emitCharacter(c, army, fallbackPos, ancNames, eduUnits, factionBodyguard, substitutionLog, edctTraitNames, traitMaxLevels);
      if (text === null) { skippedCount++; continue; }
      lines.push(text);
      lines.push("");
      declareNameFromCharLine(text);
      emittedCount++;
    }
    if (skippedCount > 0) {
      lines.push(`; ${skippedCount} character(s) skipped (no position and no fallback)`);
    }
  }

  // THEN family-only character_records + relatives (after their referenced
  // characters have been emitted above).
  if (useCrackedFamily) {
    // CRACKED CURRENT family (turn>1). Emit a character_record for every
    // cracked member of this faction NOT already declared as a `character`
    // head, then anchor `relative` lines on the family heads.
    //
    // Name resolution: a member's father/spouse/child UUID resolves to a name
    // via the cracked record's pre-computed *Name fields (indexFamily already
    // resolved them against the cracked table + v1 generals). We only emit a
    // record/relationship once its NAME is in `declaredNames`, and we DROP any
    // relative whose names aren't all declared — guaranteeing the output stays
    // engine-loadable (no dangling references).
    const recName = (r) => (r && r.fullName) ? r.fullName.trim() : null;

    // 1) character_record for non-head members. Skip members already declared
    //    as a `character` head (same name) and de-dup repeated names.
    for (const r of crackedFam) {
      const nm = recName(r);
      if (!nm) continue;
      if (declaredNames.has(nm)) continue; // already a head or emitted
      // emitCharacterRecord expects {firstName,lastName,gender,age,isDead,...}.
      // Adapt the cracked record (firstName/surname/age/gender/alive) to it.
      const adapted = {
        firstName: r.firstName,
        lastName: r.surname || null,
        gender: r.gender,
        age: r.age != null ? r.age : 1,
        isDead: !r.alive,
        isLeader: false,
        isHeir: false,
      };
      lines.push(emitCharacterRecord(adapted));
      declaredNames.add(nm);
      recordCount++;
    }
    if (recordCount > 0) lines.push("");

    // 2) relative lines. Anchor on MALE family members (heads/fathers) so the
    //    line reads `relative <father>, <wife>, <children...>, end` — matching
    //    the source convention (anchoring on a wife would be rejected). For
    //    each potential father, gather his spouse + children by UUID via the
    //    cracked table, resolve to names, and emit only if EVERY name is
    //    declared. byUuid lets us resolve spouse/child names even when the
    //    member's own *Name field is blank.
    const byUuid = crackedFamilyByUuid || new Map();
    const nameOfUuid = (uuid) => {
      if (!uuid) return null;
      const m = byUuid.get(uuid >>> 0);
      return m ? recName(m) : null;
    };
    const seenAnchor = new Set();
    for (const r of crackedFam) {
      if (r.gender !== "male") continue; // anchor relationships on males
      const fatherName = recName(r);
      if (!fatherName || !declaredNames.has(fatherName)) continue;
      if (seenAnchor.has(r.uuid >>> 0)) continue;
      const spouseName = r.spouseName || nameOfUuid(r.spouseUuid);
      const childNames = (r.childUuids || []).map(nameOfUuid).filter(Boolean);
      const haveSpouse = spouseName && declaredNames.has(spouseName);
      const declaredKids = childNames.filter(n => declaredNames.has(n));
      if (!haveSpouse && declaredKids.length === 0) continue;
      const parts = [fatherName];
      if (haveSpouse) parts.push(spouseName);
      for (const k of declaredKids) parts.push(k);
      parts.push("end");
      lines.push(`relative\t${parts.join(", ")}`);
      seenAnchor.add(r.uuid >>> 0);
      relativeCount++;
    }
    // Heads from the v1 character stream (declared as `character`) whose
    // spouse/children are cracked family members but who themselves are NOT in
    // the cracked table — anchor those too, resolving links from the cracked
    // members back to this head.
    const isCrackedMale = (uuid) => {
      const m = byUuid.get((uuid || 0) >>> 0);
      return !!(m && m.gender === "male");
    };
    const headFamily = new Map(); // head name -> { spouse:string|null, kids:Set }
    const ensureHead = (nm) => {
      let e = headFamily.get(nm);
      if (!e) { e = { spouse: null, kids: new Set() }; headFamily.set(nm, e); }
      return e;
    };
    for (const r of crackedFam) {
      const nm = recName(r);
      if (!nm || !declaredNames.has(nm)) continue;
      // Child of a v1 head (head not itself a cracked male = not handled above)?
      const fatherNm = r.fatherName || nameOfUuid(r.fatherUuid);
      if (fatherNm && fatherNm !== nm && declaredNames.has(fatherNm) && !isCrackedMale(r.fatherUuid)) {
        ensureHead(fatherNm).kids.add(nm);
      }
      // Spouse of a v1 head? (a wife whose spouseUuid points at a head not in
      // the cracked table) — record her as the head's spouse.
      const spouseNm = r.spouseName || nameOfUuid(r.spouseUuid);
      if (r.gender === "female" && spouseNm && spouseNm !== nm &&
          declaredNames.has(spouseNm) && !isCrackedMale(r.spouseUuid)) {
        ensureHead(spouseNm).spouse = nm;
      }
    }
    for (const [headNm, e] of headFamily) {
      const kids = [...e.kids].filter(n => declaredNames.has(n));
      const spouse = e.spouse && declaredNames.has(e.spouse) ? e.spouse : null;
      if (!spouse && kids.length === 0) continue;
      const parts = [headNm];
      if (spouse) parts.push(spouse);
      for (const k of kids) parts.push(k);
      parts.push("end");
      lines.push(`relative\t${parts.join(", ")}`);
      relativeCount++;
    }
  } else if (useSourceFamily) {
    for (const ln of sourceStratFamily[facId].records) {
      lines.push(ln);
      recordCount++;
    }
    for (const ln of sourceStratFamily[facId].relatives) {
      lines.push(ln);
      relativeCount++;
    }
  } else {
    const seenInRecords = new Set();
    for (const r of factionRelatives) {
      const candidates = [r.motherChar, ...r.childrenChars].filter(hasName);
      for (const candChar of candidates) {
        if (namedUuids.has(candChar.primaryUuid)) continue;
        if (seenInRecords.has(candChar.primaryUuid)) continue;
        seenInRecords.add(candChar.primaryUuid);
        lines.push(emitCharacterRecord(candChar));
        recordCount++;
      }
    }
    if (recordCount > 0) lines.push("");
    for (const r of factionRelatives) {
      if (!hasName(r.fatherChar)) continue;
      const namedMother = hasName(r.motherChar) ? r.motherChar : null;
      const namedKids = r.childrenChars.filter(hasName);
      if (!namedMother && namedKids.length === 0) continue;
      const parts = [fullName(r.fatherChar)];
      if (namedMother) parts.push(fullName(namedMother));
      for (const child of namedKids) parts.push(fullName(child));
      parts.push("end");
      lines.push(`relative\t${parts.join(", ")}`);
      relativeCount++;
    }
  }
  return { text: lines.join("\n"), emittedCount, skippedCount, recordCount, relativeCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE SPLICING — bundled descr_strat as template, replace faction blocks
// ─────────────────────────────────────────────────────────────────────────────
//
// The bundled descr_strat has three structural parts:
//   1. HEADER (lines 1..N-before-first-faction): campaign decl, playable lists,
//      date, landmarks, resources — all save-independent. KEEP AS-IS.
//   2. FACTION BLOCKS (faction → faction → ... → slave): per-faction
//      settlement + character + army content. REPLACE WITH OUR GENERATED.
//   3. TAIL (faction_agression entries, regions, spawn scripts, background
//      script): save-independent. KEEP AS-IS.
//
// We split by scanning for two anchors:
//   * splitStart = index of first `faction <id>, ai_<type>` line
//   * splitEnd   = index of first line containing `faction_agression` (comment
//     OR actual entry) after splitStart
// Relaxed diplomacy matrix locator — mirrors parseDiplomacyMatrix's logic
// but drops the key in [1,64] restriction. RIS imperial saves use key 1026
// at stride 267 (verified on T1017). Returns the same shape as the shipped
// parser: `{ factionName: { war, allied, hostile, trade, rel }, _meta }`.
//
// Stance map (from DIPLO_STANCE in saveCrackerExtras.js):
//   0=allied, 200=neutral, 400=hostile, 600=war, 850=total_war, 1000=crazy
function parseDiplomacyMatrixRelaxed(buf, factionOrder) {
  if (!Array.isArray(factionOrder) || factionOrder.length < 2) return null;
  const modN = factionOrder.length;
  // 1. Find ALL candidate matrices that satisfy the {0, key, 200, attitude<=1000}
  // invariant for at least MIN_ROWS consecutive cells. We don't anchor on the
  // mod's current faction count because older saves were made when the mod had
  // FEWER factions — e.g. Bactria T964's real matrix is 53x53 even though
  // current RIS has 239 factions. Symmetry-scan sweeps N to find the right one.
  const MIN_ROWS = 40; // smallest plausible matrix size
  const candidates = [];
  for (let p = 0x4000; p < buf.length - 32; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const k = buf.readUInt32LE(p + 4);
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (buf.readUInt32LE(p + 12) > 1000) continue;
    for (let s = 80; s <= 400; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) !== 0) continue;
      if (buf.readUInt32LE(p + s + 4) !== k) continue;
      if (buf.readUInt32LE(p + s + 8) !== 200) continue;
      let good = 0;
      for (let n = 0; n < modN + 2; n++) {
        const o = p + n * s;
        if (o + 12 >= buf.length) break;
        if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === k && buf.readUInt32LE(o + 8) === 200) good++;
        else break;
      }
      if (good >= MIN_ROWS) { candidates.push({ base: p, stride: s, key: k, good }); break; }
    }
    if (candidates.length >= 24) break; // enough to score
  }
  if (candidates.length === 0) return null;

  // 2. Score each candidate by symmetry (real matrix has att(A,B) == att(B,A)
  // ~100% of the time; false positives are ~0%). SWEEP N within the candidate's
  // sentinel-row run to find the matrix size — older saves built with smaller
  // faction counts won't symmetry-match at the current mod's N.
  const symmetryScore = (base, stride, N) => {
    let best = -1, bestC = 0;
    for (let C = -3; C <= 3; C++) {
      let sym = 0, tot = 0;
      for (let A = 1; A < N; A += Math.max(1, Math.floor(N / 12))) {
        for (let B = A + 1; B < N; B += Math.max(1, Math.floor(N / 18))) {
          const o1 = base + (A * N + B + C) * stride + 12;
          const o2 = base + (B * N + A + C) * stride + 12;
          if (o1 + 4 > buf.length || o2 + 4 > buf.length) continue;
          tot++; if (buf.readUInt32LE(o1) === buf.readUInt32LE(o2)) sym++;
        }
      }
      const sc = tot ? sym / tot : 0;
      if (sc > best) { best = sc; bestC = C; }
    }
    return { score: best, C: bestC };
  };
  let bestCand = null, bestScore = -1, bestC = 0, bestN = modN;
  for (const c of candidates) {
    // Sweep N from MIN_ROWS up to min(c.good, modN). Stride controls how many
    // rows we step through — total cells span = N*N which must fit in c.good
    // rows when the stride is 1 cell per row. We cap at min(c.good, modN) since
    // a matrix bigger than the sentinel run can't exist; capping at modN avoids
    // bogus large-N matches against the current mod's count.
    const maxN = Math.min(c.good, modN);
    for (let N = MIN_ROWS; N <= maxN; N++) {
      const { score, C } = symmetryScore(c.base, c.stride, N);
      if (score > bestScore) { bestScore = score; bestCand = c; bestC = C; bestN = N; }
    }
  }
  // Reject if no candidate scores well — the matrix probably isn't in this
  // save format. Real matrices score >0.95 when N is correct; noise stays <0.6.
  if (!bestCand || bestScore < 0.85) return null;
  const base = bestCand.base, stride = bestCand.stride, key = bestCand.key, C = bestC, N = bestN;
  const attAt = (A, B, C2) => {
    const o = base + (A * N + B + C2) * stride + 12;
    if (o < 0 || o + 4 > buf.length) return null;
    return buf.readUInt32LE(o);
  };

  // 3. Build per-faction stance lists
  const out = {};
  let warPairs = 0;
  // Skip faction names that aren't real diplomatic participants (rebels, slave, etc.)
  const isDiplomatic = (name) => name && !/_rebel\d*$|^slave$|^rebels?$|^dummies$/.test(name);
  for (let A = 0; A < N; A++) {
    const aName = factionOrder[A];
    if (!isDiplomatic(aName)) continue;
    const rec = { war: [], allied: [], hostile: [], trade: [], rel: [] };
    for (let B = 0; B < N; B++) {
      if (B === A) continue;
      const bName = factionOrder[B];
      if (!isDiplomatic(bName)) continue;
      const att = attAt(A, B, C);
      if (att == null) continue;
      // Use the canonical thresholds from DIPLO_STANCE
      if (att >= 600) { rec.war.push(bName); warPairs++; }
      else if (att <= 100) rec.allied.push(bName);
      else if (att >= 300 && att <= 500) rec.hostile.push(bName);
      // Note: bond / trade isn't in the relaxed parser (we'd need to confirm
      // the relative offset for bond which is +12 in the original parser,
      // but our offset+12 holds attitude here — the field layout might differ).
    }
    out[aName.toLowerCase()] = rec;
  }
  out._meta = { base, stride, key, C, N, warPairs: warPairs / 2, locator: "relaxed" };
  return out;
}

// Emit `core_attitudes` + `faction_agression` lines for every (A, B) pair the
// SOURCE descr_strat had, using current matrix values from the save. This is
// the round-trip-friendly path: at turn 1 the matrix matches the source so the
// emit reproduces the source verbatim; at turn N the same pair list is emitted
// with whatever the current att/agg values are. Returns { lines, attN, aggN }.
function emitCoreAttitudesFromSource(stratText, pairReader, useMatrix) {
  if (!stratText) return { lines: [], attN: 0, aggN: 0 };
  // T1 (useMatrix=false): emit source values verbatim — engine normalization
  // (-10 → 0 etc.) means matrix and source differ even before any play, so
  // for byte-identical T1 round-trip we keep source.
  // T2+ (useMatrix=true): overlay matrix values per pair. Captures war
  // declarations, peace treaties, attitude shifts. Pair list stays from
  // source so the output structure still matches descr_strat.
  // Source ORDER for these sections: core_attitudes → faction_relationships
  // → faction_agression. Engine errors with "Unexpected section after
  // faction_agression: faction_relationships" if the order is wrong, so we
  // preserve source order by streaming each line in the order encountered.
  const lines = [];
  let attN = 0, aggN = 0, relN = 0;
  let attOverlaid = 0, aggOverlaid = 0;
  for (const raw of stratText.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "");
    const cm = line.match(/^core_attitudes\s+(\S+?),\s+(-?\d+)\s+(\S+)/);
    if (cm) {
      const [, other, sourceVal, self] = cm;
      if (useMatrix && pairReader) {
        const cell = pairReader(self, other);
        if (cell != null && cell.att !== parseInt(sourceVal, 10)) {
          lines.push(`core_attitudes\t${other},\t${cell.att}\t${self}`);
          attN++; attOverlaid++;
          continue;
        }
      }
      lines.push(raw);
      attN++;
      continue;
    }
    // faction_relationships: source-verbatim (the engine treats these as
    // initial-game relationship setup; matrix-overlay isn't useful here).
    if (/^faction_relationships\s+\S+,\s+-?\d+\s+\S+/.test(line)) {
      lines.push(raw);
      relN++;
      continue;
    }
    const am = line.match(/^faction_agression\s+(\S+?),\s+(-?\d+)\s+(\S+)/);
    if (am) {
      const [, other, sourceVal, self] = am;
      if (useMatrix && pairReader) {
        const cell = pairReader(self, other);
        if (cell != null && cell.agg !== parseInt(sourceVal, 10)) {
          lines.push(`faction_agression\t${other},\t${cell.agg}\t${self}`);
          aggN++; aggOverlaid++;
          continue;
        }
      }
      lines.push(raw);
      aggN++;
    }
  }
  return { lines, attN, aggN, relN, attOverlaid, aggOverlaid };
}

// Emit `diplomatic_stance` lines from the diplomacy matrix.
// descr_strat allows: `diplomatic_stance <factA> <factB> <stance>`
// stance values: allied, suspicious, neutral, hostile, war.
// We only emit non-neutral relationships so the file stays compact.
function emitDiplomacyBlock(diploMatrix, emittedFactions) {
  if (!diploMatrix) return "";
  const lines = [];
  lines.push("; --- diplomatic_stance pairs extracted from the save ---");
  // Track emitted pairs as a canonical-order set so we don't emit both
  // A→B and B→A (the engine treats them symmetrically).
  const seenPair = new Set();
  const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  // Drop pairs referencing factions we didn't emit (engine ignores them,
  // but file-validator flags them as unknown). Pass emittedFactions=null
  // to disable the filter.
  const knownFac = emittedFactions instanceof Set ? emittedFactions : null;
  let warN = 0, alliedN = 0, hostileN = 0, droppedN = 0;
  const emitPair = (facA, facB, stance, counter) => {
    if (knownFac && (!knownFac.has(facA) || !knownFac.has(facB))) { droppedN++; return; }
    const k = pairKey(facA, facB);
    if (seenPair.has(k)) return; seenPair.add(k);
    lines.push(`diplomatic_stance ${facA} ${facB} ${stance}`);
    counter();
  };
  for (const [facA, rec] of Object.entries(diploMatrix)) {
    if (facA === "_meta") continue;
    for (const facB of rec.war || [])     emitPair(facA, facB, "war",     () => warN++);
    for (const facB of rec.allied || [])  emitPair(facA, facB, "allied",  () => alliedN++);
    for (const facB of rec.hostile || []) emitPair(facA, facB, "hostile", () => hostileN++);
  }
  lines.push(`; total: ${warN} wars, ${alliedN} alliances, ${hostileN} hostile relationships` +
    (droppedN > 0 ? ` (${droppedN} pairs dropped — faction not in emitted set)` : ""));
  return { text: lines.join("\n"), warN, alliedN, hostileN, droppedN };
}

function spliceBundledTemplate(bundledLines, newFactionBlocksText, headerComment, saveDate, zeroSettlementFactions) {
  let splitStart = -1, splitEnd = -1;
  for (let i = 0; i < bundledLines.length; i++) {
    const ln = bundledLines[i];
    if (splitStart < 0) {
      if (/^faction\s+\w+,\s*ai_/.test(ln)) splitStart = i;
    } else {
      if (/faction_agression/i.test(ln)) { splitEnd = i; break; }
    }
  }
  if (splitStart < 0) throw new Error("template has no faction blocks");
  if (splitEnd < 0) splitEnd = bundledLines.length;
  let headLines = bundledLines.slice(0, splitStart);
  // Substitute start_date with the save's actual turn/year/season so
  // year-triggered events fire at their historical year rather than
  // re-firing from -270.
  if (saveDate) {
    headLines = headLines.map(ln =>
      /^\s*start_date\s+/.test(ln)
        ? `start_date\t${saveDate.year} ${saveDate.season}`
        : ln
    );
  }
  // Prune zero-settlement factions out of the `playable` block — by
  // mid-game, factions may have been conquered (e.g. RIS T1017 has
  // romans_julii at 0 settlements). Listing a dead faction as playable
  // would put a dead entry in campaign-select and confuse the engine.
  // We DON'T touch `unlockable` / `nonplayable` — they're status not
  // selectability. We also exempt slave/dummies/rebels (they're playable
  // by convention but use 0 settlements meaningfully).
  if (zeroSettlementFactions instanceof Set && zeroSettlementFactions.size > 0) {
    const exempt = new Set(["slave", "dummies"]);
    const isRebelLike = (s) => /^(rebels?|.*_rebels?\d*)$/.test(s);
    const movedToNonplayable = [];
    let inPlayable = false, inNonplayable = false;
    // First pass: REMOVE dead faction lines from playable block (engine
    // refuses to load comments mid-playable). Collect names to add to
    // nonplayable block in second pass.
    const filtered = [];
    for (const ln of headLines) {
      if (/^\s*playable\s*$/.test(ln)) { inPlayable = true; filtered.push(ln); continue; }
      if (inPlayable && /^\s*end\s*$/.test(ln)) { inPlayable = false; filtered.push(ln); continue; }
      if (inPlayable) {
        const m = ln.match(/^(\s*)([a-z][a-z0-9_]*)\s*$/);
        if (m) {
          const fac = m[2];
          if (!exempt.has(fac) && !isRebelLike(fac) && zeroSettlementFactions.has(fac)) {
            movedToNonplayable.push(fac);
            continue; // SKIP — removed from playable
          }
        }
      }
      filtered.push(ln);
    }
    headLines = filtered;
    // Second pass: insert dead-faction names into nonplayable block (just
    // before its `end` line). Engine sees them as latent/non-selectable.
    if (movedToNonplayable.length) {
      const inserted = [];
      let inNp = false;
      for (const ln of headLines) {
        if (/^\s*nonplayable\s*$/.test(ln)) { inNp = true; inserted.push(ln); continue; }
        if (inNp && /^\s*end\s*$/.test(ln)) {
          for (const fac of movedToNonplayable) inserted.push(`\t${fac}`);
          inNp = false;
          inserted.push(ln);
          continue;
        }
        inserted.push(ln);
      }
      headLines = inserted;
      console.log(`[playable→nonplayable] moved ${movedToNonplayable.length} dead faction(s): ${movedToNonplayable.slice(0, 10).join(", ")}${movedToNonplayable.length > 10 ? ", …" : ""}`);
    }
  }
  const head = headLines.join("\n");
  // Strip core_attitudes + faction_agression from the bundled tail —
  // emitCoreAttitudesFromSource now writes them fresh from the current
  // save matrix, so leaving the bundled copies in produces duplicates.
  const tailLines = bundledLines.slice(splitEnd).filter(
    ln => !/^\s*(core_attitudes|faction_agression|faction_relationships)\b/.test(ln)
  );
  const tail = tailLines.join("\n");
  const banner = headerComment ? headerComment + "\n\n" : "";
  return banner + head + "\n" + newFactionBlocksText + "\n\n" + tail;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error("usage: node scripts/save-to-descr-strat.js <save-path> [output-path] [--deploy <dir>] [--mod-dir <dir>]");
    console.error("       --mod-dir  use <dir>/data as the reference mod (defaults to bundled-mod/data).");
    console.error("                  Use this when deploying to a specific installed mod whose");
    console.error("                  regions/EDU/EDB differ from the bundled fallback.");
    console.error("       --deploy   immediately copy the generated file into <target-campaign-dir>");
    process.exit(2);
  }
  const savePath = argv[0];
  let deployTarget = null;
  let deployRequested = false;
  let userModDir = null;
  const positional = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--deploy") {
      deployRequested = true;
      // Optional inline target: consume next arg ONLY if it looks like a path
      // (not another --flag). With no inline target, fall through to
      // auto-pick at deploy time.
      if (i + 1 < argv.length && !argv[i+1].startsWith("--")) {
        deployTarget = argv[++i];
      }
      continue;
    }
    if (argv[i] === "--mod-dir") { userModDir = argv[++i]; continue; }
    positional.push(argv[i]);
  }
  const outPath = positional[0] || path.join(PROJECT_ROOT, "derived", path.basename(savePath, ".sav") + ".descr_strat.txt");
  // Mod data dir cascade:
  //   1. --mod-dir <path>  (explicit user override)
  //   2. Auto-detect from save's modInfo by walking Mods/My Mods for a
  //      directory whose name fuzzy-matches the modDisplayName
  //   3. Fall back to bundled-mod/data
  let modDataDir = path.join(PROJECT_ROOT, "bundled-mod", "data");
  let modDetectionNote = "(default: bundled-mod)";
  if (userModDir) {
    const dataPath = path.join(userModDir, "data");
    modDataDir = fs.existsSync(dataPath) ? dataPath : userModDir;
    modDetectionNote = "(via --mod-dir)";
  } else {
    // Auto-detect from save's modInfo
    try {
      const probe = fs.readFileSync(savePath);
      const mi = parseModInfo(probe);
      if (mi && mi.modDisplayName) {
        const detected = findInstalledModByName(mi.modDisplayName);
        if (detected) {
          modDataDir = path.join(detected, "data");
          modDetectionNote = `(auto-detected from save: "${mi.modDisplayName}" → ${detected})`;
        }
      }
    } catch {}
  }
  if (!fs.existsSync(modDataDir)) {
    console.error("mod data dir not found:", modDataDir);
    process.exit(1);
  }
  console.log(`mod ${modDetectionNote}`);

  if (!fs.existsSync(savePath)) { console.error("save not found:", savePath); process.exit(1); }

  const t0 = Date.now();
  console.log("save:", savePath);
  console.log("output:", outPath);
  console.log();

  // ── Load mod data ──
  console.log(`using mod data dir: ${modDataDir}`);
  const ownership = buildInitialOwnership(modDataDir);
  if (ownership.error) { console.error("ownership parser failed:", ownership.error); process.exit(1); }
  const stratPath = ownership.stratPath;
  const { decls: factionDecls, descrOrder } = loadFactionDeclarations(stratPath);
  const engineOrder = deriveEngineFactionOrder(descrOrder);
  const chainLevels = loadChainLevels(modDataDir);
  // descr_sm_factions DECLARATION order — the order the engine indexes the
  // treasury records AND the diplomacy matrix by (cracked 2026-05-29). The old
  // `engineOrder` (a rebel-shuffle of descr_strat order) mis-attributes both.
  // Object.keys preserves declaration order from loadFactionNamelists.
  const { settlementToRegion, regionToSettlement } = loadSettlementToRegion(modDataDir);
  const settlementCoords = loadSettlementCoords(modDataDir);
  const nameLookup = loadNameLookup(modDataDir);
  const namelists = loadNamelists(modDataDir);
  const factionNamelists = loadFactionNamelists(modDataDir);
  // FULL descr_sm_factions declaration order (ALL factions, in order) — the
  // engine's real index order for treasury records AND the diplomacy matrix.
  // NB: loadFactionNamelists only captures the ~143 factions that have a
  // namelist mapping, so we re-read the faction headers here with a permissive
  // one-tab regex to get all 239 in declaration order. Falls back to engineOrder.
  const smOrder = (() => {
    try {
      const ord = [];
      for (const ln of fs.readFileSync(path.join(modDataDir, "descr_sm_factions.txt"), "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
        const m = ln.match(/^\t"([a-z_0-9]+)"\s*:/);
        if (m) ord.push(m[1]);
      }
      return ord.length > 2 ? ord : engineOrder;
    } catch { return engineOrder; }
  })();
  // Gender oracle: lowercased firstName → "female" or "male" based on which
  // namelist (`_women` vs `_men`) the name appears in. Used to enrich
  // characters whose gender byte is 0 ("unknown") — about 95% of records
  // come through with gender=0 from the parser. Names that appear in BOTH
  // lists or NEITHER stay unresolved.
  const genderByName = (() => {
    const w = new Set(), m = new Set();
    for (const [listName, names] of Object.entries(namelists)) {
      const lower = listName.toLowerCase();
      const isW = lower.endsWith("_women");
      const isM = lower.endsWith("_men");
      if (!isW && !isM) continue;
      for (const n of names) {
        const k = n.toLowerCase();
        (isW ? w : m).add(k);
      }
    }
    const out = {};
    for (const n of w) if (!m.has(n)) out[n] = "female";
    for (const n of m) if (!w.has(n)) out[n] = "male";
    return out;
  })();
  console.log(`[${Date.now() - t0}ms] gender oracle: ${Object.values(genderByName).filter(g => g === "female").length} female names, ${Object.values(genderByName).filter(g => g === "male").length} male names`);
  const traitNames = loadTraitNames(modDataDir);
  const ancNames = loadAncillaryNames(modDataDir);
  const eduUnits = loadEduUnitNames(modDataDir);
  console.log(`[${Date.now() - t0}ms] mod data loaded: ` +
    `${Object.keys(ownership.ownerByCity).length} settlements, ` +
    `${Object.keys(factionDecls).length} factions, ` +
    `${Object.keys(chainLevels).length} chains, ` +
    `${nameLookup.length} name tokens, ` +
    `${Object.keys(namelists).length} namelists, ` +
    `${Object.keys(factionNamelists).length} factions w/ namelist mapping, ` +
    `${traitNames.length} traits, ` +
    `${ancNames.length} ancillaries, ` +
    `${Object.keys(settlementCoords).length} settlement coords, ` +
    `EDU=${eduUnits ? eduUnits.size + " units" : "(missing → no unit substitution)"}`);

  // ── Parse the save ──
  const buf = fs.readFileSync(savePath);
  console.log(`[${Date.now() - t0}ms] save loaded — ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // Pass a real validChainNames Set built from EDB. Without it parseSettlements
  // grabs ANY chain-name-looking string in the settlement bytes — including
  // scripted-event markers stored there (eruption_at_etna_*, earthquake_*,
  // flood_in_*, etc.) which are NOT real buildings. EDB whitelist drops them.
  const validChainNames = new Set(Object.keys(chainLevels));
  const chainMaxLevels = {};
  for (const [name, levels] of Object.entries(chainLevels)) chainMaxLevels[name] = levels.length - 1;
  const parsed = parseSettlements(buf, validChainNames, chainMaxLevels);
  console.log(`[${Date.now() - t0}ms] settlements parsed — ${parsed.settlements.length} settlements`);

  const owners = resolveCurrentOwners(buf, ownership.ownerByCity);
  if (owners.error) { console.error("ownership resolution failed:", owners.error); process.exit(1); }
  console.log(`[${Date.now() - t0}ms] owners resolved — ${Object.keys(owners.ownerByCity).length} settlements, ${owners.unknownCount} unknown`);

  // Characters — extract ALL (including dead + non-attributed) so we can
  // build family-tree continuity. We'll filter to faction-attributed +
  // living at emission time.
  let allCharacters = [];
  if (nameLookup.length > 0 && traitNames.length > 0) {
    allCharacters = extractCharacters(buf, nameLookup, traitNames);
    // Backfill gender via namelist oracle for "unknown" chars. The parser
    // returns ~95% as "unknown" (gender byte =0 instead of 1 or 2) — but
    // the first name almost always belongs to a culture-specific _men or
    // _women namelist, so we can recover gender deterministically.
    let enriched = 0;
    for (const c of allCharacters) {
      if (c.gender === "unknown" && c.firstName) {
        const g = genderByName[c.firstName.toLowerCase()];
        if (g) { c.gender = g; c.genderInferred = true; enriched++; }
      }
    }
    const livingAttributed = allCharacters.filter(c => !c.isDead && c.faction).length;
    const males = allCharacters.filter(c => c.gender === "male").length;
    const females = allCharacters.filter(c => c.gender === "female").length;
    console.log(`[${Date.now() - t0}ms] characters extracted — ${allCharacters.length} total, ${livingAttributed} living+faction-attributed, ${males}M/${females}F (${enriched} gender inferred from namelist)`);
  } else {
    console.warn(`[${Date.now() - t0}ms] WARNING: missing nameLookup or traitNames — character extraction skipped`);
  }
  const characters = allCharacters.filter(c => !c.isDead && c.faction);
  const family = buildFamilyTree(allCharacters);
  console.log(`[${Date.now() - t0}ms] family tree — ${family.relatives.length} parent-anchor relationships, ${family.uuidToChar.size} indexed by uuid`);

  // CRACKED CURRENT family roster — wives, daughters, young sons, and dead
  // relatives that the trait-anchored v1 parser misses (they have no trait
  // list to anchor on). Parsed from the fixed-stride family table
  // (src/familyRecordParser.js, cracked 2026-05-30). Each record carries
  // name/age/gender/alive + father/spouse/child UUID links, attributed to a
  // faction via the UUID link graph against the v1 generals. This reflects the
  // CURRENT state (members born/died since T1) — used for turn>1 round-trip so
  // T2+ emits the live roster instead of the stale source family. Heads (adult
  // male generals) live in v1/allCharacters, NOT here; they appear here only as
  // link targets, so we resolve link names against BOTH sets.
  let crackedFamilyByFaction = {};
  let crackedFamilyByUuid = new Map();
  if (nameLookup.length) {
    try {
      const crackedFamily = parseFamilyRecords(buf, nameLookup);
      const extraUuidNames = new Map();
      for (const c of allCharacters) {
        if (c.primaryUuid != null) extraUuidNames.set(c.primaryUuid >>> 0, fullName(c));
      }
      indexFamily(crackedFamily, extraUuidNames);
      attributeFamilyFactions(crackedFamily, allCharacters);
      for (const r of crackedFamily) {
        crackedFamilyByUuid.set(r.uuid >>> 0, r);
        if (r.faction) (crackedFamilyByFaction[r.faction] ||= []).push(r);
      }
      const attributed = crackedFamily.filter(r => r.faction).length;
      console.log(`[${Date.now() - t0}ms] cracked family — ${crackedFamily.length} records, ${attributed} faction-attributed across ${Object.keys(crackedFamilyByFaction).length} factions`);
    } catch (e) {
      console.warn(`[${Date.now() - t0}ms] WARNING: cracked family parse failed (${e.message}) — turn>1 will fall back to source family`);
      crackedFamilyByFaction = {};
      crackedFamilyByUuid = new Map();
    }
  }

  // Turn number (needed BEFORE the emit loop to gate the cracked-family emit;
  // the canonical saveDate is re-read later for the banner/splice). For turn>1
  // we emit the cracked CURRENT family; turn 1 uses the verbatim shortcut.
  const _templateStartEarly = fs.existsSync(stratPath)
    ? parseTemplateStartDate(fs.readFileSync(stratPath, "utf8").split(/\r?\n/))
    : null;
  const _saveDateEarly = readSaveDate(buf, _templateStartEarly);
  const turnNumber = _saveDateEarly ? _saveDateEarly.turn : 1;

  // Armies (units grouped by commander UUID)
  const charArmies = groupUnitsByCommander(buf);
  console.log(`[${Date.now() - t0}ms] units grouped — ${charArmies.size} commanders with armies`);

  // V2 characters (parseCharacterExtras): catches captains, princesses,
  // diplomats, spies, assassins, admirals, agents — including the female
  // characters that v1 findCharacterRecords misses. Gives us spouseUuid +
  // age so we can fill in family-tree gaps. Each record has: ownUuid,
  // bodyguardUuid, region, spouseUuid, age, role, culture.
  const v2Chars = parseCharacterExtras(buf);
  console.log(`[${Date.now() - t0}ms] v2 characters parsed — ${v2Chars.length} (incl. females + non-general roles)`);

  // Per-faction treasuries (cracked: parseFactionTreasuries). Each record's
  // factionId is the descr_sm_factions index — map back to a faction name
  // via the engine order. The CURRENT (mid-turn) treasury is at +0;
  // turnStartTreasury is at +48 (= the start-of-turn snapshot).
  const treasuriesRaw = parseFactionTreasuries(buf);
  const currentTreasuryByFaction = {};
  for (const t of treasuriesRaw) {
    if (typeof t.factionId !== "number") continue;
    const name = smOrder[t.factionId];
    if (!name) continue;
    // If multiple records exist for the same faction (rare), keep the largest
    // — the smaller is usually a junk match.
    if (currentTreasuryByFaction[name] == null || t.treasury > currentTreasuryByFaction[name]) {
      currentTreasuryByFaction[name] = t.treasury;
    }
  }
  // PLAYER treasury override. The major playable factions (incl. the player)
  // don't get a clean factionId byte in their economic record, so the loop
  // above misses them. But the FIRST sub=6 record by offset is ALWAYS the
  // player (saveCracker crack), and its treasury is reliable. Identify the
  // player and set its denari from that record.
  const sub6 = treasuriesRaw.filter(t => t.knowledgeSize !== undefined).sort((a, b) => a.offset - b.offset);
  let playerFaction = null;
  try { playerFaction = identifyPlayerFactionFromSave(buf, treasuriesRaw); } catch {}
  if (!playerFaction && sub6.length) {
    // knowledgeSize signature for the 6 majors (stable across saves).
    const KNOWN_KNOWLEDGE = { 414: "romans_julii", 173: "carthage", 161: "antigonid", 207: "ptolemaic", 250: "seleucid", 83: "bactria" };
    playerFaction = KNOWN_KNOWLEDGE[sub6[0].knowledgeSize] || null;
    // denari match against source as a last resort (works at T1).
    if (!playerFaction) {
      for (const [fac, d] of Object.entries(factionDecls)) {
        if (d && d.denari === sub6[0].treasury) { playerFaction = fac; break; }
      }
    }
  }
  if (playerFaction && sub6.length) {
    currentTreasuryByFaction[playerFaction] = sub6[0].treasury;
    console.log(`[player-treasury] ${playerFaction} = ${sub6[0].treasury} (first sub=6 record, knowledge=${sub6[0].knowledgeSize})`);
  }
  console.log(`[${Date.now() - t0}ms] treasuries — ${treasuriesRaw.length} records, ${Object.keys(currentTreasuryByFaction).length} mapped to factions`);

  // Diplomacy matrix: per-faction { war, allied, hostile, trade, rel }.
  // The shipped parseDiplomacyMatrix uses a locator that requires key in
  // [1,64], which fails on RIS imperial (its key is 1026). Try the shipped
  // one first; if it returns null, fall back to a relaxed locator that
  // matches the same {0, key, 200, attitude} invariant without the key
  // range check.
  let diploMatrix = parseDiplomacyMatrix(buf, smOrder);
  if (!diploMatrix) {
    diploMatrix = parseDiplomacyMatrixRelaxed(buf, smOrder);
    if (diploMatrix) {
      console.log(`[${Date.now() - t0}ms]   (used relaxed locator for diplomacy matrix)`);
    }
  }
  const diploStats = diploMatrix ? Object.keys(diploMatrix).filter(k => k !== "_meta").length : 0;
  console.log(`[${Date.now() - t0}ms] diplomacy matrix — ${diploStats} factions with relations, ${diploMatrix?._meta?.warPairs || 0} war pairs`);

  // Per-settlement religion (parseReligionByCity). Returns { cityName: religionId }.
  const settlementMarkers = parsed.settlements.map(s => ({ offset: s.offset, name: s.name }));
  const religionByCity = parseReligionByCity(buf, settlementMarkers);
  console.log(`[${Date.now() - t0}ms] religions — ${Object.keys(religionByCity).length} settlements with religion data`);

  // Real settlement population from save (vs the level-based defaults
  // we were using). Cracked: u32 at settlement.offset - 1494.
  const populationByCity = extractPopulationByCity(buf, parsed.settlements);
  console.log(`[${Date.now() - t0}ms] populations — ${Object.keys(populationByCity).length} settlements with real pop data`);

  // ── Identify KILLED factions for emergent-faction setup ──
  // Any faction in the bundled descr_strat that has zero settlements
  // AND zero characters in the save is "killed". We still emit a minimal
  // faction block for them (denari 0, no settlements, no chars) so they
  // stay registered. Their original-creator settlements remain via the
  // faction_creator field on settlements they used to own → engine can
  // re-spawn them as rebels from those regions.
  // (NOTE: this happens implicitly via the orderedFactions loop below
  // — every bundled-mod faction gets a block even if cs/ss are empty.)

  // ── Group everything by faction ──
  // Map any transient `<faction>_rebel` faction id (= temporary rebellion
  // spawn) back to `slave` so we don't emit blocks for factions the bundled
  // descr_strat doesn't declare. Unowned settlements (UUID didn't resolve to
  // any descr_strat-anchored faction) also land in `slave`.
  const normalizeFaction = (f) => /_rebel$/.test(f) ? "slave" : f;
  // Skip settlements whose name doesn't map to a region in the active
  // mod's descr_regions. Common when the save was made with an older mod
  // version that had settlements since removed/renamed (Sabrata, Kition,
  // etc. exist in older RIS but not in RIS beta). Emitting them with
  // `region Unknown` would cause "region not found" engine errors.
  const byFactionSettlements = {};
  let droppedNoRegion = 0;
  for (const s of parsed.settlements) {
    const region = settlementToRegion[s.name];
    if (!region) { droppedNoRegion++; continue; }
    const owner = normalizeFaction(owners.ownerByCity[s.name] || "slave");
    if (!byFactionSettlements[owner]) byFactionSettlements[owner] = [];
    byFactionSettlements[owner].push({ ...s, region });
  }
  if (droppedNoRegion > 0) {
    console.log(`[${Date.now() - t0}ms] dropped ${droppedNoRegion} settlements whose name doesn't exist in the active mod's descr_regions (save made with different mod version)`);
  }

  // ── Fill in missing regions with placeholder settlements ──
  // RTW requires EVERY region in descr_regions to have a corresponding
  // settlement in descr_strat. The save might not have settlements for
  // every region (new regions added in the mod since the save was made,
  // or regions our parser missed). For those regions, emit a minimal
  // slave-owned placeholder settlement at level 'village' so the engine
  // is satisfied. Without this the engine errors on "missing settlement
  // for region X".
  const generatedRegionSet = new Set();
  for (const ss of Object.values(byFactionSettlements)) {
    for (const s of ss) generatedRegionSet.add(s.region);
  }
  let placeholders = 0;
  for (const [region, settlementName] of Object.entries(regionToSettlement)) {
    if (generatedRegionSet.has(region)) continue;
    if (!byFactionSettlements.slave) byFactionSettlements.slave = [];
    byFactionSettlements.slave.push({
      name: settlementName,
      region,
      offset: -1,
      buildings: [],
      queued: [],
      __placeholder: true,
    });
    placeholders++;
  }
  if (placeholders > 0) {
    console.log(`[${Date.now() - t0}ms] added ${placeholders} placeholder slave-owned settlements for mod regions not covered by save`);
  }
  const byFactionChars = {};
  for (const c of characters) {
    const fac = normalizeFaction(c.faction);
    if (!byFactionChars[fac]) byFactionChars[fac] = [];
    byFactionChars[fac].push(c);
  }
  const allFactionIds = new Set([
    ...Object.keys(byFactionSettlements),
    ...Object.keys(byFactionChars),
  ]);
  console.log(`[${Date.now() - t0}ms] factions present in save: ${allFactionIds.size} ` +
    `(unresolved settlements and *_rebel factions mapped to slave)`);

  // Build faction → preferred bodyguard unit map. For each real character
  // with an army, the FIRST unit is typically their bodyguard. We tally
  // by faction so synthesized leaders for orphan factions can borrow a
  // bodyguard name that's actually valid in the mod's EDU. Also derive a
  // file-wide fallback for factions that have no parsed characters at all.
  // Filter to EDU-valid names only — otherwise an obsolete unit name like
  // "oscan general" (no longer in the mod's EDU) becomes the "preferred"
  // bodyguard and substitution maps unknown back to unknown.
  const bodyguardCounts = {};
  const globalBodyguardCounts = {};
  for (const c of characters) {
    const army = charArmies.get(c.secondaryUuid);
    if (!army || army.length === 0) continue;
    const bg = army[0].name;
    if (!bg) continue;
    if (eduUnits && !eduUnits.has(bg)) continue; // skip unknowns
    if (!bodyguardCounts[c.faction]) bodyguardCounts[c.faction] = {};
    bodyguardCounts[c.faction][bg] = (bodyguardCounts[c.faction][bg] || 0) + 1;
    globalBodyguardCounts[bg] = (globalBodyguardCounts[bg] || 0) + 1;
  }
  const factionBodyguardByFaction = {};
  for (const [fac, counts] of Object.entries(bodyguardCounts)) {
    factionBodyguardByFaction[fac] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  const fallbackBodyguardUnit = Object.entries(globalBodyguardCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "general's bodyguard cavalry";

  // ── Emit per-faction blocks ──
  // Preserve the bundled file's faction ORDER so the engine reads them in
  // the same sequence (some campaign scripts assume a specific order).
  // INCLUDE EVERY bundled-declared faction even if it has no settlements
  // or characters in this save — those "killed" factions need a minimal
  // block to stay registered as emergent (= eligible to re-spawn when
  // a settlement using them as faction_creator rebels).
  const bundledOrder = Object.keys(factionDecls);
  // Load source descr_strat's per-region building lists so emitSettlement
  // can fall back to source for chains the save doesn't reify per-settlement
  // (governmentA-D etc — the engine implicitly assigns by faction culture).
  // For round-trip at turn 1 this restores the building counts to source parity.
  const sourceStratBuildings = loadSourceStratBuildings(stratPath);
  const sourceStratFamily = loadSourceStratFamily(stratPath);
  const sourceStratCharacters = loadSourceStratCharacters(stratPath);

  const orderedFactions = [...bundledOrder]; // every bundled faction, in order
  // Plus any save-only factions (extremely rare — usually means our
  // ownership parser mapped a settlement to a faction not in descr_strat).
  for (const fac of allFactionIds) {
    if (!factionDecls[fac]) orderedFactions.push(fac);
  }

  const blocks = [];
  const substitutionLog = [];
  // Global name uniqueness — descr_strat requires every character to have
  // a unique full name across the whole file. Single-name cultures
  // (Greek/Barbarian) frequently collide; we try A/B/C/... suffixes
  // backed by descr_names_lookup tokens.
  const usedNames = new Set();
  const nameLookupSet = new Set(nameLookup);
  // Trait whitelist — drop traits not in the user's EDCT. Saves often
  // reference renamed/removed traits (e.g. RIS renamed "Fitness" to
  // "Fitness_Normal", "Fitness_Overweight", etc); without this filter
  // the engine silently drops them anyway but the descr_strat looks
  // dirty in the validator.
  const edctTraitSet = new Set(traitNames);
  // Detect zero-settlement (dead) factions early so the per-faction emit
  // loop below can flag them as dead_until_resurrected + re_emergent. Same
  // Set is reused later by spliceBundledTemplate to remove them from the
  // playable list + add them to nonplayable.
  const zeroSettlementFactions = new Set(
    orderedFactions.filter(f => (byFactionSettlements[f] || []).length === 0)
  );
  let stats = { factions: 0, settlements: 0, characters: 0, units: 0, skipped: 0, familyRecords: 0, relativeLines: 0, warPairs: 0, alliedPairs: 0, hostilePairs: 0, dedupedNames: 0, droppedDupes: 0 };
  for (const facId of orderedFactions) {
    const decl = factionDecls[facId];
    if (!decl) { console.warn(`  WARNING: no declaration for ${facId} — skipping`); continue; }
    const ss = byFactionSettlements[facId] || [];
    // If this faction got wiped out during the captured run (0 settlements),
    // mark them as dead_until_resurrected + re_emergent so the engine treats
    // them as latent (re-emergeable via rebellions / scripted spawn). Don't
    // touch slave / dummies / rebel-like factions (their 0 is meaningful).
    if (zeroSettlementFactions.has(facId) &&
        facId !== "slave" && facId !== "dummies" && !/_rebels?\d*$/.test(facId)) {
      decl.deadUntilResurrected = true;
      decl.reEmergent = true;
    }
    const cs = byFactionChars[facId] || [];
    // Promote first character to leader if no leader exists. RTW REFUSES to
    // load a descr_strat where a playable faction has no leader; for non-
    // playable factions it usually invents one. Better to just promote.
    if (cs.length > 0 && !cs.some(c => c.isLeader)) {
      // Eligible = anything not confirmed female. Most chars come through as
      // "unknown" gender (parser pins it on ~5% of records); excluding them
      // would mean the oldest-male sort runs against a tiny pool and we'd
      // promote a child instead of an adult.
      const eligible = cs.filter(c => c.gender !== "female").sort((a, b) => (b.age || 0) - (a.age || 0));
      const cand = eligible[0] || cs[0];
      if (cand) cand.isLeader = true;
    }
    // Synthesize a placeholder leader for any faction with settlements but
    // no extracted characters. Without a leader the engine refuses to
    // load the faction. The placeholder takes the first settlement's
    // coords + a generic name token that's known to exist in the lookup.
    // Picks a name in a way that AVOIDS collisions: starts at the seed
    // index, walks forward through nameLookup until it finds an unused
    // token. Without this every faction whose name hashes to the same
    // mod-length bucket would synthesize the SAME character name and
    // the subsequent dedup pass would drop all but one of them.
    if (cs.length === 0 && ss.length > 0 && nameLookup.length > 0) {
      const seed = facId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      let firstName = "Captain";
      // Prefer the faction's own male namelist (e.g. roman_men, antigonid_men)
      // so an Antigonid synth leader doesn't end up named "Vercingetorix".
      // Fall back to the global lookup if the faction has no namelist
      // mapping or its namelist is exhausted.
      const cultureList = factionNamelists[facId]?.men;
      const cultureNames = cultureList && namelists[cultureList] ? namelists[cultureList] : null;
      const pickFrom = (arr) => {
        for (let off = 0; off < arr.length; off++) {
          const cand = arr[(seed + off) % arr.length];
          if (cand && !usedNames.has(cand)) return cand;
        }
        return null;
      };
      const cultPick = cultureNames ? pickFrom(cultureNames) : null;
      firstName = cultPick || pickFrom(nameLookup) || "Captain";
      const fallback = settlementCoords[ss[0].name] || { x: 250, y: 350 };
      const synthUuid = 0xc0000000 | (seed & 0x0fffffff);
      cs.push({
        firstName,
        lastName: null,
        gender: "male",
        age: 40,
        isLeader: true,
        isHeir: false,
        isDead: false,
        faction: facId,
        traits: [
          { name: "Factionleader", level: 1 },
          { name: "TurnsAlive", level: 1 },
        ],
        ancillaries: [],
        tileX: fallback.x,
        tileY: fallback.y,
        secondaryUuid: synthUuid,
        primaryUuid: null,
        synthesized: true,
      });
      // Pick the most-used bodyguard unit for this faction (from its real
      // characters that we DID parse, if any). Falls back to faction-
      // pool-wide most-common ("legatus legionis" on RIS) so the unit
      // exists in EDU and doesn't trip the engine's unit-type check.
      const bodyguardUnit = factionBodyguardByFaction[facId] || fallbackBodyguardUnit;
      charArmies.set(synthUuid, [{
        name: bodyguardUnit,
        xp: 0,
        armourUpgrade: 0,
        weaponUpgrade: 0,
      }]);
    }
    // Dedupe character names BEFORE emission — drop chars we can't
    // disambiguate. Leader has priority for the un-suffixed name. Runs
    // AFTER synthesis so synth leaders are deduped too.
    cs.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
    const dedupedKeep = [];
    const facMenList = factionNamelists[facId]?.men;
    const facCultureNames = facMenList && namelists[facMenList] ? namelists[facMenList] : null;
    for (const c of cs) {
      const resolved = resolveUniqueFirstName(c, usedNames, nameLookupSet, nameLookup, facCultureNames);
      if (resolved === null) { stats.droppedDupes++; continue; }
      if (c.renamedByDedup) stats.dedupedNames++;
      dedupedKeep.push(c);
    }
    cs.length = 0;
    for (const c of dedupedKeep) cs.push(c);
    const tr = currentTreasuryByFaction[facId];
    const block = emitFactionBlock(facId, decl, ss, cs, charArmies, chainLevels, family, ancNames, tr, settlementCoords, eduUnits, factionBodyguardByFaction, fallbackBodyguardUnit, substitutionLog, ownership.creatorByCity, edctTraitSet, populationByCity, traitNames.maxLevels || {}, sourceStratBuildings, sourceStratFamily, sourceStratCharacters, turnNumber, crackedFamilyByFaction, crackedFamilyByUuid);
    // Per-faction summary header REMOVED per user request — clutters diffs
    // against source descr_strat, and previously used non-ASCII characters
    // (─ em-dash) that the RTW parser is sensitive to.
    blocks.push(block.text);
    blocks.push("");
    stats.factions++;
    stats.settlements += ss.length;
    stats.characters += block.emittedCount;
    stats.skipped += block.skippedCount;
    stats.familyRecords += block.recordCount;
    stats.relativeLines += block.relativeCount;
    for (const c of cs) {
      const army = charArmies.get(c.secondaryUuid);
      if (army) stats.units += army.length;
    }
  }

  // The legacy `diplomatic_stance` emit was REMOVED — that block format
  // doesn't appear in standard descr_strat, only `core_attitudes` +
  // `faction_agression` do. The proper diplomacy emission happens just
  // below via emitCoreAttitudesFromSource (matrix-overlay).
  const emittedFactions = new Set(orderedFactions);

  // ── core_attitudes + faction_agression — emit per source pair structure
  // using current matrix values from the save. The splice would otherwise
  // strip the bundled descr_strat's per-pair lines (they fall between
  // splitStart and splitEnd), so we re-emit them here. At turn 1 these
  // exactly match the source descr_strat; later turns reflect actual state.
  const { makeDiplomacyPairReader: makePairReader } = require("../src/saveCrackerExtras.js");
  // Use descr_sm_factions order (smOrder) — the engine's real matrix index
  // order — so the live att/agg overlay reads the correct cell per pair.
  // (The old rebel-shuffled engineOrder mis-aligned it, so nothing overlaid.)
  const pairReader = makePairReader(buf, smOrder);
  if (pairReader) {
    const bundledStratText = fs.readFileSync(stratPath, "utf8");
    // Use matrix overlay for T2+ (captures war declarations, peace, attitude
    // shifts). For T1 the dedicated shortcut emits source verbatim and skips
    // this whole pipeline, so passing useMatrix=true here only affects T2+.
    const attBlock = emitCoreAttitudesFromSource(bundledStratText, pairReader, true);
    if (attBlock.lines.length) {
      blocks.push("");
      blocks.push(`; --- core_attitudes + faction_agression (overlay: ${attBlock.attOverlaid || 0} attitudes + ${attBlock.aggOverlaid || 0} aggressions changed from source) ---`);
      blocks.push(...attBlock.lines);
      stats.coreAttitudesEmitted = attBlock.attN;
      stats.factionAgressionEmitted = attBlock.aggN;
      stats.coreAttitudesOverlaid = attBlock.attOverlaid || 0;
      stats.factionAgressionOverlaid = attBlock.aggOverlaid || 0;
    }
  }

  // ── Splice into bundled template ──
  const bundledText = fs.readFileSync(stratPath, "utf8");
  const bundledLines = bundledText.split(/\r?\n/);
  const templateStart = parseTemplateStartDate(bundledLines);
  const saveDate = readSaveDate(buf, templateStart);
  if (saveDate) {
    console.log(`[${Date.now() - t0}ms] save date — turn ${saveDate.turn}, ${Math.abs(saveDate.year)} ${saveDate.year < 0 ? "BC" : "AD"} ${saveDate.season} (template base: ${templateStart ? `${templateStart.year} ${templateStart.season}` : "unknown"})`);
  } else {
    console.warn(`[${Date.now() - t0}ms] WARNING: could not read turn/year from save — start_date will stay as template default`);
  }
  const flooredDenari = substitutionLog.filter(s => s.kind === "denari_floored");
  const banner = [
    ";",
    "; Auto-generated descr_strat.txt from a save file.",
    "; Source save: " + path.basename(savePath),
    "; Generated:   " + new Date().toISOString(),
    ";",
    "; This is the 'Continue Campaign as New Campaign' artefact: the engine's",
    "; entity registry restarts at 0 when this file is loaded as a fresh",
    "; campaign, sidestepping the 65,536-slot cap that would otherwise crash",
    "; the source save's late-game state.",
    ";",
    "; Per-faction blocks (settlements + characters + armies + family records)",
    "; were generated from the save. The HEADER (campaign declaration, playable",
    "; lists, date, landmarks, resources) and TAIL (faction_aggression, regions,",
    "; spawn scripts, background script reference) are copied verbatim from the",
    "; bundled descr_strat template.",
    ";",
    "; Stats:",
    `;   ${stats.factions} factions emitted`,
    `;   ${stats.settlements} settlements (with buildings + inferred levels)`,
    `;   ${stats.characters} living characters (${stats.skipped} skipped: no position)`,
    `;   ${stats.units} units across army blocks`,
    `;   ${stats.familyRecords} family-tree character_record lines`,
    `;   ${stats.relativeLines} relative-link lines`,
    ";",
    "; Known gaps that COULD NOT be extracted from this save:",
    ";   - Female characters' full data: parseCharacterExtras found " + v2Chars.length,
    ";     v2 records but they don't carry first names — so they can only inform",
    ";     the family tree count, not produce named character_record lines.",
    ";     (gender IS inferred for males/females via namelist oracle for the v1",
    ";     parser's output — see ~388 female chars correctly identified.)",
    ";   - In-progress building queues <50% (auto-completed when ≥50%).",
    ";   - Campaign script state (Lua counters reset; intro events may re-fire).",
    ";   - Sub-faction relationships (engine handles via culture defaults).",
    ";",
    "; Things WE DID extract from the save:",
    `;   - Start date: ${saveDate ? `${Math.abs(saveDate.year)} ${saveDate.year < 0 ? "BC" : "AD"} ${saveDate.season} (turn ${saveDate.turn} of source campaign)` : "FAILED — start_date stayed as template default"}`,
    `;   - Real current treasury for ${Object.keys(currentTreasuryByFaction).length} factions (vs bundled-starting denari)`,
    `;     ${flooredDenari.length > 0 ? `${flooredDenari.length} faction(s) had negative balance — floored to 0 to avoid T1 bankruptcy events` : "all positive — no flooring needed"}`,
    `;   - Diplomatic relations: ${stats.warPairs || 0} wars, ${stats.alliedPairs || 0} alliances (N-sweep matrix locator handles older saves too)`,
    `;   - Gender on living characters: inferred via namelist oracle (names in _women → female, _men → male)`,
    `;   - Real population per settlement from save (vs descr_strat level-based default)`,
    `;   - Playable list pruned to omit dead/conquered factions (0 settlements at save time)`,
    `;   - Religion data for ${Object.keys(religionByCity).length} settlements (not emitted yet — needs further mapping to descr_strat syntax)`,
    `;   - ${v2Chars.length} v2 character records (non-general roles: females, diplomats, spies, etc.)`,
    ";",
  ].join("\n");
  // zeroSettlementFactions was computed earlier (before the emit loop). It's
  // already used inside emitFactionBlock callers to mark dead factions as
  // re_emergent; passed below to spliceBundledTemplate for playable→nonplayable
  // relocation. (Const re-declaration removed to avoid TDZ.)
  // ── T1 round-trip shortcut ──
  // When the save is at turn 1 with no actions taken, the source descr_strat
  // IS the truth (engine hasn't mutated state yet beyond startup normalization
  // which doesn't change the source file). Skip the entire reconstruct-from-save
  // pipeline and emit source verbatim. Guarantees byte-identical round-trip.
  // For turn > 1, fall through to the regular splice path that overlays state.
  let finalText;
  let finalIsBinary = false;
  if (saveDate && saveDate.turn === 1) {
    console.log(`[${Date.now() - t0}ms] T1 round-trip shortcut: emitting source descr_strat byte-for-byte verbatim (no actions to overlay)`);
    // Read source as a Buffer — preserves the source's line endings (CRLF
    // on Windows, LF on macOS). Writing utf-8 strings would normalize to
    // LF and break byte-identical round-trip even though every line matches.
    finalText = fs.readFileSync(stratPath);
    finalIsBinary = true;
  } else {
    // Pass empty banner — the verbose multi-line banner used unicode chars
    // (≥, →, —) the RTW parser rejects, refusing to load the campaign with
    // "Expected faction list starting with playable". Source descr_strat
    // starts directly with `campaign imperial_campaign`, so do the same.
    finalText = spliceBundledTemplate(bundledLines, blocks.join("\n"), "", saveDate, zeroSettlementFactions);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (finalIsBinary) {
    fs.writeFileSync(outPath, finalText);
  } else {
    // RTW Remastered's parser is STRICT about CRLF line endings — LF-only
    // files cause "Expected faction list starting with playable" and the
    // engine refuses to load the campaign. Normalize to CRLF on write.
    const crlf = finalText.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    fs.writeFileSync(outPath, crlf, "utf8");
  }
  console.log();
  console.log(`[${Date.now() - t0}ms] wrote ${outPath}`);
  console.log(`output size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
  console.log();
  console.log("Stats:");
  console.log(`  factions emitted:    ${stats.factions}`);
  console.log(`  settlements:         ${stats.settlements}`);
  console.log(`  living characters:   ${stats.characters} emitted (+${stats.skipped} skipped no-pos)`);
  console.log(`  units in armies:     ${stats.units}`);
  console.log(`  family records:      ${stats.familyRecords} character_record lines`);
  console.log(`  family relationships: ${stats.relativeLines} relative lines`);
  console.log(`  diplomatic stances:  ${stats.warPairs} wars, ${stats.alliedPairs} alliances, ${stats.hostilePairs} hostile`);
  console.log(`  treasuries matched:  ${Object.keys(currentTreasuryByFaction).length} factions`);
  if (flooredDenari.length > 0) {
    const sorted = [...flooredDenari].sort((a, b) => a.original - b.original);
    const top = sorted.slice(0, 3).map(s => `${s.from}=${s.original}`).join(", ");
    console.log(`    floored to 0:      ${flooredDenari.length} factions (deepest: ${top})`);
  }
  console.log(`  start_date:          ${saveDate ? `${saveDate.year} ${saveDate.season} (turn ${saveDate.turn})` : "TEMPLATE DEFAULT (save date unreadable)"}`);
  if (stats.dedupedNames > 0 || stats.droppedDupes > 0) {
    console.log(`  name collisions:     ${stats.dedupedNames} chars kept with substitute first names, ${stats.droppedDupes} dropped (no free name in lookup)`);
  }
  console.log(`  religions parsed:    ${Object.keys(religionByCity).length} settlements`);
  console.log(`  v2 chars (females+): ${v2Chars.length} (not yet emitted as separate descr_strat blocks)`);
  const eduSubs = substitutionLog.filter(s => s.kind === "bodyguard" || s.kind === "dropped");
  if (eduSubs.length > 0) {
    const bgSubs = eduSubs.filter(s => s.kind === "bodyguard").length;
    const dropped = eduSubs.filter(s => s.kind === "dropped").length;
    console.log(`  EDU substitutions:   ${bgSubs} bodyguard rewrites, ${dropped} unknown units dropped`);
    const bySource = {};
    for (const s of eduSubs) bySource[s.from] = (bySource[s.from] || 0) + 1;
    const top = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`    top missing units: ${top.map(([n, c]) => `"${n}"×${c}`).join(", ")}`);
  }

  // Validate the emitted file using the shipped validator. Same-process spawn
  // keeps the entire pipeline self-contained — if there are STRUCTURAL errors
  // (loader would refuse the file) we abort BEFORE deploy, preserving the
  // user's working mod descr_strat. Warnings don't block.
  const { spawnSync } = require("child_process");
  const validatorPath = path.join(SCRIPT_DIR, "validate-descr-strat.js");
  let validationFailed = false;
  if (fs.existsSync(validatorPath)) {
    console.log();
    console.log(`[validate] running scripts/validate-descr-strat.js…`);
    const res = spawnSync(process.execPath, [validatorPath, outPath, modDataDir], { encoding: "utf8" });
    const lines = (res.stdout || "").split(/\r?\n/);
    const issuesLine = lines.find(l => /^Issues:\s+\d+ errors/.test(l));
    if (issuesLine) console.log(`[validate] ${issuesLine.trim()}`);
    const errSamples = lines.filter(l => /^\s*ERR L\d+:/.test(l));
    if (errSamples.length > 0) {
      console.log(`[validate] sample errors:`);
      for (const s of errSamples) console.log(`  ${s.trim()}`);
    }
    if (res.status !== 0) {
      validationFailed = true;
      console.error(`[validate] ❌ validation reported errors — deploy will be SKIPPED to preserve the live mod`);
    } else {
      console.log(`[validate] ✓ no structural errors`);
    }
  }

  // --deploy: copy into the target campaign dir with backup
  if (deployRequested && validationFailed) {
    console.error(`\n❌ --deploy skipped: validator reported errors. Inspect ${outPath} and re-run when clean.`);
  } else if (deployRequested) {
    // Auto-pick target if none specified — same logic as deploy script
    if (!deployTarget) {
      const modsRoots = [
        "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods",
        "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/Local Mods",
      ];
      let best = null;
      function walkPick(dir, depth) {
        if (depth > 12) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const sub = path.join(dir, e.name);
          if (e.name === "imperial_campaign" && fs.existsSync(path.join(sub, "descr_strat.txt"))) {
            const mtime = fs.statSync(sub).mtimeMs;
            if (!best || mtime > best.mtime) best = { path: sub, mtime };
          }
          walkPick(sub, depth + 1);
        }
      }
      for (const r of modsRoots) walkPick(r, 0);
      if (best) {
        deployTarget = best.path;
        console.log(`\n(auto-picked deploy target: ${deployTarget})`);
      } else {
        console.error("\n❌ --deploy with no target specified, and no installed mod's imperial_campaign found. Pass explicit target.");
        process.exit(1);
      }
    }
    const target = path.join(deployTarget, "descr_strat.txt");
    const backup = path.join(deployTarget, "descr_strat.txt.backup");
    if (!fs.existsSync(deployTarget)) {
      console.error("\n❌ deploy target does not exist:", deployTarget);
      process.exit(1);
    }
    if (fs.existsSync(target) && !fs.existsSync(backup)) {
      fs.copyFileSync(target, backup);
      console.log("\n✓ backup created:", backup);
    } else if (fs.existsSync(backup)) {
      console.log("\n(backup preserved at " + backup + ")");
    }
    fs.copyFileSync(outPath, target);
    console.log(`✓ deployed to ${target}`);
    console.log("\nNext: start a NEW imperial_campaign in RTW. Rollback if needed:");
    console.log(`  node scripts/deploy-descr-strat.js --rollback "${deployTarget}"`);
  }
}

main().catch((e) => { console.error("FATAL:", e.stack || e); process.exit(1); });
