// dig-agent-spyrec.js
// Spy record located: uuid=2482542527 at off 0x3b9ef in Turn1, moved (43,78)->(47,85).
// Diplomat candidates: 3005591593 (36,58), 82994962 (9,72) at ~0x3b8df/0x3b967.
// These three records sit adjacent (0x3b8df, 0x3b967, 0x3b9ef = stride 0x88=136).
// Dump these records' full bytes across all relevant saves + diff x/y/state.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

function hexrec(buf, off, len = 136) {
  const out = [];
  for (let i = 0; i < len; i += 16) {
    const row = [], asc = [];
    for (let j = 0; j < 16 && off + i + j < buf.length; j++) {
      const b = buf[off + i + j];
      row.push(b.toString(16).padStart(2, "0"));
      asc.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    out.push(`    +${(i).toString().padStart(3)}: ${row.join(" ").padEnd(48)} | ${asc.join("")}`);
  }
  return out.join("\n");
}

// Find a coord record by uuid (key at +0, 0x7fff at +16)
function findByUuid(buf, uuid) {
  const t = Buffer.alloc(4); t.writeUInt32LE(uuid);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (buf.readUInt16LE(p + 16) === 0x7fff) {
      const x = buf.readUInt32LE(p + 8), y = buf.readUInt32LE(p + 12);
      if (x >= 1 && x <= 510 && y >= 1 && y <= 510) return p;
    }
    p += 1;
  }
  return -1;
}

const SPY = 2482542527;
const DIP_A = 3005591593, DIP_B = 82994962;

const saves = {
  base: "save_17-05-2026   Spain   Turn 1.sav",
  spy: "save_17-05-2026   Spain   Turn 1 move spy.sav",
  dip: "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
};

for (const uuid of [SPY, DIP_A, DIP_B]) {
  console.log(`\n================ uuid=${uuid} (0x${uuid.toString(16)}) ================`);
  for (const [k, name] of Object.entries(saves)) {
    const buf = load(name);
    const off = findByUuid(buf, uuid);
    if (off < 0) { console.log(`  [${k}] NOT FOUND`); continue; }
    const x = buf.readUInt32LE(off + 8), y = buf.readUInt32LE(off + 12);
    console.log(`  [${k}] off=0x${off.toString(16)} coord=(${x},${y})`);
    console.log(hexrec(buf, off, 136));
  }
}
