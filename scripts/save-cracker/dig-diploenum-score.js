// dig-diploenum-score.js
//
// Quantify how well candidate decoding RULES reproduce the known starting
// counts for each faction. Separates PLAYER zone (att==5 sentinel) from NPC
// zones. Tests several class/attitude mappings and reports match rate.
//
// Usage: node dig-diploenum-score.js [savePath]

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DEFAULT =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav";
const DESCR_STRAT =
  "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const CAMPAIGN_SCRIPT =
  "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt";
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const savePath = process.argv[2] || SAVE_DEFAULT;
const MARKER = 0x39240005;

function parseFactionOrderSimple(text) {
  // brace-depth walker (the "simple" regex fails on tab-indented file)
  const lines = text.split(/\r?\n/);
  const order = [];
  let currentFaction = null, braceDepth = 0, wasInBlock = false;
  for (const raw of lines) {
    const s = raw.trim();
    if (s.startsWith(";")) continue;
    const prevDepth = braceDepth;
    for (const ch of s) { if (ch === "{") braceDepth++; if (ch === "}") braceDepth--; }
    if (wasInBlock && braceDepth === 0) { currentFaction = null; wasInBlock = false; }
    if (prevDepth === 0 && braceDepth === 0) {
      const fm = s.match(/^"([^"]+)"\s*:/);
      if (fm) { const name = fm[1].toLowerCase(); if (name !== "factions") currentFaction = name; }
    }
    if (currentFaction && prevDepth === 0 && braceDepth === 1) {
      wasInBlock = true;
      if (!order.includes(currentFaction)) order.push(currentFaction);
    }
  }
  return order;
}

function parseDescrStratRel(text) {
  const out = {};
  const add = (a, b, kind) => { if (a === b) return; if (!out[a]) out[a] = []; out[a].push({ to: b, kind }); };
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*;/.test(raw)) continue;
    const m = raw.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1].toLowerCase(), value = parseInt(m[2], 10), to = m[3].toLowerCase();
    if (from === to) continue;
    const kind = value <= 199 ? "ally" : value === 200 ? "neutral" : "war";
    add(from, to, kind); add(to, from, kind);
  }
  return out;
}
function parseScriptRel(text) {
  const out = {};
  const add = (a, b, kind) => { if (a === b) return; if (!out[a]) out[a] = []; out[a].push({ to: b, kind }); };
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith(";")) continue;
    let m = s.match(/^console_command\s+become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
    if (m) { add(m[1].toLowerCase(), m[2].toLowerCase(), "protects"); add(m[2].toLowerCase(), m[1].toLowerCase(), "protected_by"); continue; }
    m = s.match(/^console_command\s+diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i);
    if (m) {
      const a = m[1].toLowerCase(), b = m[2].toLowerCase(), st = m[3].toLowerCase();
      const kind = st === "war" ? "war" : (st === "allied" || st === "alliance" ? "ally" : null);
      if (kind) { add(a, b, kind); add(b, a, kind); }
    }
  }
  return out;
}
function buildGT(stratRel, scriptRel, factionOrder) {
  const gt = {};
  const ensure = (f) => { if (!gt[f]) gt[f] = { allies: new Set(), wars: new Set(), protects: new Set(), protectedBy: new Set() }; return gt[f]; };
  for (const f of factionOrder) ensure(f);
  for (const f of Object.keys(scriptRel)) {
    const g = ensure(f);
    for (const e of scriptRel[f]) {
      if (e.kind === "protects") g.protects.add(e.to);
      else if (e.kind === "protected_by") g.protectedBy.add(e.to);
      else if (e.kind === "war") g.wars.add(e.to);
      else if (e.kind === "ally") g.allies.add(e.to);
    }
  }
  for (const f of Object.keys(stratRel)) {
    const g = ensure(f);
    for (const e of stratRel[f]) {
      if (g.protects.has(e.to) || g.protectedBy.has(e.to)) continue;
      if (e.kind === "ally") g.allies.add(e.to);
      else if (e.kind === "war") g.wars.add(e.to);
    }
  }
  return gt;
}

function parseTreasuries(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    if (i + 244 + 4 * regions + 4 > buf.length) continue;
    const midBase = i + 92 + 4 * regions;
    out.push({ offset: i, factionId: buf.readUInt8(midBase + 99) });
  }
  return out;
}

function collectZones(buf, factionOrder) {
  const byName = {};
  for (let i = 53; i + 8 < buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    if (fid >= factionOrder.length) continue;
    const name = factionOrder[fid];
    if (!name) continue;
    let ok = true; const entries = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    if (!byName[name] || byName[name].count < count) byName[name] = { markerOffset: i, fid, name, count, entries };
  }
  return byName;
}

