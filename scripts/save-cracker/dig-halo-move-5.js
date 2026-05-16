// Filter the metadata-record scan to character classes only and cross-reference
// against position-record UUIDs to estimate 1:1 mapping reliability.

const fs = require('fs');
const path = require('path');

const SAVES = [
  { tag: 'halo_oneman', path: 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav' },
];
const FIX = 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\';
for (const f of fs.readdirSync(FIX)) {
  if (f.endsWith('.sav')) SAVES.push({ tag: f.replace(/\.sav$/, ''), path: path.join(FIX, f) });
}

const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;

function tryReadAsciizPstr16(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 80) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}
function tryReadUtf16Pstr(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenChars = buf.readUInt16LE(off);
  if (lenChars < 2 || lenChars > 60) return null;
  if (off + 2 + lenChars * 2 > buf.length) return null;
  const chars = [];
  for (let j = 0; j < lenChars; j++) {
    const c = buf.readUInt16LE(off + 2 + j * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + lenChars * 2 };
}

// Find position records (the same pattern main.js uses, distilled).
function findPositionRecords(saveBuf) {
  const m = new Map();
  for (let N = 24; N < saveBuf.length - 8; N++) {
    if (saveBuf.readUInt32LE(N - 4) !== N - 4) continue;
    const type = saveBuf.readUInt32LE(N - 12);
    if (type !== 6 && type !== 5 && type !== 4) continue;
    const x = saveBuf.readUInt32LE(N);
    if (x < 0 || x > 1100) continue;
    const y = saveBuf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = saveBuf.readUInt32LE(N - 8);
    if (!uuid) continue;
    if (!m.has(uuid)) m.set(uuid, { uuid, type, x, y });
  }
  return m;
}

function findCharMetadataRecords(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let classStr = null, classEnd = -1;
    for (let p = i + 0x10; p < i + 0x40 && p + 2 < buf.length; p++) {
      const r = tryReadAsciizPstr16(buf, p);
      if (r && r.str.length > 3 && r.str.length < 50 &&
          /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(r.str) &&
          CHAR_CLASS_RE.test(r.str)) {
        classStr = r.str;
        classEnd = p + r.totalLen;
        break;
      }
    }
    if (!classStr) continue;
    let regionStr = null;
    for (let p = classEnd; p < classEnd + 80 && p + 2 < buf.length; p++) {
      const r = tryReadUtf16Pstr(buf, p);
      if (r && r.str.length > 2 && r.str.length < 40 &&
          /^[A-Z][A-Za-z _0-9-]*$/.test(r.str)) {
        regionStr = r.str;
        break;
      }
    }
    out.push({ off: i, uuid, className: classStr, regionName: regionStr });
  }
  return out;
}

console.log('save'.padEnd(22) + '  posRecs  charMeta  metaW/Reg  matchedToPos  metaWithRegMatched');
for (const s of SAVES) {
  if (!fs.existsSync(s.path)) continue;
  const buf = fs.readFileSync(s.path);
  const positions = findPositionRecords(buf);
  const meta = findCharMetadataRecords(buf);

  const posUuids = new Set(positions.keys());
  const metaWithRegion = meta.filter(m => m.regionName);
  const matched = meta.filter(m => posUuids.has(m.uuid));
  const matchedWithRegion = matched.filter(m => m.regionName);

  console.log(
    s.tag.padEnd(22) + '  ' +
    String(positions.size).padStart(7) + '  ' +
    String(meta.length).padStart(8) + '  ' +
    String(metaWithRegion.length).padStart(9) + '  ' +
    String(matched.length).padStart(12) + '  ' +
    String(matchedWithRegion.length).padStart(20)
  );

  if (s.tag === 'halo_oneman') {
    console.log('\n  All character-class metadata in halo_oneman:');
    for (const r of meta.slice(0, 30)) {
      const hasPos = positions.has(r.uuid);
      const pos = positions.get(r.uuid);
      console.log('    0x' + r.off.toString(16) + ' uuid=0x' + r.uuid.toString(16).padStart(8,'0') +
                  ' class="' + r.className + '"' +
                  ' region=' + (r.regionName ? '"' + r.regionName + '"' : '?'.padEnd(8)) +
                  ' pos=' + (hasPos ? `(${pos.x},${pos.y})` : 'NO_POS'));
    }
    if (meta.length > 30) console.log('    ... (' + (meta.length - 30) + ' more)');
  }
}
