// map_ground_types.tga → per-region terrain, and the movement leads built on it.
//
// Built on synthetic 2×-resolution images so the geometry is checkable by hand:
// the real file is 2041×1401 against map_regions.tga's 1020×700 (the engine's
// 2N+1 convention), and getting that scaling wrong would silently attribute
// terrain to the wrong regions.
import { describe, it, expect } from "vitest";
import { regionTerrain, terrainLeads, landComponents, reachabilityVerdicts, GROUND_TYPES, MOVEMENT_KINDS } from "./aiTerrainAudit.js";

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

// ── LAND REACHABILITY ────────────────────────────────────────────────────────
// The point of the flood fill is that it upgrades a hedge ("may be failing on
// the ground") into a fact ("there is no land route"). A claim that strong has to
// be falsifiable, so the falsification path is tested as carefully as the happy
// one.
describe("landComponents", () => {
  // 3×2 regions → 6×4 ground. A vertical wall of high mountains splits the map,
  // so the left and right sides must come out as separate components.
  const R = { L: [1, 0, 0], M: [2, 0, 0], Rt: [3, 0, 0] };
  const regions3 = img([
    [R.L, R.M, R.Rt],
    [R.L, R.M, R.Rt],
  ]);
  const cols3 = { "1,0,0": "West", "2,0,0": "Wall", "3,0,0": "East" };

  it("separates land masses split by impassable ground", () => {
    const ground = img([
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
    ]);
    const c = landComponents({ groundTga: ground, regionTga: regions3, colToRegion: cols3 });
    expect(c.components).toBe(2);
    expect(c.compsOfRegion.West).toHaveLength(1);
    expect(c.compsOfRegion.East).toHaveLength(1);
    expect(c.compsOfRegion.West[0]).not.toBe(c.compsOfRegion.East[0]);
    // the all-impassable middle region has no walkable land at all
    expect(c.compsOfRegion.Wall).toBeUndefined();
  });

  it("joins land masses when a walkable corridor exists", () => {
    const ground = img([
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.hills, C.hills, C.fertile, C.fertile],   // the pass
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.highMountains, C.highMountains, C.fertile, C.fertile],
    ]);
    const c = landComponents({ groundTga: ground, regionTga: regions3, colToRegion: cols3 });
    expect(c.components).toBe(1);
    expect(c.compsOfRegion.West[0]).toBe(c.compsOfRegion.East[0]);
    // rough ground walks — that is what makes it a pass
    expect(c.compsOfRegion.Wall[0]).toBe(c.compsOfRegion.West[0]);
  });

  it("does not leak across a diagonal touch (4-connected, not 8)", () => {
    // two fertile pixels meeting only at a corner must stay separate, or a single
    // touching pixel would fuse whole landmasses
    const M = C.highMountains;
    const ground = img([
      [C.fertile, M, M, M, M, M],
      [M, C.fertile, M, M, M, M],
      [M, M, M, M, M, M],
      [M, M, M, M, M, M],
    ]);
    const c = landComponents({ groundTga: ground, regionTga: regions3, colToRegion: cols3 });
    expect(c.components).toBe(2);
  });

  it("treats sea as impassable, so an island is its own component", () => {
    const ground = img([
      [C.fertile, C.fertile, C.shallowSea, C.shallowSea, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.shallowSea, C.shallowSea, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.shallowSea, C.shallowSea, C.fertile, C.fertile],
      [C.fertile, C.fertile, C.shallowSea, C.shallowSea, C.fertile, C.fertile],
    ]);
    const c = landComponents({ groundTga: ground, regionTga: regions3, colToRegion: cols3 });
    expect(c.components).toBe(2);
    expect(c.compsOfRegion.West[0]).not.toBe(c.compsOfRegion.East[0]);
  });

  it("names the mainland as the component holding the most regions", () => {
    // West+Wall connected (2 regions), East cut off by a sea channel (1)
    const ground = img([
      [C.fertile, C.fertile, C.fertile, C.fertile, C.shallowSea, C.fertile],
      [C.fertile, C.fertile, C.fertile, C.fertile, C.shallowSea, C.fertile],
      [C.fertile, C.fertile, C.fertile, C.fertile, C.shallowSea, C.fertile],
      [C.fertile, C.fertile, C.fertile, C.fertile, C.shallowSea, C.fertile],
    ]);
    const c = landComponents({ groundTga: ground, regionTga: regions3, colToRegion: cols3 });
    expect(c.mainlandRegions).toBe(2);
    expect(c.mainland).toBe(c.mainOfRegion.West);
    expect(c.mainOfRegion.East).not.toBe(c.mainland);
  });

  it("returns null instead of guessing when an input is missing", () => {
    expect(landComponents()).toBeNull();
    expect(landComponents({ groundTga: regions3, regionTga: null, colToRegion: cols3 })).toBeNull();
  });
});

