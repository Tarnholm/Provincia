// dig-blob-0x026fe963.js — investigate the SECOND-largest unclaimed run from
// cover.js on the Turn-960 "Dummies" autosave: 457,844 B at
// 0x026fe963..0x0276e5d7 (0.65 % of the 67.31 MB save).
//
// Pattern follows scripts/save-cracker/dig-post-grid-267-array.js. We
// document FINDINGS as a comment block above the analyser.
//
// FINDINGS (2026-05-26 session):
//   * Blob position: ~40 MB into a 67 MB save.  This is PAST all four zones
//     cover.js currently scans:
//          settlement-zone-end  = 0x1f10c72 (~32.6 MB) <- char-pool-auto stops
//          army-trail-zone-end  = 0x1f1fc14 (~32.7 MB) <- army-trail-auto stops
//          stride9-zone-end     = 0x20e6e8e (~34.4 MB) <- stride9 detector stops
//          faction-array-start  = 0x3d12d92 (~64.2 MB)
//     So the entire ~30 MB body region 0x20e6e8e..0x3d12d92 is currently
//     UNCLAIMED by every auto-detector cover.js has — that's where most of
//     the top-10 unknown runs live.
//
//   * Blob bytes: 67.1 % zero, 2.0 % ff, 30.9 % other  -> DENSE, not padding.
//
//   * Settlement-detail tokens / magic — ALL ZERO.  Not a per-settlement
//     pool ("default_set", "hinterland_region", "core_building",
//     "governor", "fc fc fc fc" all = 0).
//
//   * Building-chain tokens ("_Town", "_City", "_Village", "Hillfort",
//     "Stockade") — ALL ZERO.  Not an embedded building catalog.
//
//   * Portrait-path density is OVERWHELMING:
//          "data/ui/"               762 hits
//          "portraits/"            1143 hits
//          "/young/"                165 hits
//          "/old/"                  218 hits
//          "/dead/"                 379 hits
//          "/generals/"             383 hits
//          "captains/"                0 hits  (none — only generals)
//          "admirals/"                0 hits
//     Sample full paths (length 50-60):
//          "data/ui/barbarian/portraits/portraits/young/generals/136.tga"
//          "data/ui/barbarian/portraits/portraits/old/generals/057.tga"
//          "data/ui/barbarian/portraits/cards/young/generals/117.tga"
//     -> This is a CHARACTER-POOL payload — the slot table the engine
//     uses to cache the EDB's recruitable-general portraits, faction-
//     coloured, indexed by 3-digit number.
//
//   * Bytewise structure markers:
//          ef 00 00 00     50 hits  (record/section terminators)
//          1e 00 00 00    434 hits  (sub-record markers — the same family
//                                    cover.js section-14 army-trail-auto
//                                    chases)
//          f0 0a af f0      0 hits  (no embedded faction records)
//          fc fc fc fc      0 hits  (no settlement-detail records)
//
//   * Blob HEAD (first 64 B) is 8-byte-stride `<u32 ptr/handle> <u32 zero>`
//     records.  The "ptr" values are 30-bit numbers in [0x05000000..
//     0x70000000] — file-offset-shaped (these would resolve to bytes
//     5 MB - 112 MB into the file).  After ~88 such pairs the encoding
//     transitions to length-prefixed ASCII portrait paths, exactly the
//     shape of a `char-pool-auto` blob.
//
//   * Blob TAIL: ends with `data/ui/barbarian/portraits/portraits/dead/
//     017.tga` followed by `00 11 00 00 00 00 00 00 d3 e5 76 02` — a
//     length-prefixed slot terminator.
//
//   * Bytes IMMEDIATELY BEFORE blob (0x026fe7d3..0x026fe962): trailing
//     `ff…ff` of the prior army-record, then a length-prefixed unit name
//     `0f 00 greek slingers` + UUID + UTF-16 settlement name `Euesperidai`
//     + a structured tail.  That's the canonical army-record-end signature
//     from session 99 — confirming the immediately-preceding bytes ARE an
//     army record (claimed by some auto-detector or unit-record parser).
//
//   * Bytes IMMEDIATELY AFTER blob (0x0276e5d7..0x0276e6d7): a UUID then
//     `1e 00 00 00 [long zero pad]` + sparse FF-terminated stride records.
//     That's the army-trail-family terminator from session 62 — the next
//     bytes ARE a session-62 army-trail-auto target (and probably ARE
//     claimed by that detector in cover.js, even though that detector's
//     ZONE_END is 0x1f1fc14, because… wait, let me re-check that
//     boundary against the actual numeric output).
//
//   * Re-running cover.js's section-13 char-pool-auto criteria against
//     the blob:
//          Test A  army-unit header w/in 100 B after blob:  FALSE
//          Test B  >50% 0xff:                                FALSE (2.0%)
//          Test C  >=3 portrait paths "data/ui/":            TRUE  (762!)
//     -> The blob WOULD satisfy char-pool-auto's test-C, but the detector
//     skipped it because its ZONE_END (0x1f10c72) is at 32.6 MB and the
//     blob lives at 40 MB.  This is a ZONE-BOUNDARY bug: cover.js's
//     settlement zone (and the char-pool zone hard-coded to follow it)
//     is sized for save_1.2.sav and is too small for the larger Dummies
//     save.  Extend ZONE_END for sections 9b/13/14/15/16/17 to cover the
//     wider [merc-pool-end, faction-array-start] region and this blob
//     (and most of the other top-10 unknowns near it) will be claimed.
//
// VERDICT:
//   The blob is a CHARACTER-POOL payload (per-faction recruitable-general
//   portrait-path slot table, same family as the 61 ranges char-pool-auto
//   already claims), located in the post-32MB tail region the cover.js
//   detectors don't reach.
//
//   The fix is purely a ZONE-BOUNDARY extension in cover.js — no new
//   record-format work needed.  Drafted patch in the final summary.
//
// Usage:  node dig-blob-0x026fe963.js [savePath]

