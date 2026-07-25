// map_ground_types.tga → per-region terrain, and the movement leads built on it.
//
// Built on synthetic 2×-resolution images so the geometry is checkable by hand:
// the real file is 2041×1401 against map_regions.tga's 1020×700 (the engine's
// 2N+1 convention), and getting that scaling wrong would silently attribute
// terrain to the wrong regions.
import { describe, it, expect } from "vitest";
import { regionTerrain, terrainLeads, GROUND_TYPES, MOVEMENT_KINDS } from "./aiTerrainAudit.js";

// RGB triples as the palette keys them ("r,g,b"); the raw buffers are BGR.
const C = {
  wilderness: [0, 0, 0],
  fertile: [0, 128, 128],
  hills: [128, 128, 64],
  mountains: [98, 65, 65],
  highMountains: [196, 128, 128],
  forest: [0, 128, 0],
  denseForest: [0, 64, 0],
  swamp: [0, 255, 128],
  shallowSea: [196, 0, 0],
  beach: [255, 255, 255],
};

// Build a { W, H, raw } image from a grid of RGB triples (raw is BGR order).
function img(grid) {
  const H = grid.length, W = grid[0].length;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = grid[y][x];
      const i = (y * W + x) * 3;
      raw[i] = b; raw[i + 1] = g; raw[i + 2] = r;
    }
  }
  return { W, H, raw, desc: 0 };
}

// a 2×2 region image → a 4×4 ground image (scale 2), like the real files
const REGION_A = [10, 20, 30], REGION_B = [40, 50, 60];
const regionTga = img([
  [REGION_A, REGION_B],
  [REGION_A, REGION_B],
]);
const colToRegion = { "10,20,30": "Alpina", "40,50,60": "Campania" };

describe("regionTerrain", () => {
  it("maps double-resolution ground pixels back to the right region", () => {
    // left half = all high mountains (impassable), right half = all fertile
    const ground = img([
      [C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.highMountains, C.highMountains, C.fertile, C.fertile],
    ]);
    const t = regionTerrain({ groundTga: ground, regionTga, colToRegion });
    expect(t.world.scale).toBe(2);
    expect(t.unknownColours).toEqual([]);
    // every one of the 16 ground pixels is attributed, 8 to each region
    expect(t.byRegion.Alpina).toMatchObject({ px: 8, land: 8, impassable: 8, easy: 0, impassablePct: 100 });
    expect(t.byRegion.Campania).toMatchObject({ px: 8, land: 8, easy: 8, impassable: 0, impassablePct: 0 });
    expect(t.byRegion.Alpina.dominant).toBe("High mountains");
    expect(t.byRegion.Campania.dominant).toBe("Fertile land");
  });

  it("keeps the difficulty score inside 0-100, weighting impassable above rough", () => {
    const ground = img([
      // Alpina: half rough (hills), half impassable → 0.5*50 + 50 = 75
      [C.hills, C.hills, C.fertile, C.fertile],
      [C.hills, C.hills, C.fertile, C.fertile],
      [C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.highMountains, C.highMountains, C.fertile, C.fertile],
    ]);
    const t = regionTerrain({ groundTga: ground, regionTga, colToRegion });
    expect(t.byRegion.Alpina).toMatchObject({ roughPct: 50, impassablePct: 50, difficulty: 75 });
    expect(t.byRegion.Campania.difficulty).toBe(0);
    // an all-impassable region tops out AT 100, never above it
    const allBad = img([
      [C.denseForest, C.denseForest, C.denseForest, C.denseForest],
      [C.denseForest, C.denseForest, C.denseForest, C.denseForest],
      [C.denseForest, C.denseForest, C.denseForest, C.denseForest],
      [C.denseForest, C.denseForest, C.denseForest, C.denseForest],
    ]);
    const t2 = regionTerrain({ groundTga: allBad, regionTga, colToRegion });
    expect(t2.byRegion.Alpina.difficulty).toBe(100);
  });

  it("measures percentages against LAND only, so coastal sea does not dilute them", () => {
    const ground = img([
      // Alpina: 2 mountain + 6 sea. Difficulty must be 50 (of 4 land px... )
      [C.mountains, C.mountains, C.fertile, C.fertile],
      [C.mountains, C.mountains, C.fertile, C.fertile],
      [C.shallowSea, C.shallowSea, C.fertile, C.fertile],
      [C.shallowSea, C.shallowSea, C.fertile, C.fertile],
    ]);
    const t = regionTerrain({ groundTga: ground, regionTga, colToRegion });
    const a = t.byRegion.Alpina;
    expect(a).toMatchObject({ px: 8, land: 4, sea: 4, rough: 4 });
    expect(a.roughPct).toBe(100);   // 4 of 4 LAND pixels, not 4 of 8
    expect(a.seaPct).toBe(50);      // sea IS reported, just separately
    expect(a.difficulty).toBe(50);  // rough weighs half
  });

  it("reports colours that are not in the palette instead of silently dropping them", () => {
    const ground = img([
      [[1, 2, 3], [1, 2, 3], C.fertile, C.fertile],
      [C.fertile, C.fertile, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.fertile, C.fertile],
    ]);
    const t = regionTerrain({ groundTga: ground, regionTga, colToRegion });
    expect(t.unknownColours).toEqual([{ colour: "1,2,3", px: 2 }]);
  });

  it("returns null rather than guessing when an input is missing", () => {
    expect(regionTerrain({})).toBeNull();
    expect(regionTerrain({ groundTga: regionTga, regionTga: null, colToRegion })).toBeNull();
    expect(regionTerrain()).toBeNull();
  });

  it("covers every colour in the real file's palette", () => {
    // the RIS map uses exactly 14 distinct colours and all 14 are mapped
    expect(Object.keys(GROUND_TYPES)).toHaveLength(14);
    const classes = new Set(Object.values(GROUND_TYPES).map((t) => t.cls));
    expect([...classes].sort()).toEqual(["easy", "impassable", "rough", "sea"]);
  });
});

