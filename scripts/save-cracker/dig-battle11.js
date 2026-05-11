// dig-battle11.js — Session 31: locate event log + count diff between save_1 and save_3.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

// Per sessions 25/26/27, event log starts at 0x51b5 with 12-byte stride;
// length prefix at 0x51b1. Should be common across imperial_campaign saves.
function summarize(buf, label) {
  const LOG_START = 0x51b5;
  const len = buf.readUInt32LE(LOG_START - 4);
  console.log(`\n=== ${label}: log count=${len} ===`);

  // Find append zone: per session 27 in rome10 at offset 0x2e4e9 = record index (0x2e4e9 - 0x51b5)/12 = 13784.
  // But save_1/save_3 may have different counts. Let's locate the transition where idA=0 first appears.
  // Or rather: locate the first record where idB suddenly drops back to a low value.
  let appendStart = -1;
  let prevIdB = 0;
  for (let k = 0; k < len; k++) {
    const off = LOG_START + k * 12;
    const idB = buf.readUInt32LE(off + 8);
    const idA = buf.readUInt16LE(off + 6);
    if (k > 100 && idB < 100 && idB < prevIdB - 50 && idA === 0 && appendStart === -1) {
      appendStart = k;
      console.log(`  Append zone starts at index ${k} (0x${off.toString(16)}): idB=${idB}`);
      break;
    }
    prevIdB = idB;
  }
  return { len, appendStart };
}

const A = summarize(bA, "save_1");
const B = summarize(bB, "save_3");

// Dump the append zones (last ~100 records each)
function dumpAppendZone(buf, len, label, appendStart) {
  const start = appendStart >= 0 ? appendStart : Math.max(0, len - 100);
  console.log(`\n=== ${label} append zone @ ${start}..${len} ===`);
  for (let k = start; k < len; k++) {
    const off = 0x51b5 + k * 12;
    const hash = buf.readUInt32LE(off);
    const flag = buf.readUInt8(off + 4);
    const sub = buf.readUInt8(off + 5);
    const idA = buf.readUInt16LE(off + 6);
    const idB = buf.readUInt32LE(off + 8);
    console.log(`  [${k}] @0x${off.toString(16)} hash=0x${hash.toString(16).padStart(8,'0')} f=${flag} s=0x${sub.toString(16).padStart(2,'0')} idA=${idA} idB=${idB}`);
  }
}

dumpAppendZone(bA, A.len, "save_1", A.appendStart);
dumpAppendZone(bB, B.len, "save_3", B.appendStart);
