// saveCracker.js — ONE entrypoint that returns everything Provincia knows how
// to extract from a save, pulled from the AUTHORITATIVE parser for each field.
// Use this instead of reaching into saveCrackerExtras / buildingParser /
// saveOwnershipParser separately: each of those has fields that look right
// but are wrong (the canonical example: saveCrackerExtras.regionCount returns
// 4 for Carthage at turn 1 when ownerByCity correctly shows 41).
//
// Returns one consolidated object. Comments mark fields that come from the
// "right" parser when there's more than one option, plus known undercounts
// so callers don't get bitten again.

"use strict";

const fs = require("fs");
const path = require("path");

const { parseSettlements } = require("./buildingParser.js");
const { resolveCurrentOwners } = require("./saveOwnershipParser.js");
const { buildInitialOwnership, parseDescrRegions } = require("./ownershipParser.js");
const { findCharacterRecords } = require("./characterParser.js");
const { findUnitRecords } = require("./unitParser.js");
const { parseFamilyRecords, indexFamily, attributeFamilyFactions } = require("./familyRecordParser.js");
const { parseSieges } = require("./siegeParser.js");
const { parseEventLog } = require("./eventLogParser.js");
const { parseSettlementFields } = require("./settlementFieldsParser.js");
const { parseEventSchedule } = require("./eventScheduleParser.js");
const { findLuaCounters, classifyCounters } = require("./luaCounterParser.js");
const { parseTurn } = require("./turnParser.js");
const { parseFactionKnowledge } = require("./factionKnowledgeParser.js");
const { findAllSettlementMarkers } = require("./buildingParser.js");
const x = require("./saveCrackerExtras.js");

// Faction attribution for character records — characters appear in a block
// preceded by a `captain_card_<faction>.tga` ASCII marker. Same trick
// save-to-descr-strat.js uses. Without this, every character is unattributed
// and per-faction counts are useless.
function findFactionMarkers(saveBuf) {
  const markers = [];
  const pattern = Buffer.from("captain_card_", "ascii");
  let p = 0;
  while ((p = saveBuf.indexOf(pattern, p)) !== -1) {
    let end = p + pattern.length;
    let faction = "";
    while (end < saveBuf.length) {
      const b = saveBuf[end];
      if (b === 0x2e) break;            // hit '.' of '.tga'
      if (b < 0x20 || b > 0x7e) break;
      faction += String.fromCharCode(b);
      end++;
    }
    if (faction.length > 0 && faction.length < 30) markers.push({ pos: p, faction });
    p += pattern.length;
  }
  return markers;
}
function assignFactions(records, factionMarkers) {
  factionMarkers.sort((a, b) => a.pos - b.pos);
  const sorted = [...records].sort((a, b) => a.offset - b.offset);
  let mi = 0, lastFaction = null;
  for (const r of sorted) {
    while (mi < factionMarkers.length && factionMarkers[mi].pos < r.offset) {
      lastFaction = factionMarkers[mi].faction;
      mi++;
    }
    r.faction = lastFaction;
  }
}

function readFactionOrderFromStrat(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }
  return [];
}

// Build {factionName: denari} map from source descr_strat — used to identify
// the player when parseFactionTreasuries' baked-in detector fails.
function readDenariFromStrat(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const out = {};
    let cur = null;
    for (const raw of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, "").trim();
      const fm = line.match(/^faction\s+([a-z_0-9]+)/i);
      if (fm) { cur = fm[1]; continue; }
      const dm = line.match(/^denari\s+(-?\d+)/);
      if (dm && cur) out[cur] = parseInt(dm[1], 10);
    }
    return out;
  }
  return {};
}

// Read faction declaration order from descr_sm_factions.txt — this is the
// order the diplomacy matrix is indexed by (cracked 2026-05-29 from Bactria
// 3-turn diff: parser was using descr_strat order, producing phantom 15-ally
// lists when the real matrix had only 2-3 non-default cells).
function readSmFactionsOrder(modDataDir) {
  const src = path.join(modDataDir, "descr_sm_factions.txt");
  if (!fs.existsSync(src)) return [];
  const out = [];
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\t"([a-z_0-9]+)":/);
    if (m) out.push(m[1]);
  }
  return out;
}

