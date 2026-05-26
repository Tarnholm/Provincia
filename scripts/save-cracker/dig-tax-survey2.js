// dig-tax-survey2.js
//
// Robust settlement-stats finder for BOTH the small Alexander saves and the
// large RIS Rome-dir saves. Instead of anchoring on default_set (RIS has many
// per settlement), we scan for any UTF-16 name pstr16 whose stats block at the
// fixed dx offsets reads plausibly. The stats block is the ground truth:
//   creator(-583) small, level(-571) 0..6, PO(-435) 0..100, income(-127)
//   reasonable, pop(-35) 100..1e6. Real settlements pass all gates; random
//   name strings elsewhere in the file do not.
//
// dx is relative to the name pstr16 LENGTH-PREFIX position (matches the
// tax-change diff scripts).
//
// Read-only.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const ALEX_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';

const DX = { creator: -583, level: -571, tax: -562, po: -435, derived29: -29, income: -127, pop: -35 };

function u32(buf, off) { return (off >= 0 && off + 4 <= buf.length) ? buf.readUInt32LE(off) : null; }
function u8(buf, off) { return (off >= 0 && off < buf.length) ? buf[off] : null; }

// Find every settlement stats block by reading the stats fields at a candidate
// name pstr16 prefix and gating on plausibility. We anchor on the FIRST
// default_set per settlement (the one whose name precedes it). To dedupe RIS's
// many sub-list default_sets, we only accept a default_set if a valid name
// pstr16 ends within [ds-60, ds-8] AND the stats block is plausible.
function findSettlements(buf) {
  const DEFSET = Buffer.from('\x0c\x00default_set\x00', 'latin1');
  const out = [];
  const seen = new Set();
  let p = 0;
  while ((p = buf.indexOf(DEFSET, p)) !== -1) {
    const ds = p; p++;
    // search backward for a name pstr16 whose stats block is plausible
    for (let gap = 8; gap <= 70; gap++) {
      const cand = ds - gap;
      if (cand < 600) break;
      const len = buf.readUInt16LE(cand);
      if (len < 3 || len > 40) continue;
      if (cand + 2 + len * 2 > ds) continue;
      let ok = true, name = '';
      for (let i = 0; i < len; i++) {
        const lo = buf[cand + 2 + i * 2], hi = buf[cand + 2 + i * 2 + 1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
        name += String.fromCharCode(lo);
      }
      if (!ok || !(name[0] >= 'A' && name[0] <= 'Z')) continue;
      const level = u32(buf, cand + DX.level);
      const creator = u32(buf, cand + DX.creator);
      const po = u32(buf, cand + DX.po);
      const income = u32(buf, cand + DX.income);
      const pop = u32(buf, cand + DX.pop);
      const plausible =
        level !== null && level <= 6 &&
        creator !== null && creator <= 400 &&
        po !== null && po <= 100 &&
        income !== null && income >= 1 && income <= 200000 &&
        pop !== null && pop >= 100 && pop <= 2000000;
      if (!plausible) continue;
      if (seen.has(cand)) break;
      seen.add(cand);
      out.push({
        name, prefixPos: cand,
        tax: u8(buf, cand + DX.tax),
        level, creator, po, income, pop,
        d29: u8(buf, cand + DX.derived29),
      });
      break;
    }
  }
  return out;
}

function run(dir, file) {
  let buf;
  try { buf = fs.readFileSync(path.join(dir, file)); }
  catch (e) { console.log(`\n[skip] ${file}: ${e.message}`); return {}; }
  const rows = findSettlements(buf);
  console.log(`\n========== ${file} (${rows.length} settlements) ==========`);
  console.log('name'.padEnd(20) + 'tax'.padEnd(5) + 'lvl'.padEnd(5) + 'PO'.padEnd(6) + 'income'.padEnd(9) + 'pop'.padEnd(9) + 'd29');
  const hist = {};
  let shown = 0;
  for (const r of rows) {
    hist[r.tax] = (hist[r.tax] || 0) + 1;
    if (shown++ < 40) {
      console.log(
        String(r.name).slice(0, 19).padEnd(20) + String(r.tax).padEnd(5) +
        String(r.level).padEnd(5) + String(r.po).padEnd(6) +
        String(r.income).padEnd(9) + String(r.pop).padEnd(9) + String(r.d29)
      );
    }
  }
  if (rows.length > 40) console.log(`  ...(${rows.length - 40} more)`);
  console.log('tax histogram: ' + JSON.stringify(hist));
  // Correlation: does tax correlate with income or PO? Show mean income/PO per tax level.
  const byTax = {};
  for (const r of rows) {
    (byTax[r.tax] = byTax[r.tax] || []).push(r);
  }
  for (const t of Object.keys(byTax).sort()) {
    const g = byTax[t];
    const avgInc = (g.reduce((s, r) => s + r.income, 0) / g.length).toFixed(0);
    const avgPo = (g.reduce((s, r) => s + r.po, 0) / g.length).toFixed(0);
    console.log(`  tax=${t}: n=${g.length}  avgIncome=${avgInc}  avgPO=${avgPo}`);
  }
  return hist;
}

const targets = [
  [SAVE_DIR, 'save_macedon t0.sav'],
  [SAVE_DIR, 'save_Autosave   Antigonid Kingdom   Turn 1.sav'],
  [SAVE_DIR, 'save_Seleucids t0.sav'],
  [SAVE_DIR, 'save_Autosave   Republic of Rome   Turn 2.sav'],
  [SAVE_DIR, 'save_Autosave   Dummies   Turn 8 Start.sav'],
  [ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1.sav'],
  [ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'],
  [ALEX_DIR, 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'],
];

const g = {};
for (const [dir, file] of targets) {
  const h = run(dir, file);
  for (const [k, v] of Object.entries(h)) g[k] = (g[k] || 0) + v;
}
console.log('\n\n===== GLOBAL tax-byte (dx=-562) distribution =====');
console.log(JSON.stringify(g, null, 2));
const vals = Object.keys(g).map(Number).sort((a, b) => a - b);
console.log('observed values:', vals.join(', '), '  max =', Math.max(...vals));
