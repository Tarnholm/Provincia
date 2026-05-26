// dig-econ-gross-context.js
// The player's gross settlement income (6347/6339/6338/6539) appeared as a raw i32
// only in T3 (@0x10d411d) and T4 (@0x11fe11a, 0x129e451). Dump the full 36-i32
// neighbourhood around each hit (treat the hit as one of 36 econ fields; the record
// could START up to 35*4 bytes before). Look for a structure: a u32 self-ptr, a
// class tag, or 36 consecutive plausible economic ints. Cross-check by reading the
// SAME relative offsets in the other turns near the player faction record region.

const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function findAll(buf, v) { const out=[]; const t=Buffer.alloc(4); t.writeInt32LE(v); let p=0; while((p=buf.indexOf(t,p))!==-1){out.push(p);p++;} return out; }

const cases = [
  { tag: "T3", file: "save_arretium turn 3.sav", gross: 6338 },
  { tag: "T4", file: "save_arretium turn 4.sav", gross: 6539 },
];

for (const c of cases) {
  const buf = fs.readFileSync(path.join(BASE, c.file));
  const hits = findAll(buf, c.gross);
  console.log(`\n========== [${c.tag}] gross=${c.gross}: ${hits.length} hits ==========`);
  for (const h of hits) {
    console.log(`\n--- hit @0x${h.toString(16)} : dump i32 from -40*4 .. +20*4 ---`);
    for (let k = -40; k <= 20; k++) {
      const off = h + k*4;
      if (off < 0 || off+4 > buf.length) continue;
      const v = buf.readInt32LE(off);
      const mark = (k===0) ? "  <== GROSS" : "";
      // also show as f32 in case some fields are floats
      const fv = buf.readFloatLE(off);
      const fs_ = (Math.abs(fv) > 0.001 && Math.abs(fv) < 1e7) ? `  f32=${fv.toFixed(2)}` : "";
      console.log(`   ${String(k*4).padStart(5)} (0x${off.toString(16)}): ${String(v).padStart(12)}${mark}${fs_}`);
    }
  }
}
