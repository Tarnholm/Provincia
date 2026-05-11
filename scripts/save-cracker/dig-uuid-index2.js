// Session 26 — Reconcile UUID index schema vs event log schema
// Looking at the TAIL: 0x87d1 onwards reads correctly as event log 12B records.
// But the HEAD at 0x51b5 has different field positions.
// HYPOTHESIS: same 12-byte stride, same fields. The schema is:
//   [u32 hash][u32 location_marker][u32 year]
// OR
//   [u8 flag][u8 sub][u16 idA][u16 idB][u16 z][u32 hash]  (event log schema)
//
// Let me decode the UUID index with BOTH schemas and see which makes sense.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const SECT_START = 0x51ad;
const HDR_LEN = 8;  // self-pointer + size
const REC_START = SECT_START + HDR_LEN;  // 0x51b5
const REGION_END = 0x87e9;
const STRIDE = 12;
const N = Math.floor((REGION_END - REC_START) / STRIDE);
console.log('UUID-index records:', N, 'at stride 12');
console.log('Section spans', '0x' + REC_START.toString(16), '..', '0x' + REGION_END.toString(16));

// Decode with EVENT-LOG schema: [u8 flag][u8 sub][u16 idA][u16 idB][u16 z][u32 hash]
const eventLogSchema = [];
for (let i = 0; i < N; i++) {
  const o = REC_START + i*STRIDE;
  eventLogSchema.push({
    i, o,
    flag: buf[o], sub: buf[o+1],
    idA: buf.readUInt16LE(o+2),
    idB: buf.readUInt16LE(o+4),
    z: buf.readUInt16LE(o+6),
    h: buf.readUInt32LE(o+8) >>> 0
  });
}

// First 20 with event-log schema
console.log('\n=== Event-log schema applied: first 20 ===');
eventLogSchema.slice(0, 20).forEach(r=>{
  console.log('  [' + r.i.toString().padStart(4) + '] 0x' + r.o.toString(16) + ' f=' + r.flag + ' s=' + r.sub.toString(16).padStart(2,'0') + ' idA=' + r.idA.toString().padStart(5) + ' idB=' + r.idB.toString().padStart(5) + ' z=' + r.z + ' h=0x' + r.h.toString(16).padStart(8,'0'));
});

// Validate: with event-log schema, should flag/sub be {0..255} and look like the main event log?
const flagH = {};
for (const r of eventLogSchema) flagH[r.flag] = (flagH[r.flag]||0)+1;
console.log('\nFlag distribution (event-log schema):');
Object.entries(flagH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([f,c])=>console.log('  flag=' + f + ': ' + c));

// idB distribution
const idBs = eventLogSchema.map(r=>r.idB);
console.log('idB range:', Math.min(...idBs), '..', Math.max(...idBs));
// Should be valid years if event-log schema is right (275..695 dominant)

// Hash distribution
const hH = {};
for (const r of eventLogSchema) hH[r.h] = (hH[r.h]||0)+1;
console.log('Distinct hashes:', Object.keys(hH).length);

// Looking at hex 0x51b5: 00 00 00 00 04 00 e6 03 01 00 00 00
// With event-log schema:
//   flag=0, sub=0 — looks like an EMPTY slot
// With OTHER schema (hash first):
//   hash=0, flag=4, sub=0, idA=0x03e6=998, idB=1
// The first 16 records' tail showed:
//   06 03 01 00 00 00  — that's idA=0x0306=774, idB=1?
//   Actually the hex was: 00 00 00 00 04 00 ea 03 01 00 00 00
//   So: u32 hash=0, byte=4 (flag?), byte=0 (sub?), u16 idA=0x03ea=1002, u32 idB=1

// Try ALTERNATE schema for first 20: [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]
console.log('\n=== Alternate schema [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB]: first 20 ===');
const altSchema = [];
for (let i = 0; i < N; i++) {
  const o = REC_START + i*STRIDE;
  altSchema.push({
    i, o,
    h: buf.readUInt32LE(o) >>> 0,
    flag: buf[o+4], sub: buf[o+5],
    idA: buf.readUInt16LE(o+6),
    idB: buf.readUInt32LE(o+8)
  });
}
altSchema.slice(0,20).forEach(r=>console.log('  [' + r.i.toString().padStart(4) + '] 0x' + r.o.toString(16) + ' h=0x' + r.h.toString(16).padStart(8,'0') + ' f=' + r.flag + ' s=' + r.sub + ' idA=' + r.idA.toString().padStart(5) + ' idB=' + r.idB.toString().padStart(5)));

// Now: look at altSchema tail (where event log starts)
console.log('\n=== Alt schema: last 20 records (should transition into event log) ===');
altSchema.slice(-20).forEach(r=>console.log('  [' + r.i.toString().padStart(4) + '] 0x' + r.o.toString(16) + ' h=0x' + r.h.toString(16).padStart(8,'0') + ' f=' + r.flag + ' s=' + r.sub + ' idA=' + r.idA.toString().padStart(5) + ' idB=' + r.idB.toString().padStart(5)));

// Check: in alt-schema, the LAST record at 0x87dd should be: 0x113 0xec22d10b ... wait
// I expect the last record to begin the main event log
// 0x87dd = REC_START + ?*12; let me compute
console.log('\nLast record offsets: 0x' + (REC_START + (N-1)*12).toString(16) + ' to 0x' + (REC_START + N*12 - 1).toString(16));

