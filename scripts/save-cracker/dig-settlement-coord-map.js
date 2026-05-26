// Verify the descr_strat <-> map_regions.tga coordinate transform using the
// black settlement pixels as ground truth, and report how many descr_strat
// governor/settlement coords land on a settlement pixel.
const fs = require("fs");
const G = require("C:/dev/Provincia/src/descrStratGeneral.js");

const TGA = "C:/dev/Provincia/public/map_regions_large.tga";
const DS = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";

// ---- load TGA black pixels ----
const b = fs.readFileSync(TGA);
const W = b.readUInt16LE(12), H = b.readUInt16LE(14), desc = b[17];
const dataOff = 18 + b[0];
const bottomLeft = (desc & 0x20) === 0;
const black = new Set();
for (let row = 0; row < H; row++) {
  for (let col = 0; col < W; col++) {
    const o = dataOff + (row * W + col) * 3;
    if (b[o] === 0 && b[o + 1] === 0 && b[o + 2] === 0) {
      const yTop = bottomLeft ? (H - 1 - row) : row;
      black.add(col + "," + yTop);
    }
  }
}
console.log(`TGA ${W}x${H} bottomLeft=${bottomLeft} blackPixels(settlements)=${black.size}`);

// ---- descr_strat governor/settlement coords ----
const parsed = G.parseDescrStrat(fs.readFileSync(DS, "utf8"));
const idx = G.buildSettlementCoordIndex(parsed);
const spots = [...idx.values()].filter((v) => !v._dirty); // clean city comments
console.log(`descr_strat clean settlement spots: ${spots.length}`);

// nearest black pixel within radius r
function near(x, y, r) {
  for (let R = 0; R <= r; R++)
    for (let dx = -R; dx <= R; dx++)
      for (let dy = -R; dy <= R; dy++)
        if (black.has((x + dx) + "," + (y + dy))) return R;
  return -1;
}

const transforms = {
  "tx=dx, ty=dy (no flip)": (dx, dy) => [dx, dy],
  "tx=dx, ty=H-1-dy (Y-flip)": (dx, dy) => [dx, H - 1 - dy],
  "tx=dx, ty=H-dy": (dx, dy) => [dx, H - dy],
};
for (const [label, fn] of Object.entries(transforms)) {
  let hit0 = 0, hit1 = 0, hit2 = 0;
  for (const s of spots) {
    const [tx, ty] = fn(s.x, s.y);
    const r = near(tx, ty, 2);
    if (r === 0) hit0++; if (r >= 0 && r <= 1) hit1++; if (r >= 0) hit2++;
  }
  const n = spots.length;
  console.log(`  ${label.padEnd(28)} exact ${hit0}/${n} (${(100*hit0/n).toFixed(0)}%)  ≤1px ${hit1}/${n}  ≤2px ${hit2}/${n}`);
}

// Show a few samples under the best (Y-flip) transform
console.log("\nsamples (Y-flip): descr(x,y) -> tga(x, 699-y)  onSettlement?");
for (const s of spots.slice(0, 12)) {
  const ty = H - 1 - s.y;
  console.log(`  ${s.hint.padEnd(22)} d(${s.x},${s.y}) -> t(${s.x},${ty})  ${near(s.x, ty, 2) >= 0 ? "YES(r=" + near(s.x, ty, 2) + ")" : "no"}`);
}
