// dig-diploenum-perstance.js
//
// Per-STANCE accuracy breakdown. The aggregate match% hides that small
// factions (ally=0/war=0) inflate the score. This computes, separately for
// ALLY / WAR / PROTECTORATE, how often the decoded count equals GT (exact and
// within 1), using only NPC zones whose GT for that stance is > 0 (so we
// measure real signal, not zeros). Also reports the player zone explicitly.
//
// Tests the leading rules per stance to find which class/att slice best
// reproduces EACH stance independently.
//
// Usage: node dig-diploenum-perstance.js [savePath]

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DEFAULT =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav";
const DESCR_STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const CAMPAIGN_SCRIPT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt";
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const savePath = process.argv[2] || SAVE_DEFAULT;
const MARKER = 0x39240005;

function parseFactionOrder(text) {
  const order = []; let cur = null, depth = 0, inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (s.startsWith(";")) continue;
    const prev = depth;
    for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (inBlock && depth === 0) { cur = null; inBlock = false; }
    if (prev === 0 && depth === 0) { const m = s.match(/^"([^"]+)"\s*:/); if (m && m[1].toLowerCase() !== "factions") cur = m[1].toLowerCase(); }
    if (cur && prev === 0 && depth === 1) { inBlock = true; if (!order.includes(cur)) order.push(cur); }
  }
  return order;
}
function parseStratRel(text) {
  const out = {}; const add = (a, b, k) => { if (a === b) return; if (!out[a]) out[a] = []; out[a].push({ to: b, kind: k }); };
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*;/.test(raw)) continue;
    const m = raw.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1].toLowerCase(), v = parseInt(m[2], 10), to = m[3].toLowerCase(); if (from === to) continue;
    const k = v <= 199 ? "ally" : v === 200 ? "neutral" : "war"; add(from, to, k); add(to, from, k);
  }
  return out;
}
function parseScriptRel(text) {
  const out = {}; const add = (a, b, k) => { if (a === b) return; if (!out[a]) out[a] = []; out[a].push({ to: b, kind: k }); };
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (!s || s.startsWith(";")) continue;
    let m = s.match(/^console_command\s+become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
    if (m) { add(m[1].toLowerCase(), m[2].toLowerCase(), "protects"); add(m[2].toLowerCase(), m[1].toLowerCase(), "protected_by"); continue; }
    m = s.match(/^console_command\s+diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i);
    if (m) { const a = m[1].toLowerCase(), b = m[2].toLowerCase(), st = m[3].toLowerCase(); const k = st === "war" ? "war" : (st === "allied" || st === "alliance" ? "ally" : null); if (k) { add(a, b, k); add(b, a, k); } }
  }
  return out;
}
function buildGT(stratRel, scriptRel, fo) {
  const gt = {}; const E = (f) => { if (!gt[f]) gt[f] = { allies: new Set(), wars: new Set(), protects: new Set(), protectedBy: new Set() }; return gt[f]; };
  for (const f of fo) E(f);
  for (const f of Object.keys(scriptRel)) { const g = E(f); for (const e of scriptRel[f]) { if (e.kind === "protects") g.protects.add(e.to); else if (e.kind === "protected_by") g.protectedBy.add(e.to); else if (e.kind === "war") g.wars.add(e.to); else if (e.kind === "ally") g.allies.add(e.to); } }
  for (const f of Object.keys(stratRel)) { const g = E(f); for (const e of stratRel[f]) { if (g.protects.has(e.to) || g.protectedBy.has(e.to)) continue; if (e.kind === "ally") g.allies.add(e.to); else if (e.kind === "war") g.wars.add(e.to); } }
  return gt;
}
function parseTreas(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100 || buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) || buf.readUInt32LE(i + 20)) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) || buf.readUInt32LE(i + 36)) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40 || buf.readUInt32LE(i + 44) !== 6) continue;
    const r = buf.readUInt32LE(i + 48); if (r > 200) continue;
    if (i + 244 + 4 * r + 4 > buf.length) continue;
    out.push({ factionId: buf.readUInt8(i + 92 + 4 * r + 99) });
  }
  return out;
}
function collectZones(buf, fo) {
  const byName = {};
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4); if (count === 0 || count > 200) continue;
    const fid = buf[i - 53]; if (fid >= fo.length) continue;
    const name = fo[fid]; if (!name) continue;
    let ok = true; const entries = [];
    for (let k = 0; k < count; k++) { const o = i + 8 + k * 16; if (o + 16 > buf.length) { ok = false; break; } entries.push({ cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8) }); }
    if (!ok) continue;
    if (!byName[name] || byName[name].count < count) byName[name] = { name, count, entries, hasAtt5: entries.some((e) => e.att === 5) };
  }
  return byName;
}