function main() {
  const buf = fs.readFileSync(savePath);
  const factionOrder = parseFactionOrderSimple(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
  const gt = buildGT(parseDescrStratRel(fs.readFileSync(DESCR_STRAT, "utf8")),
                     parseScriptRel(fs.readFileSync(CAMPAIGN_SCRIPT, "utf8")), factionOrder);
  const treas = parseTreasuries(buf);
  const majorNames = new Set(treas.map((t) => factionOrder[t.factionId]).filter(Boolean));
  const zones = collectZones(buf, factionOrder);

  console.log(`SAVE: ${path.basename(savePath)}`);

  // Classify zone type: player zone = has any att==5 entry.
  const playerZones = [], npcZones = [];
  for (const name of Object.keys(zones)) {
    const z = zones[name];
    const hasAtt5 = z.entries.some((e) => e.att === 5);
    if (hasAtt5) playerZones.push(name); else npcZones.push(name);
  }
  console.log(`PLAYER-type zones (att==5 present): ${playerZones.join(", ")}`);
  console.log(`NPC-type zones: ${npcZones.length}`);
  console.log("");

  // ── PLAYER RULE: class is the stance. 1=ally, 4=protectorate, 2=war, 5=neutral.
  console.log("=== PLAYER ZONE RULE: class 1=ally 2=war 4=protectorate (5=neutral ignore) ===");
  for (const name of playerZones) {
    const z = zones[name];
    let ally = 0, war = 0, prot = 0, neu = 0, other = 0;
    for (const e of z.entries) {
      if (e.cls === 1) ally++;
      else if (e.cls === 2) war++;
      else if (e.cls === 4) prot++;
      else if (e.cls === 5 || e.cls === 0) neu++;
      else other++;
    }
    const g = gt[name] || { allies: new Set(), wars: new Set(), protects: new Set(), protectedBy: new Set() };
    console.log(`  ${name}: decoded ally=${ally} war=${war} prot=${prot} (neutral=${neu} other=${other})`);
    console.log(`     GT:   ally=${g.allies.size} war=${g.wars.size} protects=${g.protects.size} protectedBy=${g.protectedBy.size}`);
  }
  console.log("");

  // ── NPC RULE candidates. Test each and score against GT (ally/war/protect).
  // We test multiple hypotheses for how (class,att) map to stance.
  const rules = {
    // H1: class only — 0=protect, 1=ally, 2=war, 4=lockedAlly
    "H1 class: 0=prot 1=ally 2=war 4=ally": (e) =>
      e.cls === 0 ? "prot" : e.cls === 1 ? "ally" : e.cls === 2 ? "war" : e.cls === 4 ? "ally" : "neu",
    // H2: class 0 split by att — does att discriminate ally vs neutral within class 0?
    // attitude scale DS_: 0=allied,1=suspicious?,2=neutral,3=hostile,4=war... try att.
    "H2 att-as-stance: att 0..1=ally 2=neu 3..4=war (class ignored)": (e) =>
      e.att <= 1 ? "ally" : e.att === 2 ? "neu" : "war",
    // H3: combine — class 2 = war ALWAYS; class 0 = protectorate ALWAYS; class 1 = ceasefire; class 4 = locked ally.
    "H3 class: 0=prot 1=neu 2=war 4=ally": (e) =>
      e.cls === 0 ? "prot" : e.cls === 1 ? "neu" : e.cls === 2 ? "war" : e.cls === 4 ? "ally" : "neu",
    // H4: (class,att) pair — class0+att<=1 = ally else class0=neutral; class2 high att = war.
    "H4 pair": (e) => {
      if (e.cls === 4) return "ally";
      if (e.cls === 0) return e.att <= 1 ? "ally" : "neu";
      if (e.cls === 2) return e.att >= 2 ? "war" : "neu";
      return "neu";
    },
  };

  for (const [label, fn] of Object.entries(rules)) {
    let hit = 0, total = 0;
    const details = [];
    for (const name of npcZones) {
      const z = zones[name];
      const g = gt[name];
      if (!g) continue;
      let ally = 0, war = 0, prot = 0;
      for (const e of z.entries) {
        const s = fn(e);
        if (s === "ally") ally++; else if (s === "war") war++; else if (s === "prot") prot++;
      }
      // protectorate ground truth = protects + protectedBy (a faction "has" both kinds of protectorate links)
      const gtProt = g.protects.size + g.protectedBy.size;
      const okAlly = Math.abs(ally - g.allies.size) <= 1;
      const okWar = Math.abs(war - g.wars.size) <= 1;
      const okProt = Math.abs(prot - gtProt) <= 1;
      total += 3;
      if (okAlly) hit++;
      if (okWar) hit++;
      if (okProt) hit++;
      if (name === "romans_julii" || name === "antigonid" || name === "ptolemaic" || name === "bactria") {
        details.push(`     ${name}: dec ally=${ally} war=${war} prot=${prot} | GT ally=${g.allies.size} war=${g.wars.size} prot=${gtProt}`);
      }
    }
    console.log(`${label}`);
    console.log(`   match: ${hit}/${total} (${(100 * hit / total).toFixed(1)}%) across ${npcZones.length} NPC zones`);
    for (const d of details) console.log(d);
    console.log("");
  }
}

main();
