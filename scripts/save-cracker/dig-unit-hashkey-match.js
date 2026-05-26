// dig-unit-hashkey-match.js
// Find a STABLE per-unit key to join the same unit across saves. Candidates:
//   - u32 hash at name+2+nameLen+0
//   - u32 seed at name+2+nameLen+4
//   - the commander/bodyguard uuid (only for general units)
// Test stability: count how many (hash) keys are unique within a save and how
// many persist BEFORE->UPGRADED (armor experiment) and PRE->T2 (retrain).
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

function load(file) {
  const buf = fs.readFileSync(path.join(BASE_R, file));
  const recs = findUnitRecords(buf);
  for (const r of recs) {
    const off = r.offset + 2 + Buffer.from(r.name, 'ascii').length + 1; // after name+null
    r.hash = buf.readUInt32LE(off);
    r.seed = buf.readUInt32LE(off + 4);
  }
  return { buf, recs };
}

function analyze(tagA, fileA, tagB, fileB) {
  const A = load(fileA), B = load(fileB);
  console.log(`\n===== ${tagA} (${A.recs.length} units)  vs  ${tagB} (${B.recs.length} units) =====`);
  // Uniqueness of hash within A
  const hashCountA = {};
  for (const r of A.recs) hashCountA[r.hash] = (hashCountA[r.hash] || 0) + 1;
  const dupHash = Object.values(hashCountA).filter(c => c > 1).length;
  console.log(`  hash uniqueness in ${tagA}: ${Object.keys(hashCountA).length} distinct, ${dupHash} hashes used by >1 unit`);
  // join by hash
  const bByHash = new Map();
  for (const r of B.recs) {
    if (!bByHash.has(r.hash)) bByHash.set(r.hash, []);
    bByHash.get(r.hash).push(r);
  }
  let matched = 0, nameMismatch = 0;
  for (const r of A.recs) {
    const cand = bByHash.get(r.hash);
    if (cand && cand.length === 1) {
      matched++;
      if (cand[0].name !== r.name) nameMismatch++;
    }
  }
  console.log(`  unique-hash 1:1 matches ${tagA}->${tagB}: ${matched} (name mismatches: ${nameMismatch})`);
  return { A, B, bByHash };
}

analyze('PRE', 'save_arretium pre retrained..sav', 'T2', 'save_arretium retrained turn 2.sav');
analyze('BEFORE', 'save_before armor upgrade queue.sav', 'UPGRADED', 'save_next turn, armour upgraded..sav');
analyze('AFTERQ', 'save_after amour upgrade queue.sav', 'UPGRADED', 'save_next turn, armour upgraded..sav');