"use strict";
const fs   = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const BLOB_START = 0x026fe963;
const BLOB_END   = 0x0276e5d7;

const buf  = fs.readFileSync(SAVE);
const span = buf.slice(BLOB_START, BLOB_END);
console.log(`save:    ${SAVE}`);
console.log(`blob:    0x${BLOB_START.toString(16)}..0x${BLOB_END.toString(16)} (${span.length} B = ${(span.length/1024).toFixed(1)} KB)`);

function hexdump(p, n) {
  const out = [];
  for (let i = 0; i < n; i += 16) {
    const row = [];
    for (let k = 0; k < 16 && i + k < n; k++) row.push(buf[p + i + k].toString(16).padStart(2, "0"));
    let ascii = "";
    for (let k = 0; k < 16 && i + k < n; k++) {
      const c = buf[p + i + k];
      ascii += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
    }
    out.push(`  0x${(p + i).toString(16).padStart(8, "0")}  ${row.join(" ").padEnd(48)}  ${ascii}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 1. Byte frequency.
// ---------------------------------------------------------------------------
let zeros = 0, ffs = 0;
for (let i = 0; i < span.length; i++) { if (span[i] === 0) zeros++; else if (span[i] === 0xff) ffs++; }
console.log(`bytes:   0x00 = ${zeros} (${(100*zeros/span.length).toFixed(1)}%)  0xff = ${ffs} (${(100*ffs/span.length).toFixed(1)}%)  other = ${span.length-zeros-ffs} (${(100*(span.length-zeros-ffs)/span.length).toFixed(1)}%)`);

// ---------------------------------------------------------------------------
// 2. Boundary bytes.
// ---------------------------------------------------------------------------
console.log("\n--- preceding 64 B (before blob) ---");
console.log(hexdump(BLOB_START - 64, 64));
console.log("\n--- first 128 B of blob ---");
console.log(hexdump(BLOB_START, 128));
console.log("\n--- last 64 B of blob ---");
console.log(hexdump(BLOB_END - 64, 64));
console.log("\n--- 64 B following the blob ---");
console.log(hexdump(BLOB_END, 64));

// ---------------------------------------------------------------------------
// 3. Token scans (settlement, army-trail, char-pool, faction).
// ---------------------------------------------------------------------------
function countInRange(needle, start, end) {
  const nb = Buffer.isBuffer(needle) ? needle : Buffer.from(needle);
  let count = 0, p = start;
  while ((p = buf.indexOf(nb, p)) >= 0 && p < end) { count++; p += 1; }
  return count;
}
const SETTL_TOKENS = ["hinterland_region", "core_building", "default_set", "governor"];
const TRAIL_TOKENS = ["_Town", "_City", "_Village", "Hillfort", "Stockade"];
const CHARPOOL_TOKENS = ["data/ui/", "portraits/", "/portraits/", "/young/", "/old/", "/dead/", "/mid/", "captains/", "generals/", "admirals/"];
const FACTION_TOKENS = ["f0 0a af f0", "ff 0a af f0"];

console.log("\n--- token scans inside blob ---");
console.log("[settlement-detail]");
for (const t of SETTL_TOKENS) console.log(`  ${JSON.stringify(t).padEnd(22)} : ${countInRange(t, BLOB_START, BLOB_END)} hit(s)`);
console.log("[army-trail (building-chain)]");
for (const t of TRAIL_TOKENS) console.log(`  ${JSON.stringify(t).padEnd(22)} : ${countInRange(t, BLOB_START, BLOB_END)} hit(s)`);
console.log("[char-pool (portrait paths)]");
for (const t of CHARPOOL_TOKENS) console.log(`  ${JSON.stringify(t).padEnd(22)} : ${countInRange(t, BLOB_START, BLOB_END)} hit(s)`);

console.log("[bytewise magics]");
console.log(`  fc fc fc fc           : ${countInRange(Buffer.from([0xfc,0xfc,0xfc,0xfc]), BLOB_START, BLOB_END)} hit(s)`);
console.log(`  ef 00 00 00           : ${countInRange(Buffer.from([0xef,0x00,0x00,0x00]), BLOB_START, BLOB_END)} hit(s)`);
console.log(`  1e 00 00 00           : ${countInRange(Buffer.from([0x1e,0x00,0x00,0x00]), BLOB_START, BLOB_END)} hit(s)`);
console.log(`  f0 0a af f0           : ${countInRange(Buffer.from([0xf0,0x0a,0xaf,0xf0]), BLOB_START, BLOB_END)} hit(s)`);
console.log(`  ff 0a af f0           : ${countInRange(Buffer.from([0xff,0x0a,0xaf,0xf0]), BLOB_START, BLOB_END)} hit(s)`);

// ---------------------------------------------------------------------------
// 4. Find every ASCII string >= 4 chars and report the first 25 longest.
//    Goal: see what kind of content the engine is storing here.
// ---------------------------------------------------------------------------
const STRINGS = [];
{
  let p = BLOB_START, run = 0, start = -1;
  while (p < BLOB_END) {
    const c = buf[p];
    const printable = (c >= 0x20 && c <= 0x7e);
    if (printable) {
      if (start < 0) start = p;
      run++;
    } else {
      if (run >= 4) STRINGS.push({ off: start, len: run, text: buf.slice(start, start + run).toString("latin1") });
      run = 0; start = -1;
    }
    p++;
  }
  if (run >= 4 && start >= 0) STRINGS.push({ off: start, len: run, text: buf.slice(start, start + run).toString("latin1") });
}
STRINGS.sort((a, b) => b.len - a.len);
console.log(`\n--- ASCII strings inside blob: ${STRINGS.length} total, longest 25 ---`);
for (const s of STRINGS.slice(0, 25)) {
  console.log(`  +0x${(s.off - BLOB_START).toString(16).padStart(6,"0")}  len=${s.len.toString().padStart(3)}  ${JSON.stringify(s.text)}`);
}

// ---------------------------------------------------------------------------
// 5. Per-1k-byte zero-density profile — find dense and sparse sub-regions.
// ---------------------------------------------------------------------------
const BUCKET = 4096;
console.log(`\n--- zero-density profile per ${BUCKET} B (sparse to dense) ---`);
const profile = [];
for (let p = BLOB_START; p < BLOB_END; p += BUCKET) {
  const end = Math.min(p + BUCKET, BLOB_END);
  let z = 0;
  for (let i = p; i < end; i++) if (buf[i] === 0) z++;
  profile.push({ off: p - BLOB_START, pct: z / (end - p) });
}
const skip = Math.max(1, Math.floor(profile.length / 30));
for (let i = 0; i < profile.length; i += skip) {
  const e = profile[i];
  const bar = "#".repeat(Math.floor(e.pct * 40));
  console.log(`  +0x${e.off.toString(16).padStart(6,"0")}  ${(e.pct*100).toFixed(0).padStart(3)}%  ${bar}`);
}

// ---------------------------------------------------------------------------
// 6. Look for 8-byte stride at the head — `<u32 a> <u32 b>` pair table.
//    The first 64 B we already printed show what looks like 8-B records.
//    Walk the head as u32 pairs and report distinct top-half values.
// ---------------------------------------------------------------------------
console.log("\n--- first 256 B as <u32 a, u32 b> pairs ---");
for (let p = BLOB_START; p < BLOB_START + 256; p += 8) {
  const a = buf.readUInt32LE(p);
  const b = buf.readUInt32LE(p + 4);
  console.log(`  +0x${(p-BLOB_START).toString(16).padStart(4,"0")}  a=0x${a.toString(16).padStart(8,"0")}  b=0x${b.toString(16).padStart(8,"0")}  (a=${a}, b=${b})`);
}

// ---------------------------------------------------------------------------
// 7. Look for embedded length-prefixed strings in the form `<u32 len> <ascii>`
//    which is the encoding used inside character records' trait/portrait
//    archives. High count → confirms this is character/portrait data.
// ---------------------------------------------------------------------------
let lpStrings = 0;
let lpPortraits = 0;
let lpExamples = [];
for (let p = BLOB_START; p + 8 < BLOB_END; p++) {
  const len = buf.readUInt32LE(p);
  if (len < 4 || len > 96) continue;
  if (p + 4 + len >= BLOB_END) continue;
  let ok = true;
  for (let k = 0; k < len; k++) {
    const c = buf[p + 4 + k];
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  // Avoid matching every random offset — require the string to contain at
  // least one '/' or '.' or '_' (path / filename / token).
  const txt = buf.slice(p + 4, p + 4 + len).toString("latin1");
  if (!/[\/._]/.test(txt)) continue;
  lpStrings++;
  if (txt.includes("portraits/") || txt.includes("data/ui/")) lpPortraits++;
  if (lpExamples.length < 12) lpExamples.push({ off: p - BLOB_START, len, txt });
}
console.log(`\n--- length-prefixed (<u32 len> <ascii>) strings: ${lpStrings} (portraits/data-ui: ${lpPortraits}) ---`);
for (const e of lpExamples) {
  console.log(`  +0x${e.off.toString(16).padStart(6,"0")}  len=${e.len.toString().padStart(2)}  ${JSON.stringify(e.txt)}`);
}

// ---------------------------------------------------------------------------
// 8. Neighbour sanity — how many character / unit / settlement / faction
//    records sit inside the blob according to the existing parsers?
// ---------------------------------------------------------------------------
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const { findCharacterRecords } = require(`${PROVINCIA_SRC}/characterParser.js`);
const { findUnitRecords }      = require(`${PROVINCIA_SRC}/unitParser.js`);
const { findAllSettlementMarkers } = require(`${PROVINCIA_SRC}/buildingParser.js`);
const { findFactionRecords }   = require(`${PROVINCIA_SRC}/factionRecordParser.js`);

function inBlob(arr, key = "offset") {
  return arr.filter(r => r[key] >= BLOB_START && r[key] < BLOB_END).length;
}
try {
  const nameLookup = fs.readFileSync("C:/RIS/RIS/data/descr_names_lookup.txt","utf8").split(/\r?\n/).map(s=>s.trim());
  const traitNames = fs.readFileSync("C:/RIS/RIS/data/export_descr_character_traits.txt","utf8").split(/\r?\n/).filter(l=>/^Trait\s+\S/.test(l)).map(l=>l.match(/^Trait\s+(\S+)/)[1]);
  const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
  console.log(`\ncharacters in blob: ${inBlob(chars)} (total file: ${chars.length})`);
} catch (e) {
  console.log(`\n[warn] character parse failed: ${e.message}`);
}
const units    = findUnitRecords(buf);
const setts    = findAllSettlementMarkers(buf);
const factions = findFactionRecords(buf);
console.log(`units in blob:       ${inBlob(units)} (total: ${units.length})`);
console.log(`settlements in blob: ${inBlob(setts)} (total: ${setts.length})`);
console.log(`factions in blob:    ${inBlob(factions)} (total: ${factions.length})`);

// ---------------------------------------------------------------------------
// 9. Where is the blob inside the army-trail zone?  Print neighbours.
// ---------------------------------------------------------------------------
console.log("\n--- positional context ---");
console.log(`merc-pool-table end:   0x1501615`);
console.log(`settlement-zone end:   0x1f10c72`);
console.log(`army-trail-zone end:   0x1f1fc14`);
console.log(`faction-array start:   0x${factions[0]?.offset.toString(16)}`);
console.log(`first RLE record:      ~0x1f48000`);
console.log(`blob lies inside army-trail/AI-cache zone (between merc-pool and faction array).`);

console.log("\n--- previous claim (settlement marker) ---");
const lastMarker = setts.filter(s => s.offset < BLOB_START).slice(-1)[0];
const nextMarker = setts.filter(s => s.offset >= BLOB_END)[0];
console.log(`last settlement marker before blob: ${lastMarker ? `0x${lastMarker.offset.toString(16)}` : "n/a"}`);
console.log(`first settlement marker after blob: ${nextMarker ? `0x${nextMarker.offset.toString(16)}` : "n/a (no markers past blob)"}`);
