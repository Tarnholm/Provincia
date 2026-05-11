// Wider sweep: for X = 398 → 400, find every offset in baseline and save_1.3
// in u16/u32/f32 widths. Then cross-correlate ANY pair where shift is small.
// Don't assume Y is at +14.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));

function findExact(buf, value, widths = ["u16", "u32"]) {
  const out = { u16: [], u32: [], f32: [], i16: [], i32: [] };
  for (let i = 0; i + 2 <= buf.length; i++) {
    if (widths.includes("u16") && buf.readUInt16LE(i) === value) out.u16.push(i);
    if (widths.includes("i16") && buf.readInt16LE(i) === value) out.i16.push(i);
  }
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (widths.includes("u32") && buf.readUInt32LE(i) === value) out.u32.push(i);
    if (widths.includes("i32") && buf.readInt32LE(i) === value) out.i32.push(i);
    if (widths.includes("f32")) {
      const f = buf.readFloatLE(i);
      if (Number.isFinite(f) && Math.abs(f - value) < 0.01) out.f32.push(i);
    }
  }
  return out;
}

const A398 = findExact(a, 398, ["u16", "u32", "f32"]);
const A337 = findExact(a, 337, ["u16", "u32", "f32"]);
const B400 = findExact(b, 400, ["u16", "u32", "f32"]);
const B335 = findExact(b, 335, ["u16", "u32", "f32"]);

console.log(`baseline: 398 → u16:${A398.u16.length} u32:${A398.u32.length} f32:${A398.f32.length}`);
console.log(`baseline: 337 → u16:${A337.u16.length} u32:${A337.u32.length} f32:${A337.f32.length}`);
console.log(`save_1.3: 400 → u16:${B400.u16.length} u32:${B400.u32.length} f32:${B400.f32.length}`);
console.log(`save_1.3: 335 → u16:${B335.u16.length} u32:${B335.u32.length} f32:${B335.f32.length}`);

// Cross-correlate u16 X 398→400 with shift tolerance, find pairs where the
// transition is at the same absolute offset (after small shift) AND there's
// a Y transition (337→335) at SOME nearby offset.
const a398Set = new Set(A398.u16);
const b400Set = new Set(B400.u16);
const a337Set = new Set(A337.u16);
const b335Set = new Set(B335.u16);

// X-only matches: positions where X=398 in baseline AND X=400 in save_1.3 at offset+shift
const xMatches = [];
for (const o of A398.u16) {
  for (let s = -512; s <= 512; s++) {
    if (b400Set.has(o + s)) {
      xMatches.push({ aOff: o, bOff: o + s, shift: s });
      break;
    }
  }
}
console.log(`\nX-only matches: ${xMatches.length} positions (u16 398→400 with shift)`);

// For each X-match, find the Y-transition (337→335) within ±64 bytes at the same shift
const yWindow = 64;
const fullMatches = [];
for (const xm of xMatches) {
  for (let dy = -yWindow; dy <= yWindow; dy++) {
    if (dy === 0) continue;
    const aY = xm.aOff + dy, bY = xm.bOff + dy;
    if (a337Set.has(aY) && b335Set.has(bY)) {
      fullMatches.push({ ...xm, yDelta: dy });
      break;
    }
  }
}
console.log(`\n*** FULL X+Y matches: ${fullMatches.length} ***`);
for (const m of fullMatches.slice(0, 20)) {
  console.log(`  X at baseline 0x${m.aOff.toString(16)} (save_1.3 0x${m.bOff.toString(16)}, shift=${m.shift})`);
  console.log(`  Y at baseline 0x${(m.aOff+m.yDelta).toString(16)}  (Y delta from X: ${m.yDelta} bytes)`);
}

// Also try with u32 width
const aX_u32 = new Set(A398.u32);
const bX_u32 = new Set(B400.u32);
const aY_u32 = new Set(A337.u32);
const bY_u32 = new Set(B335.u32);
const xMatches32 = [];
for (const o of A398.u32) {
  for (let s = -512; s <= 512; s++) {
    if (bX_u32.has(o + s)) {
      xMatches32.push({ aOff: o, bOff: o + s, shift: s });
      break;
    }
  }
}
console.log(`\nu32 X matches: ${xMatches32.length}`);
const fullMatches32 = [];
for (const xm of xMatches32) {
  for (let dy = -yWindow; dy <= yWindow; dy++) {
    if (dy === 0) continue;
    if (aY_u32.has(xm.aOff + dy) && bY_u32.has(xm.bOff + dy)) {
      fullMatches32.push({ ...xm, yDelta: dy });
      break;
    }
  }
}
console.log(`u32 full X+Y matches: ${fullMatches32.length}`);
for (const m of fullMatches32.slice(0, 10)) {
  console.log(`  X at baseline 0x${m.aOff.toString(16)} Y delta = ${m.yDelta} bytes`);
}

// And with f32 width
const aX_f = new Set(A398.f32);
const bX_f = new Set(B400.f32);
const aY_f = new Set(A337.f32);
const bY_f = new Set(B335.f32);
const xMatchesF = [];
for (const o of A398.f32) {
  for (let s = -512; s <= 512; s++) {
    if (bX_f.has(o + s)) { xMatchesF.push({ aOff: o, bOff: o + s, shift: s }); break; }
  }
}
console.log(`\nf32 X matches: ${xMatchesF.length}`);
const fullMatchesF = [];
for (const xm of xMatchesF) {
  for (let dy = -yWindow; dy <= yWindow; dy++) {
    if (dy === 0) continue;
    if (aY_f.has(xm.aOff + dy) && bY_f.has(xm.bOff + dy)) {
      fullMatchesF.push({ ...xm, yDelta: dy });
      break;
    }
  }
}
console.log(`f32 full X+Y matches: ${fullMatchesF.length}`);