const buf = fs.readFileSync(savePath);
const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
const gt = buildGT(parseStratRel(fs.readFileSync(DESCR_STRAT, "utf8")), parseScriptRel(fs.readFileSync(CAMPAIGN_SCRIPT, "utf8")), fo);
const treas = parseTreas(buf);
const majorNames = new Set(treas.map((t) => fo[t.factionId]).filter(Boolean));
const zones = collectZones(buf, fo);

console.log(`SAVE: ${path.basename(savePath)}`);

const npcNames = Object.keys(zones).filter((n) => !zones[n].hasAtt5);

// Candidate counters per stance (NPC zones).
const allyCounters = {
  "class==1": (e) => e.cls === 1,
  "class==0": (e) => e.cls === 0,
  "class==0 && att==0": (e) => e.cls === 0 && e.att === 0,
  "class==0 && att<=1": (e) => e.cls === 0 && e.att <= 1,
  "class in {0,1} && att==0": (e) => (e.cls === 0 || e.cls === 1) && e.att === 0,
  "class==4": (e) => e.cls === 4,
};
const warCounters = {
  "class==2": (e) => e.cls === 2,
  "class==2 && att>=3": (e) => e.cls === 2 && e.att >= 3,
  "class==2 && att==4": (e) => e.cls === 2 && e.att === 4,
  "att==4": (e) => e.att === 4,
  "att>=3": (e) => e.att >= 3,
  "class==2 && att>=2": (e) => e.cls === 2 && e.att >= 2,
};
const protCounters = {
  "class==0": (e) => e.cls === 0,
  "class==4": (e) => e.cls === 4,
  "class==0 && att==0": (e) => e.cls === 0 && e.att === 0,
  "class==0 && att==1": (e) => e.cls === 0 && e.att === 1,
};

function score(counters, gtKey) {
  console.log(`\n--- ${gtKey.toUpperCase()} (NPC zones with GT ${gtKey}>0) ---`);
  // For protect, GT = protects + protectedBy
  const gtVal = (g) => gtKey === "ally" ? g.allies.size : gtKey === "war" ? g.wars.size : (g.protects.size + g.protectedBy.size);
  const relevant = npcNames.filter((n) => gt[n] && gtVal(gt[n]) > 0);
  for (const [label, fn] of Object.entries(counters)) {
    let exact = 0, within1 = 0;
    for (const n of relevant) {
      const dec = zones[n].entries.filter(fn).length;
      const g = gtVal(gt[n]);
      if (dec === g) exact++;
      if (Math.abs(dec - g) <= 1) within1++;
    }
    console.log(`  ${label.padEnd(28)} exact=${exact}/${relevant.length} (${(100 * exact / relevant.length).toFixed(0)}%)  within1=${within1}/${relevant.length} (${(100 * within1 / relevant.length).toFixed(0)}%)`);
  }
}
score(allyCounters, "ally");
score(warCounters, "war");
score(protCounters, "prot");

// Show big-faction detail with best war counters.
console.log("\n=== BIG NPC FACTIONS (class==2 vs att slices for WAR) ===");
for (const n of ["romans_julii", "antigonid", "ptolemaic", "bactria", "carthage", "achaea", "getae"]) {
  const z = zones[n]; if (!z) continue;
  const g = gt[n];
  const c2 = z.entries.filter((e) => e.cls === 2);
  const c2att = {}; for (const e of c2) c2att[e.att] = (c2att[e.att] || 0) + 1;
  console.log(`  ${n}: GT war=${g.wars.size} | class2 total=${c2.length} by att=${JSON.stringify(c2att)}  [major=${majorNames.has(n)}]`);
}

// Player zone explicit
console.log("\n=== PLAYER ZONE (seleucid) ===");
for (const n of Object.keys(zones)) {
  if (!zones[n].hasAtt5) continue;
  const z = zones[n], g = gt[n];
  const clsH = {}; for (const e of z.entries) clsH[e.cls] = (clsH[e.cls] || 0) + 1;
  console.log(`  ${n}: class hist ${JSON.stringify(clsH)}`);
  console.log(`     GT ally=${g.allies.size} war=${g.wars.size} protects=${g.protects.size} protectedBy=${g.protectedBy.size}`);
  // list seleucid's GT wars
  console.log(`     GT wars: ${[...g.wars].join(", ")}`);
  console.log(`     GT allies: ${[...g.allies].join(", ")}`);
  console.log(`     GT protects: ${[...g.protects].join(", ")}`);
}
