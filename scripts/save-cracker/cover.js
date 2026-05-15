// cover.js — byte-coverage map for an RTW Remastered .sav file.
//
// Walks the save end-to-end and classifies every byte as CLAIMED (by a known
// structure) or UNKNOWN. The output tells us how much of the .sav we
// currently understand and where the largest blind spots are. This is the
// progress meter for the rebuild-saves goal.
//
// Usage:  node cover.js [savePath]
// Default save: save_1.2.sav in the Feral campaign saves folder.

"use strict";

const fs = require("fs");
const path = require("path");

const SAVE_PATH = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const MOD_DATA_DIR = "C:/RIS/RIS/data";
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");

// Pull in the parsers we already wrote for the running app. They each emit
// `{offset, ...}` records; some carry an explicit `size` we can use to
// compute a span, others we estimate via the gap to the next record of the
// same kind.
const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));
const { findUnitRecords }      = require(path.join(PROVINCIA_SRC, "unitParser.js"));
const { findAllSettlementMarkers, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const { findFactionRecords, summarizeFactionArray }   = require(path.join(PROVINCIA_SRC, "factionRecordParser.js"));
const { findLuaCounters }      = require(path.join(PROVINCIA_SRC, "luaCounterParser.js"));

// ---------------------------------------------------------------------------
// Bitmap: 1 bit per byte. Marks claimed bytes and records the section name.
// ---------------------------------------------------------------------------
function makeBitmap(n) { return new Uint8Array(n); }

function claim(bitmap, start, end, claims, name) {
  start = Math.max(0, start);
  end = Math.min(bitmap.length, end);
  if (end <= start) return 0;
  let added = 0;
  for (let i = start; i < end; i++) {
    if (!bitmap[i]) { bitmap[i] = 1; added++; }
  }
  claims.push({ start, end, bytes: end - start, name });
  return added;
}

// ---------------------------------------------------------------------------
// Mod data loaders — minimal, just enough to feed the character parser.
// ---------------------------------------------------------------------------
function loadNameLookup(dir) {
  const p = path.join(dir, "descr_names_lookup.txt");
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map(s => s.trim());
}

function loadTraitNames(dir) {
  const p = path.join(dir, "export_descr_character_traits.txt");
  const names = [];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^Trait\s+(\S+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Main coverage walk.
// ---------------------------------------------------------------------------
function main() {
  const buf = fs.readFileSync(SAVE_PATH);
  const size = buf.length;
  console.log(`save: ${SAVE_PATH}`);
  console.log(`size: ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MB)\n`);

  const bm = makeBitmap(size);
  const claims = [];

  // --- 1. Fixed header region [0..0x3328) -----------------------------------
  // Per RESEARCH.md: header layout is fixed up to the header strings table.
  claim(bm, 0x0000, 0x3328, claims, "Header (magic, GUID, campaign-name, fixed data block)");

  // --- 2. Header Strings Table (~0x3328 .. ~0x3bad) -------------------------
  // 106 (asciiz_name, u32_version) pairs. Body root starts right after.
  claim(bm, 0x3328, 0x3bad, claims, "Header Strings Table (HST, 106 record types)");

  // --- 3. toggle_fow / RNG counter region [0x43f8..0x44e2) ------------------
  // Two-save-no-input diffs land here; treat the bracketing range as known.
  claim(bm, 0x43f8, 0x44e2, claims, "Toggle_fow / RNG counter block");

  // --- 3a. Post-fow 35-stride table (session 57) ----------------------------
  // Framed-undecoded; sits between RNG counter block and the diplo event log.
  claim(bm, 0x44e2, 0x2a25d, claims, "post-fow-35-stride-table");

  // --- 3b. Diplo event log (session 57) — 1002 × 12 B ----------------------
  claim(bm, 0x2a25d, 0x2d155, claims, "diplo-event-log");

  // --- 3c. Diplo slot-table (session 56) — 12-byte slot table -------------
  claim(bm, 0x2d4a9, 0x618f8, claims, "diplo-slot-table");

  // --- 3d. Zone A — battle/message log slots (session 54) -----------------
  claim(bm, 0x61c47, 0x846af, claims, "ZoneA-log-slots");

  // --- 3e. Zone B — scripted-event registry (session 54) ------------------
  claim(bm, 0x846af, 0xa8beb, claims, "ZoneB-scripted-events");

  // --- 3f. CHARACTER_PATHS section (session 55) ---------------------------
  claim(bm, 0xa8beb, 0xf8fd2, claims, "character-paths");

  // --- 3g. Per-region mercenary pool table (session 58) -------------------
  claim(bm, 0x14e5ac6, 0x1501615, claims, "merc-pool-table");

  // --- 4. Mid-file tile-grid matrix at 0xf8fd2 (CONFIRMED 57,120 × 267) -----
  // 240×238 × 267-byte stride. Crosses body-root boundary into the
  // "9.78 MB tile-attribute gap". One contiguous array per session 22/52.
  const GRID_START = 0xf8fd2;
  const GRID_BYTES = 240 * 238 * 267; // = 15_252_960
  const GRID_END   = GRID_START + GRID_BYTES; // = 0xf84632 (~16.27 MB)
  claim(bm, GRID_START, GRID_END, claims, "Tile-grid matrix (240×238 × 267-byte stride)");

  // --- 5. Body root [0x3bad .. 0xf8fd2) -------------------------------------
  // The "body" is the section-grammar tree. The tile-grid array starts at
  // 0xf8fd2, so the body region runs from end-of-HST up to that point.
  // We DON'T claim it as a single section — instead the sub-parsers (chars,
  // units, factions, settlements) cover the meaningful records inside.
  // The wrapper section header itself is still a known structure: claim
  // its first 8 bytes (selfPtr + size).
  claim(bm, 0x3bad, 0x3bad + 8, claims, "Body root section header (selfPtr+size)");

  // --- 6. Character records ------------------------------------------------
  let nameLookup = null, traitNames = null;
  try {
    nameLookup = loadNameLookup(MOD_DATA_DIR);
    traitNames = loadTraitNames(MOD_DATA_DIR);
  } catch (e) {
    console.log(`[warn] mod data load failed (${e.message}); skipping character parse`);
  }
  if (nameLookup && traitNames) {
    const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
    console.log(`characters: ${chars.length}`);
    // Each character record ≈ 308 + traitCount*8 + portrait_paths bytes.
    // Approximate span = min(gap-to-next, 800) to avoid swallowing adjacent
    // unknown structures (battle-log entries, message-log, etc.).
    for (let i = 0; i < chars.length; i++) {
      const start = chars[i].offset - 47; // UUID fields sit at -47/-43
      const next  = i + 1 < chars.length ? chars[i + 1].offset - 47 : chars[i].offset + 800;
      const recEnd = Math.min(next, chars[i].offset + 800);
      claim(bm, Math.max(0, start), recEnd, claims, "Character record");
    }
  }

  // --- 7. Unit records ------------------------------------------------------
  // Unit records are variable-sized (~80-200 B). We approximate with
  // min(gap-to-next, 256 B) so we don't over-claim into adjacent unknown.
  const units = findUnitRecords(buf);
  console.log(`units: ${units.length}`);
  for (let i = 0; i < units.length; i++) {
    const start = units[i].offset - 24; // fleet/passenger fields sit before
    const next  = i + 1 < units.length ? units[i + 1].offset - 24 : units[i].offset + 256;
    const recEnd = Math.min(next, units[i].offset + 256);
    claim(bm, Math.max(0, start), recEnd, claims, "Unit record");
  }

  // --- 8. Faction records (magic ff 0a af f0 / f0 0a af f0) ----------------
  const factions = findFactionRecords(buf);
  const fSum = summarizeFactionArray(factions);
  console.log(`factions: ${factions.length}${fSum ? ` (${fSum.start.toString(16)}..${fSum.end.toString(16)})` : ""}`);
  for (const f of factions) {
    claim(bm, f.offset, f.offset + f.size, claims, "Faction record");
  }

  // --- 9. Settlements + building chains (~0xf88637..~0x1f10c72) ------------
  // The scanners are greedy across the whole file. Constrain to the known
  // settlement-zone window per RESEARCH.md so we don't false-claim chain-
  // looking byte patterns from the tile-grid, faction array, etc.
  const SETT_ZONE_START = 0xf85f00; // generous lower bound (session 12 says ~0xf88637)
  const SETT_ZONE_END   = 0x1f10c72;
  const settsAll = findAllSettlementMarkers(buf);
  const setts = settsAll.filter(s => s.offset >= SETT_ZONE_START && s.offset < SETT_ZONE_END);
  console.log(`settlements (markers in zone): ${setts.length} (raw scan: ${settsAll.length})`);
  if (setts.length > 0) {
    // Claim each settlement's own marker block.
    for (const s of setts) {
      claim(bm, s.offset, s.blockEnd, claims, "Settlement marker");
    }
    // Claim each chain record inside its enclosing inter-marker gap.
    let chainTotal = 0;
    let chainBytes = 0;
    for (let i = 0; i < setts.length; i++) {
      const prevEnd = i === 0 ? SETT_ZONE_START : setts[i - 1].blockEnd;
      const chains = scanChainsBetween(buf, prevEnd, setts[i].offset, null, null);
      for (const c of chains) {
        const span = Math.min(c.size || 16, 4096);
        claim(bm, c.offset, c.offset + span, claims, "Building chain record");
        chainTotal++;
        chainBytes += span;
      }
    }
    console.log(`building chains in zone: ${chainTotal} (${chainBytes} bytes)`);
    // We intentionally do NOT claim the entire settlement-zone span —
    // per-settlement non-chain payload (~6 MB) is exactly what we still
    // need to crack. Leaving it unclaimed surfaces it in the UNKNOWN
    // table where future sessions can target it.
  }

  // --- 10. Siege block (73 bytes at 0x152f529 per session 33) --------------
  if (0x152f529 + 73 <= size) {
    claim(bm, 0x152f529, 0x152f529 + 73, claims, "Siege block (73 B per active siege)");
  }

  // --- 11. f0 0a af f0 RLE shroud-mask array @ 0x1f4847b ------------------
  // 239 variable-length records × per-faction 1020×700 RLE masks.
  // Use the magic-marker `f0 0a af f0` at +8 to enumerate records.
  const RLE_MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
  const rleOffsets = [];
  {
    let p = 0x1f48000;
    while (p < size - 8) {
      const i = buf.indexOf(RLE_MAGIC, p);
      if (i < 0) break;
      // Validate: u32 at i-8 is a self-pointer (= i - 8).
      if (i >= 8 && buf.readUInt32LE(i - 8) === i - 8) {
        rleOffsets.push(i - 8);
      }
      p = i + 4;
    }
  }
  console.log(`f0 0a af f0 RLE records: ${rleOffsets.length}`);
  for (let i = 0; i < rleOffsets.length; i++) {
    const start = rleOffsets[i] - 16; // pre-header lives at -24..0 (we approximate)
    const end   = i + 1 < rleOffsets.length ? rleOffsets[i + 1] - 16 : rleOffsets[i] + 30_000;
    claim(bm, Math.max(0, start), Math.min(size, end), claims, "RLE shroud-mask record");
  }

  // --- 12. Lua persistent counters footer near EOF --------------------------
  const counters = findLuaCounters(buf);
  console.log(`lua counters: ${counters.length}`);
  if (counters.length > 0) {
    const start = counters[0].offset;
    const end   = counters[counters.length - 1].end;
    claim(bm, start, end, claims, "Lua persistent-counter footer");
  }

  // ---------------------------------------------------------------------------
  // Walk the bitmap. Emit consecutive UNKNOWN runs >= MIN_RUN bytes.
  // ---------------------------------------------------------------------------
  const MIN_RUN = 100;
  const unknowns = [];
  let runStart = -1;
  for (let i = 0; i <= size; i++) {
    const claimedHere = i < size && bm[i];
    if (!claimedHere && runStart < 0) runStart = i;
    else if (claimedHere && runStart >= 0) {
      if (i - runStart >= MIN_RUN) unknowns.push({ start: runStart, end: i, bytes: i - runStart });
      runStart = -1;
    }
  }
  if (runStart >= 0 && size - runStart >= MIN_RUN) {
    unknowns.push({ start: runStart, end: size, bytes: size - runStart });
  }

  // ---------------------------------------------------------------------------
  // Report.
  // ---------------------------------------------------------------------------
  // Aggregate claimed bytes per section name (deduped via bitmap).
  let claimedTotal = 0;
  for (let i = 0; i < size; i++) if (bm[i]) claimedTotal++;
  const unknownTotal = size - claimedTotal;
  const pctClaimed = (claimedTotal / size * 100).toFixed(2);
  const pctUnknown = (unknownTotal / size * 100).toFixed(2);

  console.log("\n=== Known sections (raw spans, may overlap) ===");
  // Group claims by name and sum raw extents.
  const byName = new Map();
  for (const c of claims) {
    const entry = byName.get(c.name) || { name: c.name, bytes: 0, ranges: [] };
    entry.bytes += c.bytes;
    entry.ranges.push([c.start, c.end]);
    byName.set(c.name, entry);
  }
  const grouped = [...byName.values()].sort((a, b) => b.bytes - a.bytes);
  for (const g of grouped) {
    const pct = (g.bytes / size * 100).toFixed(2);
    const first = g.ranges[0];
    console.log(
      `  ${g.bytes.toString().padStart(12)}  ${pct.padStart(6)}%  ` +
      `${g.ranges.length} range(s)  first=[0x${first[0].toString(16)}..0x${first[1].toString(16)})  ${g.name}`
    );
  }

  console.log("\n=== Top 10 largest UNKNOWN runs ===");
  const top = [...unknowns].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  console.log("  start_hex      end_hex        bytes        % of file");
  for (const u of top) {
    const pct = (u.bytes / size * 100).toFixed(2);
    console.log(
      `  0x${u.start.toString(16).padStart(8, "0")}    ` +
      `0x${u.end.toString(16).padStart(8, "0")}    ` +
      `${u.bytes.toString().padStart(10)}   ${pct.padStart(6)}%`
    );
  }

  console.log("\n=== Summary ===");
  console.log(`  total file:        ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  claimed bytes:     ${claimedTotal} (${pctClaimed}%)`);
  console.log(`  unknown bytes:     ${unknownTotal} (${pctUnknown}%)`);
  console.log(`  unknown runs ≥100: ${unknowns.length}`);
  console.log(`  ${pctClaimed}% claimed, ${pctUnknown}% unknown`);
}

main();
