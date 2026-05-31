// scripts/diff-unit-fields.js — controlled-diff cracker for UNIT-LEVEL header fields.
//
// Matches the SAME unit across two saves and reports which bytes (relative to the
// post-region anchor _regionEnd) changed. Matching key options:
//   - commanderUuid (best for bodyguards: stable across turns)
//   - name+region+seed (the u32 right after the name hash)
//
// Usage:
//   node scripts/diff-unit-fields.js <saveA.sav> <saveB.sav> [--window 80]
//        [--name <substr>] [--moved-only] [--maxchanges 60]

"use strict";
const fs = require("fs");
const { findUnitRecords } = require("../src/unitParser.js");

function parseArgs(argv) {
  const a = { a: null, b: null, window: 80, name: null, maxchanges: 80, key: "auto" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--window") a.window = parseInt(argv[++i], 10);
    else if (argv[i] === "--name") a.name = argv[++i].toLowerCase();
    else if (argv[i] === "--maxchanges") a.maxchanges = parseInt(argv[++i], 10);
    else if (argv[i] === "--key") a.key = argv[++i];
    else if (!a.a) a.a = argv[i];
    else if (!a.b) a.b = argv[i];
  }
  return a;
}

// A stable per-unit id: the u32 immediately after the name hash. Layout from
// probe: [u16 nameLen][name+null][u32 hash][u32 id/seed]... We read at
// offset + 2 + nameLen + (pad to align?) — simpler & robust: derive from the
// raw bytes between name-end and region. We use commanderUuid when present,
// else (name|region|soldiers-bucket) as a weak key. The most reliable cross-save
// key is the commanderUuid for bodyguards. For non-bodyguards we use the
// per-unit id u32 sitting just before region marker region.
function unitKey(buf, r) {
  if (r.commanderUuid) return "cmd:" + r.commanderUuid;
  // id u32: scan the bytes between name end and the region rlen byte for the
  // first nonzero u32 that is stable. Use the value at name-end+1 area. We grab
  // the u32 at offset+2+nameLen-1 +1 (after null) which probe shows is the hash,
  // then +4 is the id. Use BOTH hash+id as composite for stability.
  const nameLen = buf.readUInt16LE(r.offset);
  const afterName = r.offset + 2 + nameLen; // points just past name+null
  const hash = buf.readUInt32LE(afterName);
  const id = buf.readUInt32LE(afterName + 4);
  return "id:" + r.name + ":" + r.region + ":" + hash + ":" + id;
}

function index(buf) {
  const recs = findUnitRecords(buf);
  const m = new Map();
  for (const r of recs) {
    const k = unitKey(buf, r);
    if (!m.has(k)) m.set(k, r); // first wins; dup keys are rare
  }
  return m;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ba = fs.readFileSync(args.a);
  const bb = fs.readFileSync(args.b);
  if (args.key === "count") {
    for (const [label, b] of [["A", ba], ["B", bb]]) {
      const r = findUnitRecords(b);
      const wc = r.filter((u) => u.commanderUuid).length;
      const s = r.find((u) => u.commanderUuid);
      console.log(`${label}: units=${r.length} withCmd=${wc} sampleCmd=${s && s.commanderUuid} sampleName=${s && s.name}`);
    }
    return;
  }
  const ma = index(ba);
  const mb = index(bb);
  {
    const ka = [...ma.keys()], kb = new Set(mb.keys());
    const inter = ka.filter((k) => kb.has(k)).length;
    const cmdA = ka.filter((k) => k.startsWith("cmd:")).length;
    console.error(`[diag] keysA=${ka.length} keysB=${kb.size} intersect=${inter} cmdKeysA=${cmdA}`);
  }

  let matched = 0, changedUnits = 0;
  const offsetHist = new Map(); // relative-offset -> count of units changing there
  let printed = 0;

  for (const [k, ra] of ma) {
    const rb = mb.get(k);
    if (!rb) continue;
    if (args.name && !ra.name.toLowerCase().includes(args.name)) continue;
    matched++;
    const aBase = ra._regionEnd, bBase = rb._regionEnd;
    const win = args.window;
    if (aBase + win > ba.length || bBase + win > bb.length) continue;
    const diffs = [];
    for (let o = 0; o < win; o++) {
      const x = ba[aBase + o], y = bb[bBase + o];
      if (x !== y) {
        diffs.push(o);
        offsetHist.set(o, (offsetHist.get(o) || 0) + 1);
      }
    }
    if (diffs.length) {
      changedUnits++;
      if (printed < args.maxchanges) {
        printed++;
        console.log(`\n${ra.name} | ${ra.region} | ${k} | sol ${ra.soldiers}/${ra.maxSoldiers} -> ${rb.soldiers}/${rb.maxSoldiers} | mp ${ra.movementPoints}->${rb.movementPoints}`);
        // Group diffs into runs and print before/after for each run.
        let runs = [];
        for (const o of diffs) {
          if (runs.length && o === runs[runs.length - 1].end + 1) runs[runs.length - 1].end = o;
          else runs.push({ start: o, end: o });
        }
        for (const run of runs) {
          const aHex = [], bHex = [];
          for (let o = run.start; o <= run.end; o++) {
            aHex.push(ba[aBase + o].toString(16).padStart(2, "0"));
            bHex.push(bb[bBase + o].toString(16).padStart(2, "0"));
          }
          console.log(`   +${run.start}${run.end > run.start ? ".." + run.end : ""}: ${aHex.join(" ")}  ->  ${bHex.join(" ")}`);
        }
      }
    }
  }

  console.log(`\n=== summary: matched ${matched} units, ${changedUnits} changed within +0..+${args.window} of anchor ===`);
  const sorted = [...offsetHist.entries()].sort((a, b) => b[1] - a[1]);
  console.log("changed-offset histogram (rel to _regionEnd, top 40):");
  for (const [o, c] of sorted.slice(0, 40)) console.log(`   +${String(o).padStart(3)}  ${c} units`);
}

main();
