// Low-level RTW save-buffer readers, extracted from main.js (2026-07-15).
// Every function here is PURE — it takes a Buffer (+ offsets) and returns
// decoded data, touching no module/global state. That makes the byte-format
// logic unit-testable in isolation and shrinks main.js. Behavior is identical
// to the inline versions these replaced; see the per-function crack notes.
"use strict";

// worldObjectUuid → {x,y} from the save's world-object records.
//   N-12: u32 = 6         (record-type marker)
//   N-8:  u32 = worldUuid
//   N-4:  u32 = N-4       (self-pointer)
//   N:    u32 = x (0..1100)   N+4: u32 = y (0..800)
function parseWorldObjectPositions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 12) !== 6) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N);
    // RIS imperial map is 1020x700 (vanilla ~200x150); wide bounds keep legit
    // position records on imperial saves.
    if (x < 0 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    map.set(uuid, { x, y });
  }
  return map;
}

// uuid → { className, regionName } from the per-character metadata records
// (u32 marker 0xef, ASCIIZ pstr16 class, then a UTF-16 region name).
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
      if (/^[A-Z][A-Za-z _0-9-]*$/.test(s)) { regionStr = s; break; }
    }
    out.set(uuid, { className: classStr, regionName: regionStr });
  }
  return out;
}

// End offset of the last `descr_strat` UTF-16 path string in the header —
// mod-robust anchor for turn/year (they sit at fixed offsets past it).
function findDescrStratAnchorEnd(saveBuf) {
  const needle = Buffer.from("d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0", "binary");
  const lim = Math.min(saveBuf.length, 0x10000);
  let idx = -1, p = 0;
  while (true) {
    const f = saveBuf.indexOf(needle, p);
    if (f === -1 || f > lim) break;
    idx = f; p = f + 2;
  }
  if (idx < 0) return -1;
  let e = idx;
  while (e + 1 < saveBuf.length && saveBuf[e] >= 0x20 && saveBuf[e] <= 0x7e && saveBuf[e + 1] === 0) e += 2;
  return e;
}

// Current in-game year (i32, BC negative). anchorEnd+9, or 0x44e7 fallback.
function readCurrentYearFromSave(saveBuf) {
  const a = findDescrStratAnchorEnd(saveBuf);
  const off = (a >= 0 && saveBuf[a + 4] === 0x01) ? a + 9 : 0x44e7;
  if (saveBuf.length < off + 4) return null;
  const year = saveBuf.readInt32LE(off);
  if (year < -2000 || year > 3000) return null;
  return year;
}

// Displayed turn number (save stores turn-1). anchorEnd+5, or 0x44e3 fallback.
function readTurnFromSave(saveBuf) {
  const a = findDescrStratAnchorEnd(saveBuf);
  const off = (a >= 0 && saveBuf[a + 4] === 0x01) ? a + 5 : 0x44e3;
  if (saveBuf.length < off + 4) return null;
  const turnCounter = saveBuf.readUInt32LE(off);
  if (turnCounter > 10000) return null;
  return turnCounter + 1;
}

// A length-prefixed UTF-16LE name: [u8 nchars][0x00][nchars*2 LE][0x00 0x00].
// Returns { name, end } or null. `len` is the buffer's usable length.
function readUtf16Name(data, pos, len) {
  if (pos + 4 >= len) return null;
  const nchars = data[pos];
  if (nchars < 3 || nchars > 32 || data[pos + 1] !== 0x00) return null;
  const strStart = pos + 2;
  const strEnd = strStart + nchars * 2;
  if (strEnd + 2 > len || data[strEnd] !== 0x00 || data[strEnd + 1] !== 0x00) return null;
  let decoded = "";
  for (let j = strStart; j < strEnd; j += 2) {
    const lo = data[j], hi = data[j + 1];
    if (hi !== 0x00 || lo < 0x20 || lo > 0x7e) return null;
    decoded += String.fromCharCode(lo);
  }
  if (decoded[0] < "A" || decoded[0] > "Z") return null;
  return { name: decoded, end: strEnd + 2 };
}

module.exports = {
  parseWorldObjectPositions,
  parseCharacterMetadataByUuid,
  findDescrStratAnchorEnd,
  readCurrentYearFromSave,
  readTurnFromSave,
  readUtf16Name,
};
