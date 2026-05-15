// dig-settlefields-s86-1.js — session 86
// Goal: locate population u32 inside settlement-detail bodies by finding the
// known starting-population value (e.g., Roma=9000) and cross-referencing
// across multiple settlements (Roma, Qart-Khadasht, Etruria, Parthenope, Kroton).
//
// Method:
//   1. Walk settlement-markers, name each one from UTF-16 prefix.
//   2. The blob between markers[i].blockEnd .. markers[i+1].offset is
//      settlement-detail #i (i.e. *previous* marker's settlement).
//      Actually session 78 says: settlement-detail records live between
//      consecutive markers; pair (i,i+1) gives detail i+1. We'll just emit
//      the name from BOTH neighbors and inspect.
//   3. For each detail blob, scan for u32 LE matching descr_strat population
//      value of the candidate settlement (try both neighbor names).
//   4. Across ~10 known settlements, intersect candidate offsets to find a
//      stable field position.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

const { findAllSettlementMarkers } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));

const buf = fs.readFileSync(SAVE);
const SETT_START = 0xf85f00;
const SETT_END   = 0x1f10c72;
const FC_MAGIC = Buffer.from([0xfc,0xfc,0xfc,0xfc,0x64,0x00,0x00,0x00,0x00]);

const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);
console.log(`settlement markers in zone: ${setts.length}`);

// Known starting populations from descr_strat.txt
// (only values that are reasonably distinctive — small numbers like 1500 would have
// huge false-positive rates; rare values give sharp signals).
const KNOWN = [
  { name: "Roma",                 pop: 9000  },
  { name: "Qart-Khadasht",        pop: 12000 },
  { name: "Adrumet",              pop: 5000  }, // also matches some Greek city
  { name: "Epikrateia",           pop: 5000  },
  { name: "Lepqi_Adir",           pop: 4000  },
  { name: "Etruria",              pop: 4500  },
  { name: "Ziz",                  pop: 4500  },
  { name: "Xatiq",                pop: 4500  },
  { name: "Parthenope",           pop: 3750  },
  { name: "Arik",                 pop: 3500  },
  { name: "Xupon",                pop: 3500  },
  { name: "Peucetia",             pop: 3000  },
  { name: "Etruria_Occidentalis", pop: 3000  },
  { name: "Poseidonia",           pop: 3000  },
  { name: "Lokroi_Epizephyrioi",  pop: 3000  },
  { name: "Ay-Khol",              pop: 2500  },
  { name: "Ting",                 pop: 2500  },
  { name: "Samnium",              pop: 2400  },
  { name: "Thourioi",             pop: 2200  },
  { name: "Aspis",                pop: 2200  },
  { name: "Faliscia",             pop: 2250  },
  { name: "Daunia",               pop: 2250  },
  { name: "Kroton",               pop: 1800  },
  { name: "Kanysion",             pop: 1750  },
  { name: "Karaly",               pop: 1700  },
  { name: "Kyrnos",               pop: 1500  },
  { name: "Ager_Gallicus",        pop: 1200  },
  { name: "Bebaxal",              pop: 1200  },
  { name: "Maleth",               pop: 1000  },
];
const knownByName = new Map();
for (const k of KNOWN) knownByName.set(k.name, k.pop);

// Index markers by name. The marker name string is the *region* name (per
// buildingParser comment) — actually the comment says "settlement" — but
// descr_strat uses region names. Let's just print and see.
const byName = new Map();
for (const m of setts) byName.set(m.name, m);

// What names match KNOWN?
let nameMatchCount = 0;
for (const k of KNOWN) {
  if (byName.has(k.name)) nameMatchCount++;
}
console.log(`name matches between markers and KNOWN: ${nameMatchCount} / ${KNOWN.length}`);

// Print first few marker names for verification.
console.log("\nFirst 6 markers + names:");
for (let i = 0; i < 6; i++) {
  const m = setts[i];
  console.log(`  ${i}: 0x${m.offset.toString(16)} blockEnd=0x${m.blockEnd.toString(16)} name="${m.name}"`);
}

// For each candidate, find its detail blob.
// Pair (prevMarker.blockEnd .. nextMarker.offset) is "the gap between two
// markers". Session 78 says settlement-detail = blob with FC magic shortly
// after a marker's blockEnd. So detail[i] sits in gap (i, i+1) and belongs
// to marker[i] (since marker contains the name preamble for the block
// following it). Let's test both associations: (gap-belongs-to-prev) vs
// (gap-belongs-to-next).

