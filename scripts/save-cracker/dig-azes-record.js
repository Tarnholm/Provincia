// Walk the bytes around Azes's known X@0x2d53b in baseline. Goal: find the
// start of his full character record (work backward) and the stride to the
// next character (work forward). Validate by checking which surrounding
// bytes change in pair 5 (disband unit from Skyles' army — Skyles is a
// different Saka character) and pair 1 (recruit — also affects characters).
//
// Strategy:
//   - Scan ±4KB around 0x2d53b for: (a) value 13 (region_id for Sakaia,
//     where Azes lives), (b) value 45 (Azes's age from descr_strat),
//     (c) any other plausible character-record-y small ints
//   - Look for repeating record patterns: if the next character record is
//     N bytes later, we'd see a similar (validX, _, _, _, _, _, _, validY)
//     shape at offset 0x2d53b + N
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_1turnstart.sav"));
const AZES_X_OFF = 0x2d53b;

// (1) Hex-dump 256 bytes centered on Azes's X
const PRE = 96, POST = 160;
console.log(`=== ${PRE}B before to ${POST}B after AZES X (0x${AZES_X_OFF.toString(16)}) ===`);
for (let row = -PRE; row < POST; row += 8) {
  const o = AZES_X_OFF + row;
  if (o < 0 || o + 8 > a.length) continue;
  const bytes = Array.from(a.subarray(o, o + 8)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ascii = Array.from(a.subarray(o, o + 8)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
  const u16_0 = a.readUInt16LE(o);
  const u16_2 = a.readUInt16LE(o + 2);
  const u16_4 = a.readUInt16LE(o + 4);
  const u16_6 = a.readUInt16LE(o + 6);
  const u32   = a.readUInt32LE(o);
  const f     = a.readFloatLE(o);
  const fStr = (Number.isFinite(f) && Math.abs(f) > 1e-3 && Math.abs(f) < 1e6) ? f.toFixed(2) : "—";
  const tagX = (row === 0)  ? " ← X" : "";
  const tagY = (row === 14) ? " ← Y" : (row >= 8 && row <= 14 && (row & 1) === 0) ? "" : "";
  // Mark notable values: 921, 643, 13 (Sakaia), 45 (age), 4 (TurnsAlive)
  const notable = [];
  for (const [v, name] of [[921, "X=921"], [643, "Y=643"], [13, "rgn=13"], [45, "age=45"], [4, "turns=4"]]) {
    if (u16_0 === v) notable.push(`u16@0=${name}`);
    if (u16_2 === v) notable.push(`u16@2=${name}`);
    if (u16_4 === v) notable.push(`u16@4=${name}`);
    if (u16_6 === v) notable.push(`u16@6=${name}`);
  }
  const note = notable.length ? `  // ${notable.join(", ")}` : "";
  console.log(`Δ${String(row).padStart(4)}  0x${o.toString(16).padStart(8,"0")}  ${bytes}  ${ascii}  u16:${String(u16_0).padStart(5)}|${String(u16_2).padStart(5)}|${String(u16_4).padStart(5)}|${String(u16_6).padStart(5)}  u32:${String(u32).padStart(11)}  f32:${String(fStr).padStart(8)}${tagX}${tagY}${note}`);
}

// (2) Search for region_id=13 within ±2KB of Azes's X
console.log(`\n=== u16/u8 == 13 within ±2KB of Azes X ===`);
const range = 2048;
const lo = Math.max(0, AZES_X_OFF - range);
const hi = Math.min(a.length - 4, AZES_X_OFF + range);
for (let i = lo; i < hi; i++) {
  if (a[i] === 13 && a[i + 1] === 0) {
    // Could be u16=13. But filter: don't print every occurrence (there are tons).
    const u16 = a.readUInt16LE(i);
    if (u16 === 13) {
      // Print only if Δ is a "round" / "interesting" number relative to Azes
      const d = i - AZES_X_OFF;
      if (Math.abs(d) <= 256 || (Math.abs(d) <= 1024 && d % 8 === 0)) {
        const ctxA = a.readUInt16LE(Math.max(0, i - 2));
        const ctxB = a.readUInt16LE(Math.min(a.length - 4, i + 2));
        console.log(`  Δ=${String(d).padStart(5)}  u16@0x${i.toString(16)} = 13  (prev u16: ${ctxA}, next u16: ${ctxB})`);
      }
    }
  }
}

// (3) Look for the NEXT character record by searching forward for another
// u16le pair where (X, _12B_, Y) matches another Saka character's expected
// position. Saka characters from descr_strat with their descr_strat coords:
//   Spargapeithes, Azes, Amorges, Skunkha, Skyles
// We don't know the in-game coords of the others (descr_strat × ~2.10 is
// approximate). So instead: scan forward 4KB looking for ANY other character
// record by pattern (u16 X in [50,4000], 12 bytes, u16 Y in [50,2000]) where
// the values look "real" — and there's a 12-byte separation between
// X-positions of consecutive records.
console.log(`\n=== Forward scan: next plausible character record after Azes ===`);
let lastEnd = AZES_X_OFF + 16;
for (let probe = AZES_X_OFF + 16; probe < AZES_X_OFF + 4096; probe++) {
  const x = a.readUInt16LE(probe);
  if (x < 50 || x > 4000) continue;
  if (probe + 14 + 2 > a.length) break;
  const y = a.readUInt16LE(probe + 14);
  if (y < 50 || y > 2000) continue;
  // Filter out the dense overlapping cluster we saw earlier — only show if
  // there's a meaningful "gap" since the last printed entry.
  if (probe - lastEnd < 40) continue;
  console.log(`  @0x${probe.toString(16)} (Δ=+${(probe - AZES_X_OFF).toString().padStart(4)})  X=${x}, Y=${y}`);
  lastEnd = probe + 16;
  if (lastEnd > AZES_X_OFF + 4096) break;
}

// (4) Look at what changes between baseline and pair 1 (recruit Saka
// General) IN THE AZES NEIGHBORHOOD. The recruit happened in Sakon Taphai
// where Azes is — so his settlement's recruitment queue should change, and
// his "general here" status might too.
const b1 = fs.readFileSync(path.join(SAVE_DIR, "save_1turnchange.sav"));
console.log(`\n=== Bytes that differ in save_1turnchange (recruit) within ±256B of Azes X ===`);
let count = 0;
for (let d = -256; d <= 256; d++) {
  const o = AZES_X_OFF + d;
  if (o < 0 || o >= a.length || o >= b1.length) continue;
  if (a[o] !== b1[o]) {
    console.log(`  Δ=${String(d).padStart(4)}  baseline=0x${a[o].toString(16).padStart(2,"0")} → recruit=0x${b1[o].toString(16).padStart(2,"0")}`);
    count++;
    if (count > 30) { console.log(`  ...truncated`); break; }
  }
}
if (count === 0) console.log(`  (no diffs in this range — recruit affected a different region of the file)`);
