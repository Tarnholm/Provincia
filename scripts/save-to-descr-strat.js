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

function loadFactionDeclarations(stratPath) {
  const text = fs.readFileSync(stratPath, "utf8");
  const lines = text.split(/\r?\n/);
  const out = {};
  let curFac = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const fm = line.match(/^faction\s+([A-Za-z0-9_]+)\s*(?:,\s*(.+))?$/);
    if (fm) {
      curFac = fm[1];
      out[curFac] = { aiType: fm[2] || "default", denari: 1000, superfaction: null };
      continue;
    }
    if (!curFac) continue;
    const dm = line.match(/^denari\s+(-?\d+)/);
    if (dm) { out[curFac].denari = parseInt(dm[1], 10); continue; }
    const sm = line.match(/^superfaction\s+(\w+)/);
    if (sm) { out[curFac].superfaction = sm[1]; continue; }
    if (line === "settlement") { curFac = null; }
  }
  return out;
}

function loadSettlementToRegion(modDataDir) {
  const regionsPath = findDescrRegions(modDataDir, "imperial_campaign");
  if (!regionsPath) return {};
  const regionToSettlement = parseDescrRegions(regionsPath);
  const out = {};
  for (const [region, settlement] of Object.entries(regionToSettlement)) {
    out[settlement] = region;
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

// export_descr_character_traits.txt — extract just the trait NAMES (order
// matters: the save stores trait_id = index into this list).
function loadTraitNames(modDataDir) {
  const candidates = [
    path.join(modDataDir, "export_descr_character_traits.txt"),
    path.join(modDataDir, "data", "export_descr_character_traits.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const names = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^Trait\s+(\S+)/);
      if (m) names.push(m[1]);
    }
    if (names.length > 0) return names;
  }
  return [];
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
  return `character_record\t${fullName(c)}, \t${gender}, age ${c.age || 1}, ${status}${flag}`;
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

function emitSettlement(s, factionId, chainLevels) {
  const lines = [];
  const level = inferSettlementLevel(s.buildings);
  lines.push("settlement");
  lines.push("{");
  lines.push(`\tlevel ${level}`);
  lines.push(`\tregion ${s.region || "Unknown"}`);
  lines.push(`\tyear_founded 0`);
  lines.push(`\tpopulation ${POPULATION_BY_LEVEL[level]}`);
  lines.push(`\tplan_set default_set`);
  lines.push(`\tfaction_creator ${factionId}`);
  for (const b of s.buildings) {
    const levelNames = chainLevels[b.name];
    let levelName;
    if (levelNames && typeof b.level === "number" && b.level >= 0 && b.level < levelNames.length) {
      levelName = levelNames[b.level];
    } else {
      levelName = `level_${b.level ?? "?"}`;
    }
    lines.push(`\tbuilding`);
    lines.push(`\t{`);
    lines.push(`\t\ttype ${b.name} ${levelName}`);
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
function emitCharacter(c, armyUnits, fallbackPos) {
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

  lines.push(`character,\t${fullName}, named character${role}, age ${c.age || 30}, , x ${x}, y ${y}`);

  // Traits line — skip when empty.
  // Cap trait level at 9: RTW traits have a max level of 9 in the engine.
  // The save sometimes carries higher values (these are accumulating
  // COUNTER-traits used internally; emitting them verbatim would let the
  // engine re-fire their threshold effects on every turn).
  if (c.traits && c.traits.length > 0) {
    const traitParts = c.traits
      .filter(t => t.name && t.level >= 1)
      .map(t => `${t.name} ${Math.min(t.level, 9)}`);
    if (traitParts.length > 0) {
      lines.push(`traits ${traitParts.join(", ")}`);
    }
  }

  // Ancillaries: the save stores ancillary IDs (u32), not names. To emit
  // descr_strat-valid names we need export_descr_ancillaries.txt parsing
  // — TODO. For now omit the line entirely; characters keep their main
  // traits, which is the more important fidelity.

  // Army block — every commander WITH a bodyguard unit gets one. The
  // bodyguard is the first `unit` line; other units in the stack follow.
  if (armyUnits && armyUnits.length > 0) {
    lines.push("army");
    for (const u of armyUnits) {
      const exp = u.xp ?? 0;
      const armour = u.armourUpgrade ?? 0;
      const weapon = u.weaponUpgrade ?? 0;
      lines.push(`unit\t\t${u.name}\t\texp ${exp} armour ${armour} weapon_lvl ${weapon}`);
    }
  }
  return lines.join("\n");
}

function emitFactionBlock(facId, decl, settlements, characters, charArmies, chainLevels, family) {
  const lines = [];
  lines.push(`faction\t${facId}, ${decl.aiType}`);
  if (decl.superfaction) lines.push(`superfaction ${decl.superfaction}`);
  lines.push(`denari\t${decl.denari}`);
  for (const s of settlements) {
    lines.push(emitSettlement(s, facId, chainLevels));
  }
  // Fallback position for characters whose own tileX/tileY is unset
  // (governors stuck in settlements, etc). Use the leader's position, or
  // any other commander's position.
  let fallbackPos = null;
  for (const c of characters) {
    if (c.isLeader && c.tileX && c.tileY) { fallbackPos = { x: c.tileX, y: c.tileY }; break; }
  }
  if (!fallbackPos) {
    for (const c of characters) {
      if (c.tileX && c.tileY) { fallbackPos = { x: c.tileX, y: c.tileY }; break; }
    }
  }
  // The set of UUIDs that ARE named characters in this faction — we'll skip
  // them in the character_record pass (they get full `character,` entries).
  const namedUuids = new Set(characters.map(c => c.primaryUuid).filter(Boolean));

  // Per-faction relatives: only relationships where at least the father is
  // attributed to this faction. Wives/children inherit the faction implicitly.
  const factionRelatives = family.relatives.filter(r => r.fatherChar.faction === facId);

  let emittedCount = 0, skippedCount = 0;
  for (const c of characters) {
    const army = charArmies.get(c.secondaryUuid);
    const text = emitCharacter(c, army, fallbackPos);
    if (text === null) { skippedCount++; continue; }
    lines.push(text);
    lines.push("");
    emittedCount++;
  }
  if (skippedCount > 0) {
    lines.push(`; ${skippedCount} character(s) skipped (no position and no fallback)`);
  }

  // Family-member character_record entries: every character referenced as
  // a spouse or child of one of our named characters who is NOT themselves
  // already emitted as a `character,` entry.
  let recordCount = 0;
  const seenInRecords = new Set();
  for (const r of factionRelatives) {
    const candidates = [r.motherChar, ...r.childrenChars].filter(Boolean);
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
  let relativeCount = 0;
  for (const r of factionRelatives) {
    const fatherName = fullName(r.fatherChar);
    const parts = [fatherName];
    if (r.motherChar) parts.push(fullName(r.motherChar));
    for (const child of r.childrenChars) parts.push(fullName(child));
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
function spliceBundledTemplate(bundledLines, newFactionBlocksText) {
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
  return head + "\n" + newFactionBlocksText + "\n\n" + tail;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error("usage: node scripts/save-to-descr-strat.js <save-path> [output-path]");
    process.exit(2);
  }
  const savePath = argv[0];
  const outPath = argv[1] || path.join(PROJECT_ROOT, "derived", path.basename(savePath, ".sav") + ".descr_strat.txt");

  if (!fs.existsSync(savePath)) { console.error("save not found:", savePath); process.exit(1); }

  const t0 = Date.now();
  console.log("save:", savePath);
  console.log("output:", outPath);
  console.log();

  // ── Load mod data ──
  const ownership = buildInitialOwnership(BUNDLED_MOD);
  if (ownership.error) { console.error("ownership parser failed:", ownership.error); process.exit(1); }
  const stratPath = ownership.stratPath;
  const factionDecls = loadFactionDeclarations(stratPath);
  const chainLevels = loadChainLevels(BUNDLED_MOD);
  const settlementToRegion = loadSettlementToRegion(BUNDLED_MOD);
  const nameLookup = loadNameLookup(BUNDLED_MOD);
  const traitNames = loadTraitNames(BUNDLED_MOD);
  console.log(`[${Date.now() - t0}ms] mod data loaded: ` +
    `${Object.keys(ownership.ownerByCity).length} settlements, ` +
    `${Object.keys(factionDecls).length} factions, ` +
    `${Object.keys(chainLevels).length} chains, ` +
    `${nameLookup.length} name tokens, ` +
    `${traitNames.length} traits`);

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

  // ── Group everything by faction ──
  // Map any transient `<faction>_rebel` faction id (= temporary rebellion
  // spawn) back to `slave` so we don't emit blocks for factions the bundled
  // descr_strat doesn't declare. Unowned settlements (UUID didn't resolve to
  // any descr_strat-anchored faction) also land in `slave`.
  const normalizeFaction = (f) => /_rebel$/.test(f) ? "slave" : f;
  const byFactionSettlements = {};
  for (const s of parsed.settlements) {
    const owner = normalizeFaction(owners.ownerByCity[s.name] || "slave");
    if (!byFactionSettlements[owner]) byFactionSettlements[owner] = [];
    byFactionSettlements[owner].push({ ...s, region: settlementToRegion[s.name] });
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

  // ── Emit per-faction blocks ──
  // Preserve the bundled file's faction ORDER so the engine reads them in
  // the same sequence (some campaign scripts assume a specific order).
  const bundledOrder = Object.keys(factionDecls);
  const seen = new Set();
  const orderedFactions = [];
  for (const fac of bundledOrder) {
    if (allFactionIds.has(fac)) { orderedFactions.push(fac); seen.add(fac); }
  }
  for (const fac of allFactionIds) {
    if (!seen.has(fac)) orderedFactions.push(fac);
  }

  const blocks = [];
  let stats = { factions: 0, settlements: 0, characters: 0, units: 0, skipped: 0, familyRecords: 0, relativeLines: 0 };
  for (const facId of orderedFactions) {
    const decl = factionDecls[facId];
    if (!decl) { console.warn(`  WARNING: no declaration for ${facId} — skipping`); continue; }
    const ss = byFactionSettlements[facId] || [];
    const cs = byFactionChars[facId] || [];
    // Promote first character to leader if no leader exists. RTW REFUSES to
    // load a descr_strat where a playable faction has no leader; for non-
    // playable factions it usually invents one. Better to just promote.
    if (cs.length > 0 && !cs.some(c => c.isLeader)) {
      // Heuristic: oldest male character becomes leader
      const males = cs.filter(c => c.gender === "male").sort((a, b) => (b.age || 0) - (a.age || 0));
      const cand = males[0] || cs[0];
      if (cand) cand.isLeader = true;
    }
    const block = emitFactionBlock(facId, decl, ss, cs, charArmies, chainLevels, family);
    blocks.push(`;;; ${facId} — ${ss.length} settlements, ${block.emittedCount} characters (+${block.recordCount} family records, ${block.relativeCount} relatives)`);
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

  // ── Splice into bundled template ──
  const bundledText = fs.readFileSync(stratPath, "utf8");
  const bundledLines = bundledText.split(/\r?\n/);
  const finalText = spliceBundledTemplate(bundledLines, blocks.join("\n"));

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
}

main().catch((e) => { console.error("FATAL:", e.stack || e); process.exit(1); });
