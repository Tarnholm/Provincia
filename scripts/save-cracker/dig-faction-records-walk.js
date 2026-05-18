// Use the existing factionRecordParser to locate all faction records,
// then dump per-record start bytes to look for treasury.

const fs = require("fs");
const path = require("path");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";

// Inline magic-find since factionRecordParser is ESM/JSX (the renderer)
function findFactionRecords(buf) {
  const positions = [];
  const MAGIC_1 = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
  let p = 0;
  while (p < buf.length - 16) {
    const i = buf.indexOf(MAGIC_1, p);
    if (i < 0) break;
    if (i + 16 > buf.length) break;
    const sp = buf.readUInt32LE(i + 4);
    const magic2Match = buf[i + 12] === 0xf0 && buf[i + 13] === 0x0a && buf[i + 14] === 0xaf && buf[i + 15] === 0xf0;
    if (sp !== i + 4 || !magic2Match) { p = i + 1; continue; }
    positions.push(i);
    p = i + 16;
  }
  if (positions.length === 0) return [];
  return positions.map((off, idx) => ({
    offset: off,
    size: (idx + 1 < positions.length ? positions[idx + 1] : buf.length) - off,
  }));
}

const saves = [
  "save_macedon t0.sav",
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
];

for (const saveName of saves) {
  const savePath = path.join(SAVES_DIR, saveName);
  if (!fs.existsSync(savePath)) {
    console.log(`SKIP: ${saveName} (not found)`);
    continue;
  }
  const buf = fs.readFileSync(savePath);
  const records = findFactionRecords(buf);
  console.log(`\n=== ${saveName} (${buf.length} bytes) ===`);
  console.log(`faction records: ${records.length}`);
  console.log(`first 5 records:`);
  for (const r of records.slice(0, 5)) {
    console.log(`  offset=0x${r.offset.toString(16)} size=${r.size}`);
  }
  // Print a few candidate u32 values just after each record's 24-byte header.
  // Treasury is per memory in the "per-faction state" area.
  console.log(`u32 values at +24..+72 of first 3 records:`);
  for (const r of records.slice(0, 3)) {
    const vals = [];
    for (let off = 24; off <= 72; off += 4) {
      vals.push(buf.readUInt32LE(r.offset + off));
    }
    console.log(`  rec @0x${r.offset.toString(16)}: [${vals.join(", ")}]`);
  }
}
