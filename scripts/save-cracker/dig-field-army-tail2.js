// Session 22: field-army-tail decode #2.
// Confirm: +12 = soldier count.
// Sample more records and look for XP/armour at different offsets.
// Test: do thracian_peltasts always have 200 soldiers? Bodyguards always 24?

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);
const tailStart = 0x1f10c72;
const tailEnd   = 0x1f42cb6;

// Find unit-name records
const records = [];
for (let p = tailStart; p + 2 < tailEnd; p++) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 2 + len > tailEnd) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString('ascii');
  if (!/^[a-z][a-z ]+[a-z]\0?$/.test(s)) continue;
  records.push({ off: p, len, name: s.replace(/\0$/, '') });
}

// Parse each
function parseRecord(r, nextOff) {
  const nameEnd = r.off + 2 + r.len;
  const recBytes = buf.subarray(nameEnd, nextOff);
  let settLen = null, settName = null, settOff = null;
  for (let p = 0; p + 2 + 6 <= recBytes.length; p++) {
    const sl = recBytes.readUInt16LE(p);
    if (sl < 3 || sl > 30) continue;
    if (p + 2 + sl * 2 > recBytes.length) continue;
    let ok = true;
    for (let i = 0; i < sl; i++) {
      const lo = recBytes[p + 2 + i*2], hi = recBytes[p + 2 + i*2 + 1];
      if (hi !== 0) { ok = false; break; }
      if (lo < 0x20 || lo > 0x7e) { ok = false; break; }
    }
    if (ok) {
      let s = '';
      for (let i = 0; i < sl; i++) s += String.fromCharCode(recBytes[p + 2 + i*2]);
      settLen = sl; settName = s; settOff = p;
      break;
    }
  }
  return { nameEnd, settLen, settName, settOff };
}

// All records with parsed payload
const parsed = [];
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const next = i + 1 < records.length ? records[i+1].off : tailEnd;
  const p = parseRecord(r, next);
  if (p.settOff !== null) {
    const persistentStart = p.nameEnd + p.settOff + 2 + p.settLen * 2;
    p.persistentStart = persistentStart;
    p.persistentEnd = next;
    p.persistentLen = next - persistentStart;
  }
  parsed.push({ ...r, ...p, next });
}

// Group by unit name to check consistency of +12 = soldier count
console.log('=== Soldier count (+12) consistency by unit name ===');
const byName = new Map();
for (const r of parsed) {
  if (r.persistentStart == null) continue;
  // +12 is between the ff ff ff ff terminator and start of payload data
  // Actually wait — the 0xffffffff appears at position 8 of the persistentStart based on hex dump
  // Let me re-read the schema.
  if (r.persistentStart + 12 > buf.length) continue;
  const soldiers = buf.readUInt32LE(r.persistentStart + 12);
  if (!byName.has(r.name)) byName.set(r.name, []);
  byName.get(r.name).push(soldiers);
}
for (const [name, soldiers] of [...byName.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 20)) {
  const uniq = new Set(soldiers);
  console.log(`  ${name.padEnd(35)} n=${soldiers.length}  values: ${[...uniq].sort((a,b)=>a-b).join(',')}`);
}

// Dump full 64-byte persistent payload for 5 distinct unit types
console.log('\n=== Full 64-byte persistent payload (looking for XP/armour somewhere) ===');
const seenNames = new Set();
for (const r of parsed) {
  if (r.persistentStart == null) continue;
  if (seenNames.has(r.name)) continue;
  seenNames.add(r.name);
  if (seenNames.size > 8) break;
  const payload = buf.subarray(r.persistentStart, Math.min(r.persistentStart + 64, r.persistentEnd));
  // Print as hex + u32 decoded
  console.log(`\n  ${r.name} @sett=${r.settName} (persist=${r.persistentLen}B, persistStart=0x${r.persistentStart.toString(16)})`);
  console.log(`    hex: ${payload.toString('hex')}`);
  const u32s = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) u32s.push(payload.readUInt32LE(i));
  console.log(`    u32 (every 4 bytes): ${u32s.join(' ')}`);
  // Print bytes individually for the first 24 to see field positions
  const bs = [];
  for (let i = 0; i < Math.min(24, payload.length); i++) bs.push(payload[i].toString().padStart(3));
  console.log(`    u8  (first 24): ${bs.join(' ')}`);
}

// Cross-check: are these records the "RIS field army" or "non-faction army"?
// Total tail records = 122. We confirmed they're at unique offsets.
// Check: how many DISTINCT settlement names are referenced?
const settNames = new Set();
for (const r of parsed) if (r.settName) settNames.add(r.settName);
console.log(`\n=== Settlements referenced ===`);
console.log(`Unique settlements: ${settNames.size}`);
console.log([...settNames].join(', '));

// Pattern check: 0x2c010000 at some offset — what is it?
// Looking at hex: `00 00 00 00 2c 01 00 00 01 00 00 00 06 00 ...`
// u32 at offset +4 of namEnd: 00000000
// u32 at offset +8 of namEnd: 0x0000012c = 300
// u32 at offset +12 of namEnd: 1
// u16 at offset +16 of namEnd: settLen
// We're looking at the WRONG offset for the soldier count.
// Let me trace: nameEnd = end of "thracian royal bodyguards" ASCII (24 bytes).
// After that: `ee16f664 84cd78c6 ba000000 002c0100 00010000 0006004b 006f0072 0065006c 00690061 00ffffff ff` ...
// That's: ee16f664 (4) | 84cd78c6 ba000000 (8 bytes uuid) | 002c0100 = 0x0001_2C00 = 76800 -- no
// Actually offsets are off. Let me re-examine.

// Easier: dump 32 bytes starting from nameEnd and 32 from settlement-name-end
console.log('\n=== Detailed offset analysis for record [0] illyrian warlords bodyguard ===');
const r0 = parsed[0];
console.log(`  nameEnd at 0x${r0.nameEnd.toString(16)}`);
console.log(`  bytes nameEnd..nameEnd+48: ${buf.subarray(r0.nameEnd, r0.nameEnd + 48).toString('hex')}`);
console.log(`  settLen=${r0.settLen} settName="${r0.settName}" settOff=${r0.settOff}`);
console.log(`  persistentStart at 0x${r0.persistentStart.toString(16)}`);
console.log(`  bytes persistentStart..persistentStart+48: ${buf.subarray(r0.persistentStart, r0.persistentStart + 48).toString('hex')}`);
console.log(`  u32 @ persist+0: ${buf.readUInt32LE(r0.persistentStart)}`);
console.log(`  u32 @ persist+4: ${buf.readUInt32LE(r0.persistentStart + 4)}`);
console.log(`  u32 @ persist+8: ${buf.readUInt32LE(r0.persistentStart + 8)}`);
console.log(`  u32 @ persist+12: ${buf.readUInt32LE(r0.persistentStart + 12)}`);
console.log(`  u32 @ persist+16: ${buf.readUInt32LE(r0.persistentStart + 16)}`);
console.log(`  u32 @ persist+20: ${buf.readUInt32LE(r0.persistentStart + 20)}`);
console.log(`  u32 @ persist+24: ${buf.readUInt32LE(r0.persistentStart + 24)}`);
