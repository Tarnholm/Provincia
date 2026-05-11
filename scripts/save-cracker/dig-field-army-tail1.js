// Session 22: Decode the 200KB field-army units block in the tail at
// 0x1f10c72..0x1f42cb6 (rome10).
//
// Goal: check if these unit records follow the standard unit schema markers
// from session 10/11:
//   - nameLen u16
//   - ASCII unit name
//   - region UTF-16 prefix path
//   - ff ff ff ff terminator (often)
//   - +12 = soldiers (after region path?)
//   - +16 = armour
//   - +17 = weapon
//   - +19 = morale
//   - +20 = XP
//
// We'll walk all unit-name records, then parse the trailing data for each
// looking for these fields.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

const tailStart = 0x1f10c72;
const tailEnd   = 0x1f42cb6;  // session 14's documented bounds

console.log(`Field-army-tail region: 0x${tailStart.toString(16)}..0x${tailEnd.toString(16)} (${tailEnd - tailStart} bytes)`);

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
console.log(`\nFound ${records.length} unit-name records`);

// For each unit name, find the bytes between it and the next unit name (or end of zone)
// Parse: ASCII name end → 0x00 padding → 12-byte struct → 8-byte uuid → u16 settLen → UTF-16LE settlement → soldier persistent payload
//
// Per session 14: [u16 nameLen][ASCII name][u8 0][12-byte struct][8-byte uuid][u16 settLen][UTF-16LE settlement][soldier persistent payload]

function parseRecord(r, nextOff) {
  const nameEnd = r.off + 2 + r.len;
  const recBytes = buf.subarray(nameEnd, nextOff);
  // Check the next byte is 0
  const trailing = {
    nameEnd,
    nextOff,
    size: nextOff - nameEnd,
    firstBytes: recBytes.subarray(0, Math.min(64, recBytes.length)),
  };
  // Try to find a UTF-16LE settlement name within
  // Pattern: u16 settLen ∈ [3..30], then 2*settLen bytes of UTF-16LE ASCII
  let settLen = null, settName = null, settOff = null;
  for (let p = 0; p + 2 + 6 <= recBytes.length; p++) {
    const sl = recBytes.readUInt16LE(p);
    if (sl < 3 || sl > 30) continue;
    if (p + 2 + sl * 2 > recBytes.length) continue;
    // Check each char is printable ASCII as UTF-16LE (lo=0)
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
  trailing.settLen = settLen;
  trailing.settName = settName;
  trailing.settOff = settOff;
  return trailing;
}

console.log(`\n=== Sample 10 records with full parse ===`);
for (let i = 0; i < Math.min(10, records.length); i++) {
  const r = records[i];
  const next = i + 1 < records.length ? records[i+1].off : tailEnd;
  const parsed = parseRecord(r, next);
  console.log(`\n[${i}] @0x${r.off.toString(16)} unit="${r.name}" size=${parsed.size}`);
  console.log(`     settlement="${parsed.settName}" at +${parsed.settOff}`);
  console.log(`     first 48 bytes after name end: ${parsed.firstBytes.subarray(0, 48).toString('hex')}`);
}

// Compute stride / size statistics
const sizes = [];
for (let i = 0; i < records.length; i++) {
  const next = i + 1 < records.length ? records[i+1].off : tailEnd;
  sizes.push(next - (records[i].off + 2 + records[i].len));
}
sizes.sort((a,b) => a-b);
console.log(`\n=== Record size statistics ===`);
console.log(`  Min/Q1/Med/Q3/Max: ${sizes[0]} / ${sizes[Math.floor(sizes.length*0.25)]} / ${sizes[Math.floor(sizes.length*0.5)]} / ${sizes[Math.floor(sizes.length*0.75)]} / ${sizes[sizes.length-1]}`);
console.log(`  Total records: ${records.length}`);
console.log(`  Total tail bytes covered: ${sizes.reduce((s,n) => s+n, 0)}`);

// Now: look at the bytes AT the +12, +16, +17, +19, +20 positions relative to record start
// We'll try several anchor schemes:
//   anchor A: nameEnd + 12 (i.e., right after a hypothetical 12-byte struct)
//   anchor B: just before settlement name (likely the 8-byte uuid + settLen u16)
//   anchor C: just after settlement name (start of soldier persistent payload)
console.log(`\n=== Per-record field probe — bytes at "soldier-persistent payload" (right after UTF-16LE settlement name) ===`);
// session 14 says: [u16 settLen][UTF-16LE settlement name][soldier persistent payload]
// soldier persistent has session 10/11 markers at +12,+16,+17,+19,+20
const FIELD_OFFSETS = [12, 16, 17, 19, 20];
for (let i = 0; i < Math.min(20, records.length); i++) {
  const r = records[i];
  const next = i + 1 < records.length ? records[i+1].off : tailEnd;
  const parsed = parseRecord(r, next);
  if (parsed.settOff === null) {
    console.log(`  [${i}] ${r.name}: no settlement found`);
    continue;
  }
  const nameEnd = r.off + 2 + r.len;
  const persistentStart = nameEnd + parsed.settOff + 2 + parsed.settLen * 2;
  if (persistentStart + 32 > next) {
    console.log(`  [${i}] ${r.name}: persistent payload too short (${next - persistentStart} bytes)`);
    continue;
  }
  const fields = FIELD_OFFSETS.map(o => buf[persistentStart + o]);
  // Also +12 as u32, +20 as u32 (XP)
  const u32_12 = buf.readUInt32LE(persistentStart + 12);
  const u32_20 = buf.readUInt32LE(persistentStart + 20);
  console.log(`  [${i.toString().padStart(2)}] ${r.name.padEnd(30)} sett=${(parsed.settName || '').padEnd(15)} | +12=${fields[0]} (u32=${u32_12}) +16=${fields[1]} +17=${fields[2]} +19=${fields[3]} +20=${fields[4]} (u32=${u32_20})`);
}
