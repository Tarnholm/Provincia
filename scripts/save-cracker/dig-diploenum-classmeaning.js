// dig-diploenum-classmeaning.js
//
// Pin down what `class` means by comparing the PLAYER zone (where class is a
// clean stance: 1=ally,2=war/hostile,4=protectorate,5=neutral) to NPC zones,
// and by testing the directional-protectorate hypothesis.
//
// Specifically:
//  (1) For the player (seleucid), is the class-2 "war" block actually
//      "every faction with negative attitude" (i.e. hostile, not at-war)?
//      We can't name partners, but we CAN compare counts: GT war=4 vs class2=19.
//      Test: does class2 == (# factions seleucid has discovered that are NOT
//      ally/protectorate/self)? i.e. class 2 = "known & not-friendly".
//  (2) Protectorate direction: romans_julii GRANTS 6 protectorates and they
//      show as class 0 in ITS zone. Do the 6 protectorate factions
//      (volsinii, capua, samnites, lucanians, bruttians, taras) carry a
//      reciprocal entry in THEIR OWN zones? If so what class?
//  (3) Build the full per-faction confusion: for every NPC zone, decode with
//      the BEST per-stance rule and report aggregate exact-match for the
//      majors (the factions that matter for display).
//
// Usage: node dig-diploenum-classmeaning.js [savePath]

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
    const prev = depth; for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (inBlock && depth === 0) { cur = null; inBlock = false; }
    if (prev === 0 && depth === 0) { const m = s.match(/^"([^"]+)"\s*:/); if (m && m[1].toLowerCase() !== "factions") cur = m[1].toLowerCase(); }
    if (cur && prev === 0 && depth === 1) { inBlock = true; if (!order.includes(cur)) order.push(cur); }
  }
  return order;
}
function parseStratRel(text) {
  const out = {}; const add = (a, b, k) => { if (a === b) return; if (!out[a]) out[a] = []; out[a].push({ to: b, kind: k }); };
  for (const raw of text.split(/\r?\n/)) { if (/^\s*;/.test(raw)) continue; const m = raw.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i); if (!m) continue; const f = m[1].toLowerCase(), v = parseInt(m[2], 10), t = m[3].toLowerCase(); if (f === t) continue; const k = v <= 199 ? "ally" : v === 200 ? "neutral" : "war"; add(f, t, k); add(t, f, k); }
  return out;
}
function parseScriptRel(text) {
  const out = {}; const add = (a, b, k) => { if (a === b) return; if (!out[a]) out[a] = []; out[a].push({ to: b, kind: k }); };
  for (const raw of text.split(/\r?\n/)) { const s = raw.trim(); if (!s || s.startsWith(";")) continue; let m = s.match(/^console_command\s+become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i); if (m) { add(m[1].toLowerCase(), m[2].toLowerCase(), "protects"); add(m[2].toLowerCase(), m[1].toLowerCase(), "protected_by"); continue; } m = s.match(/^console_command\s+diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i); if (m) { const a = m[1].toLowerCase(), b = m[2].toLowerCase(), st = m[3].toLowerCase(); const k = st === "war" ? "war" : (st === "allied" || st === "alliance" ? "ally" : null); if (k) { add(a, b, k); add(b, a, k); } } }
  return out;
}
function buildGT(sr, cr, fo) {
  const gt = {}; const E = (f) => { if (!gt[f]) gt[f] = { allies: new Set(), wars: new Set(), protects: new Set(), protectedBy: new Set() }; return gt[f]; };
  for (const f of fo) E(f);
  for (const f of Object.keys(cr)) { const g = E(f); for (const e of cr[f]) { if (e.kind === "protects") g.protects.add(e.to); else if (e.kind === "protected_by") g.protectedBy.add(e.to); else if (e.kind === "war") g.wars.add(e.to); else if (e.kind === "ally") g.allies.add(e.to); } }
  for (const f of Object.keys(sr)) { const g = E(f); for (const e of sr[f]) { if (g.protects.has(e.to) || g.protectedBy.has(e.to)) continue; if (e.kind === "ally") g.allies.add(e.to); else if (e.kind === "war") g.wars.add(e.to); } }
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
    const r = buf.readUInt32LE(i + 48); if (r > 200) continue; if (i + 244 + 4 * r + 4 > buf.length) continue;
    out.push({ factionId: buf.readUInt8(i + 92 + 4 * r + 99) });
  }
  return out;
}
function collectZones(buf, fo) {
  const byName = {};
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4); if (count === 0 || count > 200) continue;
    const fid = buf[i - 53]; if (fid >= fo.length) continue; const name = fo[fid]; if (!name) continue;
    let ok = true; const entries = [];
    for (let k = 0; k < count; k++) { const o = i + 8 + k * 16; if (o + 16 > buf.length) { ok = false; break; } entries.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8) }); }
    if (!ok) continue;
    if (!byName[name] || byName[name].count < count) byName[name] = { name, count, entries, hasAtt5: entries.some((e) => e.att === 5) };
  }
  return byName;
}

