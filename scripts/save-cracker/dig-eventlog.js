// Crack the in-save EVENT / MESSAGE LOG. Memory: the player record's HEAD
// sub-region holds a UTF-16 message log framed by sub-magic `f2 fe ff ff`,
// purged at turn-end (so mid-turn saves carry that turn's events). Goal: decode
// the framing into a structured list {type, text, ...} for a "recent events"
// feed.
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SAVES = [
  "save_Autosave   Spain   Turn 4.sav",          // war + siege happened this turn
  "save_Autosave   Spain   Turn 4 besiged corduba.sav",
  "save_t6.sav",
  "save_macedon t0.sav",
];
const FRAME = Buffer.from([0xf2, 0xfe, 0xff, 0xff]);

function readUtf16(buf, off, maxChars = 200) {
  // pstr16: u16 char-count then UTF-16LE
  if (off + 2 > buf.length) return null;
  const n = buf.readUInt16LE(off);
  if (n < 1 || n > maxChars || off + 2 + n * 2 > buf.length) return null;
  let s = "";
  for (let i = 0; i < n; i++) {
    const lo = buf[off + 2 + i * 2], hi = buf[off + 2 + i * 2 + 1];
    if (hi !== 0 || lo < 0x20 || lo > 0x7e) return null;
    s += String.fromCharCode(lo);
  }
  return { s, end: off + 2 + n * 2 };
}
// also try ASCII pstr16 (count then 1-byte chars)
function readAscii(buf, off, maxChars = 200) {
  if (off + 2 > buf.length) return null;
  const n = buf.readUInt16LE(off);
  if (n < 1 || n > maxChars || off + 2 + n > buf.length) return null;
  let s = "";
  for (let i = 0; i < n; i++) { const b = buf[off + 2 + i]; if (b < 0x20 || b > 0x7e) return null; s += String.fromCharCode(b); }
  return { s, end: off + 2 + n };
}

for (const name of SAVES) {
  let buf; try { buf = fs.readFileSync(DIR + name); } catch { console.log(`skip ${name}`); continue; }
  let p = 0, frames = 0;
  const samples = [];
  while ((p = buf.indexOf(FRAME, p)) !== -1) {
    frames++;
    if (samples.length < 12) {
      // try to read strings in the ~64 bytes after the frame, both encodings
      const found = [];
      for (let d = 4; d < 80; d++) {
        const a = readAscii(buf, p + d); if (a && a.s.length >= 4) { found.push(`A@+${d}:"${a.s}"`); d = a.end - (p) - 1; continue; }
        const u = readUtf16(buf, p + d); if (u && u.s.length >= 4) { found.push(`U@+${d}:"${u.s}"`); d = u.end - (p) - 1; continue; }
      }
      if (found.length) samples.push(`0x${p.toString(16)}: ${found.slice(0,4).join("  ")}`);
    }
    p += 4;
  }
  console.log(`\n=== ${name}: ${frames} f2feffff frames ===`);
  for (const s of samples) console.log("  " + s);
}
