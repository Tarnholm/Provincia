// dig-diploenum-groundtruth.js
//
// Build per-faction STARTING diplomacy ground truth from descr_strat
// (faction_relationships) + RIS_Campaign_Script (become_protector /
// diplomatic_stance), then compare each faction's save diplomacy ZONE's
// (class, attitude) distribution against the known counts.
//
// Turn-0 save => live == starting, the calibration case.
//
// Usage: node dig-diploenum-groundtruth.js [savePath]

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

// ── Faction declaration order (descr_sm_factions, blocks with "culture":) ────
function parseFactionOrder(text) {
  const lines = text.split(/\r?\n/);
  const order = [];
  let currentFaction = null;
  let braceDepth = 0;
  let wasInBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith(";")) continue;
    const prevDepth = braceDepth;
    for (const ch of s) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    if (wasInBlock && braceDepth === 0) { currentFaction = null; wasInBlock = false; }
    if (prevDepth === 0 && braceDepth === 0) {
      const fm = s.match(/^"([^"]+)"\s*:/);
      if (fm) {
        const name = fm[1].toLowerCase();
        if (name !== "factions") currentFaction = name;
      }
    }
    if (currentFaction && prevDepth === 0 && braceDepth === 1) {
      wasInBlock = true;
      if (!order.includes(currentFaction)) order.push(currentFaction);
    }
  }
  return order;
}

// descr_sm_factions blocks may use brace style. Fall back to a simpler scan:
// any top-level "<name>": line whose block contains "culture":.
function parseFactionOrderSimple(text) {
  const lines = text.split(/\r?\n/);
  const order = [];
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith(";")) continue;
    const fm = s.match(/^"([a-z0-9_]+)"\s*:/);
    if (fm && fm[1] !== "factions") { pending = fm[1].toLowerCase(); continue; }
    if (pending && /"culture"\s*:/.test(s)) {
      if (!order.includes(pending)) order.push(pending);
      pending = null;
    }
  }
  return order;
}

// ── Ground-truth relationships ──────────────────────────────────────────────
// descr_strat faction_relationships: <=199 ally, 200 neutral, >=201 war
function parseDescrStratRel(text) {
  const out = {}; // from -> [{to, kind, value}]
  const add = (a, b, kind, value) => {
    if (a === b) return;
    if (!out[a]) out[a] = [];
    out[a].push({ to: b, kind, value });
  };
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*;/.test(raw)) continue;
    const m = raw.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1].toLowerCase();
    const value = parseInt(m[2], 10);
    const to = m[3].toLowerCase();
    if (from === to) continue;
    const kind = value <= 199 ? "ally" : value === 200 ? "neutral" : "war";
    // symmetric: store both directions (the engine applies both)
    add(from, to, kind, value);
    add(to, from, kind, value);
  }
  return out;
}

// Script: become_protector <protector> <protectorate>; diplomatic_stance a b war|allied
function parseScriptRel(text) {
  const out = {};
  const add = (a, b, kind) => {
    if (a === b) return;
    if (!out[a]) out[a] = [];
    out[a].push({ to: b, kind });
  };
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith(";")) continue;
    let m = s.match(/^console_command\s+become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
    if (m) {
      const a = m[1].toLowerCase(), b = m[2].toLowerCase();
      add(a, b, "protects");      // a protects b
      add(b, a, "protected_by");  // b is protected by a
      continue;
    }
    m = s.match(/^console_command\s+diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i);
    if (m) {
      const a = m[1].toLowerCase(), b = m[2].toLowerCase(), st = m[3].toLowerCase();
      const kind = st === "war" ? "war" : (st === "allied" || st === "alliance" ? "ally" : null);
      if (kind) { add(a, b, kind); add(b, a, kind); }
      continue;
    }
  }
  return out;
}

// Build merged per-faction counts. Protectorate dominates ally/war for the
// pair (a faction you protect is not "at war"). Dedup by (to).
function buildGroundTruth(stratRel, scriptRel, factionOrder) {
  const gt = {}; // faction -> {allies:Set, wars:Set, protects:Set, protectedBy:Set}
  const ensure = (f) => {
    if (!gt[f]) gt[f] = { allies: new Set(), wars: new Set(), protects: new Set(), protectedBy: new Set() };
    return gt[f];
  };
  for (const f of factionOrder) ensure(f);
  // Apply script protectorates FIRST (they win over strat ally/war).
  for (const f of Object.keys(scriptRel)) {
    const g = ensure(f);
    for (const e of scriptRel[f]) {
      if (e.kind === "protects") g.protects.add(e.to);
      else if (e.kind === "protected_by") g.protectedBy.add(e.to);
      else if (e.kind === "war") g.wars.add(e.to);
      else if (e.kind === "ally") g.allies.add(e.to);
    }
  }
  // Apply strat ally/war, but skip pairs already a protectorate relation.
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

// ── Save zone parsing (replicate parseAllFactionDiplomacy + treasuries) ──────
const MARKER = 0x39240005;

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
    const factionId = buf.readUInt8(midBase + 99);
    out.push({ offset: i, regionCount: regions, factionId });
  }
  return out;
}

