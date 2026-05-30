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
// Decoded stream = 714,000 tiles = 510 wide × 1400 tall, row-major. LOS halos
// are written only on EVEN rows, so world (x,y) maps to grid (x, 2*y).
// Tile value: 0 = unexplored, 1 = ever-explored (permanent),
//             2..11 = live line-of-sight halo (v ≈ 8 − distance to a source).
//
// This is large per-faction data (714k cells). The parser returns a lazy
// view per faction so callers can query explored(x,y) without materializing
// every grid. Pass `factionOrder` (descr_sm_factions order) to label records.

"use strict";

const FACTION_MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
const INNER_MAGIC = 0xf0af0af0 >>> 0; // bytes f0 0a af f0 read as LE u32
const GRID_W = 510;
const GRID_H = 1400;
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
      // world (x,y) -> grid (x, 2*y)
      value: (x, y) => {
        if (x < 0 || x >= GRID_W) return 0;
        const gy = 2 * y;
        if (gy < 0 || gy >= GRID_H) return 0;
        return grid()[gy * GRID_W + x];
      },
      explored(x, y) { return this.value(x, y) >= 1; },
      // Count of explored WORLD tiles (even grid rows only; world is 510×700).
      get exploredCount() {
        const g = grid();
        let n = 0;
        for (let gy = 0; gy < GRID_H; gy += 2) {
          const base = gy * GRID_W;
          for (let x = 0; x < GRID_W; x++) if (g[base + x] >= 1) n++;
        }
        return n;
      },
      grid,
    };
  });
}

module.exports = { parseVision, findFactionRecords, decodeVisionGrid, GRID_W, GRID_H, GRID_CELLS };
