import { describe, it, expect } from "vitest";
import { buildSeaGrid, nearestSea, aStarSea } from "./seaLanePath.js";

// Tiny synthetic map: 10x5, a vertical land wall at x=5 with a gap at y=0,
// forcing the sea path to route around it.
function makeMap() {
  const W = 10, H = 5;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const land = (x === 5 && y !== 0); // wall with a gap at the top row
    const i = (y * W + x) * 4;
    if (land) { data[i] = 10; data[i + 1] = 20; data[i + 2] = 30; } // land colour
    else { data[i] = 40; data[i + 1] = 120; data[i + 2] = 200; }    // sea blue
  }
  return { data, W, H };
}
const isLand = (r, g, b) => r === 10 && g === 20 && b === 30;

describe("seaLanePath", () => {
  it("buildSeaGrid marks land impassable, sea passable", () => {
    const { data, W, H } = makeMap();
    const sg = buildSeaGrid(data, W, H, isLand, 1);
    expect(sg.w).toBe(10); expect(sg.h).toBe(5);
    expect(sg.grid[0 * 10 + 5]).toBe(1); // gap at top = sea
    expect(sg.grid[2 * 10 + 5]).toBe(0); // wall = land
  });

  it("aStarSea routes AROUND the land wall through the gap", () => {
    const { data, W, H } = makeMap();
    const sg = buildSeaGrid(data, W, H, isLand, 1);
    const path = aStarSea(sg, { x: 2, y: 2 }, { x: 8, y: 2 }, 1000);
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: 2, y: 2 });
    expect(path[path.length - 1]).toEqual({ x: 8, y: 2 });
    // must pass through the only gap (y=0) — never cross the wall at x=5,y!=0
    expect(path.some((p) => p.x === 5 && p.y === 0)).toBe(true);
    expect(path.every((p) => !(p.x === 5 && p.y !== 0))).toBe(true);
  });

  it("nearestSea finds an adjacent sea cell for a land point", () => {
    const { data, W, H } = makeMap();
    const sg = buildSeaGrid(data, W, H, isLand, 1);
    const s = nearestSea(sg, 5, 2); // on the wall
    expect(s).not.toBeNull();
    expect(sg.grid[s.y * sg.w + s.x]).toBe(1);
  });

  it("returns null when goal is unreachable land", () => {
    const { data, W, H } = makeMap();
    const sg = buildSeaGrid(data, W, H, isLand, 1);
    expect(aStarSea(sg, { x: 2, y: 2 }, { x: 5, y: 2 }, 1000)).toBeNull();
  });
});
