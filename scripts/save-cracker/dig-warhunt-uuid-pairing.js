// dig-warhunt-uuid-pairing.js
// Hypothesis: each relationUuid in a diplo zone is one HALF of a relationship
// object shared by the two parties. If so, the SAME uuid should appear in
// exactly two factions' zones. Collect every (factionName, uuid, class, att)
// across ALL ~221 zones (via parseAllFactionDiplomacy's marker-53 owner logic)
// and see how often each uuid is shared.
"use strict";
const fs = require("fs");
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);

const MARKER = 0x39240005;
function collectZones(buf) {
  // Walk every marker, owner = buf[markerOff-53], collect entries.
  const zones = []; // {fid, name, off, entries:[{uuid,cls,att,tag}]}
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    if (fid >= order.length) continue;
    const name = order[fid];
    if (!name) continue;
    let ok = true; const entries = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      const tag = buf.readUInt32LE(o + 12);
      // sanity: tag should be 0 or 0x10101
      entries.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8), tag });
    }
    if (!ok) continue;
    zones.push({ fid, name, off: i, count, entries });
  }
  return zones;
}

const save = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);
const zones = collectZones(buf);
console.log(`${save}: ${zones.length} zones`);

// Dedup: keep highest-count zone per fid (parseAllFactionDiplomacy does this)
const byFid = new Map();
for (const z of zones) {
  if (!byFid.has(z.fid) || byFid.get(z.fid).count < z.count) byFid.set(z.fid, z);
}
console.log(`unique fids: ${byFid.size}`);

// Build uuid -> [ {name, cls, att, tag} ]
const uuidMap = new Map();
for (const z of byFid.values()) {
  for (const e of z.entries) {
    if (!uuidMap.has(e.uuid)) uuidMap.set(e.uuid, []);
    uuidMap.get(e.uuid).push({ name: z.name, fid: z.fid, cls: e.cls, att: e.att, tag: e.tag });
  }
}

// Distribution: how many zones each uuid appears in
const dist = {};
for (const [uuid, arr] of uuidMap) {
  dist[arr.length] = (dist[arr.length] || 0) + 1;
}
console.log("uuid appearance count distribution:", JSON.stringify(dist));

// Show some uuids that appear in exactly 2 zones — are the class/att consistent?
let shown = 0;
console.log("\nSample uuids appearing in exactly 2 zones:");
for (const [uuid, arr] of uuidMap) {
  if (arr.length !== 2) continue;
  console.log(`  uuid ${uuid}: ${arr.map(a => `${a.name}(cls=${a.cls},att=${a.att},tag=0x${a.tag.toString(16)})`).join("  <->  ")}`);
  if (++shown >= 25) break;
}
