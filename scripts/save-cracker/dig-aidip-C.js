// dig-aidip-C.js — Session 103/L
// Final visual verification: render the decoded grid as 510×1400 (the
// confirmed dim) and compare to flipY 1020×700 TGA. If the grid is the
// real 510×1400 strategic grid, the geography should be recognizable
// even at half-x-resolution.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;

function decodeRle(zone) {
  const tiles = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

// Write a PGM at 510 wide
function writePgm(tiles, w, h, outPath, scale=32) {
  const header = `P5\n${w} ${h}\n255\n`;
  const out = Buffer.alloc(header.length + w * h);
  out.write(header, 0, 'ascii');
  for (let i = 0; i < w * h; i++) {
    const v = i < tiles.length ? tiles[i] : 0;
    out[header.length + i] = Math.min(255, v * scale);
  }
  fs.writeFileSync(outPath, out);
}

const GRID_W = 510;
const GRID_H = 1400;
for (const s of ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t11s.sav', 'athens_t22e.sav']) {
  const { body } = loadPlayer(s);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  writePgm(tiles, GRID_W, GRID_H, path.join(__dirname, `out-aidip-grid510x1400-${s.replace(/\.sav$/, '')}.pgm`));
  console.log(`wrote out-aidip-grid510x1400-${s.replace(/\.sav$/, '')}.pgm  decoded=${tiles.length}, expected=${GRID_W*GRID_H}, diff=${tiles.length - GRID_W*GRID_H}`);
}

// Quick ASCII visualization for save_1.2 at 510×1400, downsampled 5x
console.log(`\n=== ASCII visualization of save_1.2 grid (510×1400, downsampled 5x both axes) ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const SX = 8, SY = 16;
  const W = GRID_W, H = GRID_H;
  const dW = Math.floor(W / SX), dH = Math.floor(H / SY);
  for (let dy = 0; dy < dH; dy++) {
    let line = '';
    for (let dx = 0; dx < dW; dx++) {
      const x = dx * SX;
      const y = dy * SY;
      const v = tiles[y * W + x] || 0;
      const ch = v === 0 ? '.' : v === 1 ? ' ' : v === 2 ? 'o' : v === 3 ? '*' : v === 4 ? '#' : '@';
      line += ch;
    }
    console.log('  ' + line);
  }
}
