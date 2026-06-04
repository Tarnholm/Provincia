// src/visionParser.js
//
// Decodes per-faction tile vision / fog-of-war from an RTW Remastered save.
// Cracked 2026-05-30 (rtw-sav-parser/docs/findings-fog-of-war-2026-05-30.md).
//
// Each of the 238 per-faction `ff 0a af f0` records carries, right after its
// 24-byte header, an RLE-encoded vision grid:
//   record header (24B): +0 ff0aaff0, +4/+8 self-ptrs, +12 f00aaff0,
//                        +16 u32=1020 (map W), +20 u32=700 (map H)
//   body +24: RLE pairs <u8 value, u8 count> ... terminated by a pair whose count==0
//
// Decoded stream = 714,000 tiles = 1020 wide × 700 tall, ROW-MAJOR:
// linear index = tileY*1020 + tileX, in the save's engine tile coords
// (tileX 0..1019; tileY 0..699, BOTTOM-UP — to render on a top-down image
// use image_row = 699 - tileY). Tile value: 0 = unexplored / never-seen,
// 1 = ever-explored (settlement tiles are uniformly state 1),
// 2..24 = vision/recency gradient over explored tiles.
//
// CORRECTED 2026-06-04 (rtw-sav-parser/docs/findings-faction-knowledge-
// entities-2026-06-04.md). The previous "510×1400, even-rows-only, world
// (x,y)→grid(x,2y)" model was WRONG: it squashed x 2:1 and discarded the map's
// right half, so a faction's own settlements landed on explored tiles only
// 2.1% of the time. The 1020×700 row-major model scores 100.0% (20728/20738
// own settlements) across the 28-save corpus — orientation proven at 680/680
// vs 1–9% for the three alternatives.
//
// This is large per-faction data (714k cells). The parser returns a lazy
// view per faction so callers can query explored(x,y) without materializing
// every grid. Pass `factionOrder` (descr_sm_factions order) to label records.

"use strict";

const FACTION_MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
const INNER_MAGIC = 0xf0af0af0 >>> 0; // bytes f0 0a af f0 read as LE u32
const GRID_W = 1020;
const GRID_H = 700;
const GRID_CELLS = GRID_W * GRID_H; // 714000

// Enumerate the 238 faction records: validated by inner magic at +12.
function findFactionRecords(buf) {
  const records = [];
  let p = 0;
  while ((p = buf.indexOf(FACTION_MAGIC, p)) !== -1) {
    const start = p;
    p += 4;
    // self-pointers at +4/+8 (== off+4 / off+8), inner magic f0 0a af f0 at +12
    if (start + 24 > buf.length) break;
    const inner = buf.readUInt32LE(start + 12);
    if (inner !== INNER_MAGIC) continue;
    if (buf.readUInt32LE(start + 4) !== (start + 4) >>> 0) continue;
    records.push({ offset: start, bodyOffset: start + 24 });
  }
  return records;
}

// Decode the RLE vision stream for one faction record into a Uint8Array of
// GRID_CELLS bytes. Stops at the count==0 terminator or when full.
function decodeVisionGrid(buf, bodyOffset) {
  const grid = new Uint8Array(GRID_CELLS);
  let p = bodyOffset;
  let idx = 0;
  while (p + 1 < buf.length && idx < GRID_CELLS) {
    const value = buf[p];
    const count = buf[p + 1];
    p += 2;
    if (count === 0) break; // terminator
    const fill = Math.min(count, GRID_CELLS - idx);
    if (value !== 0) grid.fill(value, idx, idx + fill);
    idx += fill;
  }
  return grid;
}

// Public: build per-faction vision views. Returns an array of
// { index, faction, offset, exploredCount, explored(x,y), value(x,y), grid() }.
// `grid()` lazily decodes & caches the full grid; exploredCount is computed
// on first decode. By default grids are decoded lazily (cheap to enumerate
// records, decode only the factions you query).
function parseVision(buf, factionOrder = null) {
  const recs = findFactionRecords(buf);
  return recs.map((r, i) => {
    let _grid = null;
    const grid = () => (_grid || (_grid = decodeVisionGrid(buf, r.bodyOffset)));
    return {
      index: i,
      faction: factionOrder && factionOrder[i] ? factionOrder[i] : null,
      offset: r.offset,
      // engine tile (x,y) -> grid[y*1020 + x], row-major (tileY bottom-up).
      value: (x, y) => {
        if (x < 0 || x >= GRID_W) return 0;
        if (y < 0 || y >= GRID_H) return 0;
        return grid()[y * GRID_W + x];
      },
      explored(x, y) { return this.value(x, y) >= 1; },
      // Count of explored tiles (full 1020×700 grid).
      get exploredCount() {
        const g = grid();
        let n = 0;
        for (let k = 0; k < GRID_CELLS; k++) if (g[k] >= 1) n++;
        return n;
      },
      grid,
    };
  });
}

module.exports = { parseVision, findFactionRecords, decodeVisionGrid, GRID_W, GRID_H, GRID_CELLS };
