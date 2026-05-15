#!/usr/bin/env node
// dig-family16.js — wife record at marker-14, decode fields, find husband
// pointer.
//
// Wife record structure (from dig-family15 visual):
//   +4..7: wife firstName name index
//   +9..12: wife lastName / clan name index
//   +14..17: marker '2e 05 00 00' (constant)
//   +50..53 (offset 36 past marker): u32 — candidate husband uuid pointer
//
// Plan: parse all wife records, match wife firstName to descr_strat
// relative line, look up husband, check whether any u32 at offsets
// +18..+90 in wife record matches husband's primaryUuid or secondaryUuid.

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const nameToIdx = new Map();
nameLookup.forEach((n, i) => { if (n) nameToIdx.set(n, i); });
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) { const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]); }
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));

const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const byFirstLast = new Map();
for (const r of recs) {
  const key = `${r.firstName}|${r.lastName||''}`;
  if (!byFirstLast.has(key)) byFirstLast.set(key, []);
  byFirstLast.get(key).push(r);
}

// Find wife records: scan for marker '2e 05 00 00' (gives marker pos)
// Wife record start = marker pos - 14
// Wife firstName at +4..+7 (4 bytes after recStart)
// Actually re-reading my dump: recStart=22050564 marker at +14
//   full hex 00 00 00 00 41 0c 00 00 01 0c 0b 00 00 00 2e 05 ...
//   +0..3: 00 00 00 00
//   +4..7: 41 0c 00 00 = 3137 (Prisca) ✓
//   +8: 01
//   +9..12: 0c 0b 00 00 = 2828 (Ogulnius_Gallus)
//   +13: 00
//   +14: 00 (start of marker '2e 05 00 00')
//   Wait — let me recount. The dump starts at recStart=22050564.
//   byte 0 = 0x00, byte 1 = 0x00, byte 2 = 0x00, byte 3 = 0x00,
//   byte 4 = 0x41, byte 5 = 0x0c, byte 6 = 0x00, byte 7 = 0x00,
//   byte 8 = 0x01, byte 9 = 0x0c, byte 10 = 0x0b, byte 11 = 0x00,
//   byte 12 = 0x00, byte 13 = 0x00, byte 14 = 0x2e, byte 15 = 0x05,
//   byte 16 = 0x00, byte 17 = 0x00.
//   So firstName at +4, gender at +8 (=01 → female? alive?), lastName at +9,
//   marker at +14.

const markers = [];
for (let i = 21500000; i < 23000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
    markers.push(i);
  }
}
console.log(`Markers in 21.5M-23M: ${markers.length}`);

// Parse husband-wife pairs and children from descr_strat
const strat = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "utf8");
const pairs = [];
for (const raw of strat.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line.startsWith("relative")) continue;
  const idxEnd = line.toLowerCase().indexOf(" end");
  const head = (idxEnd > 0 ? line.slice(0, idxEnd) : line).replace(/^relative\s+/i, "");
  const parts = head.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) continue;
  const husband = parts[0];
  const wife = parts[1];
  const hParts = husband.split(/\s+/);
  pairs.push({
    husbandFirst: hParts[0],
    husbandLast: hParts.slice(1).join(" ") || null,
    wifeFirst: wife.split(/\s+/)[0],
  });
}

// Decode each wife record
const wifeRecords = [];
for (const m of markers) {
  const recStart = m - 14;
  if (recStart < 0) continue;
  const firstIdx = buf.readUInt32LE(recStart + 4);
  const gender = buf[recStart + 8]; // 01 or 00
  const lastIdx = buf.readUInt32LE(recStart + 9);
  if (firstIdx >= nameLookup.length || lastIdx >= nameLookup.length) continue;
  const firstName = nameLookup[firstIdx];
  const lastName = nameLookup[lastIdx];
  if (!firstName) continue;
  wifeRecords.push({ recStart, firstName, lastName, gender });
}
console.log(`Decoded ${wifeRecords.length} wife records`);

// Now for each wife record, find matching pair entry and check husband uuids
const offsetHistP = new Map(); // primary uuid offset
const offsetHistS = new Map(); // secondary uuid offset
let matchedPairs = 0;
let detailShown = 0;

for (const wr of wifeRecords) {
  // Find pairs matching wifeFirst AND husbandLast == wr.lastName
  const candidates = pairs.filter(p => p.wifeFirst === wr.firstName && p.husbandLast === wr.lastName);
  if (candidates.length === 0) continue;
  for (const p of candidates) {
    const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
    const husbands = byFirstLast.get(husbandKey);
    if (!husbands || husbands.length !== 1) continue;
    const h = husbands[0];
    matchedPairs++;
    // Scan wife record window for husband uuids
    const hits = [];
    for (let i = 0; i + 4 <= 200; i++) {
      const off = wr.recStart + i;
      if (off + 4 > buf.length) break;
      const v = buf.readUInt32LE(off);
      if (v === h.primaryUuid) { hits.push({ off: i, type: 'primary' }); offsetHistP.set(i, (offsetHistP.get(i)||0)+1); }
      if (v === h.secondaryUuid) { hits.push({ off: i, type: 'secondary' }); offsetHistS.set(i, (offsetHistS.get(i)||0)+1); }
    }
    if (detailShown < 10) {
      detailShown++;
      console.log(`\n  ${p.husbandFirst} ${p.husbandLast} <-> ${wr.firstName} (wifeRec at ${wr.recStart})`);
      console.log(`    husband primaryUuid=${h.primaryUuid}, secondaryUuid=${h.secondaryUuid}, recOffset=${h.offset}`);
      if (hits.length) console.log(`    HITS:`, hits.map(x => `+${x.off}:${x.type}`).join(', '));
      else console.log(`    NO HITS`);
    }
  }
}

console.log(`\nMatched pairs: ${matchedPairs}`);
console.log(`\nPrimary-uuid offset histogram in wife record:`);
for (const [o, c] of [...offsetHistP.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15)) {
  console.log(`  +${o}: ${c}`);
}
console.log(`\nSecondary-uuid offset histogram in wife record:`);
for (const [o, c] of [...offsetHistS.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15)) {
  console.log(`  +${o}: ${c}`);
}

// Try: maybe husband ref is the husband's recordOffset itself? Or husband
// name idx? Check husband firstName u32 in wife record.
console.log(`\n--- Trying husband nameIdx pointer ---`);
const offsetHistN = new Map();
let matchedN = 0;
for (const wr of wifeRecords) {
  const candidates = pairs.filter(p => p.wifeFirst === wr.firstName && p.husbandLast === wr.lastName);
  if (candidates.length === 0) continue;
  for (const p of candidates) {
    const hubFirstIdx = nameToIdx.get(p.husbandFirst);
    if (hubFirstIdx == null) continue;
    for (let i = 0; i + 4 <= 200; i++) {
      const off = wr.recStart + i;
      if (off + 4 > buf.length) break;
      if (buf.readUInt32LE(off) === hubFirstIdx) {
        offsetHistN.set(i, (offsetHistN.get(i)||0)+1);
        matchedN++;
      }
    }
  }
}
console.log(`name-idx matches: ${matchedN}`);
for (const [o, c] of [...offsetHistN.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15)) {
  console.log(`  +${o}: ${c}`);
}
