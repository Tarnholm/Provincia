// dig-header-year-player.js
// (1) Hunt YEAR anywhere in body: imperial campaign starts 270 BC. Across t0..t7
//     a year value would be 270,269,... (or summer/winter 2 turns/yr) or BC stored
//     as negative. Search whole file for turn-correlated int with |slope| in {0.5,1,2}.
// (2) Vanilla anchor: Spain has no descr_strat path. Find an alternate stable
//     anchor for the turn counter in vanilla saves.
// (3) Player faction id: is there a small int near the turn counter / header that
//     equals the known player faction index per save?

const fs = require('fs');
const path = require('path');
const S = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
function load(name) { return fs.readFileSync(path.join(S, name)); }

const tb = [
  ['t0', 0, 'save_t0.sav'], ['t1', 1, 'save_t1.sav'], ['t2', 2, 'save_t2.sav'],
  ['t3', 3, 'save_t3.sav'], ['t4', 4, 'save_t4.sav'], ['t5', 5, 'save_t5.sav'],
  ['t6', 6, 'save_t6.sav'], ['t7', 7, 'save_t7.sav'],
].map(([tag, t, fn]) => ({ tag, turn: t, buf: load(fn) }));

const minLen = Math.min(...tb.map(b => b.buf.length));

// ── PART 1: whole-file year hunt (turn-correlated int, slope -2..-0.5 or +) ──
// To keep it tractable, only inspect offsets where t0..t7 all differ AND form a
// perfectly linear sequence with integer-ish slope of small magnitude. We already
// scanned 0..0x40000 for slope in [-10,10] step int and found only the turn ctr.
// Now widen to whole common length but require |slope| in {1,2} and the t0 base
// to look like a plausible year (|base| in 200..400, i.e. 270 BC region).
console.log('=== PART 1: whole-file scan for YEAR-like turn-correlated int ===');
console.log('minLen=0x' + minLen.toString(16) + ' — scanning every byte (this is the full common prefix)');
let yearHits = 0;
for (let off = 0; off + 4 <= minLen; off++) {
  const v0 = tb[0].buf.readInt32LE(off);
  const v1 = tb[1].buf.readInt32LE(off);
  const slope = v1 - v0;
  if (slope === 0 || Math.abs(slope) > 2) continue;
  let ok = true;
  for (let i = 1; i < 8; i++) {
    if (tb[i].buf.readInt32LE(off) !== v0 + slope * i) { ok = false; break; }
  }
  if (!ok) continue;
  // skip the turn counter (slope 1, v0 0)
  if (slope === 1 && v0 === 0) continue;
  yearHits++;
  if (yearHits <= 60) {
    const vals = tb.map(b => b.buf.readInt32LE(off));
    console.log('  0x' + off.toString(16).padStart(6, '0') + ' slope=' + slope + ' base=' + v0 + ' vals=[' + vals.join(',') + ']');
  }
}
console.log('Total non-turn linear int offsets (|slope|<=2): ' + yearHits);

// Also a 2-turns-per-year model: year only changes every 2 turns. Look for an int
// that is constant for {t0,t1}, then {t2,t3}, etc. stepping by a fixed amount.
console.log('\n=== PART 1b: 2-turns-per-year stepped int (changes every 2 turns) ===');
let stepHits = 0;
for (let off = 0; off + 4 <= minLen; off++) {
  const v = tb.map(b => b.buf.readInt32LE(off));
  // pattern: v[0]==v[1], v[2]==v[3], v[4]==v[5], v[6]==v[7], with constant diff d=v[2]-v[0]
  if (v[0] !== v[1] || v[2] !== v[3] || v[4] !== v[5] || v[6] !== v[7]) continue;
  const d = v[2] - v[0];
  if (d === 0 || Math.abs(d) > 2) continue;
  if (v[4] - v[2] !== d || v[6] - v[4] !== d) continue;
  stepHits++;
  if (stepHits <= 40) console.log('  0x' + off.toString(16).padStart(6, '0') + ' d=' + d + ' vals=[' + v.join(',') + ']');
}
console.log('Total 2-turn-stepped int offsets: ' + stepHits);

