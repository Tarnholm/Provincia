// Probe: how does the save encode character TYPE/class? Cross-reference the
// role-anchored v2 records against v1 trait-anchored records (via UUID) and
// against descr_strat ground truth.
"use strict";
const fs = require("fs");
const path = require("path");
const x = require("../../src/saveCrackerExtras.js");
const { findCharacterRecords } = require("../../src/characterParser.js");

const SAVE = process.argv[2];
const MOD = process.argv[3] || "C:\\RIS\\RIS\\data";
if (!SAVE) { console.error("usage: node probe-agent-types.js <save> [mod]"); process.exit(1); }
const buf = fs.readFileSync(SAVE);

// load lookups same way saveCracker does
function loadLines(p) { return fs.readFileSync(p, "utf8").split(/\r?\n/); }
function findFile(names) {
  const dirs = [MOD,
    path.join(MOD, "world/maps/campaign/imperial_campaign"),
  ];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d, n);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
const nameLookupPath = findFile(["descr_names_lookup.txt"]);
const traitPath = findFile(["export_descr_character_traits.txt"]);
const nameLookup = nameLookupPath ? loadLines(nameLookupPath).map(s => s.trim()) : [];
// trait names: parse Trait <name> lines, index sequential
let traitNames = [];
if (traitPath) {
  const t = fs.readFileSync(traitPath, "utf8");
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^Trait\s+(\w+)/);
    if (m) traitNames.push(m[1]);
  }
}
console.log("nameLookup", nameLookup.length, "traitNames", traitNames.length);

const v2 = x.parseCharacterExtras(buf);
const byRole = {};
for (const c of v2) byRole[c.role] = (byRole[c.role] || 0) + 1;
console.log("\n=== v2 (role-anchored) role distribution ===");
console.log(byRole);

console.log("\n=== v2 non-general/captain (AGENTS) sample ===");
for (const c of v2.filter(c => !["general", "captain"].includes(c.role)).slice(0, 40)) {
  console.log(`  ${c.role.padEnd(10)} ${c.culture.padEnd(14)} own=${c.ownUuid} bg=${c.bodyguardUuid} region=${c.region} age=${c.age}`);
}

// v1 cross-ref
if (nameLookup.length && traitNames.length) {
  const v1 = findCharacterRecords(buf, nameLookup, traitNames, null);
  console.log("\n=== v1 count", v1.length, "===");
  // build uuid maps
  const v2ByOwn = new Map(), v2ByBg = new Map();
  for (const c of v2) { v2ByOwn.set(c.ownUuid >>> 0, c); if (c.bodyguardUuid) v2ByBg.set(c.bodyguardUuid >>> 0, c); }
  let matchPrimaryOwn = 0, matchSecBg = 0, matchSecOwn = 0, matchPrimaryBg = 0;
  for (const c of v1) {
    const p = c.primaryUuid >>> 0, s = c.secondaryUuid >>> 0;
    if (v2ByOwn.has(p)) matchPrimaryOwn++;
    if (v2ByBg.has(s)) matchSecBg++;
    if (v2ByOwn.has(s)) matchSecOwn++;
    if (v2ByBg.has(p)) matchPrimaryBg++;
  }
  console.log("v1.primaryUuid ∈ v2.ownUuid :", matchPrimaryOwn);
  console.log("v1.secondaryUuid ∈ v2.bgUuid:", matchSecBg);
  console.log("v1.secondaryUuid ∈ v2.ownUuid:", matchSecOwn);
  console.log("v1.primaryUuid ∈ v2.bgUuid  :", matchPrimaryBg);

  // For v1 chars that match v2 by own=primary, show the role distribution
  const roleOfV1 = [];
  for (const c of v1) {
    const m = v2ByOwn.get(c.primaryUuid >>> 0);
    if (m) roleOfV1.push({ name: `${c.firstName} ${c.lastName || ""}`.trim(), role: m.role, byteRole: c.role, isLeader: c.isLeader });
  }
  const v1roleHist = {};
  for (const r of roleOfV1) v1roleHist[r.role] = (v1roleHist[r.role] || 0) + 1;
  console.log("\n=== v1 chars matched to v2 by ownUuid: their v2.role ===");
  console.log(v1roleHist);
  console.log("\n=== sample matched agents (v1 name + v2 role) ===");
  for (const r of roleOfV1.filter(r => !["general", "captain"].includes(r.role)).slice(0, 30)) {
    console.log(`  ${r.role.padEnd(10)} ${r.name.padEnd(30)} byteRole=${r.byteRole}`);
  }
}
