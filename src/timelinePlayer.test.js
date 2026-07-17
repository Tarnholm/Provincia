// Hermetic unit tests for src/timelinePlayer.js — the Campaign Timeline
// Player's pure frame builder. Node has no ImageData, so everything operates
// on plain { width, height, data: Uint8ClampedArray } objects (exactly what
// the panel feeds it before wrapping the result in a real ImageData).
import { describe, test, expect } from "vitest";
import {
  buildOwnershipFrame,
  downscaleNearest,
  frameCacheKey,
  resolveFactionColor,
  rowOwnership,
  topFactionsForTurn,
  UNKNOWN_OWNER_COLOR,
} from "./timelinePlayer.js";

// ── synthetic 4x4 region-color map ──────────────────────────────────────────
// Two regions + sea. Region A ("Roma") painted 10,20,30 — top half.
// Region B ("Carthago") painted 40,50,60 — bottom-left quarter.
// Sea painted 0,0,120 — bottom-right quarter.
const A = [10, 20, 30];
const B = [40, 50, 60];
const SEA = [0, 0, 120];

function makeBase() {
  const width = 4, height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, [r, g, b]) => {
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (y < 2) put(x, y, A);
      else if (x < 2) put(x, y, B);
      else put(x, y, SEA);
    }
  }
  return { width, height, data };
}

const regions = {
  "10,20,30": { region: "Latium", city: "Roma", faction: "romans_julii" },
  "40,50,60": { region: "Africa", city: "Carthago", faction: "carthage" },
};

// App.js shape: { factionId: { primary: [r,g,b], secondary: [r,g,b] } }
const factionColors = {
  romans_julii: { primary: [200, 0, 0], secondary: [255, 255, 255] },
  carthage: { primary: [0, 0, 200], secondary: [255, 255, 255] },
};

// Two timeline "turns": turn 1 both owned; turn 2 Roma flips to Carthage and
// Carthago's owner is unknown (absent from the row's ownership map).
const turn1Own = { Roma: "romans_julii", Carthago: "carthage" };
const turn2Own = { Roma: "carthage" };

const px = (frame, x, y) => {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]];
};

describe("buildOwnershipFrame", () => {
  test("recolors each region to its owner's primary color; sea untouched", () => {
    const base = makeBase();
    const f = buildOwnershipFrame(base, regions, turn1Own, factionColors, null);
    expect(f.width).toBe(4);
    expect(f.height).toBe(4);
    expect(px(f, 0, 0)).toEqual([200, 0, 0, 255]);   // Roma → julii red
    expect(px(f, 3, 1)).toEqual([200, 0, 0, 255]);   // still Roma's region
    expect(px(f, 0, 3)).toEqual([0, 0, 200, 255]);   // Carthago → carthage blue
    expect(px(f, 3, 3)).toEqual([0, 0, 120, 255]);   // sea keeps original color
  });

  test("unknown owner paints dark gray, never a faction color", () => {
    const base = makeBase();
    const f = buildOwnershipFrame(base, regions, turn2Own, factionColors, null);
    expect(px(f, 0, 0)).toEqual([0, 0, 200, 255]);   // Roma flipped to carthage
    const [r, g, b] = px(f, 1, 3);                   // Carthago: no owner in row
    expect([r, g, b]).toEqual(UNKNOWN_OWNER_COLOR);
  });

  test("does not mutate the base image", () => {
    const base = makeBase();
    const copy = Uint8ClampedArray.from(base.data);
    buildOwnershipFrame(base, regions, turn1Own, factionColors, null);
    expect(Array.from(base.data)).toEqual(Array.from(copy));
  });

  test("city name matching is case-insensitive as a fallback", () => {
    const base = makeBase();
    const f = buildOwnershipFrame(base, regions, { roma: "romans_julii" }, factionColors, null);
    expect(px(f, 0, 0)).toEqual([200, 0, 0, 255]);
  });

  test("fallbackOwnerFor supplies owners the row lacks", () => {
    const base = makeBase();
    const f = buildOwnershipFrame(base, regions, turn2Own, factionColors,
      (entry) => (entry.city === "Carthago" ? "carthage" : null));
    expect(px(f, 0, 3)).toEqual([0, 0, 200, 255]);   // fallback filled Carthago in
  });

  test("owner with no known color paints dark gray", () => {
    const base = makeBase();
    const f = buildOwnershipFrame(base, regions, { Roma: "mystery_faction" }, factionColors, null);
    const [r, g, b] = px(f, 0, 0);
    expect([r, g, b]).toEqual(UNKNOWN_OWNER_COLOR);
  });
});