const buf = fs.readFileSync(savePath);
const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
const gt = buildGT(parseStratRel(fs.readFileSync(DESCR_STRAT, "utf8")), parseScriptRel(fs.readFileSync(CAMPAIGN_SCRIPT, "utf8")), fo);
const treas = parseTreas(buf);
const majorNames = treas.map((t) => fo[t.factionId]).filter(Boolean);
const zones = collectZones(buf, fo);

console.log(`SAVE: ${path.basename(savePath)}\n`);

// (1) PLAYER class-2 = "discovered & not-friendly" hypothesis.
// seleucid GT: allies(10)+protects(4)+self+wars. Total discovered = count of
// player-zone entries (115). class5(neutral)=81. So non-neutral = 34.
// non-neutral breakdown class1=10 class2=19 class4=5. ally+prot = 15.
// remaining class2=19. GT war=4. So 15 of the 19 class-2 are NOT real wars.
console.log("=== (1) PLAYER class-2 analysis (seleucid) ===");
{
  const z = zones["seleucid"]; const g = gt["seleucid"];
  console.log(`  total zone entries: ${z.count}`);
  const clsH = {}; for (const e of z.entries) clsH[e.cls] = (clsH[e.cls] || 0) + 1;
  console.log(`  class hist: ${JSON.stringify(clsH)}`);
  console.log(`  GT: ally=${g.allies.size} war=${g.wars.size} protects=${g.protects.size}`);
  console.log(`  => class1(${clsH[1]}) == GT ally(${g.allies.size})? ${clsH[1] === g.allies.size}`);
  console.log(`  => class4(${clsH[4]}) ~= GT protect(${g.protects.size})? diff=${clsH[4] - g.protects.size}`);
  console.log(`  => class2(${clsH[2]}) vs GT war(${g.wars.size}): class2 is INFLATED by ${clsH[2] - g.wars.size}`);
  console.log(`  Interpretation: class2 = "hostile/negative attitude" bucket, NOT actual war.`);
}

// (2) Protectorate direction. romans_julii grants 6 protectorates. Check the
// protectorate factions' OWN zones for a reciprocal class.
console.log("\n=== (2) Protectorate DIRECTION ===");
const protPairs = []; // {protector, protectorate}
for (const raw of fs.readFileSync(CAMPAIGN_SCRIPT, "utf8").split(/\r?\n/)) {
  const s = raw.trim(); if (!s || s.startsWith(";")) continue;
  const m = s.match(/^console_command\s+become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
  if (m) protPairs.push({ protector: m[1].toLowerCase(), protectorate: m[2].toLowerCase() });
}
console.log(`  ${protPairs.length} protectorate pairs from script:`);
for (const p of protPairs) {
  const zr = zones[p.protector], zd = zones[p.protectorate];
  // class histograms
  const h = (z) => { if (!z) return "NO-ZONE"; const x = {}; for (const e of z.entries) x[e.cls] = (x[e.cls] || 0) + 1; return JSON.stringify(x) + (z.hasAtt5 ? " [PLAYER]" : ""); };
  console.log(`  ${p.protector} PROTECTS ${p.protectorate}`);
  console.log(`     protector zone class hist: ${h(zr)}`);
  console.log(`     protectorate zone class hist: ${h(zd)}`);
}

// (3) Best-rule aggregate for MAJOR factions only (the ones the app displays).
console.log("\n=== (3) MAJOR-FACTION decode w/ best per-stance NPC rule ===");
console.log("    (ally=class1, war=class2, protect=class0  -- for NPC zones)");
let tabExactAlly = 0, tabExactWar = 0, tabExactProt = 0, n = 0;
for (const name of [...new Set(majorNames)]) {
  const z = zones[name]; if (!z) continue; const g = gt[name]; if (!g) continue;
  if (z.hasAtt5) continue; // skip player here
  const ally = z.entries.filter((e) => e.cls === 1).length;
  const war = z.entries.filter((e) => e.cls === 2).length;
  const prot = z.entries.filter((e) => e.cls === 0).length;
  const gp = g.protects.size + g.protectedBy.size;
  n++;
  if (ally === g.allies.size) tabExactAlly++;
  if (war === g.wars.size) tabExactWar++;
  if (prot === gp) tabExactProt++;
  console.log(`  ${name.padEnd(16)} dec a=${ally} w=${war} p=${prot} | GT a=${g.allies.size} w=${g.wars.size} p=${gp}  ${prot === gp ? "PROT_OK" : ""} ${war === g.wars.size ? "WAR_OK" : ""}`);
}
console.log(`  EXACT: ally ${tabExactAlly}/${n}, war ${tabExactWar}/${n}, protect ${tabExactProt}/${n}`);
