// Extract diplomatic relations for each major faction record.
// Per memory: marker `05 00 24 39` at offset +(244 + 4*regionCount) of each
// major faction record, followed by u32 count and 16-byte entries.

const fs = require("fs");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
const treas = parseFactionTreasuries(buf);
console.log(`faction records: ${treas.length}`);

const DIPLO_MARKER = Buffer.from([0x05, 0x00, 0x24, 0x39]);

const allEntries = [];
for (let i = 0; i < treas.length; i++) {
  const r = treas[i];
  const expectedOff = r.offset + 244 + 4 * r.regionCount;
  // Verify marker
  if (buf.readUInt32LE(expectedOff) !== 0x39240005) {
    console.log(`  rec ${i}: NO marker at +${244 + 4 * r.regionCount} (got 0x${buf.readUInt32LE(expectedOff).toString(16)})`);
    continue;
  }
  const count = u32(expectedOff + 4);
  if (count > 100) continue; // sanity
  const entries = [];
  for (let k = 0; k < count; k++) {
    const o = expectedOff + 8 + k * 16;
    if (o + 16 > buf.length) break;
    const e = {
      uuid: u32(o),
      class_: u32(o + 4),
      attitude: u32(o + 8),
      tag: u32(o + 12),
    };
    entries.push(e);
  }
  console.log(`rec ${i} (treasury=${r.treasury}, ${r.regionCount} regions): ${count} relations`);
  for (const e of entries.slice(0, 5)) {
    const tagOk = e.tag === 0x00010101 ? "✓" : `(tag=${e.tag.toString(16)})`;
    console.log(`  uuid=${e.uuid} class=${e.class_} attitude=${e.attitude} ${tagOk}`);
  }
  for (const e of entries) allEntries.push(e);
}

// Stats across all entries
console.log(`\ntotal relations across all factions: ${allEntries.length}`);
const tagValid = allEntries.filter(e => e.tag === 0x00010101).length;
console.log(`tag matches 0x00010101: ${tagValid}/${allEntries.length}`);

const classCounts = {};
for (const e of allEntries) classCounts[e.class_] = (classCounts[e.class_] || 0) + 1;
console.log("class distribution:");
for (const [k, v] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  class=${k}: ${v}`);
}

const attCounts = {};
for (const e of allEntries) attCounts[e.attitude] = (attCounts[e.attitude] || 0) + 1;
console.log("attitude distribution:");
for (const [k, v] of Object.entries(attCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  attitude=${k}: ${v}`);
}
