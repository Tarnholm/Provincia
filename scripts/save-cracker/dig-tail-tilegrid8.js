// dig-tail-tilegrid8.js — Decode the 16-byte header before each settlement record.
// We observed: 53 f8 66 10 | 33 83 f4 01 | 28 01 00 00 | a2 01 00 00 | 02 00 00 00 | 00 00 80 bf | ff 0a af f0 ...
//
// The "ff 0a af f0" is the magic = 4 bytes.
// Before that:
//   [u32 = 0xbf800000 = float32 -1.0]
//   [u32 = 2]
//   [u32 = 418]    <-- Y
//   [u32 = 296]    <-- X (could be model id?)
//   [u32 = 0x1f48333 = selfPtr (the "third" selfptr - this is the section start)]
//   [u32 = 0x10 66 f8 53 = checksum/hash]
//
// Verify by walking records and reading X/Y.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function analyze(savePath, label) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} =====`);
  // Find all records via 'f0 0a af f0' magic followed by 0x3fc, 0x2bc
  const records = [];
  for (let p = 0x1f00000; p < buf.length - 16; p++) {
    if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
      const a = buf.readUInt32LE(p + 4);
      const b = buf.readUInt32LE(p + 8);
      if (a === 0x3fc && b === 0x2bc) {
        // The selfPtr pair is 8 bytes BEFORE the magic.
        records.push(p - 8);
      }
    }
  }
  console.log(`Records found: ${records.length}`);

  // For each, decode the header:
  // Walk back 24 bytes from p:
  //   [u32 = checksum (varies)]
  //   [u32 = pre-section-selfPtr (= p - 16)]
  //   [u32 = "X" or width]   <-- look at this
  //   [u32 = "Y" or height]  <-- look at this
  //   [u32 = some flag]
  //   [u32 = -1.0f]
  console.log(`First 20 records — decode header (-24..+0):`);
  for (let i = 0; i < Math.min(20, records.length); i++) {
    const p = records[i];
    // The header structure I suspect:
    //   p-24: u32 hash
    //   p-20: u32 pre-section selfPtr = p-16
    //   p-16: u32 X (or Width)
    //   p-12: u32 Y (or Height)
    //   p-8:  u32 flag
    //   p-4:  f32 -1.0
    //   p:    selfPtr
    //   p+4:  selfPtr+4
    //   p+8:  magic ff0aaff0
    //   p+12: 0x3fc
    //   p+16: 0x2bc
    const hash = buf.readUInt32LE(p - 24);
    const preSelfPtr = buf.readUInt32LE(p - 20);
    const x = buf.readUInt32LE(p - 16);
    const y = buf.readUInt32LE(p - 12);
    const flag = buf.readUInt32LE(p - 8);
    const f = buf.readFloatLE(p - 4);
    console.log(`  [${i}] @0x${p.toString(16)}: hash=0x${hash.toString(16)}, preSelfPtr=0x${preSelfPtr.toString(16)} (expected 0x${(p-20).toString(16)}), X=${x}, Y=${y}, flag=${flag}, f=${f.toFixed(2)}`);
  }

  // Also: count distinct X and Y values, and the most common
  const xs = [], ys = [];
  for (const p of records) {
    xs.push(buf.readUInt32LE(p - 16));
    ys.push(buf.readUInt32LE(p - 12));
  }
  console.log(`X range: ${Math.min(...xs)}..${Math.max(...xs)}, distinct: ${new Set(xs).size}`);
  console.log(`Y range: ${Math.min(...ys)}..${Math.max(...ys)}, distinct: ${new Set(ys).size}`);

  return { buf, records, xs, ys };
}

const r10 = analyze(ROME10, "rome10");
const rT1 = analyze(ROR_T1, "RoR-T1");

// Cross-save: for record i, is (X_rome10, Y_rome10) == (X_T1, Y_T1)?
console.log(`\n===== Cross-save X,Y comparison =====`);
const n = Math.min(r10.records.length, rT1.records.length);
let xMatch = 0, yMatch = 0, both = 0;
for (let i = 0; i < n; i++) {
  if (r10.xs[i] === rT1.xs[i]) xMatch++;
  if (r10.ys[i] === rT1.ys[i]) yMatch++;
  if (r10.xs[i] === rT1.xs[i] && r10.ys[i] === rT1.ys[i]) both++;
}
console.log(`X matches: ${xMatch}/${n}, Y matches: ${yMatch}/${n}, both: ${both}/${n}`);
