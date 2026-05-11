// Direct cross-correlation: find every byte offset where the value changes
// from 921 (baseline x) to 917 (variant7 x) AND simultaneously another offset
// changes from 643 to 645. Co-occurrence within ±64 bytes pinpoints the (x,y)
// pair = Azes's position field.
//
// Tests every numeric width (u8/i8, u16/i16le, u32/i32le, f32le).
// We don't need to find the "Azes" string — the value-pair signature is
// uniquely identifying.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_1turnstart.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_7.sav"));

console.log(`baseline: ${a.length.toLocaleString()} bytes  variant: ${b.length.toLocaleString()} bytes`);
console.log(`probe: 921→917 (Δx=-4) and 643→645 (Δy=+2)\n`);

// Index every offset in baseline where each width reads each target value
function indexValue(buf, value) {
  const u16 = [], u32 = [], i16 = [], i32 = [], f32 = [];
  for (let i = 0; i + 2 <= buf.length; i++) {
    if (buf.readUInt16LE(i) === value) u16.push(i);
    if (buf.readInt16LE(i) === value) i16.push(i);
  }
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === value) u32.push(i);
    if (buf.readInt32LE(i) === value) i32.push(i);
    const f = buf.readFloatLE(i);
    if (Number.isFinite(f) && Math.abs(f - value) < 0.001) f32.push(i);
  }
  return { u16, u32, i16, i32, f32 };
}

console.log("indexing baseline for 921, 643…");
const base921 = indexValue(a, 921);
const base643 = indexValue(a, 643);
console.log(`  921 baseline counts — u16:${base921.u16.length} u32:${base921.u32.length} f32:${base921.f32.length}`);
console.log(`  643 baseline counts — u16:${base643.u16.length} u32:${base643.u32.length} f32:${base643.f32.length}`);

console.log("indexing variant7 for 917, 645…");
const var917 = indexValue(b, 917);
const var645 = indexValue(b, 645);
console.log(`  917 variant counts  — u16:${var917.u16.length} u32:${var917.u32.length} f32:${var917.f32.length}`);
console.log(`  645 variant counts  — u16:${var645.u16.length} u32:${var645.u32.length} f32:${var645.f32.length}`);

// For each width, find offsets where:
//   - baseline reads 921 at offset O   AND
//   - variant7 reads 917 at the SAME offset (or very close, allowing for small shifts)
//   - AND a 643→645 pair exists within ±64 bytes
//
// Because save_7 is bigger (slight shift), we allow shift tolerance.
function pairCheck(widthName, baseX, varX, baseY, varY) {
  // Map of offset → present in varX
  const varSet = new Set(varX);
  // For each baseline offset of 921, check varX has 917 nearby
  const xMatches = [];
  for (const o of baseX) {
    // Allow shift up to ±256 bytes
    for (let s = 0; s <= 256; s++) {
      if (varSet.has(o + s)) { xMatches.push({ baseOff: o, varOff: o + s, shift: s }); break; }
      if (s > 0 && varSet.has(o - s)) { xMatches.push({ baseOff: o, varOff: o - s, shift: -s }); break; }
    }
  }
  console.log(`  ${widthName}: ${xMatches.length} positions where ${widthName}@O=baseX-value AND ${widthName}@O+shift=varX-value`);
  // For each, check baseY=643 within ±64 bytes of baseOff and varY=645 within ±64 of varOff
  const baseYSet = new Set(baseY);
  const varYSet = new Set(varY);
  const confirmed = [];
  for (const { baseOff, varOff, shift } of xMatches) {
    for (let dy = -64; dy <= 64; dy++) {
      if (dy === 0) continue;
      if (baseYSet.has(baseOff + dy) && varYSet.has(varOff + dy)) {
        confirmed.push({ baseOff, varOff, shift, yDelta: dy });
        break;
      }
    }
  }
  return confirmed;
}

console.log("\nlooking for x@O=921→917 AND y@O+dy=643→645 (dy ∈ ±64)…");
const widths = [
  { name: "u16", baseX: base921.u16, varX: var917.u16, baseY: base643.u16, varY: var645.u16 },
  { name: "u32", baseX: base921.u32, varX: var917.u32, baseY: base643.u32, varY: var645.u32 },
  { name: "f32", baseX: base921.f32, varX: var917.f32, baseY: base643.f32, varY: var645.f32 },
  { name: "i16", baseX: base921.i16, varX: var917.i16, baseY: base643.i16, varY: var645.i16 },
  { name: "i32", baseX: base921.i32, varX: var917.i32, baseY: base643.i32, varY: var645.i32 },
];
for (const w of widths) {
  const pairs = pairCheck(w.name, w.baseX, w.varX, w.baseY, w.varY);
  console.log(`  ${w.name}: ${pairs.length} CONFIRMED (x,y) pair location(s)`);
  for (const p of pairs.slice(0, 20)) {
    console.log(`    x at 0x${p.baseOff.toString(16)} (variant: 0x${p.varOff.toString(16)}, shift=${p.shift})  y at +${p.yDelta} bytes`);
  }
}
