// dig-econ-net-search.js
// The pre-record block fields are large aggregates (population/economy KPIs?),
// not denarii. The income BREAKDOWN must be a distinct structure. Strategy:
// search the WHOLE save for the exact per-turn NET income values and known
// component-ish numbers, then look at what record they sit in. Also test the
// f13 history series and the inter-block f1 delta as income proxies.
//
// Ground truth net (treasury delta): T2=+6833 T3=+1438 T4=+1422.
// Gross settlement income (from in-game finance UI, reported by user earlier):
//   T1=6347 T2=6339 T3=6338 T4=6539.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

const bufs = {}, pr = {};
for (const t of turns) {
  bufs[t] = fs.readFileSync(path.join(BASE, FILES[t]));
  pr[t] = parseFactionTreasuries(bufs[t]).find(r => r.factionId===PLAYER_FID && r.treasury===GROUND[t]);
}

// 1) Find all occurrences of each turn's NET value as i32; report distance to player core.
function findAll(buf, val) {
  const out = [];
  for (let i=0;i+4<=buf.length;i++){ if (buf.readInt32LE(i)===val) out.push(i); }
  return out;
}
const NET = { T2:6833, T3:1438, T4:1422 };
console.log("=== net-value occurrences (i32) and Δ to player core ===");
for (const t of ["T2","T3","T4"]) {
  const occ = findAll(bufs[t], NET[t]);
  console.log(`  ${t} net=${NET[t]}: ${occ.length} occ`);
  // show ones within +-4KB of core
  const near = occ.filter(o=>Math.abs(o-pr[t].offset)<8000).map(o=>`Δ${o-pr[t].offset}`);
  console.log(`     near core (±8KB): ${near.join(" ") || "(none)"}`);
}

// 2) Find treasury value occurrences near the core (besides +0 and +180 known).
console.log("\n=== treasury occurrences near player core (±2KB) ===");
for (const t of turns) {
  const occ = findAll(bufs[t], GROUND[t]).filter(o=>Math.abs(o-pr[t].offset)<2000).map(o=>`Δ${o-pr[t].offset}`);
  console.log(`  ${t} treasury=${GROUND[t]}: ${occ.join(" ")}`);
}

// 3) f13 history series & gross/net comparison.
function ordinal0(buf, core){for(let off=core-4;off>=core-4000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function blocksFor(buf, core){const start=ordinal0(buf,core);const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const body=f.slice(2,f.length-1);const S=23,n=body.length/S;const bl=[];for(let b=0;b<n;b++)bl.push(body.slice(b*S,(b+1)*S));return bl;}
console.log("\n=== f13 history (income-per-completed-turn?) vs net & gross ===");
const t4blocks = blocksFor(bufs.T4, pr.T4.offset);
console.log("  T4 f13 by block:", t4blocks.map(b=>b[13]).join(" "));
console.log("  net series      :  --  6833 1438 1422 (treasury deltas)");
console.log("  gross series    : 6347 6339 6338 6539 (settlement income)");
console.log("  f1 series       :", t4blocks.map(b=>b[1]).join(" "));
console.log("  f3 series       :", t4blocks.map(b=>b[3]).join(" "));
console.log("  f9 series       :", t4blocks.map(b=>b[9]).join(" "));
console.log("  f0 series       :", t4blocks.map(b=>b[0]).join(" "));
console.log("  f12 series      :", t4blocks.map(b=>b[12]).join(" "));
console.log("  f22 series      :", t4blocks.map(b=>b[22]).join(" "));
