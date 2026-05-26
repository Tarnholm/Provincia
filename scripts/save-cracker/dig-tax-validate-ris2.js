// dig-tax-validate-ris2.js
//
// Validate tax field on RIS Rome-campaign saves using the PROVEN
// findAllSettlementMarkers (buildingParser). marker.offset is the FLAG byte;
// the pstr16 length-prefix is marker.offset+1, so:
//   tax @ prefixPos - 562  ==  marker.offset + 1 - 562  ==  marker.offset - 561.
//
// We read all stats-block fields relative to marker.offset and validate.
// findAllSettlementMarkers can return false positives (any UTF-16 string that
// looks like [flag][n][0][utf16][00 00]), so we gate each candidate on the
// stats block being internally plausible (level 0..6, PO 0..100, pop>=400,
// income 0..50000) before counting its tax byte.
//
// Read-only.

const fs = require('fs');
const path = require('path');
const { findAllSettlementMarkers } = require('../../src/buildingParser');

const ROME = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

const FILES = [
  'save_macedon t0.sav',
  'save_Seleucids t0.sav',
  'save_Autosave   Antigonid Kingdom   Turn 1.sav',
  'save_Autosave   Republic of Rome   Turn 2.sav',
  'save_Autosave   Republic of Rome   Turn 4 End.sav',
];

// dx relative to marker.offset (flag byte). = prefixDx + 1.
const M = { creator: -582, level: -570, tax: -561, po: -434, income: -126, pop: -34, d29: -28 };

function u32(buf, off) { return (off < 0 || off + 4 > buf.length) ? null : buf.readUInt32LE(off); }
function u8(buf, off) { return (off < 0 || off >= buf.length) ? null : buf[off]; }

function plausible(r) {
  return r.level != null && r.level <= 6 &&
    r.po != null && r.po <= 100 &&
    r.pop != null && r.pop >= 400 && r.pop <= 100000 &&
    r.income != null && r.income <= 60000;
}

for (const file of FILES) {
  let buf;
  try { buf = fs.readFileSync(path.join(ROME, file)); }
  catch (e) { console.log('\n[skip] %s: %s', file, e.message); continue; }
  const markers = findAllSettlementMarkers(buf);
  const rows = [];
  for (const m of markers) {
    const o = m.offset;
    const r = {
      name: m.name,
      tax: u8(buf, o + M.tax),
      level: u32(buf, o + M.level),
      po: u32(buf, o + M.po),
      income: u32(buf, o + M.income),
      pop: u32(buf, o + M.pop),
      d29: u8(buf, o + M.d29),
      off: o,
    };
    if (plausible(r)) rows.push(r);
  }
  // de-dupe by name keeping the first plausible record
  const seen = new Set(); const uniq = [];
  for (const r of rows) { if (seen.has(r.name)) continue; seen.add(r.name); uniq.push(r); }

  console.log('\n================= %s =================', file);
  console.log('markers=%d  plausible-stats records=%d  unique names=%d',
    markers.length, rows.length, uniq.length);
  console.log('%s%s%s%s%s%s%s',
    'name'.padEnd(18), 'tax'.padEnd(5), 'lvl'.padEnd(5), 'PO'.padEnd(6),
    'income'.padEnd(9), 'pop'.padEnd(9), 'd29');
  const taxHist = {};
  uniq.forEach(r => { taxHist[r.tax] = (taxHist[r.tax] || 0) + 1; });
  uniq.slice(0, 35).forEach(r => {
    console.log('%s%s%s%s%s%s%s',
      String(r.name).slice(0, 17).padEnd(18),
      String(r.tax).padEnd(5), String(r.level).padEnd(5),
      String(r.po).padEnd(6), String(r.income).padEnd(9),
      String(r.pop).padEnd(9), String(r.d29));
  });
  if (uniq.length > 35) console.log('  ...(%d more)', uniq.length - 35);
  console.log('tax histogram (dx marker-561 = prefix-562): %s', JSON.stringify(taxHist));
  const oor = uniq.filter(r => r.tax == null || r.tax < 0 || r.tax > 4).length;
  console.log('tax bytes OUTSIDE 0..4: %d / %d', oor, uniq.length);
}
