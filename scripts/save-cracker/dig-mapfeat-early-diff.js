// dig-mapfeat-early-diff.js
// Shift-aware diff of ONLY the early body (manager region) where FORT_MANAGER /
// WATCHTOWER_MANAGER / ROAD_MANAGER are serialized (class ids 27/32/55, before
// SETTLEMENT=70 and CHARACTER=96). Report inserted runs there. A newly built
// fort/watchtower grows its manager list, so a small insertion should land here.
import fs from "node:fs";
import path from "node:path";
import { diffSmart } from "./diff.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const aName = process.argv[2] || "save_t0.sav";
const bName = process.argv[3] || "save_t7.sav";
const LIMIT = Number(process.argv[4] || 1.5 * 1024 * 1024); // bytes from body start

const aFull = fs.readFileSync(path.join(SAVE_DIR, aName));
const bFull = fs.readFileSync(path.join(SAVE_DIR, bName));

// body starts ~0x3bad; take a window from 0x3000 to 0x3000+LIMIT
const START = 0x3000;
const a = aFull.subarray(START, START + LIMIT);
const b = bFull.subarray(START, START + LIMIT);

const { runs, anchors } = diffSmart(a, b);
console.log(`Early-body diff ${aName} vs ${bName}, window 0x${START.toString(16)}+${LIMIT}`);
console.log(`anchors=${anchors.length} runs=${runs.length}`);

// All runs (these are localized changes/inserts in the manager region)
let shown = 0;
for (const r of runs) {
  const aLen = r.aEnd - r.aStart, bLen = r.bEnd - r.bStart;
  const net = bLen - aLen;
  const absStartB = START + r.bStart;
  // dump runs that are non-trivial
  if (aLen === 0 && bLen === 0) continue;
  if (shown >= 60) { console.log("... (truncated)"); break; }
  shown++;
  console.log(`\n[${shown}] B@0x${absStartB.toString(16)} aLen=${aLen} bLen=${bLen} net=${net>=0?'+':''}${net}`);
  // show up to 64 bytes of the B side
  const dn = Math.min(bLen, 64);
  for (let i = 0; i < dn; i += 4) {
    if (r.bStart + i + 4 > b.length) break;
    const u32 = b.readUInt32LE(r.bStart + i);
    const u16a = b.readUInt16LE(r.bStart + i), u16b = b.readUInt16LE(r.bStart + i + 2);
    const bytes = Array.from(b.subarray(r.bStart + i, r.bStart + i + 4)).map(x => x.toString(16).padStart(2, "0")).join(" ");
    const asc = Array.from(b.subarray(r.bStart + i, r.bStart + i + 4)).map(x => (x >= 0x20 && x <= 0x7e) ? String.fromCharCode(x) : ".").join("");
    console.log(`      +${String(i).padStart(3)}  ${bytes}  ${asc}  u32:${String(u32).padStart(11)}  u16:${u16a},${u16b}`);
  }
}
