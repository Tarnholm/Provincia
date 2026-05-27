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
  parseModInfo,
} = require("../src/saveCrackerExtras.js");
const { parseDescrRegions: parseDR2, buildRegionCoords } = require("../src/descrStratGeneral.js");

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
      decls[curFac] = { aiType: fm[2] || "default", denari: 1000, superfaction: null };
      descrOrder.push(curFac);
      continue;
    }
    if (!curFac) continue;
    const dm = line.match(/^denari\s+(-?\d+)/);
    if (dm) { decls[curFac].denari = parseInt(dm[1], 10); continue; }
    const sm = line.match(/^superfaction\s+(\w+)/);
    if (sm) { decls[curFac].superfaction = sm[1]; continue; }
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
  for (const c of allCharacters) {
    // Anchor relationships to the MALE (father) — the bundled file's
    // convention. Skip females here; they're listed as the spouse in their
    // husband's relative line.
    if (c.gender !== "male") continue;
    if (!c.spouseUuid && (!c.childUuids || c.childUuids.length === 0)) continue;
    const motherChar = c.spouseUuid ? uuidToChar.get(c.spouseUuid) : null;
    const childrenChars = (c.childUuids || [])
      .map(u => uuidToChar.get(u))
      .filter(Boolean);
    if (!motherChar && childrenChars.length === 0) continue;
    relatives.push({ fatherChar: c, motherChar, childrenChars });
  }
  return { uuidToChar, relatives };
}

function fullName(c) {
  if (!c) return null;
  return c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
}

