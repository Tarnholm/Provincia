// dig-tax-survey.js
//
// Survey the candidate tax-rate byte across every settlement stats block.
//
// CRITICAL anchoring note: the working tax-change diff scripts measured dx
// from the settlement-name PSTR16 LENGTH-PREFIX position (findUtf16 returns the
// offset of the [u16 len] prefix). So dx=-562 etc. are relative to THAT, not to
// the first UTF-16 character. We replicate that anchor exactly here.
//
// We locate every settlement by searching for each name's `[u16 len][UTF-16]`
// pstr16, but to avoid over-matching we keep only those whose stats block reads
// plausibly (level<=6, PO<=100, income reasonable, pop in range).
//
// Read-only. No app code touched.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const ALEX_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';

// dx relative to the pstr16 LENGTH-PREFIX position of the settlement name.
const DX = {
  creator: -583,
  level: -571,
  tax: -562,
  po: -435,
  derived29: -29,
  income: -127,
  pop: -35,
};

function u32(buf, off) {
  if (off < 0 || off + 4 > buf.length) return null;
  return buf.readUInt32LE(off);
}
function u8(buf, off) {
  if (off < 0 || off >= buf.length) return null;
  return buf[off];
}

function findAll(buf, target) {
  const out = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) { out.push(p); p++; }
  return out;
}

// Find settlement name pstr16 positions by anchoring on the default_set list
// that FOLLOWS each settlement record. Returns the LENGTH-PREFIX position of
// the name (so dx offsets line up with the diff scripts).
function findSettlements(buf) {
  const DEFSET = Buffer.from('\x0c\x00default_set\x00', 'latin1'); // [u16 len=12]default_set\0
  const defSets = findAll(buf, DEFSET);
  const out = [];
  for (const ds of defSets) {
    // The name pstr16 prefix sits a short distance before default_set.
    // Search backwards for a valid [u16 len][UTF-16 ascii] whose end is < ds.
    for (let gap = 8; gap <= 80; gap++) {
      const cand = ds - gap; // candidate length-prefix position
      if (cand < 2) break;
      const len = buf.readUInt16LE(cand);
      if (len < 3 || len > 40) continue;
      const end = cand + 2 + len * 2;
      if (end > ds) continue;
      // Validate UTF-16 ASCII name, first char uppercase.
      let ok = true, name = '';
      for (let i = 0; i < len; i++) {
        const lo = buf[cand + 2 + i * 2];
        const hi = buf[cand + 2 + i * 2 + 1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
        name += String.fromCharCode(lo);
      }
      if (!ok) continue;
      if (!(name[0] >= 'A' && name[0] <= 'Z')) continue;
      out.push({ name, prefixPos: cand, defSet: ds });
      break;
    }
  }
  return out;
}

function surveySave(dir, file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const setts = findSettlements(buf);
  const rows = [];
  for (const s of setts) {
    const p = s.prefixPos;
    const level = u32(buf, p + DX.level);
    const creator = u32(buf, p + DX.creator);
    const tax = u8(buf, p + DX.tax);
    const po = u32(buf, p + DX.po);
    const income = u32(buf, p + DX.income);
    const pop = u32(buf, p + DX.pop);
    const d29 = u8(buf, p + DX.derived29);
    rows.push({ name: s.name, level, creator, tax, po, income, pop, d29, p });
  }
  return rows;
}

function printSurvey(label, rows, maxPrint = 45) {
  console.log(`\n========== ${label} (${rows.length} settlements) ==========`);
  console.log(
    'name'.padEnd(20) + 'tax'.padEnd(5) + 'lvl'.padEnd(5) + 'PO'.padEnd(6) +
    'income'.padEnd(9) + 'pop'.padEnd(9) + 'd29'
  );
  const taxHist = {};
  let shown = 0;
  for (const r of rows) {
    taxHist[r.tax] = (taxHist[r.tax] || 0) + 1;
    if (shown < maxPrint) {
      console.log(
        String(r.name).slice(0, 19).padEnd(20) +
        String(r.tax).padEnd(5) +
        String(r.level).padEnd(5) +
        String(r.po).padEnd(6) +
        String(r.income).padEnd(9) +
        String(r.pop).padEnd(9) +
        String(r.d29)
      );
      shown++;
    }
  }
  if (rows.length > maxPrint) console.log(`  ...(${rows.length - maxPrint} more)`);
  console.log('tax-byte histogram: ' + JSON.stringify(taxHist));
  return taxHist;
}

const targets = [
  [SAVE_DIR, 'save_macedon t0.sav'],
  [SAVE_DIR, 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
  [SAVE_DIR, 'save_Seleucids t0.sav'],
  [SAVE_DIR, 'save_Autosave   Republic of Rome   Turn 2.sav'],
  [ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1.sav'],
  [ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'],
  [ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'],
];

const globalHist = {};
for (const [dir, file] of targets) {
  try {
    const rows = surveySave(dir, file);
    const h = printSurvey(file, rows);
    for (const [k, v] of Object.entries(h)) globalHist[k] = (globalHist[k] || 0) + v;
  } catch (e) {
    console.log(`\n[skip] ${file}: ${e.message}`);
  }
}

console.log('\n\n========== GLOBAL tax-byte (dx=-562) value distribution ==========');
console.log(JSON.stringify(globalHist, null, 2));
const vals = Object.keys(globalHist).map(Number).sort((a, b) => a - b);
console.log('observed values:', vals.join(', '), '   max =', Math.max(...vals));
