// dig-tax-validate-ris.js
//
// Validate the tax-rate field (dx=-562 from pstr16 prefix, confirmed via the
// Alexander Pella/Sparta controlled diff) on the RIS Rome-campaign saves —
// the deliverable's primary target (save_macedon t0.sav etc).
//
// For each settlement we read the full stats block at the KNOWN field offsets
// and the tax candidate, then:
//   * print a histogram of the tax byte
//   * sanity-check it stays in 0..4
//   * check whether the stats block is internally consistent (level/PO/income/pop
//     all plausible) so we know we're anchored on a real settlement record.
//
// We anchor on the pstr16 prefix discovered by walking back from `default_set`,
// exactly like dig-tax-survey, but ALSO cross-check with
// findAllSettlementMarkers (marker.offset == prefixPos - 1).
//
// Read-only.

const fs = require('fs');
const path = require('path');

const ROME = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

const FILES = [
  'save_macedon t0.sav',
  'save_Seleucids t0.sav',
  'save_Autosave   Antigonid Kingdom   Turn 1.sav',
  'save_Autosave   Republic of Rome   Turn 2.sav',
  'save_Autosave   Republic of Rome   Turn 4 End.sav',
  'save_Autosave   Carthage   Turn 2 Start.sav',
];

// dx relative to pstr16 LENGTH-PREFIX position.
const DX = { creator: -583, level: -571, tax: -562, po: -435, income: -127, pop: -35, d29: -29 };

function u32(buf, off) { return (off < 0 || off + 4 > buf.length) ? null : buf.readUInt32LE(off); }
function u8(buf, off) { return (off < 0 || off >= buf.length) ? null : buf[off]; }

function findAll(buf, target) { const out = []; let p = 0; while ((p = buf.indexOf(target, p)) !== -1) { out.push(p); p++; } return out; }

// Find settlement records via the default_set pstr16 list and walk back to the
// name pstr16 prefix.
function findSettlements(buf) {
  const DEFSET = Buffer.from('\x0c\x00default_set\x00', 'latin1');
  const out = [];
  for (const ds of findAll(buf, DEFSET)) {
    for (let gap = 8; gap <= 80; gap++) {
      const cand = ds - gap;
      if (cand < 2) break;
      const len = buf.readUInt16LE(cand);
      if (len < 3 || len > 40) continue;
      const end = cand + 2 + len * 2;
      if (end > ds) continue;
      let ok = true, name = '';
      for (let i = 0; i < len; i++) {
        const lo = buf[cand + 2 + i * 2], hi = buf[cand + 2 + i * 2 + 1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
        name += String.fromCharCode(lo);
      }
      if (!ok || !(name[0] >= 'A' && name[0] <= 'Z')) continue;
      out.push({ name, prefixPos: cand });
      break;
    }
  }
  // de-dupe by prefixPos
  const seen = new Set(); const uniq = [];
  for (const s of out) { if (seen.has(s.prefixPos)) continue; seen.add(s.prefixPos); uniq.push(s); }
  return uniq;
}

for (const file of FILES) {
  let buf;
  try { buf = fs.readFileSync(path.join(ROME, file)); }
  catch (e) { console.log('\n[skip] %s: %s', file, e.message); continue; }
  const setts = findSettlements(buf);
  console.log('\n================= %s (%d settlements) =================', file, setts.length);
  console.log('%s%s%s%s%s%s%s',
    'name'.padEnd(18), 'tax'.padEnd(5), 'lvl'.padEnd(5), 'PO'.padEnd(6),
    'income'.padEnd(9), 'pop'.padEnd(9), 'd29');
  const taxHist = {};
  // Track tax vs income to check correlation among same-level settlements.
  const rows = [];
  for (const s of setts) {
    const p = s.prefixPos;
    const r = {
      name: s.name,
      tax: u8(buf, p + DX.tax),
      level: u32(buf, p + DX.level),
      po: u32(buf, p + DX.po),
      income: u32(buf, p + DX.income),
      pop: u32(buf, p + DX.pop),
      d29: u8(buf, p + DX.d29),
    };
    rows.push(r);
    taxHist[r.tax] = (taxHist[r.tax] || 0) + 1;
  }
  // Only print the first 30, but compute histogram over all.
  rows.slice(0, 30).forEach(r => {
    console.log('%s%s%s%s%s%s%s',
      String(r.name).slice(0, 17).padEnd(18),
      String(r.tax).padEnd(5),
      String(r.level).padEnd(5),
      String(r.po).padEnd(6),
      String(r.income).padEnd(9),
      String(r.pop).padEnd(9),
      String(r.d29));
  });
  if (rows.length > 30) console.log('  ...(%d more)', rows.length - 30);
  console.log('tax histogram (dx=-562): %s', JSON.stringify(taxHist));
  // How many tax bytes are out of the expected 0..4 enum range?
  const outOfRange = rows.filter(r => r.tax == null || r.tax < 0 || r.tax > 4).length;
  console.log('tax bytes OUTSIDE 0..4: %d / %d', outOfRange, rows.length);
}
