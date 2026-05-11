// Session 22: confirm per-soldier records inside tail unit records.
// Hypothesis: each unit record has [44-byte header] + [N × 9-byte soldier] + [padding 0xff..0xff]

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
    p.soldiers = buf.readUInt32LE(persistentStart + 12);
  }
  parsed.push({ ...r, ...p, next });
}

// For each unit record, find where the trailing 0xff run starts
console.log('=== Per-record soldier-block size analysis ===');
console.log('name | soldiers | persistLen | ff-run-start | block-size = ff-run-start - 44 | bytes/soldier');

const samples = parsed.filter(p => p.persistentStart && !/(bodyguard|general)/.test(p.name)).slice(0, 30);
for (const p of samples) {
  // Find first position >= 100 where 8 consecutive 0xff bytes start (true ff-run)
  let ffStart = -1;
  for (let i = 50; i < p.persistentLen - 8; i++) {
    let allFf = true;
    for (let j = 0; j < 8; j++) if (buf[p.persistentStart + i + j] !== 0xff) { allFf = false; break; }
    if (allFf) { ffStart = i; break; }
  }
  if (ffStart < 0) {
    console.log(`  ${p.name.padEnd(25)} sold=${p.soldiers} persistLen=${p.persistentLen}  ff-run not found`);
    continue;
  }
  const block = ffStart - 44;
  const bps = p.soldiers > 0 ? (block / p.soldiers).toFixed(3) : 'n/a';
  console.log(`  ${p.name.padEnd(25)} sold=${p.soldiers} persistLen=${p.persistentLen}  ff-run@${ffStart}  block=${block}  ${bps} B/soldier`);
}

// Find true header size = anything before the per-soldier loop starts
// One peltasts record (200 soldiers, persistLen 2448, ff-run at 1845): block = 1801, 9.005 B/soldier
// One hoplites record (240, 2834, ?): need to find ff-run.

// Now dump per-soldier 9-byte slice for thracian peltasts [0]:
const p0 = parsed.find(p => p.name === 'thracian peltasts' && p.persistentStart);
if (p0) {
  console.log(`\n=== thracian peltasts soldier dump (first 20 soldiers, 9B each, starting at +44) ===`);
  // Actually persistent layout was: +0..+43 = header, +44... soldier records
  // Re-examine: at +44 we saw c8 00 — that's soldiers=200 again? Or is +44 inside the next record?
  // Let me find the proper start of per-soldier loop.
  // Hex showed at +44: c8 00 70 16 50 00 00 00 00 00 04 15 20 00 00 00 00 00 05 8b 15 40 ...
  // The "c8 00" is 200 (u16). Then "70 16 50 00 00 00 00 00" is 8 bytes, then "04 15 20" etc.
  // 9-byte stride from +46: "70 16 50 00 00 00 00 00 04" / "15 20 00 00 00 00 00 05 8b" / "15 40 00 00 00 00 00 02 1d"
  // Each is 7 bytes "XX YY ZZ 00 00 00 00" + 2 trailing bytes.
  // The repeating pattern: 9 bytes per soldier where first 3 are varying values, then 5 zeros, then 1 byte.
  console.log(`  Bytes +44..+53 (1st soldier?): ${buf.subarray(p0.persistentStart + 44, p0.persistentStart + 53).toString('hex')}`);
  console.log(`  Bytes +53..+62 (2nd soldier?): ${buf.subarray(p0.persistentStart + 53, p0.persistentStart + 62).toString('hex')}`);
  console.log(`  Bytes +62..+71 (3rd soldier?): ${buf.subarray(p0.persistentStart + 62, p0.persistentStart + 71).toString('hex')}`);
  console.log(`  Bytes +71..+80 (4th soldier?): ${buf.subarray(p0.persistentStart + 71, p0.persistentStart + 80).toString('hex')}`);

  // Maybe stride is actually 9 bytes from +46:
  console.log(`\n  Bytes +46..+55: ${buf.subarray(p0.persistentStart + 46, p0.persistentStart + 55).toString('hex')}`);
  console.log(`  Bytes +55..+64: ${buf.subarray(p0.persistentStart + 55, p0.persistentStart + 64).toString('hex')}`);
  console.log(`  Bytes +64..+73: ${buf.subarray(p0.persistentStart + 64, p0.persistentStart + 73).toString('hex')}`);
}

// Confirmation: total tail-region unit count and per-soldier count
console.log('\n=== Total soldier count in tail field-army-zone ===');
let totalSoldiers = 0;
let withSoldiers = 0;
for (const p of parsed) {
  if (p.persistentStart && p.soldiers && p.soldiers < 500) {
    totalSoldiers += p.soldiers;
    withSoldiers++;
  }
}
console.log(`  Records with soldier counts: ${withSoldiers}/${parsed.length}`);
console.log(`  Total soldiers across tail field-armies: ${totalSoldiers}`);
console.log(`  Avg unit size: ${(totalSoldiers / withSoldiers).toFixed(1)}`);

// And total distinct faction-tribe names (settlements imply rebel/tribal regions)
const settList = parsed.filter(p => p.settName).map(p => p.settName);
const settUniq = new Set(settList);
console.log(`  ${settUniq.size} distinct settlements / tribal regions reference`);
