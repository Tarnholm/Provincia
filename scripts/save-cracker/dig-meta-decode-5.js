// Test hypothesis: u16 at record-start+0x16 in the character metadata
// record is a faction or culture ID. Sample across all 64 records in
// halo_oneman + at least one larger fixture.

const fs = require('fs');

function findAllRecs(buf) {
  const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;
  const out = [];
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let classStr = null, classStart = -1, classEnd = -1;
    for (let p = i + 0x10; p < i + 0x40 && p + 2 < buf.length; p++) {
      const lenP1 = buf.readUInt16LE(p);
      if (lenP1 < 4 || lenP1 > 50) continue;
      if (p + 2 + lenP1 > buf.length) continue;
      let ok = true;
      for (let j = 0; j < lenP1 - 1; j++) {
        const c = buf[p + 2 + j];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
      }
      if (!ok) continue;
      if (buf[p + 2 + lenP1 - 1] !== 0) continue;
      const s = buf.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
      if (CHAR_CLASS_RE.test(s) && /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(s)) {
        classStr = s;
        classStart = p + 2;
        classEnd = p + 2 + lenP1;
        break;
      }
    }
    if (!classStr) continue;
    const m = classStr.match(/^(.*?)\s+(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)$/i);
    const factionWord = m ? m[1].toLowerCase().replace(/\s+/g, '_') : '?';
    // The u16 candidate is 4 bytes before classStart
    const u16AtMinus4 = buf.readUInt16LE(classStart - 4);
    // And 2 bytes before is the strlen prefix
    const u16Strlen = buf.readUInt16LE(classStart - 2);
    out.push({ off: i, uuid, className: classStr, classStart, classEnd, factionWord, factionId: u16AtMinus4, strlen: u16Strlen });
  }
  return out;
}

const FILES = [
  ['halo_oneman', 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav'],
  ['save_10_fresh', 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\save_10_fresh.sav'],
  ['ror_t11s', 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\ror_t11s.sav'],
  ['athens_t22e', 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\athens_t22e.sav'],
];

for (const [tag, p] of FILES) {
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const recs = findAllRecs(buf);
  console.log('\n=== ' + tag + ' (' + recs.length + ' char metadata records) ===');

  // Group by factionWord, list factionId values per faction
  const byFaction = new Map();
  for (const r of recs) {
    if (!byFaction.has(r.factionWord)) byFaction.set(r.factionWord, []);
    byFaction.get(r.factionWord).push(r);
  }
  const sorted = Array.from(byFaction.entries()).sort((a, b) => b[1].length - a[1].length);

  console.log('  faction               count  factionId values         expected:UNIQUE-PER-FACTION');
  for (const [fw, list] of sorted) {
    const ids = new Set(list.map(r => r.factionId));
    const idsList = Array.from(ids).map(v => v.toString()).join(', ');
    const isUnique = ids.size === 1;
    console.log('  ' + fw.padEnd(22) + String(list.length).padStart(4) + '   ' +
                idsList.padEnd(24) + (isUnique ? '✓ stable' : '✗ MULTIPLE'));
  }

  // Now invert: group by factionId
  const byId = new Map();
  for (const r of recs) {
    if (!byId.has(r.factionId)) byId.set(r.factionId, new Set());
    byId.get(r.factionId).add(r.factionWord);
  }
  console.log('\n  factionId -> faction words (expect 1:1 if faction-unique):');
  const idEntries = Array.from(byId.entries()).sort((a, b) => a[0] - b[0]);
  for (const [id, factions] of idEntries) {
    const factionList = Array.from(factions).join(', ');
    const factionCount = recs.filter(r => r.factionId === id).length;
    console.log('    factionId=' + String(id).padStart(3) + '  chars=' + String(factionCount).padStart(4) + '   factions: ' + factionList);
  }
}
