// dig-header-classify.js
// Classify every header byte 0x00-0x500 as static-per-campaign vs dynamic
// across multiple diff sets, and look for monotonic turn/year counters.
//
// Diff sets:
//   A) t0..t7  (same campaign, 8 sequential turns) -> turn/year counters
//   B) Spain T1..T4 (same campaign) -> turn/year
//   C) arretium PRE..T4 (same campaign) -> turn/year
//   D) Carthage T1End/T2Start/T2 (same campaign)
//   E) cross-campaign (macedon/seleucid/spain/rome/t0/carthage) -> campaign config

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

function load(name) { return fs.readFileSync(path.join(S, name)); }

const sets = {
  A_t0_t7: [
    ['t0', 'save_t0.sav'],
    ['t0end', 'save_t0justbeforeturnend.sav'],
    ['t1', 'save_t1.sav'],
    ['t2', 'save_t2.sav'],
    ['t3', 'save_t3.sav'],
    ['t4', 'save_t4.sav'],
    ['t5', 'save_t5.sav'],
    ['t6', 'save_t6.sav'],
    ['t7', 'save_t7.sav'],
  ],
  B_spain: [
    ['Sp-T1', 'save_17-05-2026   Spain   Turn 1.sav'],
    ['Sp-T2', 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'],
    ['Sp-T3', 'save_Autosave   Spain   Turn 3 End.sav'],
    ['Sp-T4', 'save_Autosave   Spain   Turn 4 Start.sav'],
  ],
  C_arretium: [
    ['Ar-PRE', 'save_arretium pre retrained..sav'],
    ['Ar-QUE', 'save_arretium queued retrain.sav'],
    ['Ar-T2', 'save_arretium retrained turn 2.sav'],
    ['Ar-T3', 'save_arretium turn 3.sav'],
    ['Ar-T4', 'save_arretium turn 4.sav'],
  ],
  D_carthage: [
    ['Ca-T1E', 'save_Autosave   Carthage   Turn 1 End.sav'],
    ['Ca-T2S', 'save_Autosave   Carthage   Turn 2 Start.sav'],
    ['Ca-T2', 'save_Autosave   Carthage   Turn 2.sav'],
  ],
  E_cross: [
    ['t0(player?)', 'save_t0.sav'],
    ['Spain', 'save_17-05-2026   Spain   Turn 1.sav'],
    ['Macedon', 'save_macedon t0.sav'],
    ['Seleucid', 'save_Seleucids t0.sav'],
    ['Rome', 'save_Autosave   Republic of Rome   Turn 2.sav'],
    ['Carthage', 'save_Autosave   Carthage   Turn 1 End.sav'],
    ['Antigonid', 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
  ],
};

// header.parseHeader campaign name / uuid
function hdr(buf) {
  const campaignUuid = buf.readUInt32LE(0x04);
  const typeFlag = buf.readUInt32LE(0x1c);
  const version = buf.readUInt32LE(0x20);
  const ts = buf.readUInt32LE(0x30);
  const nameLen = buf.readUInt16LE(0x3a);
  let name = '';
  for (let i = 0; i < nameLen && i < 64; i++) name += String.fromCharCode(buf.readUInt16LE(0x3c + i * 2));
  return { campaignUuid, typeFlag, version, ts, nameLen, name, nameEnd: 0x3c + nameLen * 2 };
}

console.log('=== Header summary per save (each set) ===');
for (const [setName, list] of Object.entries(sets)) {
  console.log('\n--- ' + setName + ' ---');
  for (const [tag, fn] of list) {
    const buf = load(fn);
    const h = hdr(buf);
    console.log('  ' + tag.padEnd(12) +
      ' uuid=0x' + h.campaignUuid.toString(16).padStart(8, '0') +
      ' type=0x' + h.typeFlag.toString(16) +
      ' ver=' + h.version +
      ' ts=' + h.ts +
      ' nameEnd=0x' + h.nameEnd.toString(16) +
      ' name="' + h.name + '"');
  }
}

// For a set of buffers, find every offset (byte granularity) in [0,LIMIT)
// whose value VARIES across the set. Return per-offset value lists.
const LIMIT = 0x500;
function varyingBytes(list) {
  const bufs = list.map(([tag, fn]) => ({ tag, buf: load(fn) }));
  const varies = [];
  for (let off = 0; off < LIMIT; off++) {
    const vals = bufs.map(b => off < b.buf.length ? b.buf[off] : -1);
    if (new Set(vals).size > 1) varies.push({ off, vals });
  }
  return { bufs, varies };
}

// Print varying offsets for the same-campaign sets (these hint at counters).
for (const setName of ['A_t0_t7', 'B_spain', 'C_arretium', 'D_carthage']) {
  const list = sets[setName];
  const { bufs, varies } = varyingBytes(list);
  console.log('\n\n=== ' + setName + ': bytes in 0x00-0x500 that VARY across the set (' + varies.length + ' bytes) ===');
  console.log('   tags: ' + bufs.map(b => b.tag).join(', '));
  // Group into runs and report u32 interpretations for aligned starts
  for (const v of varies) {
    const note = (v.off >= 0x3c) ? '' : '';
    console.log('  0x' + v.off.toString(16).padStart(3, '0') + ': ' + v.vals.map(x => x.toString(16).padStart(2, '0')).join(' '));
  }
}