// ── PART 2: vanilla anchor for turn counter ──
// Spain (vanilla, no mod path) — find its turn counter. We know Spain T1..T4.
// Look for the constant byte pattern `01 XX 00 00 00` that precedes/contains turn.
console.log('\n\n=== PART 2: vanilla (Spain) turn counter location ===');
const spainSeq = [
  ['Sp-T1', 1, 'save_17-05-2026   Spain   Turn 1.sav'],
  ['Sp-T2', 2, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'],
  ['Sp-T3', 3, 'save_Autosave   Spain   Turn 3 End.sav'],
  ['Sp-T4', 4, 'save_Autosave   Spain   Turn 4 Start.sav'],
].map(([tag, t, fn]) => ({ tag, turn: t, buf: load(fn) }));
const spMin = Math.min(...spainSeq.map(b => b.buf.length));
// turn counter = file turn - 1 for autosaves (T2..T4 are autosaves; T1 is manual)
// Expected counter: Sp-T1=0(manual at turn1? or 1), Sp-T2=1, Sp-T3=2, Sp-T4=3
// They are strictly increasing by 1. Find u32 increasing by 1.
const spCands = [];
for (let off = 0; off + 4 <= Math.min(spMin, 0x60000); off++) {
  const v = spainSeq.map(b => b.buf.readUInt32LE(off));
  let inc = true;
  for (let i = 1; i < 4; i++) if (v[i] !== v[i - 1] + 1) inc = false;
  if (!inc) continue;
  if (v[0] > 100) continue;
  spCands.push({ off, v });
}
console.log('Spain u32 offsets increasing by exactly 1 (turn-counter candidates):');
for (const c of spCands.slice(0, 30)) console.log('  0x' + c.off.toString(16) + ' vals=[' + c.v.join(',') + ']');

// ── PART 3: player faction id ──
// Known players (descr_sm_factions / faction internal name):
//   t0 = romans_julii (the imperial campaign default new game = Julii)
//   Spain = spain, Macedon = macedon, Seleucid = seleucid,
//   Carthage = carthage, Antigonid = antigonid, Rome = romans_? (republic)
// We have identifyPlayerFactionFromSave already. Here just check whether ANY
// header byte 0..0x600 equals a per-save-distinct small int matching player.
console.log('\n\n=== PART 3: does any header byte distinguish the 5 distinct-player saves? ===');
const players = [
  ['t0(julii)',   'save_t0.sav'],
  ['Spain',       'save_17-05-2026   Spain   Turn 1.sav'],
  ['Macedon',     'save_macedon t0.sav'],
  ['Seleucid',    'save_Seleucids t0.sav'],
  ['Carthage',    'save_Autosave   Carthage   Turn 1 End.sav'],
  ['Antigonid',   'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
].map(([tag, fn]) => ({ tag, buf: load(fn) }));
// Note: Macedon&Seleucid share campaignUuid; Carthage&t0 share campaignUuid.
// If a header byte == player id, then t0 != Carthage at that byte (different players).
// Check 0..0x600 for a byte that is DISTINCT for these 6 AND in range 0..30.
let distinctCount = 0;
for (let off = 0; off < 0x600; off++) {
  const vals = players.map(p => p.buf[off]);
  if (vals.some(v => v > 30)) continue;
  // require t0 != Carthage (different players, same campaignUuid — rules out uuid bytes)
  if (vals[0] === vals[4]) continue;
  // require Macedon != Seleucid
  if (vals[2] === vals[3]) continue;
  distinctCount++;
  if (distinctCount <= 40) console.log('  0x' + off.toString(16).padStart(3, '0') + ': ' + vals.map((v, i) => players[i].tag.split('(')[0] + '=' + v).join(' '));
}
console.log('Header bytes (0..0x600, all <=30) distinguishing player across same-uuid pairs: ' + distinctCount);
