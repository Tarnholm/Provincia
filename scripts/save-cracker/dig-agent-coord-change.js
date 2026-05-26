// dig-agent-coord-change.js
// Among the diff runs between baseline and "move spy"/"move diplomat", find the
// ones that look like a coordinate move. The agent's live position record (per
// characterParser.buildPositionIndex / the 354-byte coord table) stores x,y as
// u32 in valid map range. A move changes x and/or y by a small delta.
// Strategy: scan every 4-byte position; if a[i] differs from b[i] AND both
// interpret as a plausible tile coord (1..510) with small delta, record it.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

function scan(aName, bName) {
  const a = load(aName), b = load(bName);
  const n = Math.min(a.length, b.length);
  console.log(`\n### ${bName}`);
  const hits = [];
  for (let i = 0; i + 4 <= n; i++) {
    const av = a.readUInt32LE(i), bv = b.readUInt32LE(i);
    if (av === bv) continue;
    if (av < 1 || av > 510 || bv < 1 || bv > 510) continue;
    const d = Math.abs(av - bv);
    if (d < 1 || d > 6) continue;
    hits.push({ i, av, bv, d });
  }
  // Group adjacent hits (x and y often 4 bytes apart)
  console.log(`  ${hits.length} coord-like u32 changes (range 1..510, delta 1..6)`);
  for (const h of hits) {
    // Check neighbour 4 bytes away for the paired coordinate
    let pair = "";
    const j = h.i + 4;
    if (j + 4 <= n) {
      const av2 = a.readUInt32LE(j), bv2 = b.readUInt32LE(j);
      pair = ` next(+4): A=${av2} B=${bv2}`;
    }
    const jb = h.i - 4;
    let prev = "";
    if (jb >= 0) {
      const av0 = a.readUInt32LE(jb), bv0 = b.readUInt32LE(jb);
      prev = ` prev(-4): A=${av0} B=${bv0}`;
    }
    console.log(`    @0x${h.i.toString(16)}: A=${h.av} B=${h.bv} (d=${h.d})${prev}${pair}`);
  }
}

scan("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1 move spy.sav");
scan("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1move diplomat and army.sav");
