// Session 27 — Cross-validate flag-event counts with lua-footer counters.
// Goal: at T5 (5 turns played, idB <= 275), how many events of each flag should there be?
//   - num_battles_* counters from lua footer → count flag=X events for hash=Y at year<=275
//   - Compare T1, T2, T3, T4, T5 archive to see if event counts grow monotonically with turn

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Parse lua counters
const counterTableStart = 0x210f56f;
const counterTableEnd = 0x2110a23;

function parseLuaCounters(start, end) {
  const records = [];
  let p = start;
  while (p < end - 8) {
    const nameLen = buf.readUInt32LE(p);
    if (nameLen > 0 && nameLen < 100 && p + 4 + nameLen * 2 + 4 <= end) {
      let s = '';
      let valid = true;
      for (let i = 0; i < nameLen; i++) {
        const lo = buf[p + 4 + i*2], hi = buf[p + 4 + i*2 + 1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { valid = false; break; }
        s += String.fromCharCode(lo);
      }
      if (valid) {
        const valOff = p + 4 + nameLen * 2;
        const v = buf.readUInt32LE(valOff);
        records.push({ off: p, name: s, value: v });
        p = valOff + 4;
        continue;
      }
    }
    p++;
  }
  return records;
}

const counters = parseLuaCounters(counterTableStart, counterTableEnd);
const num_battles = counters.filter(r=>r.name.startsWith('num_battles_'));
const num_mercs = counters.filter(r=>r.name.startsWith('num_mercs_recruited_'));
const reform_battle = counters.filter(r=>r.name.includes('_reform_battle_counter'));
const turn_number = counters.find(r=>r.name === 'turn_number');

console.log('Lua counter values:');
console.log('  turn_number =', turn_number ? turn_number.value : 'NOT FOUND');
console.log('\n  num_battles_*:');
for (const r of num_battles) console.log('    ' + r.name + ' = ' + r.value);
console.log('  Total num_battles sum:', num_battles.reduce((s,r)=>s+r.value,0));
console.log('\n  num_mercs_recruited_*:');
for (const r of num_mercs) console.log('    ' + r.name + ' = ' + r.value);
console.log('  Total num_mercs sum:', num_mercs.reduce((s,r)=>s+r.value,0));
console.log('\n  *_reform_battle_counter (top 5 by value):');
reform_battle.sort((a,b)=>b.value-a.value).slice(0,5).forEach(r=>console.log('    ' + r.name + ' = ' + r.value));
console.log('  Total reform_battle sum:', reform_battle.reduce((s,r)=>s+r.value,0));

// All non-faction-id counters
const otherCounters = counters.filter(r=>!r.name.startsWith('id_') && r.value > 0);
console.log('\n  Non-zero non-faction counters (', otherCounters.length, '):');
otherCounters.sort((a,b)=>b.value-a.value).slice(0,20).forEach(r=>console.log('    ' + r.name.padEnd(45) + ' = ' + r.value));

// Now parse the event log and count flag=X events at year <= 275 (T5 = 5 turns played)
const FULL_START = 0x51b5;
const FULL_END = 0x846af;
const STRIDE = 12;
const N = Math.floor((FULL_END - FULL_START) / STRIDE);

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
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);

console.log('\n=== Event counts by year-range ===');
const inGame = valid.filter(r=>r.idB >= 270);
console.log('Total valid in-game (idB>=270):', inGame.length);
console.log('  flag=1 sub=0x20:', inGame.filter(r=>r.flag===1).length);
console.log('  flag=2 sub=0x20:', inGame.filter(r=>r.flag===2).length);
console.log('  flag=4 sub=0:   ', inGame.filter(r=>r.flag===4).length);

console.log('\n=== Events at game-start range idB=270..275 (T0..T5) ===');
for (let y = 270; y <= 280; y++) {
  const here = valid.filter(r=>r.idB === y);
  const f1 = here.filter(r=>r.flag===1).length;
  const f2 = here.filter(r=>r.flag===2).length;
  const f4 = here.filter(r=>r.flag===4).length;
  console.log('  idB=' + y + ': total=' + here.length + ' f1=' + f1 + ' f2=' + f2 + ' f4=' + f4);
}

console.log('\n=== T5 events: idB<=275 by flag (compare to num_battles/num_mercs at T5) ===');
const t5 = valid.filter(r=>r.idB <= 275 && r.idB >= 270);
const t5f1 = t5.filter(r=>r.flag===1).length;
const t5f2 = t5.filter(r=>r.flag===2).length;
const t5f4 = t5.filter(r=>r.flag===4).length;
console.log('Events in turns T0..T5: flag=1: ' + t5f1 + ' flag=2: ' + t5f2 + ' flag=4: ' + t5f4);
console.log('Sum of num_battles_* at T5: ' + num_battles.reduce((s,r)=>s+r.value,0));
console.log('Sum of num_mercs_*  at T5: ' + num_mercs.reduce((s,r)=>s+r.value,0));

// Verify by comparing T1 archive — does flag=1 count grow with turns?
const ARCHIVE = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
if (require('fs').existsSync(ARCHIVE)) {
  const files = require('fs').readdirSync(ARCHIVE).filter(f=>f.endsWith('.sav')).slice(0,6);
  console.log('\n=== Archive saves event-counts ===');
  console.log('Files:', files);
}
