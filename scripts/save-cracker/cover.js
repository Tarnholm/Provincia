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

  // --- 2a. Pre-toggle_fow header-strings extension + flag table (session 68)
  // The region [0x3bb5..0x43f8) is a 2115 B block of UTF-16 campaign-name
  // strings followed by a 256-entry `01 00 00 00` flag/version table. Sits
  // directly after the body-root section header. Confirmed all-or-mostly
  // structured data — no longer treat as unknown.
  claim(bm, 0x3bb5, 0x43f8, claims, "header-strings-extension + flag table");

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

  // --- 4a. First settlement-detail record (session 68) ----------------------
  // The settlement-marker scanner finds 1310 markers starting at 0xf85f5c,
  // but the FIRST per-settlement detail record sits directly after the tile-
  // grid matrix at 0xf84632..0xf85f5c (6442 B). Its head has the canonical
  // `fc fc fc fc` magic (+48), `default_set` and `hinterland_region` tokens,
  // and ends with the `ef 00 00 00` terminator at 0xf85f58. No preceding
  // marker — the tile-grid end acts as the implicit marker for settlement-0.
  claim(bm, 0xf84632, 0xf85f5c, claims, "Settlement-detail record (settlement-0)");

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

    // --- 9b. Settlement-detail record auto-detector (session 63) ------------
    // Session 63 CONFIRMED: every unclaimed inter-settlement-marker gap in
    // the settlement zone is a per-settlement detail record with this
    // signature (1310/1310 gaps in save_1.2.sav matched all 5 clues):
    //   * `fc fc fc fc 64 00 00 00 00` magic in the first ~64 B (after the
    //     UTF-16 settlement-name tail bytes that bleed in from the marker)
    //   * contains "default_set" within first 256 B
    //   * contains "hinterland_region" within first 512 B
    //   * contains "core_building" within first 1024 B
    //   * ends with `ef 00 00 00` in the last 16 B
    // Body 6-9 KB, holds the settlement's faction-flag bitfield, region-
    // metadata block, the building-chain list (chains are separately claimed
    // by section 9), happiness/garrison/queue tail, then the `ef 00 00 00`
    // terminator. Auto-claim each inter-marker gap that passes ≥ 3 of 5.
    {
      const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);
      const TOK_DEF  = Buffer.from("default_set");
      const TOK_HINT = Buffer.from("hinterland_region");
      const TOK_CORE = Buffer.from("core_building");
      let detClaimed = 0;
      let detBytes   = 0;
      for (let i = 0; i < setts.length; i++) {
        const rs = setts[i].blockEnd;
        const re = (i + 1 < setts.length) ? setts[i + 1].offset : SETT_ZONE_END;
        if (re - rs < 256) continue;
        // Five clue tests
        const fcIdx = buf.indexOf(FC_MAGIC, rs);
        const fcOk  = fcIdx >= 0 && fcIdx < rs + 64;
        const defIdx = buf.indexOf(TOK_DEF, rs);
        const defOk  = defIdx >= 0 && defIdx < Math.min(re, rs + 256);
        const hintIdx = buf.indexOf(TOK_HINT, rs);
        const hintOk  = hintIdx >= 0 && hintIdx < Math.min(re, rs + 512);
        const coreIdx = buf.indexOf(TOK_CORE, rs);
        const coreOk  = coreIdx >= 0 && coreIdx < Math.min(re, rs + 1024);
        let termOk = false;
        for (let p = Math.max(rs, re - 16); p + 4 <= re; p++) {
          if (buf[p] === 0xef && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) { termOk = true; break; }
        }
        const score = (fcOk ? 1 : 0) + (defOk ? 1 : 0) + (hintOk ? 1 : 0) + (coreOk ? 1 : 0) + (termOk ? 1 : 0);
        if (score >= 3) {
          claim(bm, rs, re, claims, "Settlement-detail record");
          detClaimed++;
          detBytes += re - rs;
        }
      }
      console.log(`settlement-detail records: ${detClaimed} (${detBytes} bytes)`);
    }
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

  // --- 13. Per-faction character pool auto-detector (session 61) -----------
  // Session 60 confirmed: between every faction's settlement block and its
  // army block the engine emits a "character pool" payload. They look like:
  //   - nested taw self-pointer pairs `{selfPtr, size=6}+{selfPtr, size~300-560}`
  //     repeating 70-172 times,
  //   - and/or contain ASCII portrait paths `data/ui/<culture>/portraits/...`,
  //   - and/or are 66-70% 0xFF (empty slot table for low-pop factions),
  //   - and ALWAYS end immediately before an army-unit header:
  //     `ef 00 ... 01 00 <u16 len> <ascii unit name>`.
  //
  // Walk every UNCLAIMED run ≥ 5 KB inside the settlement zone (after the
  // per-region merc-pool table, i.e. 0x14e5ac6+) and apply the three tests.
  // If ANY passes, claim as char-pool-auto.
  {
    const ZONE_START = 0x14e5ac6;
    const ZONE_END   = Math.min(0x1f10c72, size);
    const MIN_GAP    = 5 * 1024;
    const PORTRAIT   = Buffer.from("data/ui/");
    let autoClaimed = 0;
    let autoBytes   = 0;

    // Find unclaimed runs inside the zone.
    let runStart = -1;
    const runs = [];
    for (let i = ZONE_START; i <= ZONE_END; i++) {
      const claimedHere = i < ZONE_END && bm[i];
      if (!claimedHere && runStart < 0) runStart = i;
      else if (claimedHere && runStart >= 0) {
        if (i - runStart >= MIN_GAP) runs.push([runStart, i]);
        runStart = -1;
      }
    }
    if (runStart >= 0 && ZONE_END - runStart >= MIN_GAP) {
      runs.push([runStart, ZONE_END]);
    }

    for (const [rs, re] of runs) {
      // Test A: immediately followed (within 100 B) by an army-unit header.
      //   pattern: any window where `ef 00 ... 01 00 <u16 len> <ascii>` is
      //   the next thing. Scan [re..re+100) for byte `ef` then verify the
      //   `01 00 <len> <ascii>` sub-pattern within the next 24 bytes.
      let tailOk = false;
      const searchEnd = Math.min(size - 4, re + 100);
      for (let p = re; p < searchEnd; p++) {
        if (buf[p] !== 0xef) continue;
        // Look for `01 00 <u16 len>` in [p+1 .. p+22).
        for (let q = p + 1; q < Math.min(p + 22, size - 4); q++) {
          if (buf[q] === 0x01 && buf[q + 1] === 0x00) {
            const len = buf.readUInt16LE(q + 2);
            if (len >= 3 && len <= 64 && q + 4 + len <= size) {
              // Verify ascii unit name (lowercase letters / digits / underscore / space).
              let ok = true;
              for (let k = 0; k < len; k++) {
                const c = buf[q + 4 + k];
                const isAlpha = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
                const isDigit = (c >= 0x30 && c <= 0x39);
                if (!isAlpha && !isDigit && c !== 0x5f && c !== 0x20 && c !== 0x2d) { ok = false; break; }
              }
              if (ok) { tailOk = true; break; }
            }
          }
        }
        if (tailOk) break;
      }

      // Test B: byte histogram >= 50% 0xFF.
      let ffCount = 0;
      for (let i = rs; i < re; i++) if (buf[i] === 0xff) ffCount++;
      const ffPct = ffCount / (re - rs);
      const ffOk  = ffPct > 0.50;

      // Test C: >= 3 occurrences of `data/ui/` portrait-path prefix.
      let portraitHits = 0;
      let p = rs;
      while (p < re) {
        const i = buf.indexOf(PORTRAIT, p);
        if (i < 0 || i >= re) break;
        portraitHits++;
        p = i + PORTRAIT.length;
        if (portraitHits >= 3) break;
      }
      const portraitOk = portraitHits >= 3;

      if (tailOk || ffOk || portraitOk) {
        claim(bm, rs, re, claims, "char-pool-auto");
        autoClaimed++;
        autoBytes += re - rs;
      }
    }
    console.log(`char-pool-auto: claimed ${autoClaimed} ranges (${autoBytes} bytes)`);
  }

  // --- 14. Army-trail blob auto-detector (session 62) ----------------------
  // Session 62 cracked the "gap #6 family": these are NOT random AI hashes.
  // Each blob is the trailing payload that immediately follows an army-unit
  // record's ASCII name in the settlement zone. Body is an 8-byte-stride
  // array of `{u16 x, u16 y, u8 flag, u8 0x14..0x17, u16 0}` tile-history
  // entries (movement / scouted-tile memory), often followed by building-
  // chain names ("Eastern_Town", "Carthaginian_Huge_City"), portrait paths
  // ("data/ui/.../generals/NN.tga"), and a UUID-prefixed terminator that
  // ends with `1e 00 00 00 <zeros>`. Sizes 1-22 KB; appear dozens of times.
  //
  // Three independent tests; any one suffices to claim:
  //   A. Run is IMMEDIATELY PRECEDED by `<u16 len> <ascii unit name> <8 B uuid>`.
  //   B. >= 30% of bytes match the tile-stride mask
  //      (buf[i+5]==0 && buf[i+6] in [0x14..0x17] && buf[i+7]==0) over a
  //      8-byte sliding window starting at run-start.
  //   C. Run contains BOTH a building-chain string token (e.g. "_Town", "_City",
  //      "Hillfort") AND ends with `1e 00 00 00` followed by >= 16 zeros.
  {
    const ZONE_START = 0x14e5ac6;
    // Extend zone slightly past the canonical settlement-zone end — a few
    // army-trail blobs sit right at the boundary (the very last army before
    // the faction array starts at 0x1f1fc14 for save_1.2.sav).
    const ZONE_END   = Math.min(0x1f1fc14, size);
    const MIN_GAP    = 1024;        // smaller minimum — these blobs can be 1-2 KB
    let trailClaimed = 0;
    let trailBytes   = 0;
    const CHAIN_TOKENS = [
      Buffer.from("_Town"), Buffer.from("_City"), Buffer.from("_Village"),
      Buffer.from("Hillfort"), Buffer.from("Stockade"),
    ];

    let runStart = -1;
    const runs = [];
    for (let i = ZONE_START; i <= ZONE_END; i++) {
      const claimedHere = i < ZONE_END && bm[i];
      if (!claimedHere && runStart < 0) runStart = i;
      else if (claimedHere && runStart >= 0) {
        if (i - runStart >= MIN_GAP) runs.push([runStart, i]);
        runStart = -1;
      }
    }
    if (runStart >= 0 && ZONE_END - runStart >= MIN_GAP) {
      runs.push([runStart, ZONE_END]);
    }

    for (const [rs, re] of runs) {
      // Test A: preceded by `<u16 len> <ascii> <maybe UUID/padding>`. Scan back
      // up to 320 B for `<u16 len> <ascii>` with len 4..48. The unit-parser
      // sometimes already claims the 256 B following the unit name, in which
      // case the unclaimed-run starts hundreds of bytes after the name.
      let unitTailOk = false;
      const lookback = Math.max(0, rs - 320);
      for (let p = lookback; p < rs - 4; p++) {
        const len = buf.readUInt16LE(p);
        if (len < 4 || len > 48) continue;
        if (p + 2 + len > rs) continue;
        let ok = true;
        for (let k = 0; k < len; k++) {
          const c = buf[p + 2 + k];
          const isAlpha = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
          const isDigit = (c >= 0x30 && c <= 0x39);
          if (!isAlpha && !isDigit && c !== 0x20 && c !== 0x5f && c !== 0x2d) { ok = false; break; }
        }
        if (!ok) continue;
        unitTailOk = true; break;
      }

      // Test B: tile-stride density in first ~2 KB. Stride is 9 bytes per
      // record: `<u16 tile-key with hi byte in 0x0d..0x17> <7 B mostly-zero>`.
      // We scan every BYTE offset (not stride-aligned) and count positions
      // where buf[i] != 0 && buf[i+1] in [0x0d..0x17] && next 7 bytes are
      // mostly-zero. Then check density across [rs..rs+2048).
      let tileHits = 0;
      const winEnd2 = Math.min(re - 9, rs + 2048);
      for (let i = rs; i < winEnd2; i++) {
        if (buf[i] === 0) continue;
        const hi = buf[i + 1];
        if (hi < 0x0d || hi > 0x17) continue;
        let zeros = 0;
        for (let k = 2; k < 9; k++) if (buf[i + k] === 0) zeros++;
        if (zeros >= 5) tileHits++;
      }
      const winLen = winEnd2 - rs;
      // Empirically each 9-byte tile-record produces 1 hit; density ≈ 1/9 ≈ 11%.
      const strideOk = winLen >= 256 && tileHits / winLen >= 0.06;

      // Test C: building-chain token anywhere inside the run.
      let tokenOk = false;
      for (const t of CHAIN_TOKENS) {
        const i = buf.indexOf(t, rs);
        if (i >= 0 && i < re) { tokenOk = true; break; }
      }

      // Test D: the family-defining terminator `1e 00 00 00` followed by
      // >= 14 zero bytes within the last 96 B of the run. This is the
      // strongest signature — present in every confirmed family member.
      let termOk = false;
      const termStart = Math.max(rs, re - 96);
      for (let p = termStart; p + 20 < re; p++) {
        if (buf[p] === 0x1e && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) {
          let z = 0;
          for (let k = 4; k < 20 && p + k < re; k++) if (buf[p + k] === 0) z++;
          if (z >= 14) { termOk = true; break; }
        }
      }

      // Test E: contains a `data/ui/` portrait path (general's portrait
      // cached inside the army-trail blob — observed in T3-13925).
      const portraitIdx = buf.indexOf(Buffer.from("data/ui/"), rs);
      const portraitOk = portraitIdx >= 0 && portraitIdx < re;

      if (unitTailOk || strideOk || tokenOk || termOk || portraitOk) {
        claim(bm, rs, re, claims, "army-trail-auto");
        trailClaimed++;
        trailBytes += re - rs;
      }
    }
    console.log(`army-trail-auto: claimed ${trailClaimed} ranges (${trailBytes} bytes)`);
  }

  // --- 15. Zero-pad ff-terminated trailer auto-detector (session 64) -------
  // Session 64 CONFIRMED: 1185 unclaimed runs in the army-trail zone share an
  // identical tail signature — they are army-trail blobs the session-62
  // detector missed (no portrait, no chain-token, no `1e 00` terminator, low
  // tile-stride density). All end with:
  //   (re-26) 64 00 00 00 64 00 00 00  [10 zero bytes]  <u32 hash>  ff ff ff ff
  // The `64 00 00 00 64 00 00 00` pair = two i32(100) (morale/discipline
  // baseline) and the final u32 is the per-unit hash; the four-FF u32 is the
  // record terminator. Body 200 B - 9 KB, zero/ff dominated, no ASCII.
  // Bytes preceding the run are zeros (extends the prior army-trail blob's
  // padding) — this is the trailing per-unit summary block for armies whose
  // primary trail was already swallowed by the section-62 detector.
  // Claim every unclaimed run in the army-trail zone whose last 26 bytes
  // match this pattern.
  {
    const ZONE_START = 0x14e5ac6;
    const ZONE_END   = Math.min(0x1f1fc14, size);
    const MIN_RUN    = 100;
    let zfClaimed = 0;
    let zfBytes   = 0;

    // Find unclaimed runs.
    let runStart = -1;
    const runs = [];
    for (let i = ZONE_START; i <= ZONE_END; i++) {
      const claimedHere = i < ZONE_END && bm[i];
      if (!claimedHere && runStart < 0) runStart = i;
      else if (claimedHere && runStart >= 0) {
        if (i - runStart >= MIN_RUN) runs.push([runStart, i]);
        runStart = -1;
      }
    }
    if (runStart >= 0 && ZONE_END - runStart >= MIN_RUN) {
      runs.push([runStart, ZONE_END]);
    }

    for (const [rs, re] of runs) {
      if (re - rs < 26) continue;
      const p = re - 26;
      const ok =
        buf[p]    === 0x64 && buf[p+1]  === 0 && buf[p+2]  === 0 && buf[p+3]  === 0 &&
        buf[p+4]  === 0x64 && buf[p+5]  === 0 && buf[p+6]  === 0 && buf[p+7]  === 0 &&
        buf[p+8]  === 0    && buf[p+9]  === 0 && buf[p+10] === 0 && buf[p+11] === 0 &&
        buf[p+12] === 0    && buf[p+13] === 0 && buf[p+14] === 0 && buf[p+15] === 0 &&
        buf[p+16] === 0    && buf[p+17] === 0 &&
        buf[re-4] === 0xff && buf[re-3] === 0xff && buf[re-2] === 0xff && buf[re-1] === 0xff;
      if (ok) {
        claim(bm, rs, re, claims, "zero-ff-trailer-auto");
        zfClaimed++;
        zfBytes += re - rs;
      }
    }
    console.log(`zero-ff-trailer-auto: claimed ${zfClaimed} ranges (${zfBytes} bytes)`);
  }

  // --- 16. Unit-priority stride-9 record-table auto-detector (session 65) ---
  // Session 65 CONFIRMED: 9 of the top-10 remaining unknowns in the army-trail
  // / AI-cache zone are dense tables of 9-byte records of the form:
  //   XX YY ZZ NN 00 00 00 00 00     (9 B)
  // where XX YY ZZ is a u24 LE identifier (low byte cycles through type-nibble
  // values) and NN ∈ {0x00,0x10,0x20,0x30,0x40,0x50,0x60,0x70} — an 8-value
  // category enum. Most ranges (8/9) end with a 5-byte `ff ff ff ff ff`
  // terminator and the bytes IMMEDIATELY AFTER the terminator start a length-
  // prefixed string naming a unit type or culture ("ptolemai", "egyptian",
  // "psiloi", "machai..", "greek ..", "cilici..."). The byte BEFORE the
  // terminator is the trailing zeros of the last record; the byte BEFORE
  // the run start is a partial record (the run begins mid-stride).
  // Hypothesis: this is the AI's per-faction unit-recruitment-priority
  // scoring table — one row per unit-type EDU index (~254 entries, matches
  // EDU size), the type-nibble being a 0..7 priority/stance tier and the
  // u24 ID being a cached unit-type-ID or AI weight.
  // Auto-detect criteria (run must satisfy ALL):
  //   - lies entirely within the army-trail / faction zone [0x14e5ac6, end)
  //   - length >= 100 bytes
  //   - some 9-byte alignment offset (0..8) yields >= 85% records matching
  //     the rigid pattern (5 trailing zeros AND type-nibble in enum)
  //   - run ends with either: 5+ consecutive 0xff bytes OR the next byte
  //     after the run is the start of a length-prefixed unit/culture string
  // We bound the search to the army-trail/AI-cache zone to avoid false
  // positives elsewhere (the same 9-byte motif appears within already-
  // claimed army-trail blobs, but those bytes are already taken).
  {
    const ZONE_START = 0x14e5ac6;
    const ZONE_END   = Math.min(0x20e6e8e, size); // up to lua-counter footer
    const MIN_RUN    = 100;
    let upClaimed = 0;
    let upBytes   = 0;

    // Find unclaimed runs.
    let upRunStart = -1;
    const upRuns = [];
    for (let i = ZONE_START; i <= ZONE_END; i++) {
      const claimedHere = i < ZONE_END && bm[i];
      if (!claimedHere && upRunStart < 0) upRunStart = i;
      else if (claimedHere && upRunStart >= 0) {
        if (i - upRunStart >= MIN_RUN) upRuns.push([upRunStart, i]);
        upRunStart = -1;
      }
    }
    if (upRunStart >= 0 && ZONE_END - upRunStart >= MIN_RUN) {
      upRuns.push([upRunStart, ZONE_END]);
    }

    for (const [rs, re] of upRuns) {
      // Best stride-9 alignment. Records have shape XX YY ZZ NN MM 00 00 00 00
      // where NN is a type-nibble (0x00..0x80, low nibble 0) and MM is a
      // per-range constant (observed: 0x00 in commander/unit-id tables,
      // 0x04 in faction-region tables).
      let bestOff = -1, bestOk = 0, bestTotal = 0;
      for (let off = 0; off < 9; off++) {
        const mmCounts = {};
        let total = 0;
        for (let p = rs + off; p + 9 <= re; p += 9) {
          total++;
          const b3 = buf[p+3];
          if (buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
              (b3 & 0x0f) === 0 && b3 <= 0x80) {
            const mm = buf[p+4];
            mmCounts[mm] = (mmCounts[mm]||0) + 1;
          }
        }
        // pick dominant MM constant
        let topOk = 0;
        for (const k in mmCounts) if (mmCounts[k] > topOk) topOk = mmCounts[k];
        if (topOk > bestOk) { bestOk = topOk; bestTotal = total; bestOff = off; }
      }
      if (bestTotal < 50) continue; // need >= ~50 records to be confident
      if (bestOk / bestTotal < 0.78) continue;
      claim(bm, rs, re, claims, "stride9-score-table-auto");
      upClaimed++;
      upBytes += re - rs;
    }
    console.log(`unit-priority-table-auto: claimed ${upClaimed} ranges (${upBytes} bytes)`);
  }

  // --- 17. Multi-stride record-table sweeper (session 68) -------------------
  // Generalizes the session-65 stride-9 detector to also handle stride-7
  // tables and runs that begin mid-stride or contain embedded FF-filler.
  // Same idea: walk unclaimed runs inside the army-trail/AI-cache zone and
  // claim any that look like dense stride-{7,9} record tables where each
  // record's trailing 4 bytes are zeros.
  //
  // Concretely each record is `<S-4 bytes data>` + `<4 zero bytes>` for
  // stride S ∈ {7, 9}. We find the alignment offset 0..S-1 with the highest
  // match fraction among non-FF-filler records, and claim if >= 85% match.
  // All-FF records are excluded from the denominator since the engine
  // appears to pad these tables with 0xff sentinels between sub-blocks.
  {
    const ZONE_START = 0x14e5ac6;
    const ZONE_END   = Math.min(0x20e6e8e, size);
    const MIN_RUN    = 80;
    let msClaimed = 0;
    let msBytes   = 0;

    let msRunStart = -1;
    const msRuns = [];
    for (let i = ZONE_START; i <= ZONE_END; i++) {
      const claimedHere = i < ZONE_END && bm[i];
      if (!claimedHere && msRunStart < 0) msRunStart = i;
      else if (claimedHere && msRunStart >= 0) {
        if (i - msRunStart >= MIN_RUN) msRuns.push([msRunStart, i]);
        msRunStart = -1;
      }
    }
    if (msRunStart >= 0 && ZONE_END - msRunStart >= MIN_RUN) {
      msRuns.push([msRunStart, ZONE_END]);
    }

    for (const [rs, re] of msRuns) {
      let bestPct = 0, bestS = 0;
      for (const S of [7, 9]) {
        for (let off = 0; off < S; off++) {
          let total = 0, ok = 0, ffFill = 0;
          for (let p = rs + off; p + S <= re; p += S) {
            total++;
            // FF filler record?
            let allFF = true;
            for (let k = 0; k < S; k++) if (buf[p + k] !== 0xff) { allFF = false; break; }
            if (allFF) { ffFill++; continue; }
            // Last 4 bytes zero?
            let z = 0;
            for (let k = S - 4; k < S; k++) if (buf[p + k] === 0) z++;
            if (z === 4) ok++;
          }
          const dataRecs = total - ffFill;
          if (dataRecs < 5) continue;
          const pct = ok / dataRecs;
          if (pct > bestPct) { bestPct = pct; bestS = S; }
        }
      }
      if (bestPct < 0.85) continue;
      claim(bm, rs, re, claims, "stride-table-auto");
      msClaimed++;
      msBytes += re - rs;
    }
    console.log(`stride-table-auto: claimed ${msClaimed} ranges (${msBytes} bytes)`);
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