function emitCharacterRecord(c) {
  const gender = c.gender || "male";
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

function emitSettlement(s, factionId, chainLevels, originalCreator, populationByCity) {
  const lines = [];
  const level = inferSettlementLevel(s.buildings);
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
  let emittedCoreBuilding = false;
  for (const b of s.buildings) {
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
    lines.push(`\tbuilding`);
    lines.push(`\t{`);
    lines.push(`\t\ttype ${b.name} ${levelName}`);
    lines.push(`\t}`);
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
function resolveUniqueFirstName(c, usedNames, nameLookupSet) {
  const orig = c.firstName;
  if (!orig) return null;
  const lastBit = c.lastName ? ` ${c.lastName}` : "";
  const key0 = orig + lastBit;
  if (!usedNames.has(key0)) { usedNames.add(key0); return orig; }
  // Try letter suffixes A..Z (some mods use only A-J).
  for (let code = 65; code <= 90; code++) {
    const cand = orig + String.fromCharCode(code);
    if (nameLookupSet && !nameLookupSet.has(cand)) continue;
    const candKey = cand + lastBit;
    if (usedNames.has(candKey)) continue;
    usedNames.add(candKey);
    c.firstName = cand;
    return cand;
  }
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

function emitFactionBlock(facId, decl, settlements, characters, charArmies, chainLevels, family, ancNames, currentTreasury, settlementCoords, eduUnits, factionBodyguardByFaction, fallbackBodyguardUnit, substitutionLog, creatorByCity, edctTraitNames, populationByCity, traitMaxLevels) {
  const factionBodyguard = factionBodyguardByFaction[facId] || fallbackBodyguardUnit;
  const lines = [];
  // Strip any trailing comma that leaked through from the source mod's
  // descr_strat (RIS alternate_campaign has `faction\trj, ai_rome,` —
  // trailing comma is harmless in that file but tokenizes as an empty
  // field here, looking like a parse error to humans reading the diff).
  const aiType = decl.aiType.replace(/,+$/, "");
  lines.push(`faction\t${facId}, ${aiType}`);
  if (decl.superfaction) lines.push(`superfaction ${decl.superfaction}`);
  // Prefer the save's actual current treasury; fall back to bundled-starting
  // denari when extraction missed this faction (small/rebel factions whose
  // economic record wasn't matched).
  const denari = (currentTreasury != null) ? currentTreasury : decl.denari;
  lines.push(`denari\t${denari}`);
  for (const s of settlements) {
    const origCreator = creatorByCity ? creatorByCity[s.name] : null;
    lines.push(emitSettlement(s, facId, chainLevels, origCreator, populationByCity));
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

  let emittedCount = 0, skippedCount = 0;
  for (const c of characters) {
    const army = charArmies.get(c.secondaryUuid);
    const text = emitCharacter(c, army, fallbackPos, ancNames, eduUnits, factionBodyguard, substitutionLog, edctTraitNames, traitMaxLevels);
    if (text === null) { skippedCount++; continue; }
    lines.push(text);
    lines.push("");
    emittedCount++;
  }
  if (skippedCount > 0) {
    lines.push(`; ${skippedCount} character(s) skipped (no position and no fallback)`);
  }

  // Only count family members with a real firstName — wives/children
  // parsed from save sometimes lack names (different record format), and
  // a `relative` line with empty parts is malformed. Drop unnamed kin.
  const hasName = (c) => !!(c && c.firstName);
  // Family-member character_record entries: every character referenced as
  // a spouse or child of one of our named characters who is NOT themselves
  // already emitted as a `character,` entry.
  let recordCount = 0;
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

  // Relative lines tie the named character to spouse + children by NAME.
  // Skip lines where neither spouse nor any child has a name (would emit
  // `relative\tDad, end` which is a no-op + clutters validator output).
  let relativeCount = 0;
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
  const N = factionOrder.length;
  // 1. Find ALL candidate matrices that satisfy the {0, key, 200, attitude<=1000}
  // invariant for at least N+2 consecutive cells. Larger saves can have several
  // distinct "matrix-shaped" regions — picking the first one (as before) gives
  // a false positive on Bactria T964 where the real matrix is the 4th hit.
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
      for (let n = 0; n < N + 2; n++) {
        const o = p + n * s;
        if (o + 12 >= buf.length) break;
        if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === k && buf.readUInt32LE(o + 8) === 200) good++;
        else break;
      }
      if (good >= N) { candidates.push({ base: p, stride: s, key: k }); break; }
    }
    if (candidates.length >= 12) break; // enough to score
  }
  if (candidates.length === 0) return null;

  // 2. Score each candidate by symmetry (real matrix has att(A,B) == att(B,A)
  // ~100% of the time; false positives are essentially 0% symmetric). Score
  // each over a 7x7 sample so this is cheap.
  const symmetryScore = (base, stride) => {
    let best = -1, bestC = 0;
    const attAt = (A, B, C) => {
      const o = base + (A * N + B + C) * stride + 12;
      if (o < 0 || o + 4 > buf.length) return null;
      return buf.readUInt32LE(o);
    };
    for (let C = -3; C <= 3; C++) {
      let sym = 0, tot = 0;
      for (let A = 1; A < N; A += 7) for (let B = A + 1; B < N; B += 5) {
        const v1 = attAt(A, B, C), v2 = attAt(B, A, C);
        if (v1 == null || v2 == null) continue;
        tot++; if (v1 === v2) sym++;
      }
      const sc = tot ? sym / tot : 0;
      if (sc > best) { best = sc; bestC = C; }
    }
    return { score: best, C: bestC };
  };
  let bestCand = null, bestScore = -1, bestC = 0;
  for (const c of candidates) {
    const { score, C: cC } = symmetryScore(c.base, c.stride);
    if (score > bestScore) { bestScore = score; bestCand = c; bestC = cC; }
  }
  // Reject if no candidate scores well — the matrix probably isn't in this
  // save format. Real matrices score >0.9 (T1017 hit 93% across candidates);
  // false-positive runs from arbitrary structured data score ~0.2-0.5.
  // Threshold 0.8 catches the real matrix while rejecting the noise.
  if (!bestCand || bestScore < 0.8) return null;
  const base = bestCand.base, stride = bestCand.stride, key = bestCand.key, C = bestC;
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

function spliceBundledTemplate(bundledLines, newFactionBlocksText, headerComment) {
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
  const head = bundledLines.slice(0, splitStart).join("\n");
  const tail = bundledLines.slice(splitEnd).join("\n");
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
  const { settlementToRegion, regionToSettlement } = loadSettlementToRegion(modDataDir);
  const settlementCoords = loadSettlementCoords(modDataDir);
  const nameLookup = loadNameLookup(modDataDir);
  const traitNames = loadTraitNames(modDataDir);
  const ancNames = loadAncillaryNames(modDataDir);
  const eduUnits = loadEduUnitNames(modDataDir);
  console.log(`[${Date.now() - t0}ms] mod data loaded: ` +
    `${Object.keys(ownership.ownerByCity).length} settlements, ` +
    `${Object.keys(factionDecls).length} factions, ` +
    `${Object.keys(chainLevels).length} chains, ` +
    `${nameLookup.length} name tokens, ` +
    `${traitNames.length} traits, ` +
    `${ancNames.length} ancillaries, ` +
    `${Object.keys(settlementCoords).length} settlement coords, ` +
    `EDU=${eduUnits ? eduUnits.size + " units" : "(missing → no unit substitution)"}`);

  // ── Parse the save ──
  const buf = fs.readFileSync(savePath);
  console.log(`[${Date.now() - t0}ms] save loaded — ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const parsed = parseSettlements(buf, null, null);
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
    const livingAttributed = allCharacters.filter(c => !c.isDead && c.faction).length;
    console.log(`[${Date.now() - t0}ms] characters extracted — ${allCharacters.length} total, ${livingAttributed} living+faction-attributed`);
  } else {
    console.warn(`[${Date.now() - t0}ms] WARNING: missing nameLookup or traitNames — character extraction skipped`);
  }
  const characters = allCharacters.filter(c => !c.isDead && c.faction);
  const family = buildFamilyTree(allCharacters);
  console.log(`[${Date.now() - t0}ms] family tree — ${family.relatives.length} parent-anchor relationships, ${family.uuidToChar.size} indexed by uuid`);

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
    const name = engineOrder[t.factionId];
    if (!name) continue;
    // If multiple records exist for the same faction (rare), keep the largest
    // — the smaller is usually a junk match.
    if (currentTreasuryByFaction[name] == null || t.treasury > currentTreasuryByFaction[name]) {
      currentTreasuryByFaction[name] = t.treasury;
    }
  }
  console.log(`[${Date.now() - t0}ms] treasuries — ${treasuriesRaw.length} records, ${Object.keys(currentTreasuryByFaction).length} mapped to factions`);

  // Diplomacy matrix: per-faction { war, allied, hostile, trade, rel }.
  // The shipped parseDiplomacyMatrix uses a locator that requires key in
  // [1,64], which fails on RIS imperial (its key is 1026). Try the shipped
  // one first; if it returns null, fall back to a relaxed locator that
  // matches the same {0, key, 200, attitude} invariant without the key
  // range check.
  let diploMatrix = parseDiplomacyMatrix(buf, engineOrder);
  if (!diploMatrix) {
    diploMatrix = parseDiplomacyMatrixRelaxed(buf, engineOrder);
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
  let stats = { factions: 0, settlements: 0, characters: 0, units: 0, skipped: 0, familyRecords: 0, relativeLines: 0, warPairs: 0, alliedPairs: 0, hostilePairs: 0, dedupedNames: 0, droppedDupes: 0 };
  for (const facId of orderedFactions) {
    const decl = factionDecls[facId];
    if (!decl) { console.warn(`  WARNING: no declaration for ${facId} — skipping`); continue; }
    const ss = byFactionSettlements[facId] || [];
    const cs = byFactionChars[facId] || [];
    // Promote first character to leader if no leader exists. RTW REFUSES to
    // load a descr_strat where a playable faction has no leader; for non-
    // playable factions it usually invents one. Better to just promote.
    if (cs.length > 0 && !cs.some(c => c.isLeader)) {
      const males = cs.filter(c => c.gender === "male").sort((a, b) => (b.age || 0) - (a.age || 0));
      const cand = males[0] || cs[0];
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
      for (let off = 0; off < nameLookup.length; off++) {
        const cand = nameLookup[(seed + off) % nameLookup.length];
        if (cand && !usedNames.has(cand)) { firstName = cand; break; }
      }
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
    for (const c of cs) {
      const resolved = resolveUniqueFirstName(c, usedNames, nameLookupSet);
      if (resolved === null) { stats.droppedDupes++; continue; }
      dedupedKeep.push(c);
    }
    cs.length = 0;
    for (const c of dedupedKeep) cs.push(c);
    const tr = currentTreasuryByFaction[facId];
    const block = emitFactionBlock(facId, decl, ss, cs, charArmies, chainLevels, family, ancNames, tr, settlementCoords, eduUnits, factionBodyguardByFaction, fallbackBodyguardUnit, substitutionLog, ownership.creatorByCity, edctTraitSet, populationByCity, traitNames.maxLevels || {});
    // Per-faction summary header: human-readable digest at the top of
    // each faction block so a glance at the file tells you what's in it.
    const trTag = tr != null ? `treasury=${tr.toLocaleString()}` : "treasury=(bundled-default)";
    const leader = cs.find(c => c.isLeader);
    const leaderTag = leader ? `leader=${leader.firstName}${leader.lastName ? ' ' + leader.lastName : ''}${leader.synthesized ? ' [SYNTH]' : ''}` : "leader=(none)";
    const totalPop = ss.reduce((a, s) => a + ((populationByCity && populationByCity[s.name]) || 0), 0);
    const popTag = totalPop > 0 ? `population=${totalPop.toLocaleString()}` : "population=(unknown)";
    blocks.push(`;;; ${facId} ─ ${ss.length} settlements / ${block.emittedCount} chars / ${block.relativeCount} family-links`);
    blocks.push(`;;;   ${trTag}, ${leaderTag}, ${popTag}`);
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

  // ── Diplomacy block — goes before per-faction blocks ──
  const emittedFactions = new Set(orderedFactions);
  const diploBlock = emitDiplomacyBlock(diploMatrix, emittedFactions);
  if (diploBlock && diploBlock.text) {
    blocks.unshift(diploBlock.text, "");
    stats.warPairs = diploBlock.warN;
    stats.alliedPairs = diploBlock.alliedN;
    stats.hostilePairs = diploBlock.hostileN;
  }

  // ── Splice into bundled template ──
  const bundledText = fs.readFileSync(stratPath, "utf8");
  const bundledLines = bundledText.split(/\r?\n/);
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
    `;   - Diplomatic relations: parseDiplomacyMatrix couldn't locate the matrix`,
    `;     in this save (matrix locator works on some saves but not all RIS`,
    `;     formats). Engine will pick defaults from descr_strat faction_agression.`,
    ";   - Female characters' full data: parseCharacterExtras found " + v2Chars.length,
    ";     v2 records but they don't carry names — so they can only inform the",
    ";     family tree count, not produce character_record lines.",
    ";   - In-progress building queues (only completed buildings carry over).",
    ";   - Campaign script state (Lua counters reset; intro events may re-fire).",
    ";",
    "; Things WE DID extract from the save:",
    `;   - Real current treasury for ${Object.keys(currentTreasuryByFaction).length} factions (vs bundled-starting denari)`,
    `;   - Religion data for ${Object.keys(religionByCity).length} settlements (not emitted yet — needs further mapping to descr_strat syntax)`,
    `;   - ${v2Chars.length} v2 character records (non-general roles: females, diplomats, spies, etc.)`,
    ";",
  ].join("\n");
  const finalText = spliceBundledTemplate(bundledLines, blocks.join("\n"), banner);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, finalText, "utf8");
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
  console.log(`  religions parsed:    ${Object.keys(religionByCity).length} settlements`);
  console.log(`  v2 chars (females+): ${v2Chars.length} (not yet emitted as separate descr_strat blocks)`);
  if (substitutionLog.length > 0) {
    const bgSubs = substitutionLog.filter(s => s.kind === "bodyguard").length;
    const dropped = substitutionLog.filter(s => s.kind === "dropped").length;
    console.log(`  EDU substitutions:   ${bgSubs} bodyguard rewrites, ${dropped} unknown units dropped`);
    const bySource = {};
    for (const s of substitutionLog) bySource[s.from] = (bySource[s.from] || 0) + 1;
    const top = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`    top missing units: ${top.map(([n, c]) => `"${n}"×${c}`).join(", ")}`);
  }

  // --deploy: copy into the target campaign dir with backup
  if (deployRequested) {
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
