// Find all positions where PRE has u32=0 and POST has u32=2.
// The diplomatic class field flips from 0 (peace) to 2 (war).
const fs = require("fs");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const PRE = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 Start.sav`);
const POST = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav`);

const minLen = Math.min(PRE.length, POST.length);

// Search for u32 transitions: 0 → 2
const transitions = [];
for (let p = 0; p + 4 < minLen; p += 1) {
  const pre = PRE.readUInt32LE(p);
  const post = POST.readUInt32LE(p);
  if (pre === 0 && post === 2) {
    transitions.push({ pos: p });
  }
}
console.log(`${transitions.length} positions where u32 went 0 → 2`);
for (const t of transitions.slice(0, 20)) {
  // Show 16 bytes around it in both
  const start = Math.max(0, t.pos - 8);
  const preHex = Array.from(PRE.slice(start, t.pos + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const postHex = Array.from(POST.slice(start, t.pos + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  0x${t.pos.toString(16)}:`);
  console.log(`    pre  (${start.toString(16)}): ${preHex}`);
  console.log(`    post (${start.toString(16)}): ${postHex}`);
}

// Also check reverse: any position where PRE=2 became POST=0 (cease war)
const reverseT = [];
for (let p = 0; p + 4 < minLen; p += 1) {
  const pre = PRE.readUInt32LE(p);
  const post = POST.readUInt32LE(p);
  if (pre === 2 && post === 0) {
    reverseT.push(p);
  }
}
console.log(`\n${reverseT.length} positions where u32 went 2 → 0`);

// Also: 1 → 2 (ceasefire → war)?
const oneTwoT = [];
for (let p = 0; p + 4 < minLen; p += 1) {
  const pre = PRE.readUInt32LE(p);
  const post = POST.readUInt32LE(p);
  if (pre === 1 && post === 2) {
    oneTwoT.push(p);
  }
}
console.log(`${oneTwoT.length} positions where u32 went 1 → 2`);
