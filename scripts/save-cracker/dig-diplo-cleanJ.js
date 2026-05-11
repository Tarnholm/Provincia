// Session 32 step J: check stretch targets.
// (a) Session 22+31 counters at +(52+4N+148), +(52+4N+172), +(52+4N+224) per faction.
//     N is the index 0..238. Session 31: faction-table-base. Need to find the base.
// (b) Event log at 0x51b5..0x846af.
// (c) Per-tile event registry at 0x84f1f.
//
// Filter the substitution events to which fall into these ranges.

const fs = require('fs');
const path = require('path');

const events = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/diplo-clean-events.json', 'utf8'));

// Range filter helper.
function inRange(off, lo, hi) { return off >= lo && off < hi; }

// (a) AI counters — need faction-record base address. We know flip1 location 0x103286 is in the
// matrix. The faction record array might be at the well-known offset ~0x3328 + headers.
// Let's just list all unique event offsets, grouped by major range.

const ranges = [
  { name: 'header_RNG (0x43f8)', lo: 0x43f0, hi: 0x4400 },
  { name: 'RNG_state (0x455c)', lo: 0x4550, hi: 0x4570 },
  { name: 'AI_tile_data (0xa8e00..0xab000)', lo: 0xa8e00, hi: 0xab000 },
  { name: 'mystery_dbe34 (0xdbe00..0xdc000)', lo: 0xdbe00, hi: 0xdc000 },
  { name: 'matrix_flip1 (0x103286)', lo: 0x103280, hi: 0x103290 },
  { name: 'matrix_flip2 (0xa775de)', lo: 0xa775d0, hi: 0xa775e0 },
  { name: 'region_records (0xf84600+)', lo: 0xf84000, hi: 0xfa0000 },
  { name: 'unified_event_log (0x51b5..0x846af)', lo: 0x51b5, hi: 0x846af },
  { name: 'per_tile_event_reg (0x84f1f+)', lo: 0x84f1f, hi: 0x88000 },
];

console.log(`Total events: ${events.length}`);
const grouped = {};
for (const e of events) {
  for (const r of ranges) {
    if (inRange(e.ai, r.lo, r.hi)) {
      grouped[r.name] = (grouped[r.name] || []);
      grouped[r.name].push(e);
      break;
    }
  }
}
console.log(`\n=== Events by range ===`);
for (const r of ranges) {
  console.log(`  ${r.name}: ${(grouped[r.name] || []).length}`);
}

// (a) Faction record base: session 22 says counters per faction at +52+4N+148 from base.
// To test, we'd need the base. But session 17 says faction records start at ~0x3328 post-HST.
// Substitution events near 0x3328+ would suggest counter ticks.
const earlyEvents = events.filter(e => e.ai < 0xa8000);
console.log(`\nEvents in first 0xa8000 bytes: ${earlyEvents.length}`);
for (const e of earlyEvents.slice(0, 30)) {
  console.log(`  off=0x${e.ai.toString(16)} type=${e.type} ${e.type==='replace' ? `aLen=${e.aLen} bLen=${e.bLen} dA=${e.aHex} dB=${e.bHex}` : `a=${e.a} b=${e.b}`}`);
}

// Events between 0xa8e00 and 0xab000 (the AI/tile cluster).
const tileEvents = (grouped['AI_tile_data (0xa8e00..0xab000)'] || []);
console.log(`\nAI tile cluster: ${tileEvents.length} events. First 50:`);
for (const e of tileEvents.slice(0, 50)) {
  console.log(`  off=0x${e.ai.toString(16)} type=${e.type} ${e.type==='replace' ? `${e.aHex} -> ${e.bHex}` : `${e.a.toString(16)} -> ${e.b.toString(16)}`}`);
}
