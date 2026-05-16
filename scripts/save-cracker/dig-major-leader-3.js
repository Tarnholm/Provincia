// Around each major's first occurrence outside its own record, look for
// nearby ASCII or UTF-16 strings (within ±256 bytes). If any string is
// a faction NAME (e.g., "romans_julii", "Carthage", etc.), we've found
// the missing factionTag → name link.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

function findMajors(buf) {
  const records = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    records.push({ pos: i, factionTag: buf.readUInt32LE(i + 28) });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}

const majors = findMajors(A);

function findStrings(buf, start, end) {
  const out = [];
  // ASCIIZ length-prefixed (u16 strlen incl null)
  for (let p = start; p < end - 4; p++) {
    const lenP1 = buf.readUInt16LE(p);
    if (lenP1 < 4 || lenP1 > 40) continue;
    if (p + 2 + lenP1 > buf.length) continue;
    let ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c = buf[p + 2 + j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    if (buf[p + 2 + lenP1 - 1] !== 0) continue;
    const s = buf.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
    if (s.length >= 3 && /^[A-Za-z][A-Za-z _0-9]*[A-Za-z0-9]$/.test(s)) {
      out.push({ off: p, kind: 'asciiz', str: s });
    }
  }
  // UTF-16 LE pstr16
  for (let p = start; p < end - 4; p++) {
    const lenChars = buf.readUInt16LE(p);
    if (lenChars < 3 || lenChars > 40) continue;
    if (p + 2 + lenChars * 2 > buf.length) continue;
    let ok = true;
    const chars = [];
    for (let j = 0; j < lenChars; j++) {
      const c = buf.readUInt16LE(p + 2 + j * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      chars.push(String.fromCharCode(c));
    }
    if (!ok) continue;
    const s = chars.join('');
    if (/^[A-Z][A-Za-z _0-9-]*$/.test(s)) {
      out.push({ off: p, kind: 'utf16', str: s });
    }
  }
  return out;
}

// For each major's factionTag first occurrence (outside its own record),
// look for strings within ±256 bytes.
for (let k = 0; k < majors.length; k++) {
  const tag = majors[k].factionTag;
  let firstOcc = -1;
  for (let i = 0; i + 4 <= A.length; i++) {
    if (A.readUInt32LE(i) === tag) {
      if (i >= majors[k].pos && i < majors[k].pos + 256) continue;
      firstOcc = i; break;
    }
  }
  if (firstOcc < 0) continue;
  const winStart = Math.max(0, firstOcc - 256);
  const winEnd = Math.min(A.length, firstOcc + 256);
  const strs = findStrings(A, winStart, winEnd);
  console.log('\nmajor[' + k + '] tag=0x' + tag.toString(16).padStart(8, '0') + ' first-occ 0x' + firstOcc.toString(16));
  if (strs.length === 0) {
    console.log('  no length-prefixed strings within ±256 bytes');
  } else {
    for (const s of strs.slice(0, 20)) {
      const delta = s.off - firstOcc;
      console.log('  ' + (delta >= 0 ? '+' : '') + delta + '  (' + s.kind + ') "' + s.str + '"');
    }
  }
}