describe("terrainLeads", () => {
  // one very hard region (big enough to be trusted) and one easy one
  const terrain = {
    byRegion: {
      Alpina: { region: "Alpina", land: 900, difficulty: 84, impassablePct: 68, roughPct: 32, dominant: "High mountains" },
      Campania: { region: "Campania", land: 900, difficulty: 5, impassablePct: 0, roughPct: 10, dominant: "Fertile land" },
      Tiny: { region: "Tiny", land: 98, difficulty: 95, impassablePct: 95, roughPct: 0, dominant: "Dense forest" },
    },
    world: { regions: 3, medianDifficulty: 25 },
  };
  const stuck = (region, faction, n) => Array.from({ length: n }, (_, i) => ({
    kind: "stuck_mission", name: "Gen" + i, faction, region, detail: "ordered repeatedly",
  }));

  it("annotates every movement finding whose region resolves, hard or not", () => {
    const findings = [...stuck("Alpina", "salassi", 1), ...stuck("Campania", "romans_julii", 1)];
    const r = terrainLeads({ findings, terrain });
    expect(r.annotated).toBe(2);
    expect(findings[0].terrain).toMatchObject({ dominant: "High mountains", difficulty: 84 });
    // the easy region is annotated too — the panel shows it as context
    expect(findings[1].terrain).toMatchObject({ dominant: "Fertile land", difficulty: 5 });
  });

  it("translates a SETTLEMENT target to its region — the log names settlements", () => {
    const findings = stuck("Aosta", "salassi", 3);
    // without the map nothing resolves…
    expect(terrainLeads({ findings, terrain }).annotated).toBe(0);
    // …with it, all three do
    const r = terrainLeads({ findings, terrain, regionOfSettlement: { Aosta: "Alpina" } });
    expect(r.annotated).toBe(3);
    expect(r.leads).toHaveLength(1);
  });

  it("raises a lead only for hard ground, and only above the finding threshold", () => {
    expect(terrainLeads({ findings: stuck("Alpina", "salassi", 3), terrain }).leads).toHaveLength(1);
    // 2 findings is below minFindings
    expect(terrainLeads({ findings: stuck("Alpina", "salassi", 2), terrain }).leads).toHaveLength(0);
    // easy ground never leads, however many failures
    expect(terrainLeads({ findings: stuck("Campania", "romans_julii", 20), terrain }).leads).toHaveLength(0);
  });

  it("ignores regions too small for their percentages to mean anything", () => {
    // Tiny is 95% impassable but only 98 land px — a third of the real map's
    // regions are that small, and 95% of 98 pixels is not evidence about a route
    const r = terrainLeads({ findings: stuck("Tiny", "someone", 10), terrain });
    expect(r.annotated).toBe(10);      // still annotated…
    expect(r.leads).toHaveLength(0);   // …but never a lead
  });

  it("always shows the land-pixel count so the reader can judge the evidence", () => {
    const [lead] = terrainLeads({ findings: stuck("Alpina", "salassi", 4), terrain }).leads;
    expect(lead.evidence).toMatch(/Alpina: 84% hard, 68% impassable, mostly High mountains \(900 land px\)/);
    expect(lead.issue).toMatch(/difficulty 84% vs median 25%/);
    expect(lead.file).toBe("map_ground_types.tga");
    expect(lead.faction).toBe("salassi");
  });

  it("labels the unattributed bucket honestly instead of showing a faction of '?'", () => {
    // `campaign for region 'N' aborted` names a region but no faction
    const findings = Array.from({ length: 5 }, () => ({ kind: "aborted_hotspot", faction: "?", region: "Alpina" }));
    const [lead] = terrainLeads({ findings, terrain }).leads;
    expect(lead.faction).toBe("all (faction not named in the log)");
    expect(lead.faction).not.toContain("?");
  });

  it("says nothing about problems terrain cannot explain", () => {
    // garrison stripping and war spam are political/economic, not geographic
    expect(MOVEMENT_KINDS.has("garrison_stripped")).toBe(false);
    expect(MOVEMENT_KINDS.has("war_spam")).toBe(false);
    expect(MOVEMENT_KINDS.has("rich_but_stalled")).toBe(false);
    const findings = Array.from({ length: 30 }, () => ({ kind: "garrison_stripped", faction: "salassi", region: "Alpina" }));
    const r = terrainLeads({ findings, terrain });
    expect(r.annotated).toBe(0);
    expect(r.leads).toEqual([]);
  });

  it("degrades quietly when terrain could not be read at all", () => {
    expect(terrainLeads({ findings: stuck("Alpina", "x", 9), terrain: null })).toEqual({ leads: [], annotated: 0 });
    expect(terrainLeads({})).toEqual({ leads: [], annotated: 0 });
  });
});
