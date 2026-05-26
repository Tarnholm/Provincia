// dig-agent-posrec2.js
// Refine: agent coord record may use a fractional marker OTHER than 0x7fff.
// 1) Show coord-table records (0x7fff) that appear in base but not move (and v.v.)
// 2) Generalize: find records with x,y in valid range and ANY u16 marker at +16,
//    keyed by uuid; report appeared/disappeared/moved.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

function coordRecords(buf, requireMarker) {
  const map = new Map();
  for (let p = 0; p + 20 < buf.length; p++) {
    const mk = buf.readUInt16LE(p + 16);
    if (requireMarker && mk !== 0x7fff) continue;
    const x = buf.readUInt32LE(p + 8);
    const y = buf.readUInt32LE(p + 12);
    if (x < 1 || x > 510 || y < 1 || y > 510) continue;
    const uuid = buf.readUInt32LE(p);
    if (uuid === 0 || uuid === 0xffffffff || uuid < 0x10000) continue;
    if (!map.has(uuid)) map.set(uuid, { x, y, off: p, mk });
  }
  return map;
}

function report(aName, bName, label) {
  const a = load(aName), b = load(bName);
  console.log(`\n############ ${label} ############`);
  const ma = coordRecords(a, true), mb = coordRecords(b, true);
  // disappeared (in A not B)
  const gone = [], appeared = [];
  for (const [u, r] of ma) if (!mb.has(u)) gone.push({ u, r });
  for (const [u, r] of mb) if (!ma.has(u)) appeared.push({ u, r });
  console.log(`0x7fff recs A=${ma.size} B=${mb.size}`);
  console.log(`  DISAPPEARED (A only) x${gone.length}:`);
  for (const g of gone) console.log(`    uuid=${g.u} (${g.r.x},${g.r.y}) off=0x${g.r.off.toString(16)}`);
  console.log(`  APPEARED (B only) x${appeared.length}:`);
  for (const g of appeared) console.log(`    uuid=${g.u} (${g.r.x},${g.r.y}) off=0x${g.r.off.toString(16)}`);
}

report("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1 move spy.sav", "MOVE SPY");
report("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1move diplomat and army.sav", "MOVE DIPLOMAT");