describe("reachabilityVerdicts", () => {
  // Island = comp 1, Mainland/Inland = comp 0, FarIsle = comp 2
  const components = {
    compsOfRegion: { Island: [1], Mainland: [0], Inland: [0], FarIsle: [2] },
    mainOfRegion: { Island: 1, Mainland: 0, Inland: 0, FarIsle: 2 },
    mainland: 0, mainlandRegions: 2, components: 3, walkablePx: 100, regionsWithLand: 4,
  };
  const ownerByCity = { IslandTown: "islanders", MainTown: "continentals" };
  const regionOfSettlement = { IslandTown: "Island", MainTown: "Mainland", InlandTown: "Inland" };
  const order = (faction, region, n = 1) => Array.from({ length: n }, (_, i) => ({
    kind: "stuck_mission", name: "Gen" + i, faction, region, detail: "re-issued every turn",
  }));

  it("proves no land route and writes it into the finding's own verdict", () => {
    const findings = order("islanders", "InlandTown", 2);
    const r = reachabilityVerdicts({ findings, components, ownerByCity, regionOfSettlement, navalByFaction: {} });
    expect(r.reliable).toBe(true);
    expect(r.verdicts).toBe(2);
    expect(findings[0].noLandRoute).toBe(true);
    expect(findings[0].verdict).toMatch(/^NO LAND ROUTE — Inland shares no walkable land/);
    expect(findings[0].verdict).toMatch(/and it has no ships/);
  });

  it("distinguishes 'has ships but never embarks' from 'has no ships at all'", () => {
    const withFleet = order("islanders", "InlandTown", 1);
    const r1 = reachabilityVerdicts({ findings: withFleet, components, ownerByCity, regionOfSettlement, navalByFaction: { islanders: 4 } });
    expect(withFleet[0].verdict).toMatch(/it has 4 ship\(s\), so this needs a transport/);
    expect(r1.leads[0].file).toBe("descr_strat.txt");
    expect(r1.leads[0].suggestion).toMatch(/never embarks/);

    const noFleet = order("islanders", "InlandTown", 1);
    const r2 = reachabilityVerdicts({ findings: noFleet, components, ownerByCity, regionOfSettlement, navalByFaction: {} });
    expect(r2.leads[0].file).toMatch(/export_descr_unit\.txt/);
    expect(r2.leads[0].suggestion).toMatch(/give this faction a navy/);
  });

  it("stays silent when a land route DOES exist", () => {
    const findings = order("continentals", "InlandTown", 5);
    const r = reachabilityVerdicts({ findings, components, ownerByCity, regionOfSettlement, navalByFaction: {} });
    expect(r.verdicts).toBe(0);
    expect(r.leads).toEqual([]);
    expect(findings[0].noLandRoute).toBeUndefined();
  });

  it("EXCLUDES a faction whose units the model cannot account for", () => {
    // The falsifier has to use a signal the home set is NOT built from. Owning a
    // region puts its component in the home set, so "they already own it" can
    // never fire. UNIT positions are independent: a faction with no ships whose
    // units stand on a disconnected landmass could neither walk nor sail there,
    // so the model is wrong about that faction and it is dropped.
    const findings = order("islanders", "FarIsle", 3);
    const r = reachabilityVerdicts({
      findings, components, ownerByCity, regionOfSettlement,
      navalByFaction: {},                                   // no ships anywhere
      unitsByFactionRegion: { islanders: { Inland: 4 } },    // yet units inland
    });
    expect(r.reliable).toBe(false);
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0]).toMatchObject({ faction: "islanders", region: "Inland" });
    expect(r.excluded).toEqual(["islanders"]);
    // no verdict is issued for the excluded faction…
    expect(r.verdicts).toBe(0);
    expect(r.leads).toEqual([]);
    expect(findings[0].noLandRoute).toBeUndefined();
    expect(findings[0].verdict).toBeUndefined();
  });

  it("does not exclude a faction that owns ships — it could have sailed", () => {
    const findings = order("islanders", "FarIsle", 2);
    const r = reachabilityVerdicts({
      findings, components, ownerByCity, regionOfSettlement,
      navalByFaction: { islanders: 2 },
      unitsByFactionRegion: { islanders: { Inland: 4 } },
    });
    expect(r.contradictions).toEqual([]);
    expect(r.excluded).toEqual([]);
    expect(r.verdicts).toBe(2);
  });

  it("excludes only the disproved faction, not the whole run", () => {
    const findings = [...order("islanders", "FarIsle", 2), ...order("continentals", "FarIsle", 2)];
    const r = reachabilityVerdicts({
      findings, components, ownerByCity, regionOfSettlement,
      navalByFaction: {},
      unitsByFactionRegion: { islanders: { Inland: 1 } },
    });
    expect(r.excluded).toEqual(["islanders"]);
    // the continentals' verdicts still stand
    expect(r.verdicts).toBe(2);
    expect(r.leads.map((l) => l.faction)).toEqual(["continentals"]);
  });

  it("skips findings with no faction named — there is nothing to test against", () => {
    const findings = [{ kind: "aborted_hotspot", faction: "?", region: "Island" }];
    expect(reachabilityVerdicts({ findings, components, ownerByCity, regionOfSettlement }).verdicts).toBe(0);
  });

  it("only judges movement findings, never economic or political ones", () => {
    const findings = [{ kind: "garrison_stripped", faction: "islanders", region: "InlandTown" }];
    const r = reachabilityVerdicts({ findings, components, ownerByCity, regionOfSettlement });
    expect(r.verdicts).toBe(0);
    expect(findings[0].noLandRoute).toBeUndefined();
  });

  it("degrades quietly with no components or no save", () => {
    expect(reachabilityVerdicts({ findings: order("islanders", "InlandTown"), components: null, ownerByCity }))
      .toMatchObject({ verdicts: 0, reliable: null, leads: [] });
    expect(reachabilityVerdicts({ findings: order("islanders", "InlandTown"), components, ownerByCity: null }))
      .toMatchObject({ verdicts: 0, leads: [] });
  });
});
