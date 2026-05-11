// Session 26 — Validate: is the 13.9KB "UUID index" really part of the same event log as
// the 495KB main event log? Check schema continuity.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Region A: "UUID index" section 0x51b5..0x87e9 (after 8B section header)
// Region B: "Main event log" 0x87e9..0x846af
// Unified schema candidate: [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]

// First: examine the EXACT boundary at 0x87e9
console.log('=== Boundary 0x87dd..0x87f5 ===');
for (let o = 0x87dd; o < 0x87f5; o += 12) {
  const slice = buf.subarray(o, o+12);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Wait — I see the problem. Boundary is offset by 4 bytes.
// 0x87dd: 13 01 00 00 0b d1 22 ec 01 20 11 01 13 01 00 00 0b d1 22 ec
//                                                       ↑ event-log style 12B
// So actual record start is 0x87e1+something?
// Or the records ARE at 12B stride starting from 0x51b5 but the LAST one ends at 0x87e9
// 0x87e9 - 0x51b5 = 13876 bytes / 12 = 1156.33 (not exact)
// Need to recompute boundaries

// What's the schema? Try BOTH 12B strides at 0x51b5:
// (A) [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]
// (B) [u8 flag][u8 sub][u16 idA][u16 idB][u16 z][u32 hash]  (event-log)

// Actually let me look at the BIG picture. The event log dense section ran 0x87e9..0x2dca1 with
// schema [flag,sub,idA,idB,z,hash]. The very first record was:
//   0x87e9: 01 20 11 01 13 01 00 00 0b d1 22 ec
// And the LAST record of "UUID index":
//   0x87cd: 04 00 63 00 13 01 00 00 00 00 00 00
//   0x87d9: 01 20 10 01 13 01 00 00 0b d1 22 ec

// Then the EVENT LOG at 0x87e9 starts with:
//   01 20 11 01 13 01 00 00 0b d1 22 ec
// Both have idB=0x113=275, hash=0xec22d10b!

// So with the SAME schema (flag, sub, idA, idB, z, hash), records IMMEDIATELY before 0x87e9 also work:
// 0x87d9: f=1 s=0x20 idA=0x0110=272 idB=0x0113=275 z=0 h=0xec22d10b
// 0x87e9: f=1 s=0x20 idA=0x0111=273 idB=0x0113=275 z=0 h=0xec22d10b
// CONSECUTIVE idA — same actor, same year!

// So the SAME 12B event-log schema applies INSIDE the "UUID index" section too!
// The boundary at 0x87e9 was an artificial dividing line — it's all ONE event log.

// Let me verify: align 12B records at REC_START=0x51b5 with event-log schema. Are most records valid?
const REC_START = 0x51b5;
const REC_END = 0x87e9;
const N = (REC_END - REC_START) / 12;
console.log('\nUUID-index region with event-log schema: ' + N + ' records');

const recs = [];
for (let i = 0; i < N; i++) {
  const o = REC_START + i*12;
  recs.push({
    i, o,
    flag: buf[o], sub: buf[o+1],
    idA: buf.readUInt16LE(o+2),
    idB: buf.readUInt16LE(o+4),
    z: buf.readUInt16LE(o+6),
    h: buf.readUInt32LE(o+8) >>> 0
  });
}

// Flag distribution
const flagH = {};
for (const r of recs) flagH[r.flag] = (flagH[r.flag]||0)+1;
console.log('Flag distribution:');
Object.entries(flagH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([f,c])=>console.log('  flag=' + f + ': ' + c));

// idB (year) distribution
const idBs = recs.map(r=>r.idB);
const idBmin = Math.min(...idBs), idBmax = Math.max(...idBs);
console.log('idB range:', idBmin, '..', idBmax);

const idBcount = {};
for (const r of recs) idBcount[r.idB] = (idBcount[r.idB]||0)+1;
console.log('Distinct idB values:', Object.keys(idBcount).length);

// Validate: records where flag={1,2,4} should be valid (matches dense event log)
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && r.z===0 && r.idB < 800);
const zero = recs.filter(r=>r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.z===0 && r.h===0);
console.log('Valid event-log records (flag 1/2/4):', valid.length, '/', N);
console.log('All-zero records:', zero.length);
console.log('Other:', N - valid.length - zero.length);

