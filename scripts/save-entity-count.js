// One-off: load a save with Provincia's parsers and dump entity counts so
// we can compare against the engine's ~64k pointer-registry budget. Most of
// the categories (factions, characters, settlements, buildings, units,
// character_records, armies) come from existing parsers; the rest are
// approximated by scanning the buffer for stable signatures or skipped if
// no reliable signature is known.

const fs = require("fs");
const path = require("path");
const { parseHeader, parseCharacterExtras } = require("../src/saveCrackerExtras.js");
const { findAllSettlementMarkers, parseSettlements } = require("../src/buildingParser.js");
const { findUnitRecords } = require("../src/unitParser.js");

const savePath = process.argv[2];
if (!savePath || !fs.existsSync(savePath)) {
  console.error("usage: node save-entity-count.js <save.sav>");
  process.exit(1);
}

console.log(`save: ${savePath}`);
const buf = fs.readFileSync(savePath);
console.log(`size: ${(buf.length / (1024 * 1024)).toFixed(1)} MB (${buf.length.toLocaleString()} bytes)`);
console.log("");

const counts = {};

// ── factions: from header ─────────────────────────────────────────────
try {
  const hdr = parseHeader(buf);
  counts.factions = hdr.factionCount || (hdr.factionRecords ? hdr.factionRecords.length : null);
} catch (e) { counts.factions = `error: ${e.message}`; }

// ── settlements: settlement-marker scan ───────────────────────────────
let settlements = [];
try { settlements = findAllSettlementMarkers(buf); counts.settlements = settlements.length; }
catch (e) { counts.settlements = `error: ${e.message}`; }

// ── buildings: total across all settlements ───────────────────────────
try {
  // parseSettlements returns { settlements: [...] } where each entry has
  // .buildings — sum them. Whitelist null is tolerated.
  const result = parseSettlements(buf, null, null);
  const setts = (result && result.settlements) || [];
  counts.settlements_parsed = setts.length;
  counts.buildings = setts.reduce((s, x) => s + (x.buildings ? x.buildings.length : 0), 0);
} catch (e) { counts.buildings = `error: ${e.message}`; }

// ── character records: live character extras ──────────────────────────
try {
  const chars = parseCharacterExtras(buf);
  counts.characters = chars.length;
} catch (e) { counts.characters = `error: ${e.message}`; }

// ── units: rough count via unit-record signature ──────────────────────
try {
  const units = findUnitRecords(buf);
  counts.units = (units && units.length) || `unknown shape: ${typeof units}`;
} catch (e) { counts.units = `error: ${e.message}`; }

// ── report ────────────────────────────────────────────────────────────
const order = ["factions", "settlements", "settlements_parsed", "characters", "units", "buildings"];
console.log("entity counts (the ones Provincia's parsers expose):");
for (const k of order) {
  const v = counts[k];
  console.log(`  ${k.padEnd(14)} ${typeof v === "number" ? v.toLocaleString() : v}`);
}
const numericTotal = order.reduce((s, k) => s + (typeof counts[k] === "number" ? counts[k] : 0), 0);
console.log("");
console.log(`subtotal of above:  ${numericTotal.toLocaleString()}`);
console.log(`pointer-registry limit (~2^16): 65,536`);
console.log(`headroom (subtotal only): ${(65536 - numericTotal).toLocaleString()}`);
console.log("");
console.log("note: this misses ports / forts / watchtowers / roads / sieges / armies /");
console.log("character_records / cameras / superfactions — your screenshot's full list");
console.log("totalled ~65,563 entities, which is essentially AT the 64k limit. Add this");
console.log("subtotal to those uncounted classes for the real number.");
