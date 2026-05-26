// dig-diploenum-final.js
//
// Final consolidated verdict. Runs on both calibration saves and reports:
//  - Player zone (att==5) reliability per stance.
//  - NPC zone per-stance recoverability (exact-match% over factions with GT>0).
//  - Whether tag discriminates war.
//  - The recommended rule + its measured accuracy.
//
// Usage: node dig-diploenum-final.js

"use strict";
const fs = require("fs");
const SAVES = [
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
];
const DESCR_STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const CAMPAIGN_SCRIPT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt";
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
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
    for (let k = 0; k < count; k++) { const o = i + 8 + k * 16; if (o + 16 > buf.length) { ok = false; break; } entries.push({ cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) }); }
    if (!ok) continue;
    if (!byName[name] || byName[name].count < count) byName[name] = { name, count, entries, hasAtt5: entries.some((e) => e.att === 5) };
  }
  return byName;
}

const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
const gt = buildGT(parseStratRel(fs.readFileSync(DESCR_STRAT, "utf8")), parseScriptRel(fs.readFileSync(CAMPAIGN_SCRIPT, "utf8")), fo);

for (const sp of SAVES) {
  const buf = fs.readFileSync(sp);
  const zones = collectZones(buf, fo);
  const playerName = Object.keys(zones).find((n) => zones[n].hasAtt5);
  console.log(`\n#################### ${sp.split(/[\\/]/).pop()} ####################`);
  console.log(`player (att5 zone owner): ${playerName}`);

  // PLAYER zone class decode vs GT.
  const pz = zones[playerName], pg = gt[playerName];
  const pc = {}; for (const e of pz.entries) pc[e.cls] = (pc[e.cls] || 0) + 1;
  console.log(`PLAYER zone class hist=${JSON.stringify(pc)}  GT ally=${pg.allies.size} war=${pg.wars.size} prot=${pg.protects.size + pg.protectedBy.size}`);

  // Tag discrimination: tag values vs war.
  const tagVals = new Set(); for (const n of Object.keys(zones)) for (const e of zones[n].entries) tagVals.add(e.tag >>> 0);
  console.log(`distinct tag values (all zones): ${[...tagVals].map((t) => "0x" + t.toString(16)).join(", ")}`);

  // NPC per-stance exact-match% (GT>0 only).
  const npc = Object.keys(zones).filter((n) => !zones[n].hasAtt5 && gt[n]);
  const stExact = (counter, gtFn) => {
    const rel = npc.filter((n) => gtFn(gt[n]) > 0);
    let ex = 0; for (const n of rel) if (zones[n].entries.filter(counter).length === gtFn(gt[n])) ex++;
    return rel.length ? `${ex}/${rel.length} (${(100 * ex / rel.length).toFixed(0)}%)` : "n/a";
  };
  console.log(`NPC protect=class0 exact: ${stExact((e) => e.cls === 0, (g) => g.protects.size + g.protectedBy.size)}`);
  console.log(`NPC ally=class1 exact:    ${stExact((e) => e.cls === 1, (g) => g.allies.size)}`);
  console.log(`NPC ally=class0 exact:    ${stExact((e) => e.cls === 0, (g) => g.allies.size)}`);
  console.log(`NPC war=class2 exact:     ${stExact((e) => e.cls === 2, (g) => g.wars.size)}`);
}
