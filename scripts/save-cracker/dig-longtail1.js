// dig-longtail1.js — characterise the top long-tail unknowns.
//
// Goal: rerun cover.js's claim phase, then for each of the top-20 largest
// UNKNOWN runs:
//   - dump first 128 bytes + last 32 bytes (hex)
//   - byte histogram bucket (0x00 / printable-ASCII / other)
//   - extract ASCII strings ≥4 chars
//   - report adjacent claim names (256 B before / after)
//   - report leading-32-byte signature (hex) so we can group families.
//
// Output: console table + a JSON dump at out-longtail-top20.json so the next
// pass can group by signature.

"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

// Re-use cover.js's claim machinery by requiring it. cover.js currently runs
// main() on import — instead, replicate the run via a child process and parse
// its UNKNOWN list... no. Simpler: inline a slim version that gives us the
// bitmap. We require the parsers directly.
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));
const { findUnitRecords }      = require(path.join(PROVINCIA_SRC, "unitParser.js"));
const { findAllSettlementMarkers, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const { findFactionRecords }   = require(path.join(PROVINCIA_SRC, "factionRecordParser.js"));
const { findLuaCounters }      = require(path.join(PROVINCIA_SRC, "luaCounterParser.js"));

const MOD_DATA_DIR = "C:/RIS/RIS/data";

function loadNameLookup(dir) {
  return fs.readFileSync(path.join(dir, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
}
function loadTraitNames(dir) {
  const lines = fs.readFileSync(path.join(dir, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  const out = [];
  for (const l of lines) { const m = l.match(/^Trait\s+(\S+)/); if (m) out.push(m[1]); }
  return out;
}

function main() {
  const buf = fs.readFileSync(SAVE);
  const size = buf.length;
  const bm = new Uint8Array(size);
  const claims = []; // {start,end,name}
  const claim = (s, e, n) => {
    s = Math.max(0, s); e = Math.min(size, e);
    if (e <= s) return;
    for (let i = s; i < e; i++) bm[i] = 1;
    claims.push({ start: s, end: e, name: n });
  };

  // Mirror cover.js exactly for the major spans we care about. We don't need
  // all the auto-detectors to be perfect — we just need to know what's NOT
  // claimed in the same set cover.js produces. Easier: re-run cover.js as a
  // subprocess in JSON-ish mode. But cover.js has no JSON mode. So we
  // replicate the spans by running cover.js as a child and parsing its log.
  // BUT cover.js already does the work; cheaper to call it through node -e
  // tricks. Instead, parse cover.js stdout for the top-20 list now extended:

  // Quick re-implementation: call cover.js as subprocess with arg to print top
  // 20 unknowns. cover.js only prints top 10. We instead re-implement
  // minimally — actually the simplest is to spawn cover.js, intercept its
  // bitmap. cover.js currently doesn't export. Patch: copy the inline logic.
  // To avoid duplication, we will spawn cover.js (it has all detectors live).
  // We do NOT need its bitmap; we need the spans. Re-implementing produces
  // duplication risk. Instead: monkey-patch cover.js by requiring its module
  // — but cover.js calls main() on import.

  // Cleanest: spawn cover.js, parse "Top 10" but additionally we want top 20.
  // Patch cover.js? Don't — instead, replicate the structural calls here.
  // For top-20 hunting we just need the unknowns list, which depends on the
  // bitmap, which depends on every claim. Replicating fully is ~150 lines.
  //
  // PRAGMATIC: run cover.js once to capture stdout for top-10. Then do a
  // SECOND pass on a separate bitmap with the SAME spans by parsing cover.js's
  // own log of claimed first-range starts — too brittle.
  //
  // Best path: spawn cover.js, get its top 10 (= 30+ KB unknowns). Then for
  // a "long tail" view we do our OWN coarse bitmap (header, character, unit,
  // faction, settlements + chains, lua counters, RLE) — that already captures
  // ~80% and the unknowns we surface will overlap with cover.js's top runs.
  // Good enough for shape classification.

  // --- header ---
  claim(0, 0x3328, "header");
  claim(0x3328, 0x3bad, "HST");
  claim(0x3bad, 0x3bb5, "body-root");
  claim(0x43f8, 0x44e2, "rng-block");
  claim(0x44e2, 0x2a25d, "post-fow-stride");
  claim(0x2a25d, 0x2d155, "diplo-event-log");
  claim(0x2d4a9, 0x618f8, "diplo-slot-table");
  claim(0x61c47, 0x846af, "ZoneA-log-slots");
  claim(0x846af, 0xa8beb, "ZoneB-scripted-events");
  claim(0xa8beb, 0xf8fd2, "character-paths");
  claim(0xf8fd2, 0xf84632, "tile-grid-matrix");

  // characters
  const names = loadNameLookup(MOD_DATA_DIR);
  const traits = loadTraitNames(MOD_DATA_DIR);
  const chars = findCharacterRecords(buf, names, traits);
  for (const c of chars) if (c.recordSize) claim(c.offset, c.offset + c.recordSize, "char");

  // units
  const units = findUnitRecords(buf);
  for (const u of units) {
    const end = u.endOffset || (u.offset + (u.recordSize || 0)) || u.offset + 280;
    claim(u.offset, end, "unit");
  }

  // settlements + chains
  const settles = findAllSettlementMarkers(buf);
  for (const s of settles) claim(s.offset, s.offset + (s.markerLen || 13), "settle");
  // building chains: scanChainsBetween in pairs
  for (let i = 0; i < settles.length; i++) {
    const start = settles[i].offset + (settles[i].markerLen || 13);
    const end   = (i + 1 < settles.length) ? settles[i + 1].offset : 0xf84632;
    try {
      const chains = scanChainsBetween(buf, start, end);
      for (const c of chains) claim(c.offset, c.offset + (c.recordSize || 0), "chain");
    } catch (_) {}
  }

  // factions
  const factions = findFactionRecords(buf);
  for (const f of factions) claim(f.offset, f.offset + (f.recordSize || 0), "faction");

  // lua counters
  const lua = findLuaCounters(buf);
  for (const l of lua) claim(l.offset, l.offset + (l.recordSize || 0), "lua");

  // Append synthetic spans that match cover.js's hard-coded special claims.
  claim(0x14e5ac6, 0x1501615, "merc-pool");
  claim(0x152f529, 0x152f572, "siege");
  claim(0x20e6e8e, 0x20e8342, "lua-footer");

  // Now walk for unclaimed runs ≥ 100B and pick top 20 by size.
  const unknowns = [];
  let rs = -1;
  for (let i = 0; i <= size; i++) {
    const c = i < size && bm[i];
    if (!c && rs < 0) rs = i;
    else if (c && rs >= 0) { if (i - rs >= 100) unknowns.push({ start: rs, end: i, bytes: i - rs }); rs = -1; }
  }
  if (rs >= 0 && size - rs >= 100) unknowns.push({ start: rs, end: size, bytes: size - rs });

  const top = [...unknowns].sort((a, b) => b.bytes - a.bytes).slice(0, 20);

  // Adjacency: build a quick "what claim covers x" oracle.
  const sortedClaims = [...claims].sort((a, b) => a.start - b.start);
  function claimAt(off) {
    // linear lookup acceptable for 20 calls
    for (const c of sortedClaims) if (off >= c.start && off < c.end) return c.name;
    return null;
  }
  function nearestBefore(off) {
    let best = null;
    for (const c of sortedClaims) if (c.end <= off && (!best || c.end > best.end)) best = c;
    return best;
  }
  function nearestAfter(off) {
    for (const c of sortedClaims) if (c.start >= off) return c;
    return null;
  }

  function hex(b, n) { return [...b.subarray(0, n)].map(x => x.toString(16).padStart(2, "0")).join(" "); }
  function stats(s, e) {
    let z = 0, asc = 0;
    for (let i = s; i < e; i++) {
      const v = buf[i];
      if (v === 0) z++;
      else if (v >= 0x20 && v < 0x7f) asc++;
    }
    const n = e - s;
    return { zeros: z, ascii: asc, other: n - z - asc, len: n };
  }
  function strings(s, e, minLen = 4) {
    const out = [];
    let cur = -1;
    for (let i = s; i <= e; i++) {
      const v = i < e ? buf[i] : 0;
      const printable = v >= 0x20 && v < 0x7f;
      if (printable && cur < 0) cur = i;
      else if (!printable && cur >= 0) {
        if (i - cur >= minLen) out.push({ off: cur, len: i - cur, s: buf.slice(cur, i).toString("ascii") });
        cur = -1;
      }
    }
    return out.slice(0, 8);
  }

  const out = [];
  console.log(`\n=== Top 20 long-tail UNKNOWNS (after coarse claim) ===`);
  for (const u of top) {
    const head = buf.slice(u.start, Math.min(u.end, u.start + 32));
    const sig = [...head].map(x => x.toString(16).padStart(2, "0")).join("");
    const st = stats(u.start, u.end);
    const strs = strings(u.start, u.end, 4);
    const before = nearestBefore(u.start);
    const after  = nearestAfter(u.end);
    const before2 = nearestBefore(u.start - 1);
    out.push({
      start: u.start, end: u.end, bytes: u.bytes,
      headHex: hex(buf.slice(u.start), 64),
      tailHex: hex(buf.slice(Math.max(u.start, u.end - 32), u.end), 32),
      sig32: sig,
      sig8:  [...head.subarray(0,8)].map(x => x.toString(16).padStart(2,"0")).join(" "),
      stats: st,
      strings: strs.map(s => `@+${s.off - u.start}:${s.s}`),
      before: before && { name: before.name, gap: u.start - before.end },
      after:  after  && { name: after.name,  gap: after.start - u.end },
    });
    console.log(`\n  0x${u.start.toString(16)}  ..  0x${u.end.toString(16)}  (${u.bytes} B)`);
    console.log(`    before: ${before ? before.name : "-"} (gap ${before ? u.start - before.end : "-"} B)`);
    console.log(`    after : ${after  ? after.name  : "-"} (gap ${after  ? after.start - u.end : "-"} B)`);
    console.log(`    head64: ${hex(buf.slice(u.start), 64)}`);
    console.log(`    tail32: ${hex(buf.slice(Math.max(u.start, u.end - 32), u.end), 32)}`);
    console.log(`    stats : zeros=${st.zeros}/${st.len} (${(st.zeros/st.len*100).toFixed(1)}%)  ascii=${st.ascii}  other=${st.other}`);
    console.log(`    sig8  : ${[...head.subarray(0,8)].map(x => x.toString(16).padStart(2,"0")).join(" ")}`);
    if (strs.length) console.log(`    strs  : ${strs.map(s => `@+${s.off - u.start}:"${s.s}"`).join("  ")}`);
  }

  fs.writeFileSync(path.join(__dirname, "out-longtail-top20.json"), JSON.stringify(out, null, 2));
  console.log(`\nWrote out-longtail-top20.json`);

  // Bucket by leading sig
  console.log(`\n=== Leading-8-byte signatures (top 20) ===`);
  const groups = new Map();
  for (const u of out) {
    const k = u.sig8;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  for (const [k, arr] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k}  -> ${arr.length} unknowns  (sizes ${arr.map(x => x.bytes).join(", ")})`);
  }

  // Same buckets but on first 4 bytes
  console.log(`\n=== Leading-4-byte signatures (top 20) ===`);
  const groups4 = new Map();
  for (const u of out) {
    const k = u.sig8.slice(0, 11); // "aa bb cc dd"
    if (!groups4.has(k)) groups4.set(k, []);
    groups4.get(k).push(u);
  }
  for (const [k, arr] of [...groups4.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k}  -> ${arr.length} unknowns  (sizes ${arr.map(x => x.bytes).join(", ")})`);
  }
}

main();
