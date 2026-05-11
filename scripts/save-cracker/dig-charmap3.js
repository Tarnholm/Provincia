// Diff every character across save pairs and find which characters CHANGE.
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

const A = process.argv[2] || "save_rome5..sav";
const B = process.argv[3] || "save_rome6.sav";

const a = fs.readFileSync(path.join(SAVES, A));
const b = fs.readFileSync(path.join(SAVES, B));
const recsA = cp.findCharacterRecords(a, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(b, nameLookup, traitNames, null);

console.log(`A=${A} chars=${recsA.length}`);
console.log(`B=${B} chars=${recsB.length}`);

// Match by primaryUuid + firstName + lastName
function key(r) { return `${r.primaryUuid}|${r.firstName}|${r.lastName}`; }
const idxA = new Map();
for (const r of recsA) idxA.set(key(r), r);

let changed = 0;
const changedChars = [];
for (const rb of recsB) {
  const ra = idxA.get(key(rb));
  if (!ra) continue;
  // Compare 600 bytes from record start
  let firstDiff = -1, totalDiff = 0;
  const span = Math.min(600, a.length - ra.offset, b.length - rb.offset);
  for (let d = -48; d < span; d++) {
    if (a[ra.offset + d] !== b[rb.offset + d]) {
      if (firstDiff < 0) firstDiff = d;
      totalDiff++;
    }
  }
  if (totalDiff > 0) {
    changedChars.push({ ra, rb, totalDiff, firstDiff });
    changed++;
  }
}
console.log(`# ${changed} characters with byte differences in record interior`);
changedChars.sort((x,y) => x.totalDiff - y.totalDiff);
for (const c of changedChars.slice(0, 30)) {
  console.log(`  ${c.ra.firstName} ${c.ra.lastName||""}  ageA=${c.ra.age} ageB=${c.rb.age}  tA=${c.ra.traits.length} tB=${c.rb.traits.length}  totalDiff=${c.totalDiff}  firstDiff=${c.firstDiff}  offA=0x${c.ra.offset.toString(16)} offB=0x${c.rb.offset.toString(16)}`);
}
