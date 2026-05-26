// dig-econ-history-blocks.js
// BREAKTHROUGH: sub-record ordinal-0 (the self-ptr nearest the class-100 core)
// is a PER-TURN ECONOMY HISTORY. Each turn the save accumulates one more block.
//   T1: 1 block  (104 bytes)
//   T2: 2 blocks (196 bytes)
//   T3: 3 blocks (288 bytes)
//   T4: 4 blocks (380 bytes)
// Stride between blocks = 92 bytes (23 i32). Layout we need to confirm:
//   self-ptr(u32) | turnSerial(u32) | block0 | block1 | ... | tailCount | tail-selfptr
// This script locates ordinal-0 per turn (its OWN self-ptr), then splits the
// payload into 92-byte blocks and prints each block's 23 i32 fields ALIGNED by
// field index, so we can read off which field = treasury/income/expense.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

const bufs = {}, pr = {};
for (const t of turns) {
  bufs[t] = fs.readFileSync(path.join(BASE, FILES[t]));
  const recs = parseFactionTreasuries(bufs[t]);
  pr[t] = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
}

// Find ordinal-0 self-ptr (closest self-ptr before the core).
function ordinal0(buf, core) {
  for (let off = core - 4; off >= core - 4000; off -= 4) {
    if (off < 0) break;
    if (buf.readUInt32LE(off) === off) return off;
  }
  return -1;
}

console.log("ground treasury: T1=10000 T2=16833 T3=18271 T4=19693");
console.log("net delta:        --    +6833   +1438   +1422\n");

for (const t of turns) {
  const buf = bufs[t], core = pr[t].offset;
  const start = ordinal0(buf, core);
  const payloadStart = start + 4;          // skip self-ptr
  const serial = buf.readUInt32LE(start);  // == start
  const turnSerial = buf.readInt32LE(start + 4); // appears to be turn number?
  const totalLen = core - start;
  console.log(`\n########## ${t}  ordinal0 @0x${start.toString(16)} (Δcore=${start-core}) len=${totalLen} turnSerialField=${turnSerial} ##########`);

  // Read all i32 in the payload (after self-ptr) up to core.
  const fields = [];
  for (let o = start; o + 4 <= core; o += 4) fields.push(buf.readInt32LE(o));
  // fields[0] = selfptr-as-i32, fields[1] = turnSerial, then blocks.
  // Determine block layout: from the dump, block stride is 23 i32 starting at fields[2].
  // Trailer = last 2 i32 (count + tail-selfptr-ish 414337867).
  console.log(`raw i32 (${fields.length}): ${fields.join(" ")}`);

  // Split: header = fields[0..1]; trailer = last 1 (marker 414337867); middle = blocks of 23.
  const body = fields.slice(2, fields.length - 1);
  const trailer = fields.slice(fields.length - 1);
  const STRIDE = 23;
  const nBlocks = body.length / STRIDE;
  console.log(`header=[${fields[0]}(selfptr) ${fields[1]}]  trailer=[${trailer.join(" ")}]  bodyLen=${body.length} -> ${nBlocks} blocks of ${STRIDE}`);
  if (Number.isInteger(nBlocks)) {
    for (let b = 0; b < nBlocks; b++) {
      const blk = body.slice(b*STRIDE, (b+1)*STRIDE);
      console.log(`  block ${b}: ${blk.map((v,i)=>`f${i}=${v}`).join(" ")}`);
    }
  } else {
    console.log("  *** STRIDE 23 does not divide body evenly; trying other strides ***");
    for (const s of [22,23,24,46]) {
      if (body.length % s === 0) console.log(`     stride ${s} divides -> ${body.length/s} blocks`);
    }
  }
}
