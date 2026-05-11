// Multi-save Leonidas position triangulation.
//
// Known sequence:
//   baseline (savestartsparta): (398, 337) region 1049
//   save_1.3: (400, 335) region 1072
//   save_1.4: (406, 329) region 1072
//   save_1.5: embarked on boat (position likely matches boat's tile)
//   save_1.6: (407, 320) region 446 (sea)
//
// We use 1.3 vs 1.4 as the cleanest pair (smallest state change: +6/-6 move).
// Then validate any candidate offset with the larger 1.3 vs 1.6 pair (407, 320).
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const v13 = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));
const v14 = fs.readFileSync(path.join(SAVE_DIR, "save_1.4.sav"));
const v15 = fs.readFileSync(path.join(SAVE_DIR, "save_1.5.sav"));
const v16 = fs.readFileSync(path.join(SAVE_DIR, "save_1.6.sav"));
console.log(`v13:${v13.length}  v14:${v14.length}  v15:${v15.length}  v16:${v16.length}`);
console.log(`Δ14-13:${v14.length - v13.length}  Δ15-14:${v15.length - v14.length}  Δ16-15:${v16.length - v15.length}\n`);

// Step 1: 1.3 vs 1.4 — find every offset where u16 changes 400→406 AND another
// nearby offset changes 335→329. (1.3 baseline → 1.4 variant)
function indexU16Eq(buf, value) {
  const out = [];
  for (let i = 0; i + 2 <= buf.length; i++) if (buf.readUInt16LE(i) === value) out.push(i);
  return out;
}

const v13_400 = indexU16Eq(v13, 400);
const v13_335 = indexU16Eq(v13, 335);
const v14_406 = new Set(indexU16Eq(v14, 406));
const v14_329 = new Set(indexU16Eq(v14, 329));
console.log(`v13: 400 hits=${v13_400.length}, 335 hits=${v13_335.length}`);
console.log(`v14: 406 hits=${v14_406.size}, 329 hits=${v14_329.size}`);

// For each 400-hit in v13, check if v14 has 406 at the same shift-aligned offset
// (small shift tolerance), and a 335→329 transition nearby.
const candidates = [];
for (const xOff of v13_400) {
  for (let s = -64; s <= 64; s++) {
    if (!v14_406.has(xOff + s)) continue;
    // check Y nearby
    for (let dy = -64; dy <= 64; dy++) {
      if (dy === 0) continue;
      const y13 = xOff + dy;
      if (y13 < 0 || y13 + 2 > v13.length) continue;
      if (v13.readUInt16LE(y13) !== 335) continue;
      const y14 = xOff + s + dy;
      if (y14 < 0 || y14 + 2 > v14.length) continue;
      if (v14_329.has(y14)) {
        candidates.push({ xOff, shift: s, yDelta: dy });
        break;
      }
    }
    if (candidates.find(c => c.xOff === xOff)) break;
  }
}
console.log(`\n*** v13→v14 candidates (X 400→406 AND Y 335→329 within ±64B): ${candidates.length} ***`);
for (const c of candidates.slice(0, 20)) {
  console.log(`  X@v13=0x${c.xOff.toString(16)}  shift=${c.shift}  yDelta=${c.yDelta}`);
}

// Step 2: validate each candidate against v13 vs v16 (X 400→407, Y 335→320)
const v16_407 = new Set(indexU16Eq(v16, 407));
const v16_320 = new Set(indexU16Eq(v16, 320));
console.log(`\nv16: 407 hits=${v16_407.size}, 320 hits=${v16_320.size}`);

const validated = [];
for (const c of candidates) {
  // The X offset in v16 may have a different shift than v14
  for (let s16 = -128; s16 <= 128; s16++) {
    const x16 = c.xOff + s16;
    if (!v16_407.has(x16)) continue;
    const y16 = x16 + c.yDelta;
    if (y16 < 0 || y16 + 2 > v16.length) continue;
    if (v16_320.has(y16)) {
      validated.push({ ...c, shift16: s16 });
      break;
    }
  }
}
console.log(`\n*** validated against v16 (X also 400→407, Y also 335→320 at same yDelta): ${validated.length} ***`);
for (const v of validated.slice(0, 10)) {
  console.log(`  CONFIRMED  X@v13=0x${v.xOff.toString(16)}  yDelta=${v.yDelta}  shift14=${v.shift}  shift16=${v.shift16}`);
  console.log(`           v13 X=${v13.readUInt16LE(v.xOff)} Y=${v13.readUInt16LE(v.xOff + v.yDelta)}`);
  console.log(`           v14 X=${v14.readUInt16LE(v.xOff + v.shift)} Y=${v14.readUInt16LE(v.xOff + v.shift + v.yDelta)}`);
  console.log(`           v16 X=${v16.readUInt16LE(v.xOff + v.shift16)} Y=${v16.readUInt16LE(v.xOff + v.shift16 + v.yDelta)}`);
}

// Step 3: also check baseline (398, 337) at the same offset
if (validated.length > 0) {
  const baseline = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
  console.log(`\n[also checking baseline ${baseline.length.toLocaleString()} bytes at same offset, with shift tolerance ±256]`);
  for (const v of validated.slice(0, 5)) {
    let matched = false;
    for (let sb = -256; sb <= 256; sb++) {
      const xB = v.xOff + sb;
      if (xB < 0 || xB + 2 > baseline.length) continue;
      if (baseline.readUInt16LE(xB) !== 398) continue;
      const yB = xB + v.yDelta;
      if (yB < 0 || yB + 2 > baseline.length) continue;
      if (baseline.readUInt16LE(yB) === 337) {
        console.log(`  baseline X=398 @ 0x${xB.toString(16)} (shift=${sb})  Y=337 @ 0x${yB.toString(16)} ✓`);
        matched = true;
        break;
      }
    }
    if (!matched) console.log(`  baseline @ ~0x${v.xOff.toString(16)}: no 398/337 within ±256 (Leonidas's baseline pos may not be there)`);
  }
}
