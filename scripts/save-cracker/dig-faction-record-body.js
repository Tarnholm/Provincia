// Dump the body of the player's faction record (after the known header
// fields). Look for character/heir/leader UUIDs.

const fs = require("fs");
const { parseCharacterExtras, parseFactionTreasuries } = require("../../src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const treas = parseFactionTreasuries(buf);
const player = treas[0];
console.log(`player record at 0x${player.offset.toString(16)}`);
console.log(`treasury=${player.treasury} turnStart=${player.turnStartTreasury} regionCount=${player.regionCount}`);

// Known header end: +92 + 4*N + 4 (after turnStart u32)
const N = player.regionCount;
const headerEnd = 92 + 4 * N + 4;
console.log(`header ends at +${headerEnd}`);

// Next record is at treas[1].offset
const bodyEnd = treas.length > 1 ? treas[1].offset - player.offset : 8000;
console.log(`record body spans +${headerEnd}..+${bodyEnd} (${bodyEnd - headerEnd} bytes)`);

// Get all chars for cross-reference
const chars = parseCharacterExtras(buf);
const charByUuid = new Map();
for (const c of chars) charByUuid.set(c.ownUuid, c);

// Dump u32s from headerEnd to +500, with notes
console.log(`\nu32 fields after header (+${headerEnd}..+${headerEnd + 400}):`);
for (let off = headerEnd; off < Math.min(bodyEnd, headerEnd + 400); off += 4) {
  const fileOff = player.offset + off;
  if (fileOff + 4 > buf.length) break;
  const v = u32(fileOff);
  let note = "";
  if (v === 0) continue; // skip zeros for less noise
  if (v === 0xffffffff) note = " ← sentinel";
  else if (charByUuid.has(v)) note = ` ← char: ${charByUuid.get(v).region} age ${charByUuid.get(v).age}`;
  else if (v < 100) note = ` (small ${v})`;
  else if (v < 10000) note = ` (${v})`;
  else if (v < 100000) note = ` (mid ${v})`;
  else note = ` (large)`;
  console.log(`  +${off.toString().padStart(4)}: 0x${v.toString(16).padStart(8, "0")}${note}`);
}
