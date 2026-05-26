// Resolve the turn/year conflict: read u32 turn@anchorEnd+5 and i32 @anchorEnd+9
// across known-turn saves. Does +9 track the campaign year (BC negative, stepping
// ~every 2 turns)?
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SAVES = ["save_t0.sav","save_t1.sav","save_t2.sav","save_t3.sav","save_t4.sav","save_t5.sav","save_t6.sav","save_t7.sav"];

function anchorEnd(buf) {
  // last UTF-16LE "descr_strat" in first 0x10000
  const needle = Buffer.from("d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0", "binary");
  let idx = -1, p = 0;
  const lim = Math.min(buf.length, 0x10000);
  while (true) { const f = buf.indexOf(needle, p); if (f === -1 || f > lim) break; idx = f; p = f + 2; }
  if (idx < 0) return -1;
  // walk to end of printable UTF-16 run
  let e = idx;
  while (e + 1 < buf.length && buf[e] >= 0x20 && buf[e] <= 0x7e && buf[e + 1] === 0) e += 2;
  return e;
}

for (const name of SAVES) {
  let buf; try { buf = fs.readFileSync(DIR + name); } catch { console.log(`${name}: missing`); continue; }
  const a = anchorEnd(buf);
  if (a < 0) { console.log(`${name}: no anchor`); continue; }
  const tag4 = buf[a + 4];
  const turn = buf.readUInt32LE(a + 5);
  const v9i = buf.readInt32LE(a + 9);
  const v9u = buf.readUInt32LE(a + 9);
  console.log(`${name.padEnd(14)} anchorEnd=0x${a.toString(16)} tag@+4=0x${tag4.toString(16)} turn@+5=${turn}  @+9 i32=${v9i} u32=${v9u}`);
}
