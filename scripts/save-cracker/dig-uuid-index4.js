// Session 26 — SCHEMA UNIFICATION: test if SCHEMA-A works on BOTH regions.
// SCHEMA-A: [u32 hash][u8 flag][u8 sub][u16 idA][u32 idB] @ 12B stride
// Apply across full 0x51b5..0x846af region.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const FULL_START = 0x51b5;
const FULL_END = 0x846af;
const STRIDE = 12;
const N = Math.floor((FULL_END - FULL_START) / STRIDE);
console.log('Full event-log region (unified): 0x' + FULL_START.toString(16), '..0x' + FULL_END.toString(16), '=', (FULL_END-FULL_START), 'bytes,', N, 'records');

const recs = [];
for (let i = 0; i < N; i++) {
  const o = FULL_START + i*STRIDE;
  recs.push({
    i, o,
    hash: buf.readUInt32LE(o) >>> 0,
    flag: buf[o+4], sub: buf[o+5],
    idA: buf.readUInt16LE(o+6),
    idB: buf.readUInt32LE(o+8)
  });
}

// Validity check
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);
const zero = recs.filter(r=>r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.hash===0);
const other = recs.filter(r=>!((r.flag===1||r.flag===2||r.flag===4)&&(r.sub===0||r.sub===0x20)&&r.idB>0&&r.idB<800&&r.idA<4096)&&!(r.flag===0&&r.sub===0&&r.idA===0&&r.idB===0&&r.hash===0));
console.log('\nWith SCHEMA-A (hash-first, idB u32):');
console.log('  Valid records:', valid.length, '(' + (100*valid.length/N).toFixed(1) + '%)');
console.log('  All-zero:', zero.length);
console.log('  Other:', other.length);

// Flag distribution under SCHEMA-A
const flagH = {};
for (const r of recs) flagH[r.flag] = (flagH[r.flag]||0)+1;
const flagS = Object.entries(flagH).sort((a,b)=>b[1]-a[1]);
console.log('\nFlag distribution (full region):');
flagS.slice(0,10).forEach(([f,c])=>console.log('  flag=' + f + ': ' + c));
console.log('Distinct flag values:', flagS.length);

// Sub distribution
const subH = {};
for (const r of recs) subH[r.sub] = (subH[r.sub]||0)+1;
console.log('Sub distribution:');
Object.entries(subH).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([s,c])=>console.log('  sub=0x' + parseInt(s).toString(16) + ': ' + c));

// idB (year) distribution
const idBs = valid.map(r=>r.idB);
console.log('\nidB (year) range (valid records):', Math.min(...idBs), '..', Math.max(...idBs));
const idBcount = {};
for (const r of valid) idBcount[r.idB] = (idBcount[r.idB]||0)+1;
console.log('Distinct idB values:', Object.keys(idBcount).length);

// Per-year event count for top 15 years
const idByear = Object.entries(idBcount).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
console.log('First 10 years:');
idByear.slice(0,10).forEach(([y,c])=>console.log('  year=' + y + ': ' + c + ' events'));
console.log('Last 10 years:');
idByear.slice(-10).forEach(([y,c])=>console.log('  year=' + y + ': ' + c + ' events'));

// HOORAY: This is the unified event log.
// idB = year (relative to game start which is some "year 0" – game-start = 270 BC).
// Actually rome10 is T5 (turn 5), so current game-year = 5. The MAX idB in valid is 696.
// 696 - 5 = 691 — that's "future" years scheduled or 270 BC + 696 = AD 426 (end of campaign)

// Top hash + faction-ID cross-check
const hashH = {};
for (const r of valid) hashH[r.hash] = (hashH[r.hash]||0)+1;
const hashS = Object.entries(hashH).sort((a,b)=>b[1]-a[1]);
console.log('\nTop 20 actor hashes:');
hashS.slice(0,20).forEach(([h,c])=>console.log('  0x' + (parseInt(h)>>>0).toString(16).padStart(8,'0') + ': ' + c));
console.log('Distinct hashes (valid):', hashS.length);

