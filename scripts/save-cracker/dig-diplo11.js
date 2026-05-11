// dig-diplo11.js — keep dumping past the 16-byte stride array; look for a
// per-faction (20-21 element) array of small ints.

const fs = require("fs");

function findMajors(buf) {
  const out = [];
  for (let i = 0x3000; i + 56 < buf.length; i += 4) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    out.push(i);
  }
  return out.sort((a, b) => a - b);
}

function dumpHex(buf, start, len, anchor=0) {
  let out = "";
  for (let i = 0; i < len; i += 16) {
    out += `+${(start - anchor + i).toString().padStart(5)}: `;
    for (let j = 0; j < 16 && i+j < len; j++) {
      out += buf[start+i+j].toString(16).padStart(2,'0') + " ";
    }
    out += "  ";
    for (let j = 0; j < 16 && i+j < len; j++) {
      const c = buf[start+i+j];
      out += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : ".";
    }
    out += "\n";
  }
  return out;
}

const SAVE_R10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

const buf = fs.readFileSync(SAVE_R10);
const bufR = fs.readFileSync(SAVE_ROR);

// Player records (smallest offset)
const playerR10 = findMajors(buf)[0];
const playerR = findMajors(bufR)[0];

// In rome10: count=34, array starts ~+340 from rlEnd's base, ends at +340+34*16 = +884
// Let me get the actual offsets

function postArrayDump(buf, off, label) {
  const N = buf.readUInt32LE(off + 48);
  const rlEnd = off + 52 + 4 * N;
  let arrStart = -1, count = -1;
  for (let i = rlEnd; i < rlEnd + 1024; i++) {
    if (buf[i] === 0x24 && buf[i+1] === 0x39) {
      count = buf.readUInt32LE(i + 2);
      arrStart = i + 6;
      break;
    }
  }
  const arrEnd = arrStart + count * 16;
  console.log(`\n=== ${label} player @ 0x${off.toString(16)} count=${count} arrayEnds @ +${arrEnd-off} ===`);
  console.log(dumpHex(buf, arrEnd, 768, off));
}

postArrayDump(buf, playerR10, "rome10");
postArrayDump(bufR, playerR, "RoR-T1");
