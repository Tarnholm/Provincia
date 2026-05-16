// Full Alex Turn 1/2 fact sheet. Particularly interested in:
//   - Turn 1 End vs Turn 1 AI attacked (combat resolution mid-state)
//   - Turn 1 AI attacked vs Turn 2 Start (post-combat End Turn continuation)
//   - Turn 1 End vs Turn 2 Start (full Alex End Turn — small!)
//   - Turn 2 vs Turn 2 adoption (Alex adoption event)
//   - Turn 2 manual vs Turn 2 Start autosave (are they identical?)

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const SAVES = [
  ['t1_baseline',        BASE + 'save_17-05-2026   Macedon   Turn 1.sav'],
  ['besige_fort',        BASE + 'save_17-05-2026   Macedon   Turn 1 besige fort.sav'],
  ['besige_byz',         BASE + 'save_17-05-2026   Macedon   Turn 1 besige Byzantium.sav'],
  ['move_to_siege',      BASE + 'save_17-05-2026   Macedon   Turn 1 move 1 unit to besige fort army.sav'],
  ['disembark',          BASE + 'save_17-05-2026   Macedon   Turn 1 disembarkship.sav'],
  ['board_ship',         BASE + 'save_17-05-2026   Macedon   Turn 1 boeard ship.sav'],
  ['attack_retreats',    BASE + 'save_17-05-2026   Macedon   Turn 1 attack enemy that retreats.sav'],
  ['tax_pella',          BASE + 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'],
  ['tax_sparta',         BASE + 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'],
  ['building_queue',     BASE + 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'],
  ['unit_queue',         BASE + 'save_17-05-2026   Macedon   Turn 1 unit queued in Sparta, Pella.sav'],
  ['boat_to_port',       BASE + 'save_17-05-2026   Macedon   Turn 1 boat moved to port.sav'],
  ['t1_end_autosave',    BASE + 'save_Autosave   Macedon   Turn 1 End.sav'],
  ['t1_ai_attacked',     BASE + 'save_Turn 1 AI attacked, army next to besiged fort.sav'],
  ['t2_start_autosave',  BASE + 'save_Autosave   Macedon   Turn 2 Start.sav'],
  ['t2_manual',          BASE + 'save_17-05-2026   Macedon   Turn 2.sav'],
  ['t2_adoption',        BASE + 'save_17-05-2026   Macedon   Turn 2 adoption.sav'],
];

const bufs = {};
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) { console.log('MISSING', tag); continue; }
  bufs[tag] = fs.readFileSync(p);
}

function readCounters(buf) {
  return {
    year:   buf.readInt32LE(0x504),
    evtCtr: buf.readUInt32LE(0xefd),
  };
}

console.log('save'.padEnd(22) + '  size       year   evtCtr@0xefd  Δsize_vs_baseline');
for (const [tag] of SAVES) {
  if (!bufs[tag]) continue;
  const c = readCounters(bufs[tag]);
  const δ = bufs[tag].length - bufs.t1_baseline.length;
  console.log(tag.padEnd(22) + '  ' + bufs[tag].length.toString().padStart(8) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(8) +
              '       ' + (δ >= 0 ? '+' : '') + δ);
}

// Check: are t2_manual and t2_start_autosave IDENTICAL byte-for-byte?
console.log('\n=== Manual save vs autosave at turn 2 ===');
if (bufs.t2_manual && bufs.t2_start_autosave) {
  const a = bufs.t2_manual, b = bufs.t2_start_autosave;
  if (a.length !== b.length) {
    console.log('  DIFFERENT SIZES:', a.length, 'vs', b.length);
  } else {
    let diffs = 0;
    const positions = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diffs++;
        if (positions.length < 10) positions.push(i);
      }
    }
    console.log('  same size (' + a.length + ' bytes). Mismatching bytes:', diffs);
    if (positions.length > 0) console.log('  first 10 diff positions:', positions.map(o => '0x' + o.toString(16)));
  }
}

// Focused diffs for the EndTurn sequence
function diffSummary(label, a, b) {
  console.log('\n=== ' + label + ' ===');
  console.log('  size: A=' + a.length + ' B=' + b.length + ' Δ=' + (b.length - a.length));
  // First diff from front, last from back
  let frontDiff = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { frontDiff = i; break; }
  }
  let backDiff = -1;
  let ai = a.length - 1, bi = b.length - 1;
  while (ai >= 0 && bi >= 0) {
    if (a[ai] !== b[bi]) { backDiff = bi; break; }
    ai--; bi--;
  }
  console.log('  divergence: 0x' + frontDiff.toString(16) + ' .. 0x' + backDiff.toString(16) + ' (in B)');
  console.log('  divergence width: ' + (backDiff - frontDiff + 1) + ' bytes in B, ' + ((backDiff - frontDiff + 1) - (b.length - a.length)) + ' in A');
  // Counter advance
  if (frontDiff === 0xefd) {
    console.log('  counter@0xefd advance: ' + a.readUInt32LE(0xefd) + ' → ' + b.readUInt32LE(0xefd) + '  Δ=' + (b.readUInt32LE(0xefd) - a.readUInt32LE(0xefd)));
  }
}

diffSummary('Turn 1 End autosave → AI attacked (combat resolution mid-state)',
            bufs.t1_end_autosave, bufs.t1_ai_attacked);
diffSummary('AI attacked → Turn 2 Start (post-combat End Turn continuation)',
            bufs.t1_ai_attacked, bufs.t2_start_autosave);
diffSummary('Turn 1 End → Turn 2 Start (full Alex End Turn)',
            bufs.t1_end_autosave, bufs.t2_start_autosave);
diffSummary('Turn 2 manual → Turn 2 adoption (Alex adoption event)',
            bufs.t2_manual, bufs.t2_adoption);
diffSummary('Turn 1 baseline → boat_to_port → t1_end_autosave',
            bufs.boat_to_port, bufs.t1_end_autosave);

// Look for the +614 trio pattern — three same-size actions that should
// reveal action-type and region-id fields
console.log('\n=== +614 trio comparison (attack_retreats, tax_pella, tax_sparta) ===');
const trio = ['attack_retreats', 'tax_pella', 'tax_sparta'];
for (let i = 0; i < trio.length; i++) {
  for (let j = i + 1; j < trio.length; j++) {
    const a = bufs[trio[i]], b = bufs[trio[j]];
    let diffs = 0;
    const positions = [];
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      if (a[k] !== b[k]) {
        diffs++;
        if (positions.length < 30) positions.push(k);
      }
    }
    console.log('  ' + trio[i] + ' vs ' + trio[j] + ': ' + diffs + ' mismatching bytes (first 10: ' +
                positions.slice(0, 10).map(o => '0x' + o.toString(16)).join(', ') + ')');
  }
}

// Adoption record extraction from Turn 2 adoption
console.log('\n=== Turn 2 adoption record extraction ===');
function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}
console.log('  "Adoption" hits in t2_adoption:', findUtf16(bufs.t2_adoption, 'Adoption').map(o => '0x' + o.toString(16)));
console.log('  "Adoption" hits in t2_manual:  ', findUtf16(bufs.t2_manual, 'Adoption').map(o => '0x' + o.toString(16)));