describe("frameCacheKey", () => {
  test("stable for the same (campaign, row) and distinct otherwise", () => {
    expect(frameCacheKey(0, 3)).toBe(frameCacheKey(0, 3));
    expect(frameCacheKey(0, 3)).not.toBe(frameCacheKey(0, 4));
    expect(frameCacheKey(0, 3)).not.toBe(frameCacheKey(1, 3));
  });
});

describe("resolveFactionColor", () => {
  test("reads the App.js { primary: [r,g,b] } shape, case-insensitive id", () => {
    expect(resolveFactionColor(factionColors, "romans_julii")).toEqual([200, 0, 0]);
    expect(resolveFactionColor(factionColors, "ROMANS_JULII")).toEqual([200, 0, 0]);
  });
  test("tolerates adjacent shapes and misses", () => {
    expect(resolveFactionColor({ x: [1, 2, 3] }, "x")).toEqual([1, 2, 3]);
    expect(resolveFactionColor({ x: "#ff0080" }, "x")).toEqual([255, 0, 128]);
    expect(resolveFactionColor({ x: { r: 9, g: 8, b: 7 } }, "x")).toEqual([9, 8, 7]);
    expect(resolveFactionColor(factionColors, "nope")).toBeNull();
    expect(resolveFactionColor(null, "x")).toBeNull();
  });
});

describe("downscaleNearest", () => {
  test("returns input untouched when already within maxWidth", () => {
    const base = makeBase();
    expect(downscaleNearest(base, 700)).toBe(base);
  });
  test("halves exactly with nearest sampling — region keys survive", () => {
    const base = makeBase();
    const small = downscaleNearest(base, 2);
    expect(small.width).toBe(2);
    expect(small.height).toBe(2);
    // Every surviving pixel must be one of the ORIGINAL palette colors
    // (nearest — never a blend that would match no region key).
    const palette = [A, B, SEA].map((c) => c.join(","));
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const [r, g, b] = px(small, x, y);
        expect(palette).toContain([r, g, b].join(","));
      }
    }
    expect(px(small, 0, 0).slice(0, 3)).toEqual(A);  // top row is region A
  });
});

describe("topFactionsForTurn / rowOwnership", () => {
  test("counts settlements per faction, sorted desc, limited", () => {
    const own = { a: "f1", b: "f1", c: "f2", d: "f3", e: "f3", f: "f3" };
    expect(topFactionsForTurn(own, 2)).toEqual([
      { faction: "f3", count: 3 },
      { faction: "f1", count: 2 },
    ]);
    expect(topFactionsForTurn(null)).toEqual([]);
  });
  test("rowOwnership accepts _ownerByCity or ownerByCity, null when absent/empty", () => {
    expect(rowOwnership({ _ownerByCity: { Roma: "x" } })).toEqual({ Roma: "x" });
    expect(rowOwnership({ ownerByCity: { Roma: "x" } })).toEqual({ Roma: "x" });
    expect(rowOwnership({ _ownerByCity: {} })).toBeNull();
    expect(rowOwnership({ turn: 3 })).toBeNull();
    expect(rowOwnership(null)).toBeNull();
  });
});
