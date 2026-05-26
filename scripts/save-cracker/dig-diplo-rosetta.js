// TURN-0 ROSETTA STONE: a turn-0 save's diplo section is the mod files compiled
// to binary. We know the complete turn-0 diplomacy (faction_relationships JSON).
// Align it against the zone class/attitude values, per faction, to TRANSLATE the
// enum: if "#entries with class==C" matches "#relations of kind K" for each
// faction, then class C means kind K.
const fs = require("fs");
const path = require("path");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const RELS = "C:\\dev\\Provincia\\public\\faction_relationships_large.json";

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}

const order = loadFactionOrder(SM_FACTIONS);
const rels = JSON.parse(fs.readFileSync(RELS, "utf8"));
const buf = fs.readFileSync(SAVE);

// Parse all zones: faction name + per-entry class/attitude.
const MARKER = 0x39240005;
const zones = {};
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4);
  if (count === 0 || count > 200) continue;
  const fid = buf.readUInt32LE(i - 53);     // CORRECTED: faction_id is u32 at M-53
  if (fid >= order.length) continue;
  const name = order[fid];
  if (!name) continue;
  let ok = true;
  const classCount = {}, attCount = {};
  for (let k = 0; k < count; k++) {
    const o = i + 8 + k * 16;
    if (o + 16 > buf.length) { ok = false; break; }
    const cls = buf.readUInt32LE(o + 4);
    const att = buf.readUInt32LE(o + 8);
    classCount[cls] = (classCount[cls] || 0) + 1;
    attCount[att] = (attCount[att] || 0) + 1;
  }
  if (!ok) continue;
  const tag0 = buf.readUInt32LE(i + 8 + 12);
  if (!zones[name] || zones[name].count < count) zones[name] = { count, classCount, attCount, isPlayer: tag0 === 0, marker: i };
}

// Mod-file relation kinds per faction.
function kindsOf(name) {
  const arr = rels[name] || [];
  const c = {};
  for (const r of arr) c[r.kind] = (c[r.kind] || 0) + 1;
  return c;
}

// Discover all kinds present.
const allKinds = new Set();
for (const name in rels) for (const r of rels[name]) allKinds.add(r.kind);
console.log("relation kinds in mod file:", [...allKinds].join(", "));

// CORRELATION: for each (class value, kind) pair, count factions where
// zone.classCount[class] === modfile.kindCount[kind] (exact per-faction match).
const classVals = [0, 1, 2, 4, 5];
const kinds = [...allKinds];
console.log("\n=== Per-faction EXACT match rate: zone #class==C  vs  modfile #kind==K ===");
console.log("(high % => that class value encodes that relation kind)");
const factionsWithZone = Object.keys(zones);
console.log(`factions with a zone: ${factionsWithZone.length}\n`);
const header = "class\\kind".padEnd(12) + kinds.map(k => k.padEnd(14)).join("");
console.log(header);
for (const cv of classVals) {
  let row = `class=${cv}`.padEnd(12);
  for (const k of kinds) {
    let exact = 0, total = 0;
    for (const name of factionsWithZone) {
      const zc = zones[name].classCount[cv] || 0;
      const mk = kindsOf(name)[k] || 0;
      if (mk > 0) { total++; if (zc === mk) exact++; }   // only score factions that HAVE this kind
    }
    const pct = total ? Math.round(100 * exact / total) : 0;
    row += `${exact}/${total}(${pct}%)`.padEnd(14);
  }
  console.log(row);
}

// Spot-check the clearest cases: majors with known protectorates.
console.log("\n=== Spot-check majors (zone class dist vs mod-file kinds) ===");
for (const name of ["romans_julii", "carthage", "seleucid", "antigonid", "ptolemaic", "macedon", "pontus"]) {
  if (!zones[name]) { console.log(`${name}: NO ZONE`); continue; }
  const z = zones[name];
  const mk = kindsOf(name);
  console.log(`${name}${z.isPlayer ? " [PLAYER]" : ""}: count=${z.count}  class=${JSON.stringify(z.classCount)}  att=${JSON.stringify(z.attCount)}`);
  console.log(`   mod-file: ${JSON.stringify(mk)}`);
}