// What's "other"?
const other = recs.filter(r=>!((r.flag===1||r.flag===2||r.flag===4)&&r.z===0) && !(r.flag===0&&r.sub===0&&r.idA===0&&r.idB===0&&r.z===0&&r.h===0));
console.log('First 15 "other" records:');
other.slice(0,15).forEach(r=>{
  const hex = Array.from(buf.subarray(r.o, r.o+12)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  [' + r.i + '] 0x' + r.o.toString(16) + ': ' + hex);
});

// First 20 records — same as before, with event-log schema
console.log('\n=== First 20 records (event-log schema) ===');
recs.slice(0,20).forEach(r=>console.log('  [' + r.i.toString().padStart(4) + '] 0x' + r.o.toString(16) + ' f=' + r.flag.toString().padStart(3) + ' s=' + r.sub.toString().padStart(3) + ' idA=' + r.idA.toString().padStart(5) + ' idB=' + r.idB.toString().padStart(5) + ' z=' + r.z + ' h=0x' + r.h.toString(16).padStart(8,'0')));

// The first records have z != 0 which means they're NOT valid event-log records
// They're a DIFFERENT 12B schema. Let me check: bytes 0x51b5..0x52a5 are formatted differently
console.log('\n=== Schema is DIFFERENT in early part of UUID-index region ===');
// 12B record 0: 00 00 00 00 04 00 e6 03 01 00 00 00
// With ALT schema [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]:
//   hash=0, flag=4, sub=0, idA=998, idB=1
// This is CONSISTENT with event log later
// So the boundary between SCHEMA-A (alt) and SCHEMA-B (event-log standard) happens somewhere

// Find the transition point: where does schema-A break?
// SCHEMA-A: [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]
// → valid if flag ∈ {0,1,2,4,7,...} AND sub ∈ {0,0x20} AND idA < 4096 AND idB < 800
// SCHEMA-B (event log): [u8 flag][u8 sub][u16 idA][u16 idB][u16 z][u32 hash]
// → valid if flag ∈ {1,2,4} AND sub ∈ {0,0x20} AND z=0 AND idB < 800

const schemaA = [];
const schemaB = [];
for (let i = 0; i < N; i++) {
  const o = REC_START + i*12;
  const aHash = buf.readUInt32LE(o);
  const aFlag = buf[o+4];
  const aSub = buf[o+5];
  const aIdA = buf.readUInt16LE(o+6);
  const aIdB = buf.readUInt32LE(o+8);
  const aValid = (aSub === 0 || aSub === 0x20) && aIdA < 4096 && aIdB < 800;
  const bFlag = buf[o];
  const bSub = buf[o+1];
  const bIdA = buf.readUInt16LE(o+2);
  const bIdB = buf.readUInt16LE(o+4);
  const bZ = buf.readUInt16LE(o+6);
  const bHash = buf.readUInt32LE(o+8) >>> 0;
  const bValid = (bFlag === 1 || bFlag === 2 || bFlag === 4) && (bSub === 0 || bSub === 0x20) && bZ === 0 && bIdB < 800;
  schemaA.push({i, o, valid: aValid, fields: {hash: aHash, flag: aFlag, sub: aSub, idA: aIdA, idB: aIdB}});
  schemaB.push({i, o, valid: bValid, fields: {flag: bFlag, sub: bSub, idA: bIdA, idB: bIdB, z: bZ, hash: bHash}});
}

let aWin = 0, bWin = 0;
for (let i = 0; i < N; i++) {
  if (schemaA[i].valid && !schemaB[i].valid) aWin++;
  else if (!schemaA[i].valid && schemaB[i].valid) bWin++;
}
console.log('Schema-A (hash-first) wins:', aWin);
console.log('Schema-B (flag-first event-log) wins:', bWin);

// Show transition region
console.log('\n=== Where SCHEMA-A→SCHEMA-B transition occurs ===');
for (let i = 0; i < N; i++) {
  if (schemaA[i].valid !== schemaB[i].valid && i > 700) {
    console.log('  [' + i + '] 0x' + schemaA[i].o.toString(16) + ' A=' + schemaA[i].valid + ' B=' + schemaB[i].valid);
    if (i > 720) break;
  }
}

// Print 10 records around i=1140 (where main event log transitions in)
console.log('\n=== Records 1100..1160 (both schemas) ===');
for (let i = 1100; i < 1160; i++) {
  const o = REC_START + i*12;
  const aS = schemaA[i].fields;
  const bS = schemaB[i].fields;
  const hex = Array.from(buf.subarray(o, o+12)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  [' + i + '] ' + hex + ' | A=' + (schemaA[i].valid?'✓':'✗') + ' hash=0x' + aS.hash.toString(16).padStart(8,'0') + ' f' + aS.flag + ' idA=' + aS.idA + ' idB=' + aS.idB + ' | B=' + (schemaB[i].valid?'✓':'✗') + ' f' + bS.flag + ' idA=' + bS.idA + ' idB=' + bS.idB + ' h=0x' + bS.hash.toString(16).padStart(8,'0'));
}
