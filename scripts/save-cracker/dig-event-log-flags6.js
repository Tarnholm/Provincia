// Session 26 — Cross-save validation: does schema-A work on RoR-T1 too?
// This would confirm the schema is universal across saves.

const fs = require('fs');
const ROR_T1 = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';
if (!fs.existsSync(ROR_T1)) { console.log('No RoR-T1 save'); process.exit(0); }
const buf = fs.readFileSync(ROR_T1);
console.log('RoR-T1 size:', buf.length);

// Find equivalent region. In rome10, event log starts at 0x51b5.
// Need to find offset in RoR-T1 where the same UTF-16LE "imperial_campaign" appears
// Then traverse to the event log

// Easier: find pattern "01 20 11 01 13 01 00 00" — actually that's rome10 specific
// Better: find "13 01 00 00 0b d1 22 ec" in RoR-T1 (but rome10's hash 0xec22d10b is per-save).
// Better still: find a record like "01 20 ?? 01 13 01 00 00 XX XX XX XX" — flag=1, sub=0x20, idA<512, year=275
// The early-record schema-A: hash=??, flag=1, sub=0x20, idA<512, year=275 → bytes at +4 = 01 20, +6 = idA, +8 = 0x113 00 00 00

const pat = Buffer.from([0x01, 0x20]);
let nMatch = 0;
const matches = [];
for (let o = 0x4000; o < Math.min(buf.length - 12, 0x100000); o++) {
  if (buf[o] === 0x01 && buf[o+1] === 0x20 && buf[o+8] < 256 && buf[o+9] === 0 && buf[o+10] === 0 && buf[o+11] === 0) {
    // Possible record: schema-A says these are at +4,+5 (flag, sub) and +8 (idB low byte)
    // So record start is at o - 4
    const recOff = o - 4;
    const hash = buf.readUInt32LE(recOff);
    const flag = buf[recOff + 4];
    const sub = buf[recOff + 5];
    const idA = buf.readUInt16LE(recOff + 6);
    const idB = buf.readUInt32LE(recOff + 8);
    if (idB > 0 && idB < 500 && idA < 4096) {
      matches.push({recOff, hash, flag, sub, idA, idB});
      nMatch++;
      if (nMatch > 100) break;
    }
  }
}
console.log('Pattern matches (schema-A valid record candidates):', nMatch);
if (matches.length > 0) {
  console.log('First 10 candidates:');
  matches.slice(0,10).forEach(m=>console.log('  0x' + m.recOff.toString(16) + ' hash=0x' + m.hash.toString(16).padStart(8,'0') + ' f=' + m.flag + ' s=0x' + m.sub.toString(16) + ' idA=' + m.idA + ' idB=' + m.idB));
}

// What's the first such offset? That's likely near the START of RoR-T1's event log
if (matches.length > 0) {
  // The first match gives an idea of where the event log lives in RoR-T1
  const firstMatch = matches[0].recOff;
  console.log('\nFirst candidate at 0x' + firstMatch.toString(16));

  // Now: try to parse 12-byte records FROM that offset backwards to find log start
  // and forwards to find log end
  // First scan forward from firstMatch
  let validForward = 0;
  let p = firstMatch;
  while (p + 12 <= buf.length) {
    const flag = buf[p+4], sub = buf[p+5];
    const idA = buf.readUInt16LE(p+6);
    const idB = buf.readUInt32LE(p+8);
    if ((flag===1||flag===2||flag===4) && (sub===0||sub===0x20) && idB < 800 && idA < 4096) {
      validForward++;
      p += 12;
    } else if (flag===0 && sub===0 && idA===0 && idB===0 && buf.readUInt32LE(p)===0) {
      p += 12;  // zero slot
    } else {
      break;
    }
  }
  console.log('Forward valid records from 0x' + firstMatch.toString(16) + ':', validForward, 'up to 0x' + p.toString(16));

  // Apply full schema-A scan within this range
  if (validForward > 100) {
    let nValid = 0, nZero = 0, nOther = 0;
    let p2 = firstMatch;
    const idBs = [];
    const hashes = new Set();
    while (p2 + 12 <= buf.length) {
      const flag = buf[p2+4], sub = buf[p2+5];
      const idA = buf.readUInt16LE(p2+6);
      const idB = buf.readUInt32LE(p2+8);
      const hash = buf.readUInt32LE(p2);
      if ((flag===1||flag===2||flag===4) && (sub===0||sub===0x20) && idB > 0 && idB < 800 && idA < 4096) {
        nValid++;
        idBs.push(idB);
        hashes.add(hash);
        p2 += 12;
      } else if (flag===0 && sub===0 && idA===0 && idB===0 && hash===0) {
        nZero++;
        p2 += 12;
      } else if (nValid + nZero + nOther > 50000) break;  // safety
      else { nOther++; p2 += 12; }
      if (nValid + nZero + nOther > 50000) break;
    }
    console.log('\n=== RoR-T1 event log (schema-A) ===');
    console.log('Valid records:', nValid);
    console.log('All-zero slots:', nZero);
    console.log('Other:', nOther);
    if (idBs.length > 0) {
      console.log('idB year range:', Math.min(...idBs), '..', Math.max(...idBs));
      console.log('Distinct hashes:', hashes.size);
    }
  }
}

// Also find max idB in RoR-T1 specifically
// In rome10 (T5), max valid idB was 696. In RoR-T1 (T1), should be ~270 + 1 = 271 if log only records past years
console.log('\n=== Comparison rome10 (T5) vs RoR-T1 (T1) ===');
console.log('rome10: idB range 1..696, 13947 valid records, 1533 hashes');
