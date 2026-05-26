// dig-bloodline-leader-raw.js
//
// Dump the raw record bytes of a v1 "leader" to confirm whether tid=457
// (Factionleader) is genuinely stored, and whether the record is a real
// character or a name-pool/template artifact. Also count UNIQUE primaryUuids
// among the 211 leaders (duplicates => template/garbage).

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const MOD_DIR = "C:\\RIS\\RIS\\data";
const nameLookup = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitDeclOrder = [];
for (const line of fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitDeclOrder.push(tm[1]);
}

const argSave = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(path.join(SAVES, argSave));
console.log(`Save: ${argSave}\n`);

const v1 = findCharacterRecords(buf, nameLookup, traitDeclOrder, null);
const leaders = v1.filter(c => c.isLeader);
const heirs = v1.filter(c => c.isHeir);

// Unique primaryUuids among leaders
const uniqP = new Set(leaders.map(c => c.primaryUuid >>> 0));
console.log(`leaders=${leaders.length}, unique primaryUuid=${uniqP.size}`);
console.log(`heirs=${heirs.length}, unique primaryUuid=${new Set(heirs.map(c=>c.primaryUuid>>>0)).size}`);

// Are leaders+heirs ALWAYS co-occurring on the same records? Check overlap.
const both = v1.filter(c => c.isLeader && c.isHeir);
console.log(`records flagged BOTH leader AND heir: ${both.length}`);

// Offset spread of leaders — do they cluster in one zone (template pool) or
// spread across the whole character section?
const offs = leaders.map(c => c.offset).sort((a,b)=>a-b);
console.log(`leader offset range: 0x${offs[0].toString(16)} .. 0x${offs[offs.length-1].toString(16)}`);
// Gaps
let big = 0; for (let i=1;i<offs.length;i++) if (offs[i]-offs[i-1] > 0x10000) big++;
console.log(`leader records with >64KB gap to previous: ${big}`);

// Dump raw bytes of the first leader record (LAYOUT detection from parser)
const c = leaders[0];
console.log(`\n=== Raw dump: first leader ${c.firstName} ${c.lastName||""} @0x${c.offset.toString(16)} ===`);
console.log(`age=${c.age} infl=${c.influence} cmd=${c.command} traitCount=${c.traits.length}`);
console.log(`primaryUuid=0x${(c.primaryUuid>>>0).toString(16)} secondaryUuid=0x${(c.secondaryUuid>>>0).toString(16)}`);
const start = c.offset - 48;
for (let j = 0; j < 360; j += 16) {
  const off = start + j;
  const slice = buf.slice(off, off + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,"0")).join(" ");
  const asc = Array.from(slice).map(b => (b>=0x20&&b<0x7f)?String.fromCharCode(b):".").join("");
  const rel = off - c.offset;
  console.log(`  ${(rel>=0?"+":"")}${rel.toString().padStart(4)} 0x${off.toString(16)}: ${hex}  |${asc}|`);
}

// Show traits with their byte offsets so we can see if tid=457 is real
console.log(`\nTraits parsed:`);
for (const t of c.traits) console.log(`  tid=${t.id} ${t.name} pts=${t.points}`);
