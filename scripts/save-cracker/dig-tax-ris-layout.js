// Determine the RIS-save settlement stats-block layout. The Alexander-calibrated
// dx offsets (income@-127, tax@-562) don't yield plausible values in RIS Rome-dir
// saves, so the layout differs. Find a known RIS settlement and dump the region
// before its name to relocate income/pop/PO/level, then look for the tax enum.
//
// Strategy: in macedon t0 (RIS), find the FIRST default_set of a settlement,
// walk back to its name pstr16, then scan dx=-700..0 for the income/pop/PO
// fields by value (we know pop is a few thousand, income hundreds-thousands).
//
// Read-only.

const fs = require('fs');
const path = require('path');
const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';

const buf = fs.readFileSync(path.join(SAVE_DIR, 'save_macedon t0.sav'));

function findAll(buf, target) { const o = []; let p = 0; while ((p = buf.indexOf(target, p)) !== -1) { o.push(p); p++; } return o; }

const DEFSET = Buffer.from('\x0c\x00default_set\x00', 'latin1');
const defSets = findAll(buf, DEFSET);
console.log('default_set count:', defSets.length);

// For each default_set, look backward for a name pstr16 immediately preceding.
// Collect the FIRST default_set whose name is right before it (settlement head).
function nameBefore(ds) {
  for (let gap = 8; gap <= 40; gap++) {
    const cand = ds - gap;
    if (cand < 4) break;
    const len = buf.readUInt16LE(cand);
    if (len < 3 || len > 40) continue;
    if (cand + 2 + len * 2 > ds) continue;
    let ok = true, name = '';
    for (let i = 0; i < len; i++) {
      const lo = buf[cand + 2 + i * 2], hi = buf[cand + 2 + i * 2 + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= 'A' && name[0] <= 'Z') return { cand, name, gap };
  }
  return null;
}

// Find settlement heads (a name pstr16 immediately before a default_set).
const heads = [];
const seenName = new Set();
for (const ds of defSets) {
  const nb = nameBefore(ds);
  if (!nb) continue;
  if (seenName.has(nb.cand)) continue;
  seenName.add(nb.cand);
  heads.push({ ...nb, ds });
}
console.log('settlement heads (name immediately before a default_set):', heads.length);
console.log('first 15:', heads.slice(0, 15).map(h => h.name).join(', '));

// Pick a few well-known settlements and dump u32 values dx=-700..-1 looking for
// pop/income/PO. We know Rome RIS pop ~ thousands.
const TARGETS = ['Pella', 'Sparta', 'Athens', 'Thermon', 'Corinth', 'Larissa', 'Demetrias'];
for (const name of TARGETS) {
  const h = heads.find(x => x.name === name);
  if (!h) { console.log(`\n${name}: not found as settlement head`); continue; }
  console.log(`\n===== ${name} (namePrefix @0x${h.cand.toString(16)}, gap-to-defset=${h.gap}) =====`);
  // Dump every u32 in dx -700..-1 that is a "small-ish" plausible number
  const np = h.cand;
  const interesting = [];
  for (let dx = -700; dx <= -1; dx++) {
    const v = (np + dx + 4 <= buf.length && np + dx >= 0) ? buf.readUInt32LE(np + dx) : null;
    if (v === null) continue;
    // pop/income/PO candidates: 1..40000
    if (v >= 1 && v <= 40000) interesting.push({ dx, v });
  }
  // print compactly
  console.log('  plausible u32 (1..40000) by dx:');
  let line = '';
  for (const it of interesting) {
    line += `[${it.dx}]=${it.v} `;
    if (line.length > 110) { console.log('    ' + line); line = ''; }
  }
  if (line) console.log('    ' + line);
  // also list bytes that are small enums (0..4) across dx -700..-1
  const enums = [];
  for (let dx = -700; dx <= -1; dx++) {
    const b = buf[np + dx];
    if (b >= 0 && b <= 4) enums.push(dx);
  }
  // (too many; skip printing all — we cross-reference across settlements below)
}
