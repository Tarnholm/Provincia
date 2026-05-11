// dig-siege-turn10.js
// save_7 (Brundisium siege, possibly turn 0-1 of siege) vs save_8 (still Brundisium sieged
// + new Tarentum siege starts). If siege had a turn counter, save_8's Brundisium siege block
// should have higher value than save_7's.
//
// But we only found ONE block per save. save_8 has Tarentum-UUID block ONLY. So Brundisium
// siege block from save_7 was REMOVED in save_8 (Brundisium siege ended in save_8).
//
// Per brief: "save_8.1 | war w/ Taras + siege Tarentum". So between save_7 and save_8 the
// Brundisium siege was lifted/won. The 73-byte cycle is: insert when siege starts, delete
// when siege ends (Brundisium lifted, then new Tarentum block inserted, net 0).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

// File sizes
const sizes = {};
for (const s of ["save_6.1.sav", "save_7.1.sav", "save_8.1.sav", "save_9.1.sav"]) {
  sizes[s] = fs.statSync(path.join(SAVE_DIR, s)).size;
}
console.log("File sizes:");
for (const [s, sz] of Object.entries(sizes)) console.log(`  ${s}: ${sz}`);
console.log(`  save_6 → save_7: ${sizes["save_7.1.sav"] - sizes["save_6.1.sav"]}`);
console.log(`  save_7 → save_8: ${sizes["save_8.1.sav"] - sizes["save_7.1.sav"]}`);
console.log(`  save_8 → save_9: ${sizes["save_9.1.sav"] - sizes["save_8.1.sav"]}`);

// save_7 → save_8 is +3218 bytes. That includes net 0 from siege swap (Brundisium siege ends,
// Tarentum siege starts) plus +3218 from other game state.
//
// In save_7, was the siege block UUID 8ca7c190a40c62d30ae06177. In save_8, UUID is 7093a67be00e7f3deb2ac995. So the SAME 0x152f529 location holds different UUIDs in different saves.
//
// Now look at TURN counter. Look at u16=2261 across many saves. If it's wall HP, it might decay
// across multiple sieging turns. Compare save_7 (just-started siege) vs save_8 (different just-started siege).
// Both are 2261. So this is at least a consistent starting wall HP.
//
// To test wall HP definitively, we'd need a save where siege had progressed and walls were
// damaged. We don't have that in this corpus.
//
// Let me check: does u16=2261 appear in save_6 or save_9 anywhere as a wall-HP value?
// Look for it inside settlement records.

function findU16(buf, val, start, end) {
  const out = [];
  for (let i = start; i + 2 <= end; i++) {
    if (buf.readUInt16LE(i) === val) out.push(i);
  }
  return out;
}

console.log("\n=== u16=2261 occurrences in save_6 (no siege), save_7 (Brundisium siege), save_8 (Tarentum siege) ===");
for (const s of ["save_6.1.sav", "save_7.1.sav", "save_8.1.sav"]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const occs = findU16(buf, 2261, 0, buf.length);
  console.log(`${s}: ${occs.length} occurrences`);
  for (const o of occs.slice(0, 10)) console.log(`  0x${o.toString(16)}`);
}

// Try other plausible wall-HP-ish numbers around 2261.
// Per RTW, "stone_wall" might be ~2000-3000. Let me check what 2261 (= 0x08d5) commonly is.
// Could also be 2261 = (specific city's wall HP from settlement-record).

// Inspect Brundisium's "defenses" chain HP in save_6 vs save_7.
// Per session 17, building HP is at +0x28 from chain record's name start.
// Find "defenses" chain in Brundisium.

function findChain(buf, settlementOff, prevSettlementEnd, chainName) {
  for (let i = prevSettlementEnd; i < settlementOff - 8; i++) {
    const ln = buf.readUInt16LE(i);
    if (ln !== chainName.length + 1) continue;
    if (buf.slice(i + 2, i + 2 + chainName.length).toString("ascii") !== chainName) continue;
    if (buf[i + 2 + chainName.length] !== 0) continue;
    return i;
  }
  return -1;
}

// Look for "defenses" chain near Brundisium
function findAllSettlementMarkers(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") {
      out.push({ offset: i, name, blockEnd: se + 2 });
    }
  }
  return out;
}

for (const s of ["save_6.1.sav", "save_7.1.sav"]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const markers = findAllSettlementMarkers(buf);
  const idx = markers.findIndex(m => m.name === "Brundisium");
  const brun = markers[idx];
  const prev = markers[idx - 1];
  console.log(`\n${s} Brundisium @ 0x${brun.offset.toString(16)}, prev end 0x${prev.blockEnd.toString(16)}`);
  const defensesOff = findChain(buf, brun.offset, prev.blockEnd, "defenses");
  if (defensesOff > 0) {
    console.log(`  defenses chain at 0x${defensesOff.toString(16)}`);
    // Print 64 bytes from defenses chain start
    console.log(`  bytes: ${buf.slice(defensesOff, defensesOff + 64).toString("hex")}`);
    // Decode u16 at +0x12 (some "wall HP" candidate)
    for (let k = 0; k < 64; k += 4) {
      const u32 = buf.readUInt32LE(defensesOff + k);
      const u16a = buf.readUInt16LE(defensesOff + k);
      const u16b = buf.readUInt16LE(defensesOff + k + 2);
      console.log(`    +${k}: u32=${u32}, u16s=(${u16a}, ${u16b})`);
    }
  }
}
