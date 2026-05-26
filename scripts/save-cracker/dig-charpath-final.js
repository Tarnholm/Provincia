// dig-charpath-final.js  —  DELIVERABLE reference parser for CHARACTER_PATHS
// =============================================================================
// CRACKED 2026-05-22 (vanilla classic 1.3 MB Spain saves).
//
// WHERE: The body root's first child section is named "CHARACTER_PATHS" (name
//        string in the header section-type registry at 0x000d7f). The live
//        character records (one per movable agent/army) live at the very start
//        of the body root (~0x3b900 in these saves). Each record holds the
//        agent's current (x,y) plus, IF the agent has a pending multi-turn move
//        order, an inline waypoint route.
//
// PER-CHARACTER RECORD (relevant fields, little-endian):
//   +0   u32  self-pointer (== record offset P)            [record anchor]
//   +4   u32  self-pointer + 4 (== P+4)
//   +8   u32  small enum (0,2,6 seen — char/agent class?)
//   +12  u32  OWNER UUID (stable per character across saves; 0x93f897bf = spy)
//   +16  u32  forward pointer (next sibling-ish)
//   +20  u32  CURRENT x tile
//   +24  u32  CURRENT y tile
//   +28  u16  fractional pos (0x7fff mid-tile when idle; 0x0000 after move)
//   +30  u16  flag (0x0001)
//   +32  f32  0.5  (constant 00 80 3f)
//   ...  fixed state block (ff ff ff ff sentinels, a state float, 0x19 const)...
//
// PATH BLOCK (present ONLY when the agent has a queued move; absent in the
// static turn-1 save -> proves paths are stored only for in-flight orders):
//   [u8  legCount]                       number of route legs (1..N)
//   legCount × LEG, where LEG =
//     [u32 count]                        number of waypoint tiles in this leg
//     count × ( u32 x, u32 y )           tile coords, chebyshev-adjacent step
//   [u8 0x01][u8 0x00]                   path-record terminator
//   ...immediately followed by the next character record's UUID anchor.
//
// Semantics:
//   - leg[k].dest == leg[k+1].src  (legs are a continuous waypoint-chained route)
//   - leg[0].src == the agent's CURRENT tile (+20/+24)
//   - FINAL DESTINATION = last point of the last leg
//   - Multi-leg = the player shift/right-clicked several waypoints; the engine
//     stores each click-segment as its own leg.
//
// VALIDATION (this script): the spy's 105-byte path record is byte-identical in
// BOTH the "move spy" save and the later "move diplomat and army" save; the
// static save has zero path records.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { hex } from "./loader.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const FILES = {
  static: "save_17-05-2026   Spain   Turn 1.sav",
  spy:    "save_17-05-2026   Spain   Turn 1 move spy.sav",
  dip:    "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
};

// Parse one path block (legCount + legs). Returns null if it doesn't validate.
function parsePathBlock(buf, o) {
  const legCount = buf.readUInt8(o);
  if (legCount < 1 || legCount > 8) return null;
  let p = o + 1;
  const legs = [];
  for (let k = 0; k < legCount; k++) {
    if (p + 4 > buf.length) return null;
    const count = buf.readUInt32LE(p);
    if (count < 1 || count > 200 || p + 4 + count * 8 > buf.length) return null;
    const pts = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const b = p + 4 + i * 8;
      const x = buf.readUInt32LE(b), y = buf.readUInt32LE(b + 4);
      if (x > 1000 || y > 1000) { ok = false; break; }
      if (i > 0 && (Math.abs(x - pts[i-1][0]) > 1 || Math.abs(y - pts[i-1][1]) > 1)) { ok = false; break; }
      pts.push([x, y]);
    }
    if (!ok) return null;
    legs.push({ count, pts });
    p = p + 4 + count * 8;
  }
  if (legs.length !== legCount) return null;
  // continuity check
  for (let k = 1; k < legs.length; k++) {
    const a = legs[k-1].pts[legs[k-1].count-1], b = legs[k].pts[0];
    if (a[0] !== b[0] || a[1] !== b[1]) return null;
  }
  return { legCount, legs, end: p, destination: legs[legs.length-1].pts.slice(-1)[0] };
}

// Generic enumerator: scan the body-root path region for path blocks whose
// preceding 8 bytes look like a character-record current (x,y) == leg0.src.
function enumeratePaths(buf, lo = 0x3b800, hi = 0x44000) {
  const out = [];
  for (let o = lo; o < hi; o++) {
    const blk = parsePathBlock(buf, o);
    if (!blk) continue;
    // require trailing 01 00 terminator
    if (buf[blk.end] !== 0x01 || buf[blk.end + 1] !== 0x00) continue;
    // owner: the record self-pointer header sits before; find it (u32(P)==P && u32(P+4)==P+4)
    let hdr = null;
    for (let p = o; p > o - 0x140 && p >= 0; p--) {
      if (buf.readUInt32LE(p) === p && buf.readUInt32LE(p + 4) === p + 4) { hdr = p; break; }
    }
    const uuid = hdr !== null ? buf.readUInt32LE(hdr + 12) : null;
    const curX = hdr !== null ? buf.readUInt32LE(hdr + 20) : null;
    const curY = hdr !== null ? buf.readUInt32LE(hdr + 24) : null;
    out.push({ off: o, hdr, uuid, curX, curY, ...blk });
    o = blk.end; // skip past
  }
  // de-dup overlaps
  return out;
}

for (const [label, fname] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, fname));
  console.log(`\n========== ${label}  (${buf.length} bytes) ==========`);
  const paths = enumeratePaths(buf);
  console.log(`pending move-order records found: ${paths.length}`);
  for (const p of paths) {
    const ownerOk = p.curX === p.legs[0].pts[0][0] && p.curY === p.legs[0].pts[0][1];
    console.log(`  rec@0x${p.off.toString(16)} owner=0x${(p.uuid||0).toString(16).padStart(8,"0")} cur=(${p.curX},${p.curY}) legs=${p.legCount} dest=(${p.destination[0]},${p.destination[1]}) curMatchesLeg0Src=${ownerOk}`);
    p.legs.forEach((leg, i) => {
      console.log(`     leg${i}: ${leg.pts.map(pt=>`(${pt[0]},${pt[1]})`).join(" ")}`);
    });
  }
}

// Cross-save proof: spy path bytes identical in spy save and dip save.
const spy = fs.readFileSync(path.join(SAVE_DIR, FILES.spy));
const dip = fs.readFileSync(path.join(SAVE_DIR, FILES.dip));
const spyBlock = spy.subarray(0x3ba46, 0x3baaf);
const dipSpyBlock = dip.subarray(0x3bad2, 0x3bb3b);
console.log(`\n=== cross-save proof: spy 105-byte path block identical in both saves? ${spyBlock.equals(dipSpyBlock)} ===`);
