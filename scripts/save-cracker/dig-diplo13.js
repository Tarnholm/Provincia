// dig-diplo13.js — dump the regions around the candidate diplomacy array.

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
  for (let i = 0; i < len; i += 32) {
    out += `+${(start - anchor + i).toString().padStart(5)}: `;
    for (let j = 0; j < 32 && i+j < len; j++) {
      out += buf[start+i+j].toString(16).padStart(2,'0');
      if (j%4===3) out += ' ';
    }
    out += "\n";
  }
  return out;
}

function probe(file, label) {
  const buf = fs.readFileSync(file);
  const majors = findMajors(buf);
  console.log(`\n=== ${label} player majors[0] ===`);
  for (let i = 0; i < majors.length; i++) {
    const off = majors[i];
    const N = buf.readUInt32LE(off + 48);
    // Print 64 bytes starting at +260 (where we saw 30-long u8 small-int array)
    console.log(`major[${i}] @0x${off.toString(16)} N=${N} treasury=${buf.readInt32LE(off)}`);
    console.log("  range +260..+340:");
    console.log(dumpHex(buf, off + 260, 80, off));
  }
}

probe("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav", "rome10");
probe("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav", "RoR-T1");
