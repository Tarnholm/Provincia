// dig-script-fired-state-3.js
// Refine the historic-events table model:
//   Hypothesis: the events table is a LIVE QUEUE of pending (not-yet-fired)
//   events. When a one-time event fires it is REMOVED from the table. So
//   "which events have fired" = "which descr_events entries are ABSENT from
//   the save's table".  The 'olympics' entry (fires turn 1) is present at T0
//   but gone at T7 -> strong support.
//
// Steps:
//  1. Walk the events table in both saves with the real record grammar and
//     list every (category,name) entry. Compare the SETS.
//  2. Decode one record's payload fields precisely.
//
// Research/diagnostics only.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

function load(f) { return fs.readFileSync(path.join(BASE, f)); }

// pstr16 ASCIIZ: u16 lenPlus1 (includes NUL), then ascii bytes + NUL.
function pstr(buf, o, end) {
  if (o + 2 > end) return null;
  const lp1 = buf.readUInt16LE(o);
  if (lp1 < 2 || lp1 > 64) return null;
  if (o + 2 + lp1 > end) return null;
  for (let j = 0; j < lp1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lp1 - 1] !== 0) return null;
  return { str: buf.toString('latin1', o + 2, o + 2 + lp1 - 1), total: 2 + lp1 };
}

// Find the events table start: the first "historic"/"volcano" category pstr
// preceding the first known event name. We anchor on the first occurrence of
// the category pstr16 "volcano".
function findTableStart(buf) {
  // category strings appear as pstr16. Find "olympics" or first "historic".
  // Anchor: pstr16 "historic" (len 9 => lp1=9) -> bytes 09 00 'historic' 00
  const anchors = ['historic', 'volcano'];
  let best = -1;
  for (const a of anchors) {
    const lp1 = a.length + 1;
    const needle = Buffer.concat([Buffer.from([lp1 & 0xff, (lp1 >> 8) & 0xff]), Buffer.from(a, 'latin1'), Buffer.from([0])]);
    const p = buf.indexOf(needle);
    if (p !== -1 && (best === -1 || p < best)) best = p;
  }
  return best;
}

// Walk records: each record = [pstr category][pstr name][fixed payload].
// Determine payload size by finding the next valid category pstr.
const CATEGORIES = new Set(['historic', 'volcano', 'plague', 'earthquake', 'storm', 'flood', 'riot', 'emergent_faction']);

function walkTable(buf) {
  const start = findTableStart(buf);
  if (start < 0) return { start, events: [] };
  const end = Math.min(buf.length, start + 0x4000); // table is small (<16KB)
  const events = [];
  let p = start;
  let guard = 0;
  while (p < end && guard++ < 500) {
    const cat = pstr(buf, p, end);
    if (!cat || !CATEGORIES.has(cat.str)) break;
    const name = pstr(buf, p + cat.total, end);
    if (!name) break;
    const payloadStart = p + cat.total + name.total;
    // find next category pstr to bound payload
    let next = -1;
    for (let q = payloadStart; q < Math.min(payloadStart + 80, end); q++) {
      const c = pstr(buf, q, end);
      if (c && CATEGORIES.has(c.str)) {
        // also require a following name pstr to reduce false hits
        const nm = pstr(buf, q + c.total, end);
        if (nm) { next = q; break; }
      }
    }
    const recEnd = next < 0 ? payloadStart + 33 : next;
    events.push({ off: p, cat: cat.str, name: name.str, payload: buf.slice(payloadStart, recEnd) });
    if (next < 0) break;
    p = next;
  }
  return { start, events };
}

const EARLY = 'save_t0.sav';
const LATER = 'save_t7.sav';
const a = load(EARLY), b = load(LATER);

const ta = walkTable(a);
const tb = walkTable(b);

console.log(`EARLY ${EARLY}: table@0x${ta.start.toString(16)}  events=${ta.events.length}`);
console.log(`LATER ${LATER}: table@0x${tb.start.toString(16)}  events=${tb.events.length}`);

const setA = new Set(ta.events.map((e) => `${e.cat}:${e.name}`));
const setB = new Set(tb.events.map((e) => `${e.cat}:${e.name}`));

const firedRemoved = [...setA].filter((k) => !setB.has(k)).sort();
const newlyPresent = [...setB].filter((k) => !setA.has(k)).sort();

console.log(`\n--- present at EARLY but GONE at LATER (=> FIRED between t0 and t7) [${firedRemoved.length}] ---`);
for (const k of firedRemoved) console.log('   ' + k);

console.log(`\n--- present at LATER but absent at EARLY [${newlyPresent.length}] ---`);
for (const k of newlyPresent) console.log('   ' + k);

// Decode the payload of the first few records (field layout).
console.log('\n--- payload field decode (first 6 EARLY records) ---');
for (const e of ta.events.slice(0, 6)) {
  const pl = e.payload;
  const u = (i) => (i + 4 <= pl.length ? pl.readUInt32LE(i) : null);
  const i32 = (i) => (i + 4 <= pl.length ? pl.readInt32LE(i) : null);
  console.log(`  ${e.cat}:${e.name}  payloadLen=${pl.length}`);
  console.log(`     +0=0x${(u(0) >>> 0).toString(16)}  +4=${u(4)}  +8=${u(8)}  +12=${u(12)}(date?)  +16=${u(16)}  +20=${u(20)}  +24=${u(24)}  +28=${u(28)}`);
}

// Full sorted list at EARLY for the deliverable.
console.log('\n--- ALL pending events at EARLY (t0) ---');
for (const e of ta.events) console.log(`   ${e.cat}:${e.name}`);
