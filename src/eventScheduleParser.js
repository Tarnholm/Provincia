// src/eventScheduleParser.js
//
// RTW Remastered .sav SCRIPTED-EVENT / DISASTER SCHEDULE — the in-save backing
// of descr_events.txt (the campaign's dated historical & disaster schedule)
// plus the engine's appended runtime random-disaster registry. Cracked
// 2026-05-31, cross-validated on RIS julii1/2/3 + Carthage1/2/3
// (rtw-sav-parser/docs/findings-coverage-eventschedule-2026-05-31.md).
//
// LOCATE BY SIGNATURE (not a fixed offset): pstr16-asciiz "historic\0" preceded
// 4 bytes earlier by a u32 record-count.
//
// HEADER: u32 count
// RECORD (variable; walk via the two leading pstrs):
//   pstr16_asciiz category   (historic|volcano|earthquake|flood|storm|plague|locusts|riot|…)
//   pstr16_asciiz label      (descr_events label; == category for runtime random events)
//   i32  year                (absolute, negative = BC; epoch 270 BC)
//   u32  season              (2 = summer, 0 = winter)
//   u32  hasPosition         (1 → x,y follow; 0 → omitted)
//   [u32 x, u32 y]
//   u32  scale               (disaster scale)
//   u32  warning             (1 = `warning` flag, e.g. Vesuvius; else 0)
//   u8   terminator (0x00 pad)
//
// The first ~34 records are the static descr_events set (byte-identical across
// turns); the table is APPEND-ONLY (engine appends a record per random-disaster
// roll, label==category, flagged isRandom). Fired-vs-pending is NOT stored —
// the engine re-derives it by comparing (year,season) to the campaign date, so
// "pending" = static records whose date is later than the current turn's date.

"use strict";

const CATEGORIES = new Set([
  "historic", "volcano", "earthquake", "flood", "storm",
  "plague", "locusts", "riot", "emergent_faction", "famine", "fire",
]);

function readPstrAsciiz(buf, p) {
  if (p + 2 > buf.length) return null;
  const len = buf.readUInt16LE(p);
  if (len < 1 || len > 64) return null;
  if (p + 2 + len > buf.length) return null;
  let s = "";
  for (let i = 0; i < len - 1; i++) {
    const c = buf[p + 2 + i];
    if (c < 32 || c > 126) return null;
    s += String.fromCharCode(c);
  }
  if (buf[p + 2 + (len - 1)] !== 0) return null;
  return { s, next: p + 2 + len };
}

function locate(buf) {
  const needle = Buffer.concat([Buffer.from([0x09, 0x00]), Buffer.from("historic\0", "ascii")]);
  let from = 0;
  while (true) {
    const i = buf.indexOf(needle, from);
    if (i < 0) return null;
    from = i + 1;
    const cat = readPstrAsciiz(buf, i);
    if (!cat) continue;
    const lab = readPstrAsciiz(buf, cat.next);
    if (!lab) continue;
    const count = buf.readUInt32LE(i - 4);
    if (count >= 1 && count <= 1000) return { countOff: i - 4, firstRec: i, count };
  }
}

function parseEventSchedule(buf) {
  const loc = locate(buf);
  if (!loc) return null;
  const recs = [];
  let p = loc.firstRec;
  for (let n = 0; n < loc.count; n++) {
    const start = p;
    const cat = readPstrAsciiz(buf, p);
    if (!cat || !CATEGORIES.has(cat.s)) break;
    p = cat.next;
    const lab = readPstrAsciiz(buf, p);
    if (!lab) break;
    p = lab.next;
    if (p + 16 > buf.length) break;
    const year = buf.readInt32LE(p); p += 4;
    const season = buf.readUInt32LE(p); p += 4;
    const hasPosition = buf.readUInt32LE(p); p += 4;
    let x = null, y = null;
    if (hasPosition === 1) {
      if (p + 8 > buf.length) break;
      x = buf.readUInt32LE(p); p += 4; y = buf.readUInt32LE(p); p += 4;
    }
    if (p + 8 > buf.length) break;
    const scale = buf.readUInt32LE(p); p += 4;
    const warning = buf.readUInt32LE(p); p += 4;
    recs.push({
      index: n, offset: start,
      category: cat.s,
      label: lab.s,
      isRandom: lab.s === cat.s,
      year,
      season: season === 2 ? "summer" : season === 0 ? "winter" : `s${season}`,
      x, y, scale, warning: warning === 1,
    });
    // advance to next category pstr (skip trailing 0x00 pad byte(s))
    let q = p, found = -1;
    for (; q <= p + 8; q++) { const pr = readPstrAsciiz(buf, q); if (pr && CATEGORIES.has(pr.s)) { found = q; break; } }
    if (n < loc.count - 1) { if (found < 0) break; p = found; }
  }
  return { count: loc.count, headerOffset: loc.countOff, records: recs };
}

module.exports = { parseEventSchedule, CATEGORIES };
