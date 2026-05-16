// Quick smoke-test that the new parseCharacterMetadataByUuid in main.js
// returns the same data as our dig-halo-move-5.js scan and links to
// position records.

const fs = require('fs');
const path = require('path');

// Re-implement the function locally to avoid loading main.js (which pulls in Electron).
function parseCharacterMetadataByUuid(buf) {
  const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;
  const out = new Map();
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let classStr = null, classEnd = -1;
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
      const s = buf.slice(p + 2, p + 2 + lenP1 - 1).toString("latin1");
      if (CHAR_CLASS_RE.test(s) && /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(s)) {
        classStr = s;
        classEnd = p + 2 + lenP1;
        break;
      }
    }
    if (!classStr) continue;
    let regionStr = null;
    for (let p = classEnd; p < classEnd + 80 && p + 2 < buf.length; p++) {
      const lenChars = buf.readUInt16LE(p);
      if (lenChars < 3 || lenChars > 40) continue;
      if (p + 2 + lenChars * 2 > buf.length) continue;
      const chars = [];
      let ok = true;
      for (let j = 0; j < lenChars; j++) {
        const c = buf.readUInt16LE(p + 2 + j * 2);
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        chars.push(String.fromCharCode(c));
      }
      if (!ok) continue;
      const s = chars.join("");
      if (/^[A-Z][A-Za-z _0-9-]*$/.test(s)) {
        regionStr = s;
        break;
      }
    }
    out.set(uuid, { className: classStr, regionName: regionStr });
  }
  return out;
}
function parseWorldObjectPositions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 12) !== 6) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N);
    if (x < 0 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    map.set(uuid, { x, y });
  }
  return map;
}

const SAVES = [
  'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav',
  'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\ror_t11s.sav',
  'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\athens_t22e.sav',
];

for (const p of SAVES) {
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const meta = parseCharacterMetadataByUuid(buf);
  const positions = parseWorldObjectPositions(buf);
  const matched = [];
  let unmatched = 0;
  for (const [uuid, m] of meta) {
    if (positions.has(uuid)) matched.push({ uuid, ...m, ...positions.get(uuid) });
    else unmatched++;
  }
  const withRegion = matched.filter(m => m.regionName).length;
  console.log(path.basename(p));
  console.log('  total char-meta:', meta.length, ' matched-to-pos:', matched.length, ' unmatched:', unmatched, ' withRegion:', withRegion);
  console.log('  Sample (first 5):');
  for (const r of matched.slice(0, 5)) {
    console.log('    uuid=0x' + r.uuid.toString(16).padStart(8, '0') +
                ' class="' + r.className + '"' +
                ' region="' + (r.regionName || '?') + '"' +
                ' pos=(' + r.x + ',' + r.y + ')');
  }
}