// Find all detail blobs.
const details = [];
for (let i = 0; i < setts.length; i++) {
  const rs = setts[i].blockEnd;
  const re = (i + 1 < setts.length) ? setts[i + 1].offset : SETT_END;
  if (re - rs < 256) continue;
  const fcIdx = buf.indexOf(FC_MAGIC, rs);
  if (fcIdx < 0 || fcIdx >= rs + 64) continue;
  // terminator
  let termOk = false;
  for (let p = Math.max(rs, re - 16); p + 4 <= re; p++) {
    if (buf[p] === 0xef && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) { termOk = true; break; }
  }
  if (!termOk) continue;
  details.push({
    markerIdx: i,
    prevName: setts[i].name,
    nextName: (i + 1 < setts.length) ? setts[i + 1].name : null,
    start: rs,
    end: re,
    fcIdx: fcIdx,
    bodyLen: re - rs,
  });
}
console.log(`\ndetail blobs found: ${details.length}`);

// For each KNOWN settlement, check both associations.
// Score association by: which name gives more u32-pop hits across the dataset?

function scanU32Hits(slice, val) {
  const hits = [];
  for (let p = 0; p + 4 <= slice.length; p++) {
    if (slice.readUInt32LE(p) === val) hits.push(p);
  }
  return hits;
}

console.log("\n--- Per-known-settlement u32 pop scan ---");
const offsetHistogramPrev = new Map(); // offset-from-FC-magic
const offsetHistogramNext = new Map();
let prevHitTotal = 0, nextHitTotal = 0;
for (const d of details) {
  const slice = buf.slice(d.start, d.end);
  const fcRel = d.fcIdx - d.start;
  const popPrev = d.prevName ? knownByName.get(d.prevName) : null;
  const popNext = d.nextName ? knownByName.get(d.nextName) : null;
  if (popPrev) {
    const hits = scanU32Hits(slice, popPrev);
    if (hits.length) prevHitTotal++;
    for (const h of hits) {
      const rel = h - fcRel;
      offsetHistogramPrev.set(rel, (offsetHistogramPrev.get(rel) || 0) + 1);
    }
  }
  if (popNext) {
    const hits = scanU32Hits(slice, popNext);
    if (hits.length) nextHitTotal++;
    for (const h of hits) {
      const rel = h - fcRel;
      offsetHistogramNext.set(rel, (offsetHistogramNext.get(rel) || 0) + 1);
    }
  }
}
console.log(`prev-association detail blobs with >=1 hit: ${prevHitTotal}`);
console.log(`next-association detail blobs with >=1 hit: ${nextHitTotal}`);

function topHist(h, n = 15) {
  return [...h.entries()].sort((a,b) => b[1]-a[1]).slice(0, n);
}
console.log("\nTop offsets-from-FC where pop u32 found (prev-name association):");
for (const [off, count] of topHist(offsetHistogramPrev)) {
  console.log(`  rel ${off} (0x${off.toString(16)}): ${count} settlements`);
}
console.log("\nTop offsets-from-FC where pop u32 found (next-name association):");
for (const [off, count] of topHist(offsetHistogramNext)) {
  console.log(`  rel ${off} (0x${off.toString(16)}): ${count} settlements`);
}

// Also try absolute-from-start
const offsetHistogramAbsPrev = new Map();
const offsetHistogramAbsNext = new Map();
for (const d of details) {
  const slice = buf.slice(d.start, d.end);
  const popPrev = d.prevName ? knownByName.get(d.prevName) : null;
  const popNext = d.nextName ? knownByName.get(d.nextName) : null;
  if (popPrev) {
    for (const h of scanU32Hits(slice, popPrev)) {
      offsetHistogramAbsPrev.set(h, (offsetHistogramAbsPrev.get(h) || 0) + 1);
    }
  }
  if (popNext) {
    for (const h of scanU32Hits(slice, popNext)) {
      offsetHistogramAbsNext.set(h, (offsetHistogramAbsNext.get(h) || 0) + 1);
    }
  }
}
console.log("\nTop ABS offsets-from-start (prev assoc):");
for (const [off, count] of topHist(offsetHistogramAbsPrev)) {
  console.log(`  abs ${off} (0x${off.toString(16)}): ${count} settlements`);
}
console.log("\nTop ABS offsets-from-start (next assoc):");
for (const [off, count] of topHist(offsetHistogramAbsNext)) {
  console.log(`  abs ${off} (0x${off.toString(16)}): ${count} settlements`);
}
