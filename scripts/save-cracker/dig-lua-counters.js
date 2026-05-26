// dig-lua-counters.js — Cross-reference RIS campaign script counter
// declarations against the Lua persistent-counter table parsed out of the
// save. Goal: confirm format (already known — see src/luaCounterParser.js)
// and discover any counter NOT yet documented, so the Lua zone can be
// fully decoded.
//
// Inputs:
//   - save_macedon t0.sav
//   - RIS_Campaign_Script.txt
//   - data/major_event_scripts/*.txt
//
// Output: console table comparing script-declared counters vs save-resident
// counters, plus any save counters NOT declared by RIS (= engine-internal).

const fs = require("fs");
const path = require("path");
const { findLuaCounters } = require("../../src/luaCounterParser");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const RIS_CAMPAIGN = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt";
const RIS_EVENTS_DIR = "C:/RIS/RIS/data/major_event_scripts";

// ─────────────────────────────────────────────────────────────────────────
// 1. Pull all counter operations from RIS scripts
// ─────────────────────────────────────────────────────────────────────────
function scanCounterOps(text) {
  // declare_counter NAME [initial_value]
  // set_counter NAME VAL
  // inc_counter NAME VAL
  // dec_counter NAME VAL
  const re = /^\s*(declare_counter|set_counter|inc_counter|dec_counter)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(-?\d+))?/gm;
  const ops = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    ops.push({ op: m[1], name: m[2], val: m[3] != null ? Number(m[3]) : null });
  }
  return ops;
}

const campaignText = fs.readFileSync(RIS_CAMPAIGN, "utf8");
// Strip lines whose first non-whitespace char is ';' (RTW script comment).
const campaignActive = campaignText
  .split(/\r?\n/)
  .filter(l => !/^\s*;/.test(l))
  .join("\n");

const campaignOps = scanCounterOps(campaignActive);

const eventOps = [];
for (const f of fs.readdirSync(RIS_EVENTS_DIR)) {
  if (!f.endsWith(".txt")) continue;
  const t = fs.readFileSync(path.join(RIS_EVENTS_DIR, f), "utf8");
  const active = t.split(/\r?\n/).filter(l => !/^\s*;/.test(l)).join("\n");
  for (const op of scanCounterOps(active)) {
    eventOps.push({ ...op, file: f });
  }
}

const declaredFromScript = new Set();
for (const op of campaignOps) if (op.op === "declare_counter") declaredFromScript.add(op.name);
for (const op of eventOps) if (op.op === "declare_counter") declaredFromScript.add(op.name);

// All names referenced by any counter op (declare, set, inc, dec)
const referencedFromScript = new Set();
for (const op of campaignOps) referencedFromScript.add(op.name);
for (const op of eventOps) referencedFromScript.add(op.name);

console.log("=== RIS script counter operations ===");
console.log(`Campaign script: ${campaignOps.length} operations`);
console.log(`Event triggers : ${eventOps.length} operations across ${new Set(eventOps.map(o => o.file)).size} files`);
console.log(`Declared in scripts: ${declaredFromScript.size}`);
console.log(`Referenced (any op): ${referencedFromScript.size}`);

// Group set/inc/dec for stable init values
const initialValues = new Map(); // name -> first set value seen
for (const op of campaignOps.concat(eventOps)) {
  if (op.op === "set_counter" && op.val != null && !initialValues.has(op.name)) {
    initialValues.set(op.name, op.val);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Parse the save's Lua counter table
// ─────────────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(SAVE);
console.log(`\nSave: ${path.basename(SAVE)} (${buf.length} bytes)`);

const records = findLuaCounters(buf);
console.log(`Parsed ${records.length} Lua counter records from save`);
if (records.length === 0) {
  console.log("FATAL: no records found. Aborting.");
  process.exit(1);
}

const firstOff = records[0].offset;
const lastEnd = records[records.length - 1].end;
console.log(`Lua zone byte range: 0x${firstOff.toString(16)} .. 0x${lastEnd.toString(16)} (${lastEnd - firstOff} bytes)`);

const saveByName = new Map();
for (const r of records) saveByName.set(r.name, r);

// ─────────────────────────────────────────────────────────────────────────
// 3. Compare script-declared vs save-resident
// ─────────────────────────────────────────────────────────────────────────
console.log("\n=== Script-declared counters PRESENT in save ===");
let present = 0, missing = 0;
for (const name of [...declaredFromScript].sort()) {
  if (saveByName.has(name)) {
    present++;
    const r = saveByName.get(name);
    const initStr = initialValues.has(name) ? ` (script-init=${initialValues.get(name)})` : "";
    console.log(`  PRESENT  ${name.padEnd(40)} value=${r.value}${initStr}`);
  }
}

console.log("\n=== Script-declared counters MISSING from save ===");
for (const name of [...declaredFromScript].sort()) {
  if (!saveByName.has(name)) {
    missing++;
    console.log(`  MISSING  ${name}`);
  }
}

console.log("\n=== Save counters NOT declared by RIS scripts (engine-internal or referenced-only) ===");
let engineOnly = 0;
for (const r of records) {
  if (!declaredFromScript.has(r.name)) {
    engineOnly++;
    const referenced = referencedFromScript.has(r.name) ? " [REF-IN-SCRIPT]" : "";
    console.log(`  UNDECL   ${r.name.padEnd(40)} value=${r.value} (${r.value >>> 0} u32, ${(r.value | 0)} i32)${referenced}`);
  }
}

console.log(`\nSummary: ${present} present, ${missing} missing, ${engineOnly} undeclared-but-in-save`);

// ─────────────────────────────────────────────────────────────────────────
// 4. Format validation — does every record have ASCII-safe identifier
// ─────────────────────────────────────────────────────────────────────────
let nonIdent = 0;
for (const r of records) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name)) nonIdent++;
}
console.log(`\nFormat validation: ${records.length - nonIdent}/${records.length} records have identifier-shaped names`);

// Dump value distribution for an idea of the encoding (signed/unsigned/uuid)
const allVals = records.map(r => r.value);
const zero = allVals.filter(v => v === 0).length;
const small = allVals.filter(v => v > 0 && v < 1000).length;
const negish = allVals.filter(v => v > 0xfffff000).length;
const big = allVals.filter(v => v >= 1000 && v <= 0xfffff000).length;
console.log(`Value distribution: zero=${zero} small(<1000)=${small} big=${big} near-u32-max(>0xfffff000)=${negish}`);

// Boundary check: are there any bytes between the last record's end and the
// next known section, or does the table truly terminate cleanly?
console.log("\n=== Bytes immediately after last Lua record ===");
const tailDump = buf.slice(lastEnd, Math.min(lastEnd + 64, buf.length));
console.log(`  hex: ${Array.from(tailDump).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`  ascii: ${Array.from(tailDump).map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".").join("")}`);

// Check the byte immediately BEFORE the first record — likely the section's
// length prefix or a back-pointer.
console.log("\n=== Bytes immediately before first Lua record ===");
const headDump = buf.slice(Math.max(0, firstOff - 64), firstOff);
console.log(`  hex: ${Array.from(headDump).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`  ascii: ${Array.from(headDump).map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".").join("")}`);