// Faction-ID cross-ref
const factionIds = {};
const FOOTER_START = 0x210f56f, FOOTER_END = 0x2110a23;
let p = FOOTER_START;
while (p < FOOTER_END - 8) {
  const nameLen = buf.readUInt32LE(p);
  if (nameLen > 0 && nameLen < 100 && p + 4 + nameLen*2 + 4 <= FOOTER_END) {
    let s = '', ok = true;
    for (let i = 0; i < nameLen; i++) {
      const lo = buf[p+4+i*2], hi = buf[p+4+i*2+1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      s += String.fromCharCode(lo);
    }
    if (ok) {
      const valOff = p + 4 + nameLen*2;
      const v = buf.readUInt32LE(valOff);
      if (/^id_/.test(s)) factionIds[v>>>0] = s.replace(/^id_/, '');
      p = valOff + 4;
      continue;
    }
  }
  p++;
}
console.log('Faction IDs loaded:', Object.keys(factionIds).length);

let factionHashHits = 0;
for (const r of valid) if (factionIds[r.hash]) factionHashHits++;
console.log('Valid records with hash ∈ faction-IDs:', factionHashHits);

// Try: maybe hash is a CHARACTER UUID. Number of distinct hashes
// 1437 distinct hashes (earlier session 3 finding) - but session 25 said 469 character_paths
// 469 << 1437 — so hashes are NOT character_paths section IDs

// CRITICAL: if SCHEMA-A is right and idB = year, idA = some entity ID
// idA range: max 4096 (or so). With ~1500 hashes (= actors), idA might be the "target" of each event
// idA could be: settlement ID, region ID, character ID — small numbers fit

// idA distribution
const idAs = valid.map(r=>r.idA);
console.log('\nidA range (valid):', Math.min(...idAs), '..', Math.max(...idAs));
const idAcount = {};
for (const r of valid) idAcount[r.idA] = (idAcount[r.idA]||0)+1;
console.log('Distinct idA values:', Object.keys(idAcount).length);
// Most common
const idAtop = Object.entries(idAcount).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('Top 10 idA values:');
idAtop.forEach(([a,c])=>console.log('  idA=' + a + ': ' + c));

// CRITICAL test: same-hash entries with consecutive idA mean a "path" — let's verify
// E.g. rec[1110..1114]: hash=0xec22d10b, idA=275-279 in year 273
// rec[1147..1153]: hash=0xb53a6c46, idA=840-846 in year 274
// rec[1124..1126]: hash=0xd87f3809, idA=545-547 in year 273
// All within same year. Same actor moving through 5-7 sequential idA values.

// HYPOTHESIS: idA is the TILE ID along a movement path
// For rome10 (T5), max year = 275 = game-start. So everything before 275 is HISTORICAL.
// idB=1..275 = pre-game history? Maybe historical events recorded for context.
// Actually, the game-start year is 270 BC, internal idB=270, T5=idB 275.
// idB < 270 are unused space? Or pre-game-history starting events?

// Per-year count graph
console.log('\n=== Events per year (full range, valid records) ===');
const yearBuckets = {};
for (const r of valid) {
  const y = r.idB;
  yearBuckets[y] = (yearBuckets[y]||0)+1;
}
// Print every 25th year
const allYears = Object.keys(yearBuckets).map(Number).sort((a,b)=>a-b);
console.log('Years range:', allYears[0], '..', allYears[allYears.length-1], '(' + allYears.length + ' distinct)');
for (let i = 0; i < allYears.length; i += 25) {
  console.log('  year=' + allYears[i] + ': ' + yearBuckets[allYears[i]]);
}

// Cross-check: do hashes appear for years before AND after game-start year (270)?
// If so, hash = character UUID, and the log goes back to pre-game-history events for context
// If hashes only appear in idB >= 270, then they're per-game-actor records only
const hashByYearRange = {};
for (const r of valid) {
  if (!hashByYearRange[r.hash]) hashByYearRange[r.hash] = {minY: r.idB, maxY: r.idB};
  else {
    hashByYearRange[r.hash].minY = Math.min(hashByYearRange[r.hash].minY, r.idB);
    hashByYearRange[r.hash].maxY = Math.max(hashByYearRange[r.hash].maxY, r.idB);
  }
}
const preGameHashes = Object.entries(hashByYearRange).filter(([h, r]) => r.minY < 270).length;
const postGameHashes = Object.entries(hashByYearRange).filter(([h, r]) => r.maxY > 275).length;
const inBothHashes = Object.entries(hashByYearRange).filter(([h, r]) => r.minY < 270 && r.maxY > 275).length;
console.log('\nHashes with idB < 270 (pre-game):', preGameHashes);
console.log('Hashes with idB > 275 (post-T5):', postGameHashes);
console.log('Hashes spanning both:', inBothHashes);

// First record at idB=275 (game-start) onwards
const gameRecs = valid.filter(r=>r.idB >= 270);
console.log('Records at idB >= 270 (game-time):', gameRecs.length);
// Unique hashes at idB >= 270
const gameHashes = new Set(gameRecs.map(r=>r.hash));
console.log('Distinct hashes at game-time:', gameHashes.size);

const preGameRecs = valid.filter(r=>r.idB < 270);
console.log('Records at idB < 270 (pre-game):', preGameRecs.length);
const preHashes = new Set(preGameRecs.map(r=>r.hash));
console.log('Distinct hashes pre-game:', preHashes.size);

// Intersection
let sharedHashes = 0;
for (const h of preHashes) if (gameHashes.has(h)) sharedHashes++;
console.log('Hashes shared between pre-game and game-time:', sharedHashes);
