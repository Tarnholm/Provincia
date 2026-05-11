// Read the bytes around the confirmed (x,y) pair to figure out the record
// layout. Show same range from baseline and variant7 side-by-side, with each
// 2-byte u16 + 4-byte u32 + 4-byte f32 interpretation, so the field structure
// pops out.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_1turnstart.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_7.sav"));

const aStart = 0x2d53b;
const bStart = 0x2d5bf;
// Show 64 bytes before and 96 after
const PRE = 64, POST = 96;

function annotate(buf, off) {
  const lines = [];
  for (let i = -PRE; i < POST; i += 4) {
    const o = off + i;
    if (o < 0 || o + 4 > buf.length) continue;
    const u16a = buf.readUInt16LE(o);
    const u16b = buf.readUInt16LE(o + 2);
    const u32 = buf.readUInt32LE(o);
    const f = buf.readFloatLE(o);
    const bytes = Array.from(buf.subarray(o, o + 4)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(buf.subarray(o, o + 4)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    const fStr = (Number.isFinite(f) && Math.abs(f) < 1e10 && Math.abs(f) > 1e-5) ? f.toExponential(3) : "—";
    const tag = i === 0 ? "← X" : i === 14 ? "← Y" : (i > 0 && i < 14) ? " mid" : "";
    lines.push(`Δ${String(i).padStart(4)}  ${bytes}  ${ascii.padEnd(4)}  u16:${String(u16a).padStart(6)},${String(u16b).padStart(6)}  u32:${String(u32).padStart(11)}  f32:${fStr.padStart(10)} ${tag}`);
  }
  return lines.join("\n");
}

console.log("=== BASELINE around 0x2d53b (X=921, Y=643) ===");
console.log(annotate(a, aStart));
console.log("\n=== VARIANT7 around 0x2d5bf (X=917, Y=645) ===");
console.log(annotate(b, bStart));

// Also show byte-level diff in this range
console.log("\n=== DIFF ===");
const range = PRE + POST;
for (let i = -PRE; i < POST; i++) {
  const ao = aStart + i, bo = bStart + i;
  if (ao < 0 || ao >= a.length || bo < 0 || bo >= b.length) continue;
  if (a[ao] !== b[bo]) {
    console.log(`  Δ${String(i).padStart(4)}  baseline=0x${a[ao].toString(16).padStart(2,"0")} (${a[ao]})  variant=0x${b[bo].toString(16).padStart(2,"0")} (${b[bo]})`);
  }
}