// NOTE (2026-05-31): readPlayableFromStrat + buildRecordOrderToFactionName were
// removed. They built a "player-pulled-to-front" record order used by the OLD
// current-treasury attribution, which mis-keyed treasuries on mid/late saves.
// Current treasury is now keyed by record ARRAY POSITION into descr_sm order
// (smOrder), matching the treasury-HISTORY keying. See the keying block in
// crackSave + docs/findings-treasury-attribution-2026-05-31.md.

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

function loadTraitNames(modDataDir) {
  const src = path.join(modDataDir, "export_descr_character_traits.txt");
  if (!fs.existsSync(src)) return [];
  const names = [];
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^Trait\s+(\S+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

// Public entrypoint. `modDataDir` should be the mod's data/ folder (e.g.
// "C:/RIS/RIS/data") — needed because ownership + name resolution both
// require reading descr_regions + descr_strat + descr_names_lookup.
function crackSave(saveBuf, modDataDir) {
  const t0 = Date.now();

  // ── mod-side context (small, cached on disk reads) ────────────────────
  const stratOrder    = readFactionOrderFromStrat(modDataDir);
  const nameLookup    = loadNameLookup(modDataDir);
  const traitNames    = loadTraitNames(modDataDir);
  const ownership     = buildInitialOwnership(modDataDir);
  const engineOrder   = x.deriveEngineFactionOrder(stratOrder);
  // The diplomacy matrix is indexed by descr_sm_factions order, NOT descr_strat
  // (cracked 2026-05-29 from Bactria 3-turn diff). Falls back to engineOrder.
  // KNOWN REMAINING ISSUE: matrix locator/key calibration is still off across
  // saves — Bactria T1/T2/T3 returned slightly different ally sets even though
  // user confirmed no diplomatic changes happened. So treat ally lists as
  // approximate until the locator is fixed.
  const smOrder       = readSmFactionsOrder(modDataDir);
  const diploOrder    = smOrder.length > 0 ? smOrder : engineOrder;

  // ── save-side parses, each from its CANONICAL source ──────────────────
  const header        = x.parseHeader(saveBuf);
  const treasuriesRaw = x.parseFactionTreasuries(saveBuf);
  const ownersOut     = resolveCurrentOwners(saveBuf, ownership.ownerByCity);
  const settlements   = parseSettlements(saveBuf, null, null); // returns { settlements: [...], ... }
  const diplomacy     = x.parseDiplomacyMatrix(saveBuf, diploOrder);
  const v2Chars       = x.parseCharacterExtras(saveBuf);

  // findCharacterRecords returns FULLY-PARSED records (firstName, age, role,
  // stats, traits, etc) — no separate parseCharacter call needed. The records
  // arrive without faction attribution; we tag each via the captain_card
  // marker trick used by save-to-descr-strat.
  let v1Chars = [];
  if (nameLookup.length && traitNames.length) {
    v1Chars = findCharacterRecords(saveBuf, nameLookup, traitNames, null);
    const markers = findFactionMarkers(saveBuf);
    assignFactions(v1Chars, markers);
  }

  // Full family roster — wives, daughters, young sons, dead relatives. These
  // are NOT in v1 (no trait list to anchor on); they live in a separate
  // fixed-stride family table. Cracked 2026-05-30 (see
  // src/familyRecordParser.js + rtw-sav-parser findings-family-2026-05-30).
  // Each record carries name, age, gender, alive/dead, and father/spouse/child
  // UUID links. Family HEADS (adult male generals) are in v1, not here, so we
  // resolve link names against BOTH this table and the v1 character set.
  let family = [];
  if (nameLookup.length) {
    family = parseFamilyRecords(saveBuf, nameLookup);
    // Build a uuid->name map from v1 generals so father/spouse links that
    // point at a trait-anchored head still resolve to a name.
    const extraUuidNames = new Map();
    for (const c of v1Chars) {
      const uuid = c.uuid != null ? c.uuid : c.characterUuid;
      const nm = c.fullName || c.name ||
        (c.firstName ? (c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName) : null);
      if (uuid != null && nm) extraUuidNames.set(uuid >>> 0, nm);
    }
    indexFamily(family, extraUuidNames);
    // Attribute family members to factions via the UUID link graph (they have
    // no per-faction marker of their own). Adds `.faction` to each record.
    attributeFamilyFactions(family, v1Chars);
  }
  // Per-faction family rollup (generals from v1 + their wives/children/dead
  // relatives from the family table) — what the round-trip needs to emit a
  // complete `character_record` set.
  const familyByFaction = {};
  for (const r of family) {
    if (r.faction) (familyByFaction[r.faction] ||= []).push(r);
  }

  // Active sieges — siege-ID links the besieging army to the besieged
  // settlement (cracked 2026-05-30, src/siegeParser.js). Empty when none active.
  const settlementList = (settlements && settlements.settlements) || [];
  const sieges = parseSieges(saveBuf, settlementList);

  // End-of-turn event log — sieges/captures/births/deaths/marriages/defeats,
  // each tagged with the owning faction (cracked 2026-05-31, src/eventLogParser.js).
  // diffTurn() against the previous save yields "what happened last turn".
  const events = parseEventLog(saveBuf, stratOrder);

  // Per-settlement runtime fields (population growth, income, public order,
  // governor) — cracked 2026-05-31, src/settlementFieldsParser.js. Keyed by name.
  let settlementFields = {};
  try {
    settlementFields = parseSettlementFields(saveBuf, findAllSettlementMarkers(saveBuf));
  } catch (e) { /* leave empty on failure */ }

  // Scripted-event / disaster schedule (descr_events table) — cracked
  // 2026-05-31, src/eventScheduleParser.js. Static historical events + appended
  // runtime random disasters; "pending" = records dated after the current turn.
  let eventSchedule = null;
  try { eventSchedule = parseEventSchedule(saveBuf); } catch (e) { /* leave null */ }

  // RIS campaign-script state — Lua persistent counters bucketed into
  // factionIds / scriptState (reform/rebellion/battle timers) / engineCounters.
  // NB engineCounters.turn_number is a RIS season-toggle, NOT the turn index
  // (use `turn` above). See luaCounterParser.classifyCounters.
  let scriptCounters = null;
  try { scriptCounters = classifyCounters(findLuaCounters(saveBuf)); } catch (e) { /* leave null */ }

  // Per-faction AI world-knowledge summary — how many map settlements each
  // faction has scouted (FACTION_RECORD_TAIL, cracked 2026-05-31,
  // src/factionKnowledgeParser.js). Light summary only (the full per-tuple
  // tile/owner detail is available via parseFactionKnowledge on demand —
  // ~10k tuples is too heavy to ship in every crackSave payload). Keyed by the
  // knowing faction's name. The ff0aaff0 record array is in ENGINE order
  // (deriveEngineFactionOrder = descr_strat order with the first rebel slot
  // rotated to the end — the SAME order as the treasury records + diplomacy
  // matrix), NOT sm/diplo order. Using diploOrder mislabeled ~192/238 records
  // by one slot (cracked 2026-05-31, findings-record-faction-map). The tuple
  // OWNER field (f5) uses descr_strat 0-based order, so pass stratOrder for
  // ownerName resolution. Player's own record = engineOrder.indexOf(player);
  // engineOrder[237] = slave = the global revealed-area record.
  let factionKnowledge = null;
  try {
    const fk = parseFactionKnowledge(saveBuf, stratOrder); // stratOrder → tuple ownerName
    const perFaction = {};
    for (const r of fk.records) {
      const name = engineOrder[r.factionIndex]; // engineOrder → the KNOWING faction
      if (name) perFaction[name] = { knownTiles: r.tupleCount, knownSettlements: r.fullCount };
    }
    factionKnowledge = { perFaction, factionsWithTail: fk.records.length, totalTuples: fk.totalTuples };
  } catch (e) { /* leave null */ }

  // Units & armies — per-unit type / soldiers / max / XP (src/unitParser.js,
  // the same cracked parser the live path uses). Faction is attributed via the
  // unit's region owner (ownerByCity); commander-led units are grouped into
  // armies by commanderUuid, commander-less units are settlement garrisons.
  let units = [], armies = [];
  try {
    const own = ownersOut.ownerByCity || {};
    // unit.region is a REGION name; ownerByCity is keyed by SETTLEMENT name —
    // map region→settlement via descr_regions, then look up the owner.
    let r2s = {};
    try { if (ownership.regionsPath) r2s = parseDescrRegions(ownership.regionsPath); } catch (e) { /* */ }
    units = findUnitRecords(saveBuf);
    for (const u of units) {
      const city = (u.region && r2s[u.region]) || u.region;
      u.faction = (city && own[city]) || null;
    }
    const byCmd = new Map();
    for (const u of units) {
      if (!u.commanderUuid) continue;
      let a = byCmd.get(u.commanderUuid);
      if (!a) { a = { commanderUuid: u.commanderUuid, region: u.region, faction: u.faction, unitCount: 0, soldiers: 0 }; byCmd.set(u.commanderUuid, a); }
      a.unitCount++; a.soldiers += u.soldiers || 0;
    }
    armies = [...byCmd.values()];
  } catch (e) { /* leave empty */ }

  // ── derive per-faction rollups from the CORRECT source ────────────────
  // Region count comes from ownerByCity tally (NOT from treasuriesRaw.regionCount
  // — that field is broken: returns 4 for Carthage when truth is 41).
  const regionsByFaction = {};
  for (const [city, faction] of Object.entries(ownersOut.ownerByCity || {})) {
    (regionsByFaction[faction] ||= []).push(city);
  }
  // v1 character count per faction. KNOWN UNDERCOUNT: v1 misses wives and
  // daughters — e.g. Carthage at turn 1 = 9 generals here vs 23 family
  // members in descr_strat (9 male generals + 14 spouses/children). v2
  // finds the full 23 but has broken role/faction attribution. If you
  // need accurate family counts, this is unresolved.
  const charsByFaction = {};
  for (const c of v1Chars) {
    if (!c.faction) continue;
    (charsByFaction[c.faction] ||= []).push(c);
  }

  let playerFaction = x.identifyPlayerFactionFromSave(saveBuf, treasuriesRaw);
  // Fallback: identifyPlayer fails for some factions (verified: Bactria T1).
  // Position 0 of sub=6 records is ALWAYS the player — derive the player by
  // matching the first record's treasury or knowledgeSize against source
  // descr_strat. Treasury match works at T1; for T2+ where treasury has
  // shifted from source, knowledgeSize match is the stable fallback.
  const sub6sorted = treasuriesRaw
    .filter(t => t.knowledgeSize !== undefined)
    .sort((a, b) => a.offset - b.offset);
  if (!playerFaction && sub6sorted.length > 0) {
    const firstTreasury = sub6sorted[0].treasury;
    const firstKnowledge = sub6sorted[0].knowledgeSize;
    // Parse source denari per faction
    const denariByFaction = readDenariFromStrat(modDataDir);
    for (const [fac, den] of Object.entries(denariByFaction)) {
      if (den === firstTreasury) { playerFaction = fac; break; }
    }
    // Knowledge fallback if denari fails
    if (!playerFaction && firstKnowledge != null) {
      // Try each candidate playable faction by knowledgeSize — gathered
      // empirically from cross-save runs: each faction has a stable
      // knowledgeSize at T1 (Julii=414, Carthage=173, Antigonid=161,
      // Ptolemaic=207, Seleucid=250, Bactria=83). Match if anyone fits.
      const KNOWN_KNOWLEDGE = {
        414: "romans_julii", 173: "carthage", 161: "antigonid",
        207: "ptolemaic", 250: "seleucid", 83: "bactria",
      };
      if (KNOWN_KNOWLEDGE[firstKnowledge]) playerFaction = KNOWN_KNOWLEDGE[firstKnowledge];
    }
    // Dummies signature (cracked 2026-05-29): synthetic AI-test faction has
    // knowledgeSize=1 (it knows nothing) AND no captain banner before the first
    // NPC record (so identifyPlayerFactionFromSave returns null). The negative
    // treasury (~ -33561 in T20) is also distinctive — only dummies runs deep
    // negative because it has no settlements producing income.
    if (!playerFaction && firstKnowledge === 1 && firstTreasury < 0) {
      playerFaction = "dummies";
    }
  }
  // ── current-treasury → faction keying (fixed 2026-05-31) ──────────────
  // parseFactionTreasuries emits EXACTLY ONE record per faction, in
  // descr_sm_factions declaration order, 1:1 by ARRAY POSITION once sorted by
  // offset (239 records <-> 239 descr_sm factions). So the correct faction for
  // record i is smOrder[i] — the SAME positional keying the treasury-HISTORY
  // fix uses (docs/findings-treasury-history-keying-2026-05-31.md), now applied
  // to current treasury too.
  //
  // The OLD logic keyed by (a) a per-faction knowledge-size signature, then
  // (b) a position fallback into buildRecordOrderToFactionName. Both were
  // unreliable on mid/late saves:
  //   - The knowledge signature is NOT unique (e.g. on a T34 RoR save the minor
  //     factions bessi & sparta share bactria's=83 / cyrene's=69 sigs), and on
  //     late saves most minor/rebel factions collapse to tiny shared sigs
  //     (1/2/4), so the signature can't disambiguate them.
  //   - buildRecordOrderToFactionName rebuilt an order that drifted from the
  //     real record layout, mis-attributing the (real) treasuries of those
  //     records to the wrong faction names. On the T34 save this bound a
  //     191983-denarii record to a 0-region faction (paeonia) while a
  //     113-region empire (seleucid) showed a tiny treasury under the wrong key.
  //   - The per-record factionId BYTE is ALSO wrong here (off-by-one starting at
  //     the carthage record, repeats 0 for several records) — same drift the
  //     history fix documented. Record ARRAY POSITION is the reliable identity.
  //
  // Verified on julii1 (T1) AND the T34 RoR save: each major faction's stable
  // knowledge signature lands on exactly its smOrder position (romans_julii@0,
  // carthage@4, antigonid@5, ptolemaic@6, seleucid@7, bactria@8, ...).
  //
  // PLAYER SWAP: the one deviation from raw smOrder is that the PLAYER faction's
  // record is moved to position 0, and the faction that naturally occupies
  // position 0 (smOrder[0] == romans_julii) is moved to the player's natural
  // smOrder slot. I.e. positions 0 and `playerSlot` are SWAPPED. When the player
  // IS smOrder[0] (a Julii campaign) the swap is the identity, which is why the
  // simpler "idx -> smOrder" keying already validates on julii saves. Confirmed
  // on save_Carthage1 (player=carthage): rec0=carthage(173, the player) and the
  // displaced romans_julii(414) sits at carthage's natural slot 4.
  const orderedRecords = treasuriesRaw.slice().sort((a, b) => a.offset - b.offset);
  // Build the positional faction-name order, applying the player swap.
  const positionOrder = smOrder.slice();
  const playerSlot = playerFaction ? smOrder.indexOf(playerFaction) : -1;
  if (playerSlot > 0) {
    positionOrder[0] = playerFaction;        // player record sits at position 0
    positionOrder[playerSlot] = smOrder[0];  // displaced smOrder[0] takes player's slot
  }
  const trByName = new Map();
  for (let i = 0; i < orderedRecords.length && i < positionOrder.length; i++) {
    const name = positionOrder[i];
    if (name && !trByName.has(name)) trByName.set(name, orderedRecords[i]);
  }

  const factions = {};
  for (let i = 0; i < stratOrder.length; i++) {
    const name = stratOrder[i];
    const tr = trByName.get(name) || null;
    factions[name] = {
      factionId: i,
      treasury: tr ? tr.treasury : null,
      turnStartTreasury: tr ? tr.turnStartTreasury : null,
      netThisTurn: tr ? tr.netThisTurn : null,
      regionCount: (regionsByFaction[name] || []).length,
      regions: regionsByFaction[name] || [],
      generalCount: (charsByFaction[name] || []).length,
      diplomacy: diplomacy ? diplomacy[name] : null,
    };
  }

  // Turn number — CONFIRMED literal counter (cracked 2026-05-31, turnParser.js).
  // Reads the campaign-date record (`…descr_strat.txt` + marker, then
  // u32 turnsElapsed + i32 currentYear). EXACT at any turn — replaces the old
  // econ-history-block-count heuristic, which SATURATED (~10) on long campaigns
  // (it returned turn 10 for a known "Turn 34 Start" save). Also yields the
  // current campaign year + season-within-year (4 turns/year for RIS).
  // Validated 11/11: julii/Carthage 1/2/3, Carthage T2E/T3S, RoR T5/T8/T34.
  const turnInfo = parseTurn(saveBuf);
  let turn = turnInfo ? turnInfo.turn : null;
  const currentYear = turnInfo ? turnInfo.year : null;
  const seasonIndex = turnInfo ? turnInfo.seasonIndex : null;

  // Fallback (only if the date-record signature is absent): the legacy
  // econ-history-block count before the player record. Capped/approximate on
  // long campaigns — kept solely so `turn` is non-null on odd save layouts.
  if (turn == null && playerFaction && trByName.has(playerFaction)) {
    const r = trByName.get(playerFaction);
    for (let off = r.offset - 4; off >= r.offset - 100000 && off >= 0; off -= 4) {
      if (saveBuf.readUInt32LE(off) === off) {
        const f = [];
        for (let o = off; o + 4 <= r.offset; o += 4) f.push(saveBuf.readInt32LE(o));
        const body = f.slice(2, f.length - 1);
        if (body.length >= 23 && body.length % 23 === 0) turn = body.length / 23;
        break;
      }
    }
  }

  return {
    header,
    playerFaction,
    turn,
    currentYear,                // current campaign year (BC negative); null if unknown
    seasonIndex,                // 0..3 within the year (4 turns/year); null if unknown
    factions,
    settlements: settlements && settlements.settlements ? settlements.settlements : [],
    characters: {
      v1: v1Chars,              // trait-anchored: generals/agents (name, traits, age, pos)
      v2Count: v2Chars.length,  // role/uuid records (no names)
      family,                   // FULL family roster incl. women: name, age, gender,
                                // alive, faction, fatherUuid/spouseUuid/childUuids (+resolved names)
      familyByFaction,          // family records grouped by attributed faction
    },
    diplomacy,                  // { factionName: {war, allied, hostile, trade}, _meta }
    sieges,                     // [{ besiegerArmyUuid, siegeId, turnsRemaining, turnsUnderSiege, siegeWindow, targetSettlement }]
    events,                     // end-of-turn event log [{ type, faction, subject, title, body }]
    settlementFields,           // { city: { populationGrowth, income, publicOrder, governorUuid, ... } }
    eventSchedule,              // { count, records:[{category,label,year,season,x,y,scale,warning,isRandom}] }
    scriptCounters,             // { factionIds, scriptState (reform/rebellion timers), engineCounters }
    factionKnowledge,           // { perFaction:{name:{knownTiles,knownSettlements}}, factionsWithTail, totalTuples }
    units,                      // [{ name, region, faction, commanderUuid, soldiers, maxSoldiers, xp, ... }]
    armies,                     // commander-led groupings: [{ commanderUuid, region, faction, unitCount, soldiers }]
    ownerByCity: ownersOut.ownerByCity || {},
    _stats: {
      ms: Date.now() - t0,
      factions: Object.keys(factions).length,
      settlements: (settlements && settlements.settlements || []).length,
      v1Characters: v1Chars.length,
      v2Characters: v2Chars.length,
      familyMembers: family.length,
      familyFemales: family.filter((r) => r.gender === "female").length,
      familyAttributed: family.filter((r) => r.faction).length,
      sieges: sieges.length,
      events: events.length,
      factionsWithKnowledge: factionKnowledge ? factionKnowledge.factionsWithTail : 0,
      units: units.length,
      armies: armies.length,
      wars: diplomacy ? diplomacy._meta?.warPairs : null,
      saveSizeBytes: saveBuf.length,
    },
  };
}

module.exports = { crackSave };