// Idea: each section of the UUID index might have a special schema
// Where the section is a per-faction history block, with "actor_hash=0" meaning unowned/rebel
// idA = character/army ID
// idB = year (1, 4, 7, ... small early values then ramping up)

// Alt schema's idB range
const altIdBs = altSchema.map(r=>r.idB);
console.log('\nAlt-schema idB range:', Math.min(...altIdBs), '..', Math.max(...altIdBs));

// Try to find what 0x03e60004 represents
// Maybe it's not a u32 but two u16: 0x0004, 0x03e6 = (lo=4, hi=998)
// 4 = an event type, 998 = an idA
// Then NEXT 12 bytes: 0x00000000, 0x03ea0004, 0x00000001 = lo=4, hi=1002, then idB=1
// Actually let me re-examine byte positions

// New schema: [u32 prev_hash_or_zero][u8 a][u8 b][u16 idA][u32 idB]
// Where prev_hash is shared across consecutive records (faction-history grouping?)
// rec[0]: hash=0, idA=998, idB=1
// rec[1]: hash=0, idA=1002, idB=1
// rec[2]: hash=0, idA=1006, idB=1
// rec[3]: hash=0, idA=1010, idB=1
// rec[4]: hash=0, idA=1016, idB=1
// rec[5]: hash=0, idA=998, idB=4
// rec[6]: hash=0, idA=1002, idB=4
// rec[7]: hash=0, idA=1006, idB=4
// rec[8]: hash=0, idA=1010, idB=4
// rec[9]: hash=0, idA=635, idB=7  -- wait that's odd
// Actually rec[9] had: 04 00 7b 02 07 00 00 00 -- idA=0x027b=635, idB=7

// This LOOKS like a per-year roster of characters / armies
// Where idA = character/army-ID and idB = year
// Each year, 5 IDs are listed (998, 1002, 1006, 1010, 1016 at year=1)
// Then next year another 5 IDs: same plus differences
// This could be the FACTION-CHANGE log: which characters belonged to which faction in which year

// Let me check the entries with non-zero hash
const nonZeroHash = altSchema.filter(r=>r.h !== 0);
console.log('\nRecords with non-zero hash:', nonZeroHash.length);
console.log('First 20 non-zero-hash records:');
nonZeroHash.slice(0,20).forEach(r=>console.log('  [' + r.i + '] h=0x' + r.h.toString(16).padStart(8,'0') + ' f=' + r.flag + ' s=' + r.sub + ' idA=' + r.idA + ' idB=' + r.idB));

// Sanity: hash 0xec22d10b is the first event-log hash
// In alt-schema, where does it appear?
const ecHits = altSchema.filter(r=>r.h === 0xec22d10b);
console.log('\nHash 0xec22d10b appears in UUID index alt-schema at:', ecHits.length, 'records');
ecHits.slice(0,5).forEach(r=>console.log('  [' + r.i + '] h=0x' + r.h.toString(16) + ' f=' + r.flag + ' s=' + r.sub + ' idA=' + r.idA + ' idB=' + r.idB));

// Try fields a different way - maybe FLAG and SUB are at different positions
// Looking at 0x87dd: 13 01 00 00 0b d1 22 ec 01 20 11 01
// First 4B: 0x113 = 275 (year), then 4B: 0xec22d10b (hash), then 4B: 0x01112001 (= 01 20 11 01 = flag=1, sub=0x20, idA=0x111=273)
// So actually the schema might be:  [u32 year][u32 hash][u32 event_packed] = 12 bytes!
// Where event_packed = [u8 flag][u8 sub][u16 idA]
console.log('\n=== NEW schema: [u32 year][u32 hash][u8 flag][u8 sub][u16 idA] ===');
const newSchema = [];
for (let i = 0; i < N; i++) {
  const o = REC_START + i*STRIDE;
  newSchema.push({
    i, o,
    year: buf.readUInt32LE(o),
    hash: buf.readUInt32LE(o+4) >>> 0,
    flag: buf[o+8], sub: buf[o+9],
    idA: buf.readUInt16LE(o+10)
  });
}
console.log('First 20 (new schema):');
newSchema.slice(0,20).forEach(r=>console.log('  [' + r.i + '] year=' + r.year.toString().padStart(5) + ' hash=0x' + r.hash.toString(16).padStart(8,'0') + ' f=' + r.flag + ' s=' + r.sub.toString().padStart(3) + ' idA=' + r.idA.toString().padStart(5)));
console.log('Last 10:');
newSchema.slice(-10).forEach(r=>console.log('  [' + r.i + '] year=' + r.year.toString().padStart(5) + ' hash=0x' + r.hash.toString(16).padStart(8,'0') + ' f=' + r.flag + ' s=' + r.sub.toString().padStart(3) + ' idA=' + r.idA.toString().padStart(5)));

// Year distribution
const yH = {};
for (const r of newSchema) yH[r.year]=(yH[r.year]||0)+1;
console.log('Year-field distribution (top 15):');
Object.entries(yH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).slice(0,15).forEach(([y,c])=>console.log('  year=' + y + ': ' + c));
console.log('Distinct year values:', Object.keys(yH).length);

// Years range
const ys = newSchema.map(r=>r.year);
console.log('Year range:', Math.min(...ys), '..', Math.max(...ys));
