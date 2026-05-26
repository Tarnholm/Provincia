// dig-charpath-verify.js
// Independent verification of the CHARACTER_PATHS crack claimed in
// dig-charpath-final.js. Dumps RAW bytes (no trusting the parser) around:
//   (a) the "CHARACTER_PATHS" registry name string,
//   (b) the spy path record header + leg bytes in BOTH spy & dip saves,
//   (c) the SAME offset in the STATIC save (must NOT be a path),
//   (d) the per-character record header self-pointer layout,
//   (e) the big non-waypoint changed runs (0x12267d, 0x420d6) to identify them.
import fs from "node:fs";
import path from "node:path";
import { hex, ascii } from "./loader.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const stat = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const spy  = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1 move spy.sav"));
const dip  = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1move diplomat and army.sav"));

function dump(buf, o, n, label) {
  console.log(`  ${label} @0x${o.toString(16)}:`);
  for (let r = 0; r < n; r += 16) {
    const off = o + r;
    console.log(`    0x${off.toString(16).padStart(6,"0")}  ${hex(buf, off, 16)}  |${ascii(buf, off, 16)}|`);
  }
}

// (a) registry name — find every "CHARACTER_PATHS" occurrence and show context
console.log("=== (a) CHARACTER_PATHS name string occurrences (static) ===");
{
  const needle = Buffer.from("CHARACTER_PATHS", "ascii");
  let from = 0, idx;
  while ((idx = stat.indexOf(needle, from)) !== -1) {
    // show the u32 count prefix before the name (registry format [u32 count][ASCIIZ name])
    const cnt = idx >= 4 ? stat.readUInt32LE(idx - 4) : null;
    console.log(`  @0x${idx.toString(16)}  preceding u32=${cnt}  ctx: ${ascii(stat, idx-4, 28)}`);
    from = idx + 1;
  }
}

// (b)/(c) spy path record — raw bytes. Final script says record header self-ptr
// is found by scanning back; path block starts at 0x3ba46 (spy) / 0x3bad2 (dip).
console.log("\n=== (b) spy save: bytes 0x3ba00..0x3bb00 (record header + path) ===");
dump(spy, 0x3ba00, 0x100, "spy");
console.log("\n=== (c) STATIC save: SAME window 0x3ba00..0x3bb00 (should be NO path) ===");
dump(stat, 0x3ba00, 0x100, "static");

// (d) decode the spy record header that the final script auto-found (hdr scan).
console.log("\n=== (d) spy record-header self-pointer search around 0x3ba46 ===");
{
  const o = 0x3ba46;
  for (let p = o; p > o - 0x140 && p >= 0; p--) {
    if (spy.readUInt32LE(p) === p && spy.readUInt32LE(p + 4) === p + 4) {
      console.log(`  header @0x${p.toString(16)}  selfptr ok`);
      console.log(`    +0  u32=0x${spy.readUInt32LE(p).toString(16)}  (==P)`);
      console.log(`    +4  u32=0x${spy.readUInt32LE(p+4).toString(16)}  (==P+4)`);
      console.log(`    +8  u32=${spy.readUInt32LE(p+8)}`);
      console.log(`    +12 u32 UUID=0x${spy.readUInt32LE(p+12).toString(16)}`);
      console.log(`    +16 u32=0x${spy.readUInt32LE(p+16).toString(16)}`);
      console.log(`    +20 u32 curX=${spy.readUInt32LE(p+20)}`);
      console.log(`    +24 u32 curY=${spy.readUInt32LE(p+24)}`);
      console.log(`    +28 u16=0x${spy.readUInt16LE(p+28).toString(16)}  +30 u16=0x${spy.readUInt16LE(p+30).toString(16)}`);
      console.log(`    +32 f32=${spy.readFloatLE(p+32)}`);
      console.log(`    distance header->pathBlock(0x3ba46) = ${o - p} bytes`);
      dump(spy, p, o - p + 16, "    full header");
      break;
    }
  }
}

// (e) what are the big NON-waypoint changed runs? identify by raw dump.
console.log("\n=== (e) spy big run @0x12267d (247b) — static vs spy ===");
dump(stat, 0x122640, 0x80, "static");
dump(spy,  0x122640, 0x80, "spy");

console.log("\n=== (e) dip big run @0x420d6 (152b) & @0x42aa8 (146b) — extended char blocks? ===");
dump(stat, 0x420c0, 0x60, "static");
dump(dip,  0x420c0, 0x60, "dip(@0x421d0 region)");

// (f) confirm cur (x,y) of each owner matches its leg0 src AND the agent's
//     known descr_strat / 354-coord position. Just re-print decoded coords.
console.log("\n=== (f) decoded current tiles per owner (from headers) ===");
function ownerCur(buf, pathOff) {
  for (let p = pathOff; p > pathOff - 0x140 && p >= 0; p--) {
    if (buf.readUInt32LE(p) === p && buf.readUInt32LE(p + 4) === p + 4) {
      return { hdr: p, uuid: buf.readUInt32LE(p+12), x: buf.readUInt32LE(p+20), y: buf.readUInt32LE(p+24) };
    }
  }
  return null;
}
console.log("  spy save spy   :", ownerCur(spy, 0x3ba46));
console.log("  dip save army  :", ownerCur(dip, 0x3b936));
console.log("  dip save diplo :", ownerCur(dip, 0x3ba26));
console.log("  dip save spy   :", ownerCur(dip, 0x3bad2));