// Collect every diplomacy zone, owner = buf[markerOffset - 53].
function collectZones(buf, factionOrder) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    if (fid >= factionOrder.length) continue;
    const name = factionOrder[fid];
    if (!name) continue;
    let ok = true;
    const entries = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({
        uuid: buf.readUInt32LE(o),
        cls: buf.readUInt32LE(o + 4),
        att: buf.readUInt32LE(o + 8),
        tag: buf.readUInt32LE(o + 12),
      });
    }
    if (!ok) continue;
    zones.push({ markerOffset: i, fid, name, count, entries });
  }
  return zones;
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const buf = fs.readFileSync(savePath);
  const smText = fs.readFileSync(DESCR_SM_FACTIONS, "utf8");
  const stratText = fs.readFileSync(DESCR_STRAT, "utf8");
  const scriptText = fs.readFileSync(CAMPAIGN_SCRIPT, "utf8");

  let factionOrder = parseFactionOrderSimple(smText);
  if (factionOrder.length < 10) factionOrder = parseFactionOrder(smText);

  console.log(`SAVE: ${path.basename(savePath)}  (${buf.length} bytes)`);
  console.log(`factionOrder (${factionOrder.length}): ${factionOrder.join(", ")}`);
  console.log("");

  const stratRel = parseDescrStratRel(stratText);
  const scriptRel = parseScriptRel(scriptText);
  const gt = buildGroundTruth(stratRel, scriptRel, factionOrder);

  // Identify major (class-100) records & player.
  const treas = parseTreasuries(buf);
  const majorFids = new Set(treas.map((t) => t.factionId));
  const majorNames = new Set(treas.map((t) => factionOrder[t.factionId]).filter(Boolean));
  console.log(`Major (class-100) faction records: ${treas.length}`);
  console.log(`Major faction names: ${[...majorNames].join(", ")}`);

  const zones = collectZones(buf, factionOrder);
  // Dedup: keep highest-count zone per faction name.
  const zoneByName = {};
  for (const z of zones) {
    if (!zoneByName[z.name] || zoneByName[z.name].count < z.count) zoneByName[z.name] = z;
  }
  console.log(`Diplomacy zones found: ${zones.length}  (unique factions: ${Object.keys(zoneByName).length})`);
  console.log("");

  // Per-faction (class, attitude) histogram + ground-truth counts.
  // Print only factions present in ground truth so output stays focused.
  const allNames = new Set([...Object.keys(zoneByName), ...factionOrder]);

  // Tag-uniqueness check.
  const tagSet = new Set();
  for (const z of zones) for (const e of z.entries) tagSet.add(e.tag.toString(16));
  console.log(`Distinct tag values across ALL zones: ${[...tagSet].join(", ")}`);
  console.log("");

  // Build cross histogram for class and (class,attitude).
  function fmtHist(h) {
    return Object.entries(h).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ");
  }

  console.log("=== PER-FACTION: zone (class hist) | (class,att hist) | GROUND TRUTH ===");
  for (const name of factionOrder) {
    const z = zoneByName[name];
    const g = gt[name] || { allies: new Set(), wars: new Set(), protects: new Set(), protectedBy: new Set() };
    const gtStr = `ally=${g.allies.size} war=${g.wars.size} protects=${g.protects.size} protectedBy=${g.protectedBy.size}`;
    if (!z) {
      // factions with no zone but possibly ground truth
      if (g.allies.size + g.wars.size + g.protects.size + g.protectedBy.size > 0) {
        console.log(`${pad(name, 22)} [NO ZONE]                                  | ${gtStr}`);
      }
      continue;
    }
    const isMajor = majorNames.has(name);
    const clsHist = {};
    const caHist = {};
    for (const e of z.entries) {
      clsHist[e.cls] = (clsHist[e.cls] || 0) + 1;
      const k = `${e.cls},${e.att}`;
      caHist[k] = (caHist[k] || 0) + 1;
    }
    const caStr = Object.entries(caHist).sort().map(([k, v]) => `(${k}):${v}`).join(" ");
    console.log(
      `${pad(name, 22)} ${isMajor ? "[NPC]" : "[plr?]"} cls{${fmtHist(clsHist)}}`
    );
    console.log(`${" ".repeat(24)} ca{ ${caStr} }`);
    console.log(`${" ".repeat(24)} GT: ${gtStr}`);
  }

  // Aggregate: which (class) values exist & their global frequency.
  const globalCls = {};
  const globalCa = {};
  for (const name of Object.keys(zoneByName)) {
    for (const e of zoneByName[name].entries) {
      globalCls[e.cls] = (globalCls[e.cls] || 0) + 1;
      const k = `c${e.cls}/a${e.att}`;
      globalCa[k] = (globalCa[k] || 0) + 1;
    }
  }
  console.log("");
  console.log(`GLOBAL class freq: ${fmtHist(globalCls)}`);
  console.log(`GLOBAL (class/att) freq:`);
  for (const [k, v] of Object.entries(globalCa).sort()) console.log(`   ${k}: ${v}`);
}

function pad(s, n) { return (s + " ".repeat(n)).slice(0, n); }

main();
