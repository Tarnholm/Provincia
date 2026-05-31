// scripts/probe-rome-garrison.js — assert the LIVE garrison/field-army split
// for the settlement Rome. Replicates the renderer's classification:
//   garrison = commanderless units + governor's stack + commanders ON the
//              settlement tile;
//   field    = every other commanded stack in the region.
// Proves the fix: the 2 generals' field stacks (Marcus, Servius) standing OFF
// Rome's settlement tile are NOT in the garrison and ARE separate field armies.
//
// Usage: node scripts/probe-rome-garrison.js <save.sav> [--mod <dir>]

"use strict";
const fs = require("fs");
const { crackSave } = require("../src/saveCracker.js");

function parseArgs(argv) {
  const a = { save: null, mod: "C:\\RIS\\RIS\\data" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (!a.save) a.save = argv[i];
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.save || !fs.existsSync(args.save)) { console.error("save not found:", args.save); process.exit(1); }

const buf = fs.readFileSync(args.save);
const r = crackSave(buf, args.mod);
const player = r.playerFaction;
const REGION = "Roma";
const CITY = "Rome";
console.log(`turn ${r.turn}  player ${player}  region ${REGION}`);

// inferredCmd (main.js Pass 1+2)
for (const u of r.units) { if (u.commanderUuid) u.inferredCmd = u.commanderUuid; }
{
  const ordered = r.units.slice().sort((a, b) => a.offset - b.offset);
  let lastCmd = null;
  for (const u of ordered) {
    if (u.commanderUuid) { lastCmd = u.commanderUuid; continue; }
    if (!lastCmd) continue;
    if (/^naval\b/i.test(u.name || "") || u.region === "the sea") continue;
    u.inferredCmd = lastCmd;
  }
}

// Character coords by secondaryUuid (the unit commanderUuid).
const v1 = r.characters.v1 || [];
const charByCmd = new Map();
for (const c of v1) { if (c.secondaryUuid) charByCmd.set(c.secondaryUuid, c); }

// Governor of Rome.
const governorUuid = r.settlementFields && r.settlementFields[CITY] && r.settlementFields[CITY].governorUuid || null;

// Rome's settlement tile = the governor's tile (he stands inside at turn 1).
const gov = charByCmd.get(governorUuid);
const settlementTile = gov && gov.tileX != null ? { x: gov.tileX, y: gov.tileY } : null;
console.log(`governor uuid=${governorUuid ? governorUuid.toString(16) : "none"} tile=${settlementTile ? `${settlementTile.x},${settlementTile.y}` : "?"}`);

// cmdsAtSettlement = commanders whose tile == settlement tile.
const cmdsAtSettlement = new Set();
if (settlementTile) {
  for (const c of v1) {
    if (!c.secondaryUuid) continue;
    if (c.tileX === settlementTile.x && c.tileY === settlementTile.y) cmdsAtSettlement.add(c.secondaryUuid);
  }
}

const regionUnits = r.units.filter((u) => u.region === REGION);

function classify(useSameFaction) {
  const ownerFaction = player.toLowerCase();
  const garrison = [];
  const fieldByCmd = new Map();
  for (const u of regionUnits) {
    const cmd = u.commanderUuid || u.inferredCmd || null;
    let inGarr = false;
    if (!u.commanderUuid && !u.inferredCmd) inGarr = true;
    else if (governorUuid && cmd === governorUuid) inGarr = true;
    else if (cmdsAtSettlement.has(cmd)) inGarr = true;
    else if (useSameFaction && (u.faction || "").toLowerCase() === ownerFaction) inGarr = true; // OLD buggy clause
    if (inGarr) garrison.push(u);
    else { (fieldByCmd.get(cmd) || fieldByCmd.set(cmd, []).get(cmd)).push(u); }
  }
  return { garrison, fieldByCmd };
}

function report(label, useSameFaction) {
  const { garrison, fieldByCmd } = classify(useSameFaction);
  console.log(`\n--- ${label} ---`);
  console.log(`garrison: ${garrison.length} units`);
  const garrCmds = [...new Set(garrison.map((u) => (u.commanderUuid || u.inferredCmd || 0)))];
  console.log(`  garrison commander groups: ${garrCmds.map((c) => c ? `${c.toString(16)} (${charByCmd.get(c) ? charByCmd.get(c).firstName + " " + (charByCmd.get(c).lastName||"") : "?"})` : "cmd=0").join(", ")}`);
  console.log(`field armies: ${fieldByCmd.size} stacks`);
  for (const [cmd, us] of fieldByCmd) {
    const c = charByCmd.get(cmd);
    console.log(`  ${cmd.toString(16)} ${c ? c.firstName + " " + (c.lastName||"") : "?"} @(${c?c.tileX:"?"},${c?c.tileY:"?"})  ${us.length} units`);
  }
  return { garrison, fieldByCmd };
}

const before = report("BEFORE (old sameFaction clause)", true);
const after = report("AFTER (fixed: in-settlement only)", false);

// Assertions for the fix. Identify the 2 off-tile Roman generals by name
// (uuids are per-save) — they must be field armies, NOT garrison.
let ok = true;
const firstOf = (cmd) => { const c = charByCmd.get(cmd); return c ? c.firstName : null; };
for (const wantName of ["Marcus", "Servius"]) {
  const fieldCmd = [...after.fieldByCmd.keys()].find((c) => firstOf(c) === wantName);
  const inField = !!fieldCmd;
  const inGarr = after.garrison.some((u) => firstOf(u.commanderUuid || u.inferredCmd || 0) === wantName);
  console.log(`\nASSERT ${wantName}: field=${inField} garrison=${inGarr}  ${inField && !inGarr ? "PASS" : "FAIL"}`);
  if (!inField || inGarr) ok = false;
}
// Governor's garrison stack still present (15 units, all under Quintus/cmd0).
const garrUnits = after.garrison.length;
console.log(`ASSERT garrison non-empty & excludes the 2 field generals: ${garrUnits} units  ${garrUnits > 0 ? "PASS" : "FAIL"}`);
if (garrUnits === 0) ok = false;
// No unit dropped: garrison + field == region units.
const fieldUnitTotal = [...after.fieldByCmd.values()].reduce((s, a) => s + a.length, 0);
console.log(`ASSERT no units dropped: garrison(${garrUnits}) + field(${fieldUnitTotal}) == region(${regionUnits.length})  ${garrUnits + fieldUnitTotal === regionUnits.length ? "PASS" : "FAIL"}`);
if (garrUnits + fieldUnitTotal !== regionUnits.length) ok = false;

console.log(`\n${ok ? "ALL ASSERTIONS PASS" : "ASSERTIONS FAILED"}`);
process.exit(ok ? 0 : 1);
