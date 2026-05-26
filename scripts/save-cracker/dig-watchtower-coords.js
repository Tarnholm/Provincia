// dig-watchtower-coords.js — find where in the post-grid records the
// descr_strat watchtower coords are stored. Try multiple encodings:
//   - u32 LE pair
//   - u16 LE pair
//   - u8 pair (unlikely — coords go to 911 > 255)
//   - Single packed u32 (e.g. (y << 16) | x or (y * width) + x)
//   - Reversed order (y first)
//
// The 22 starting watchtowers from descr_strat MUST be in the save somewhere.
// If they're in the post-grid array, we can:
//   (1) identify the records that ARE watchtowers
//   (2) infer their distinguishing byte fingerprint
//   (3) extrapolate to count ALL watchtowers (built ones use the same encoding)

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const DS = "C:/dev/Provincia/bundled-mod/data/world/maps/campaign/imperial_campaign/descr_strat.txt";

const buf = fs.readFileSync(SAVE);

// Get descr_strat watchtower coords (handle both space and comma)
const dsLines = fs.readFileSync(DS, "utf8").split(/\r?\n/);
const wtCoords = [];
for (const line of dsLines) {
  const m = line.match(/^watchtower\s+(\d+)[\s,]+(\d+)/);
  if (m) wtCoords.push({ x: parseInt(m[1]), y: parseInt(m[2]) });
}
console.log(`descr_strat watchtowers: ${wtCoords.length}`);
console.log(`coords: ${wtCoords.map(c => `(${c.x},${c.y})`).join(" ")}`);

// Search the WHOLE save buffer for each coord pair in multiple encodings.
// First just see if the coords exist AT ALL anywhere in the save.
console.log("\n=== Searching whole save for descr_strat coords ===");
function tryEncoding(name, encoder, maxHits = 5) {
  let totalMatches = 0;
  const hitsPerCoord = [];
  for (const c of wtCoords) {
    const needle = encoder(c.x, c.y);
    if (!needle) continue;
    let p = 0, hits = 0, samples = [];
    while ((p = buf.indexOf(needle, p)) >= 0) {
      hits++;
      if (samples.length < maxHits) samples.push(p);
      p += 1;
    }
    if (hits > 0) totalMatches += hits;
    hitsPerCoord.push({ x: c.x, y: c.y, hits, samples });
  }
  const withHits = hitsPerCoord.filter(h => h.hits > 0).length;
  console.log(`  ${name}: ${withHits}/${wtCoords.length} coords found anywhere (${totalMatches} total)`);
  if (withHits > 0) {
    const top = hitsPerCoord.filter(h => h.hits > 0).slice(0, 3);
    for (const h of top) console.log(`    (${h.x},${h.y}): ${h.hits} hits  first @ 0x${h.samples[0].toString(16)}`);
  }
  return { totalMatches, withHits, hitsPerCoord };
}

// u32 LE: x, y
tryEncoding("u32 (x,y)", (x, y) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(x, 0); b.writeUInt32LE(y, 4);
  return b;
});
// u32 LE: y, x
tryEncoding("u32 (y,x)", (x, y) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(y, 0); b.writeUInt32LE(x, 4);
  return b;
});
// u16 LE: x, y
tryEncoding("u16 (x,y)", (x, y) => {
  const b = Buffer.alloc(4);
  b.writeUInt16LE(x, 0); b.writeUInt16LE(y, 2);
  return b;
});
// u16 LE: y, x
tryEncoding("u16 (y,x)", (x, y) => {
  const b = Buffer.alloc(4);
  b.writeUInt16LE(y, 0); b.writeUInt16LE(x, 2);
  return b;
});
// packed u32: (y<<16)|x as little-endian
tryEncoding("u32 packed (y<<16)|x", (x, y) => {
  if (x > 0xffff || y > 0xffff) return null;
  const v = ((y & 0xffff) << 16) | (x & 0xffff);
  const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b;
});
tryEncoding("u32 packed (x<<16)|y", (x, y) => {
  if (x > 0xffff || y > 0xffff) return null;
  const v = ((x & 0xffff) << 16) | (y & 0xffff);
  const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b;
});
// Float pairs (positions sometimes stored as floats)
tryEncoding("f32 (x,y)", (x, y) => {
  const b = Buffer.alloc(8);
  b.writeFloatLE(x, 0); b.writeFloatLE(y, 4);
  return b;
});
// Float plus 0.5 (centred on tile)
tryEncoding("f32 (x+0.5, y+0.5)", (x, y) => {
  const b = Buffer.alloc(8);
  b.writeFloatLE(x + 0.5, 0); b.writeFloatLE(y + 0.5, 4);
  return b;
});

// Many engines scale coords. RTW tile_size from descr_geography_new might
// be ~0.4 or similar. Let's check tile_size:
console.log("\n--- Check for any single coord (just x as u32) ---");
{
  let withHits = 0;
  for (const c of wtCoords) {
    const b = Buffer.alloc(4); b.writeUInt32LE(c.x, 0);
    if (buf.indexOf(b) >= 0) withHits++;
  }
  console.log(`  any single u32(x) found: ${withHits}/${wtCoords.length}`);
}
{
  let withHits = 0;
  for (const c of wtCoords) {
    const b = Buffer.alloc(4); b.writeUInt32LE(c.y, 0);
    if (buf.indexOf(b) >= 0) withHits++;
  }
  console.log(`  any single u32(y) found: ${withHits}/${wtCoords.length}`);
}
