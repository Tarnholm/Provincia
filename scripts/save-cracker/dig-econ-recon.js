// dig-econ-recon.js
// Foundational reconnaissance for FACTION_ECONOMICS (registry id 91, count 36).
//   1. Confirm ground-truth treasuries on the 4 arretium saves via parseFactionTreasuries.
//   2. Count class-100 records vs the registry's 36.
//   3. Read the registry FACTION_ECONOMICS entry directly.
//   4. Check the loadFactionOrder count (is 36 = number of factions?).

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries, parseHeader } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

const ARRETIUM = {
  T1: "save_arretium pre retrained..sav",
  T2: "save_arretium retrained turn 2.sav",
  T3: "save_arretium turn 3.sav",
  T4: "save_arretium turn 4.sav",
};
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8");
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order;
}

const order = loadFactionOrder(SM_FACTIONS);
console.log(`RIS descr_sm_factions order: ${order.length} factions`);
console.log("  " + order.map((f, i) => `${i}:${f}`).join("  "));

// Registry read for FACTION_ECONOMICS
function readRegistry(buf) {
  let p = 0x3310;
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString("latin1");
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, offset: p, name, count });
    p = end + 1;
  }
  return types;
}

for (const [tag, file] of Object.entries(ARRETIUM)) {
  const full = path.join(BASE, file);
  if (!fs.existsSync(full)) { console.log(`\n[${tag}] MISSING: ${file}`); continue; }
  const buf = fs.readFileSync(full);
  const recs = parseFactionTreasuries(buf);
  const types = readRegistry(buf);
  const fe = types.find(t => t.name === "FACTION_ECONOMICS");
  console.log(`\n===== [${tag}] ${file} (${(buf.length/1048576).toFixed(2)} MB) =====`);
  console.log(`  class-100 records: ${recs.length}   registry FACTION_ECONOMICS count=${fe ? fe.count : "?"} @0x${fe ? fe.offset.toString(16) : "?"}`);
  console.log(`  ground-truth treasury T${tag.slice(1)} = ${GROUND[tag]}`);
  // Which record (if any) has treasury == ground truth?
  const match = recs.filter(r => r.treasury === GROUND[tag]);
  if (match.length) {
    for (const m of match) console.log(`    >>> class-100 rec @0x${m.offset.toString(16)} treasury=${m.treasury} turnStart=${m.turnStartTreasury} factionId=${m.factionId}(${order[m.factionId]}) regions=${m.regionCount}`);
  } else {
    console.log(`    !!! NO class-100 record matches ground truth ${GROUND[tag]} (player record is elsewhere)`);
  }
  // Show treasuries of all class-100 records (these are NPC majors)
  console.log(`  all class-100 treasuries: ` + recs.map(r => `${order[r.factionId]||"?"}=${r.treasury}`).join(", "));
}
