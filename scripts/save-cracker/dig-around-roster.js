// Dump a wider area BEFORE the antigonid roster looking for any
// section boundary or structural marker.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const ROSTER = 0x1517fe3;
// Dump 4KB before roster start
const START = ROSTER - 0x1000;
const END = ROSTER + 0x40;

console.log(`bytes 0x${START.toString(16)} .. 0x${END.toString(16)} (roster at 0x${ROSTER.toString(16)})\n`);

// Look for the LAST self-pointer signature before the roster
console.log("self-pointers in this range (u32 at p equals p):");
const selfPtrs = [];
for (let p = START; p < ROSTER; p++) {
  if (p + 4 > buf.length) break;
  if (buf.readUInt32LE(p) === p) {
    selfPtrs.push(p);
  }
}
for (const sp of selfPtrs) {
  const next4 = buf.readUInt32LE(sp + 4);
  console.log(`  0x${sp.toString(16)}  next4=0x${next4.toString(16)} (=${next4})`);
}

// Look for 'antigonid' or 'macedon' or any ASCII strings in this range
console.log("\nASCII strings (>=4 chars) in the 4KB before roster:");
let curStr = "";
let strStart = 0;
for (let p = START; p < ROSTER; p++) {
  const b = buf[p];
  if (b >= 0x20 && b <= 0x7e) {
    if (curStr === "") strStart = p;
    curStr += String.fromCharCode(b);
  } else {
    if (curStr.length >= 4) console.log(`  0x${strStart.toString(16)}: "${curStr}"`);
    curStr = "";
  }
}

// Now look 16KB further back to find a section start
console.log("\nself-pointers in 16KB before roster (offsets only):");
const wideStart = ROSTER - 0x4000;
for (let p = wideStart; p < ROSTER; p++) {
  if (p + 4 > buf.length) break;
  if (buf.readUInt32LE(p) === p) {
    process.stdout.write(`0x${p.toString(16)} `);
  }
}
console.log();
