// Session 22: field-army-tail #3.
// We have ~122 unit records cleanly parsed with soldier counts at +12 and +16.
// But the brief mentioned XP/armour/weapon/morale. Let me see if those exist:
// they might be in the BODYGUARD records (which contain a leading character record)
// vs the unit records (just troops).

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);
const tailStart = 0x1f10c72;
const tailEnd   = 0x1f42cb6;

const records = [];
for (let p = tailStart; p + 2 < tailEnd; p++) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 2 + len > tailEnd) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString('ascii');
  if (!/^[a-z][a-z ]+[a-z]\0?$/.test(s)) continue;
  records.push({ off: p, len, name: s.replace(/\0$/, '') });
}

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

const isCharRec = (r) => /(bodyguard|general)/.test(r.name);

console.log('=== Persistent-payload size by record type ===');
const charSizes = parsed.filter(p => isCharRec(p) && p.persistentLen).map(p => p.persistentLen);
const unitSizes = parsed.filter(p => !isCharRec(p) && p.persistentLen).map(p => p.persistentLen);
const sortAsc = (a,b)=>a-b;
console.log(`  Character records: ${charSizes.length}. Size min/med/max: ${Math.min(...charSizes)} / ${charSizes.sort(sortAsc)[Math.floor(charSizes.length/2)]} / ${Math.max(...charSizes)}`);
console.log(`  Unit records: ${unitSizes.length}. Size min/med/max: ${Math.min(...unitSizes)} / ${unitSizes.sort(sortAsc)[Math.floor(unitSizes.length/2)]} / ${Math.max(...unitSizes)}`);

console.log('\n=== Two thracian peltasts (both 200 soldiers) — what differs? ===');
const peltasts = parsed.filter(p => p.name === 'thracian peltasts');
console.log(`Found ${peltasts.length} thracian peltasts records`);
if (peltasts.length >= 2) {
  const p1 = peltasts[0], p2 = peltasts[1];
  console.log(`  P1 sett=${p1.settName} persistLen=${p1.persistentLen}`);
  console.log(`  P2 sett=${p2.settName} persistLen=${p2.persistentLen}`);
  console.log(`  P1 first 96 bytes: ${buf.subarray(p1.persistentStart, p1.persistentStart + 96).toString('hex')}`);
  console.log(`  P2 first 96 bytes: ${buf.subarray(p2.persistentStart, p2.persistentStart + 96).toString('hex')}`);
}

console.log('\n=== Two greek hoplites (both 240 soldiers) — what differs? ===');
const hoplites = parsed.filter(p => p.name === 'greek hoplites');
console.log(`Found ${hoplites.length} greek hoplites records`);
if (hoplites.length >= 2) {
  const p1 = hoplites[0], p2 = hoplites[1];
  console.log(`  P1 sett=${p1.settName} persistLen=${p1.persistentLen}`);
  console.log(`  P2 sett=${p2.settName} persistLen=${p2.persistentLen}`);
  console.log(`  P1 first 96 bytes: ${buf.subarray(p1.persistentStart, p1.persistentStart + 96).toString('hex')}`);
  console.log(`  P2 first 96 bytes: ${buf.subarray(p2.persistentStart, p2.persistentStart + 96).toString('hex')}`);
  console.log(`  Byte diffs first 200:`);
  let nDiff = 0;
  for (let i = 0; i < 200; i++) {
    const b1 = buf[p1.persistentStart + i];
    const b2 = buf[p2.persistentStart + i];
    if (b1 !== b2) { console.log(`    +${i.toString().padStart(3)}: ${b1} vs ${b2}`); nDiff++; if (nDiff > 30) break; }
  }
}

console.log('\n=== Pre-settlement zone structure (first 21 bytes after unit name) ===');
for (let i = 0; i < Math.min(5, parsed.length); i++) {
  const r = parsed[i];
  const bytes = buf.subarray(r.nameEnd, r.nameEnd + 21);
  console.log(`  [${i}] ${r.name.padEnd(35)} bytes: ${bytes.toString('hex')}`);
}

const eeCount = parsed.filter(r => buf[r.nameEnd] === 0xee).length;
console.log(`\nRecords starting with 0xee: ${eeCount}/${parsed.length}`);

console.log('\n=== Search for repeating-stride sub-structure in thracian peltasts record [0] ===');
if (peltasts.length > 0) {
  const p = peltasts[0];
  const slice = buf.subarray(p.persistentStart, p.persistentEnd);
  const ffOffsets = [];
  for (let i = 0; i + 4 <= slice.length; i++) {
    if (slice.readUInt32LE(i) === 0xffffffff) ffOffsets.push(i);
  }
  console.log(`  0xffffffff markers: ${ffOffsets.length} at offsets: ${ffOffsets.slice(0, 30).join(', ')}${ffOffsets.length > 30 ? ' ...' : ''}`);

  // Compute diffs of ff offsets to look for stride
  const diffs = ffOffsets.slice(0, 30).map((v, i) => i > 0 ? v - ffOffsets[i-1] : 0);
  console.log(`  ff-stride diffs: ${diffs.slice(1).join(', ')}`);
}

// Print a thracian peltasts record FULL hex dump (it's ~2483 bytes)
if (peltasts.length > 0) {
  console.log('\n=== thracian peltasts [0] full persistent payload (first 256 bytes hex+ascii) ===');
  const p = peltasts[0];
  for (let off = 0; off < Math.min(256, p.persistentLen); off += 16) {
    const h = [];
    const a = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[p.persistentStart + off + j];
      h.push(b.toString(16).padStart(2, '0'));
      a.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.');
    }
    console.log(`  +${off.toString().padStart(4)}: ${h.join(' ')}  ${a.join('')}`);
  }
}
