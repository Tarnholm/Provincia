// Cross-validate the +1100 / +1288 population candidates by tracking growth
// across T1 → T4 saves. Population should grow ~3-7% per turn.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const TURN_FILES = {
  1: 'save_17-05-2026   Spain   Turn 1.sav',
  2: 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  3: 'save_Autosave   Spain   Turn 3 End.sav',
  4: 'save_Autosave   Spain   Turn 4 Start.sav',
};

const BUFFERS = {};
for (const t of [1, 2, 3, 4]) BUFFERS[t] = fs.readFileSync(path.join(BASE, TURN_FILES[t]));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

// For each save, build settlement list with default_set offsets
function getSettlements(buf) {
  const defSets = findPstr16Asciiz(buf, 'default_set');
  return defSets.map(ds => {
    let nameOff = -1;
    for (let step = -20; step <= 0; step++) {
      const c = ds - 18 + step;
      if (c < 0) continue;
      const r = readPstr16Utf16(buf, c);
      if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
    }
    return {
      name: nameOff !== -1 ? readPstr16Utf16(buf, nameOff).str : '???',
      defSet: ds
    };
  });
}

const SETTLEMENTS_BY_TURN = {};
for (const t of [1, 2, 3, 4]) SETTLEMENTS_BY_TURN[t] = getSettlements(BUFFERS[t]);

// For each settlement, track u32@+1100 and u32@+1288 across turns
const CANDIDATES_OFF = [1100, 1288, 204, 980, 1052, 684, 964];
console.log('=== Per-settlement field tracking across T1→T4 ===');

// Use T1's settlement list as the canonical name list
const t1List = SETTLEMENTS_BY_TURN[1].filter(s => s.name && s.name !== '???');
for (const candOff of CANDIDATES_OFF) {
  console.log('\n--- Offset +' + candOff + ' across turns ---');
  console.log('settlement_name  T1   T2   T3   T4  pattern');
  // For first 15 settlements
  for (const s1 of t1List.slice(0, 20)) {
    const values = [];
    for (const t of [1, 2, 3, 4]) {
      const s = SETTLEMENTS_BY_TURN[t].find(x => x.name === s1.name);
      if (!s) { values.push('N/A'); continue; }
      const off = s.defSet + candOff;
      if (off + 4 > BUFFERS[t].length) { values.push('N/A'); continue; }
      values.push(BUFFERS[t].readUInt32LE(off));
    }
    // Pattern classification
    const numValues = values.filter(v => typeof v === 'number');
    let pattern = '';
    if (numValues.length === 4) {
      const allEqual = numValues.every(v => v === numValues[0]);
      const allMonoUp = numValues[1] > numValues[0] && numValues[2] > numValues[1] && numValues[3] > numValues[2];
      const allMonoDown = numValues[1] < numValues[0] && numValues[2] < numValues[1] && numValues[3] < numValues[2];
      const range = Math.max(...numValues) - Math.min(...numValues);
      if (allEqual) pattern = '=stable';
      else if (allMonoUp) pattern = '↑growth (Δ' + (numValues[3] - numValues[0]) + ')';
      else if (allMonoDown) pattern = '↓decline';
      else if (range < 200) pattern = '~stable';
      else pattern = 'mixed';
    }
    console.log('  ' + s1.name.padEnd(16) + ' ' + values.map(v => String(v).padStart(5)).join(' ') + '  ' + pattern);
  }
}
