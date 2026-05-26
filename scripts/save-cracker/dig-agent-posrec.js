// dig-agent-posrec.js
// Position records have layout (per characterParser.buildPositionIndex):
//   -4  u32 == 6 or 4 (header)
//    0  u32 uuid (record key, stable across moves)
//    8  u32 x (1..510)
//   12  u32 y (1..510)
//   16  u16 0x7fff fractional marker (land) — actually buildPositionIndex used +58 for mp
// The 354-byte coord table (characterParser.buildSecUuidIndex) uses:
//    0  u32 secUuid
//    8  u32 x
//   12  u32 y
//   16  u16 0x7fff
//
// Build a uuid->(x,y,offset) map from BOTH the baseline and the move save using
// the 0x7fff coord-table signature, then report uuids whose coords changed by a
// small delta. That uuid is the agent that moved. Dump full record bytes for it.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

// Scan for coord records: +16 u16 == 0x7fff, x,y in range, key uuid at +0.
function coordRecords(buf) {
  const map = new Map(); // uuid -> {x,y,off}
  for (let p = 0; p + 20 < buf.length; p++) {
    if (buf.readUInt16LE(p + 16) !== 0x7fff) continue;
    const x = buf.readUInt32LE(p + 8);
    const y = buf.readUInt32LE(p + 12);
    if (x < 1 || x > 510 || y < 1 || y > 510) continue;
    const uuid = buf.readUInt32LE(p);
    if (uuid === 0 || uuid === 0xffffffff || uuid < 0x10000) continue;
    // keep first occurrence per uuid
    if (!map.has(uuid)) map.set(uuid, { x, y, off: p });
  }
  return map;
}

function compare(aName, bName, label) {
  const a = load(aName), b = load(bName);
  const ma = coordRecords(a), mb = coordRecords(b);
  console.log(`\n############ ${label} ############`);
  console.log(`base coord recs=${ma.size}  new coord recs=${mb.size}`);
  const moved = [];
  for (const [uuid, ra] of ma) {
    const rb = mb.get(uuid);
    if (!rb) continue;
    if (ra.x === rb.x && ra.y === rb.y) continue;
    const d = Math.abs(ra.x - rb.x) + Math.abs(ra.y - rb.y);
    moved.push({ uuid, a: ra, b: rb, d });
  }
  moved.sort((x, y) => x.d - y.d);
  console.log(`${moved.length} uuids with changed coords:`);
  for (const m of moved.slice(0, 40)) {
    console.log(`  uuid=${m.uuid} (0x${m.uuid.toString(16)}) (${m.a.x},${m.a.y})->(${m.b.x},${m.b.y}) d=${m.d}  offA=0x${m.a.off.toString(16)} offB=0x${m.b.off.toString(16)}`);
  }
  return { a, b, moved };
}

compare("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1 move spy.sav", "MOVE SPY");
compare("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1move diplomat and army.sav", "MOVE DIPLOMAT");
