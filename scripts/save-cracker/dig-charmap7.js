// For each suspect offset, sample values from many characters and look for
// patterns (constant-stride increments, age-correlated, trait-count correlated, etc.)
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const A = process.argv[2] || "save_rome6.sav";
const B = process.argv[3] || "save_rome7.sav";
const a = fs.readFileSync(path.join(SAVES, A));
const b = fs.readFileSync(path.join(SAVES, B));
const recsA = cp.findCharacterRecords(a, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(b, nameLookup, traitNames, null);
function key(r) { return `${r.primaryUuid}|${r.firstName}|${r.lastName}`; }
const ia = new Map();
for (const r of recsA) ia.set(key(r), r);

const offsets = [102, 106, 118, 119, 122, 158, 170, 178, 179, 218, 222, 250, 254, 298];

for (const off of offsets) {
  console.log(`\n## rel +${off}`);
  // Read u8 + u16le + u32le and sample first 8 chars that change
  let n = 0;
  const samples = [];
  for (const rb of recsB) {
    const ra = ia.get(key(rb));
    if (!ra) continue;
    if (a[ra.offset + off] === b[rb.offset + off]) continue;
    if (n++ >= 8) break;
    const u8a = a[ra.offset + off];
    const u8b = b[rb.offset + off];
    const u16a = a.readUInt16LE(ra.offset + off);
    const u16b = b.readUInt16LE(rb.offset + off);
    const u32a = a.readUInt32LE(ra.offset + off);
    const u32b = b.readUInt32LE(rb.offset + off);
    const f32a = a.readFloatLE(ra.offset + off);
    const f32b = b.readFloatLE(rb.offset + off);
    const ageDelta = rb.age - ra.age;
    const tDelta = rb.traits.length - ra.traits.length;
    samples.push({
      name: `${ra.firstName} ${ra.lastName||""}`,
      u8a, u8b, u16a, u16b, u32a, u32b, f32a, f32b, ageDelta, tDelta,
      ageA: ra.age, ageB: rb.age, role: ra.role,
    });
  }
  for (const s of samples) {
    console.log(`  ${s.name.padEnd(35)} u8: ${s.u8a}->${s.u8b}  u16: ${s.u16a}->${s.u16b} (Δ${s.u16b-s.u16a})  u32: ${s.u32a}->${s.u32b} (Δ${s.u32b-s.u32a})  f32: ${s.f32a.toFixed(3)}->${s.f32b.toFixed(3)}  age:${s.ageA}->${s.ageB} t:${s.tDelta>=0?"+":""}${s.tDelta}`);
  }
}
