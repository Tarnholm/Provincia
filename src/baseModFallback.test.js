// Tests for src/baseModFallback.js — base-mod inheritance for the campaign
// import scan (the "map edits in the base folder never reach a submod slot"
// bug, 2026-08-06).
//
// All filesystem access is INJECTED (a Set of existing paths + a fake
// findRelatedModDirs), so no temp-dir fixtures — which also sidesteps the
// findRelatedModDirs 5-level-walk trap (a shallow tmpdir fixture reaches
// %TEMP% itself and picks up concurrent tests' trees as "the base mod";
// see the 2026-07-30 modOverlay test lesson).
import { describe, it, expect } from "vitest";
import path from "path";
import { fillCampaignFilesFromBase } from "./baseModFallback.js";

const CAMPAIGN_FILES = ["descr_regions.txt", "descr_strat.txt", "descr_win_conditions.txt", "map_regions.tga", "map_ground_types.tga", "map_heights.tga"];
const SHARED_FILES = ["descr_sm_factions.txt"];

const SUB = path.join("C:", "mods", "_submods", "four_romans", "data");
const BASE = path.join("C:", "mods", "ris", "data");
const VAN = path.join("C:", "steam", "rome", "data");

const subCampDir = path.join(SUB, "world", "maps", "campaign", "imperial_campaign");

// fake fs: existsSync over an explicit path set (case-exact, resolved)
const fakeFs = (paths) => {
  const set = new Set(paths.map((p) => path.resolve(p)));
  return { existsSync: (p) => set.has(path.resolve(p)) };
};

const baseTree = [
  path.join(SUB, "world"), // layout marker for the submod data root
  path.join(BASE, "export_descr_unit.txt"),
  path.join(BASE, "world"),
  path.join(BASE, "descr_sm_factions.txt"),
  path.join(BASE, "world", "maps", "base", "descr_regions.txt"),
  path.join(BASE, "world", "maps", "base", "map_regions.tga"),
  path.join(BASE, "world", "maps", "base", "map_ground_types.tga"),
  path.join(BASE, "world", "maps", "base", "map_heights.tga"),
  // win conditions live in the base's own campaign dir — proves campaign-dir
  // precedence resolves per-campaign files, not only world/maps/base ones
  path.join(BASE, "world", "maps", "campaign", "imperial_campaign", "descr_win_conditions.txt"),
];

describe("fillCampaignFilesFromBase", () => {
  it("fills a thin submod's missing map/shared files from its base mod and reports the root", () => {
    const camp = { name: "imperial_campaign", dir: subCampDir, found: { "descr_strat.txt": path.join(subCampDir, "descr_strat.txt") } };
    const used = [];
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs(baseTree),
      findRelatedModDirs: () => [BASE],
      onRootUsed: (r) => used.push(r),
    });
    expect(camp.found["map_regions.tga"]).toBe(path.join(BASE, "world", "maps", "base", "map_regions.tga"));
    expect(camp.found["map_ground_types.tga"]).toBe(path.join(BASE, "world", "maps", "base", "map_ground_types.tga"));
    expect(camp.found["map_heights.tga"]).toBe(path.join(BASE, "world", "maps", "base", "map_heights.tga"));
    expect(camp.found["descr_regions.txt"]).toBe(path.join(BASE, "world", "maps", "base", "descr_regions.txt"));
    expect(camp.found["descr_win_conditions.txt"]).toBe(path.join(BASE, "world", "maps", "campaign", "imperial_campaign", "descr_win_conditions.txt"));
    expect(camp.found["descr_sm_factions.txt"]).toBe(path.join(BASE, "descr_sm_factions.txt"));
    // the submod's own descr_strat is untouched
    expect(camp.found["descr_strat.txt"]).toBe(path.join(subCampDir, "descr_strat.txt"));
    expect(used).toEqual([BASE]);
    expect(camp.inheritedFrom).toEqual([BASE]);
  });

  it("prefers the base's campaign dir over its world/maps/base for the same file", () => {
    const camp = { name: "imperial_campaign", dir: subCampDir, found: {} };
    const tree = [...baseTree, path.join(BASE, "world", "maps", "campaign", "imperial_campaign", "descr_regions.txt")];
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs(tree), findRelatedModDirs: () => [BASE],
    });
    expect(camp.found["descr_regions.txt"]).toBe(path.join(BASE, "world", "maps", "campaign", "imperial_campaign", "descr_regions.txt"));
  });

  it("leaves a complete campaign untouched and reports no roots", () => {
    const found = {};
    for (const f of [...CAMPAIGN_FILES, ...SHARED_FILES]) found[f] = path.join(subCampDir, f);
    const camp = { name: "imperial_campaign", dir: subCampDir, found };
    const used = [];
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs(baseTree), findRelatedModDirs: () => { throw new Error("must not be called"); }, onRootUsed: (r) => used.push(r),
    });
    expect(used).toEqual([]);
    expect(camp.inheritedFrom).toBeUndefined();
  });

  it("a FULL mod fills from its OWN world/maps/base — never from sibling mods", () => {
    const fullCampDir = path.join(BASE, "world", "maps", "campaign", "imperial_campaign");
    const camp = { name: "imperial_campaign", dir: fullCampDir, found: {} };
    const other = path.join("C:", "mods", "other", "data");
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs([...baseTree, path.join(other, "world", "maps", "base", "map_regions.tga")]),
      findRelatedModDirs: () => { throw new Error("must not be called for a full mod"); },
    });
    // when the user selected the campaign folder directly, the scan never saw
    // the mod's own base dir — the helper must resolve it from the data root
    expect(camp.found["map_regions.tga"]).toBe(path.join(BASE, "world", "maps", "base", "map_regions.tga"));
    expect(camp.found["descr_sm_factions.txt"]).toBe(path.join(BASE, "descr_sm_factions.txt"));
  });

  it("REGRESSION (v0.9.1483, the '103 regions' bug): a full mod's own base beats vanilla", () => {
    // The exact broken shape: user's slot imports the RIS campaign folder
    // DIRECTLY, so the scan found only descr_strat + win conditions. v1481
    // filled the other 5 files from VANILLA and the RIS slot rendered the
    // vanilla map. The mod's own files must win; vanilla only fills what the
    // mod itself lacks.
    const campDir = path.join(BASE, "world", "maps", "campaign", "imperial_campaign");
    const camp = { name: "imperial_campaign", dir: campDir, found: {
      "descr_strat.txt": path.join(campDir, "descr_strat.txt"),
      "descr_win_conditions.txt": path.join(campDir, "descr_win_conditions.txt"),
    } };
    const tree = [...baseTree,
      path.join(VAN, "world", "maps", "base", "descr_regions.txt"),
      path.join(VAN, "world", "maps", "base", "map_regions.tga"),
      path.join(VAN, "world", "maps", "base", "map_ground_types.tga"),
      path.join(VAN, "world", "maps", "base", "map_heights.tga"),
      path.join(VAN, "descr_sm_factions.txt"),
    ];
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs(tree),
      findRelatedModDirs: () => { throw new Error("must not be called for a full mod"); },
      getVanillaDataDir: () => VAN,
    });
    for (const f of ["descr_regions.txt", "map_regions.tga", "map_ground_types.tga", "map_heights.tga"]) {
      expect(camp.found[f]).toBe(path.join(BASE, "world", "maps", "base", f));
    }
    expect(camp.found["descr_sm_factions.txt"]).toBe(path.join(BASE, "descr_sm_factions.txt"));
    expect(Object.values(camp.found).some((p) => p.startsWith(VAN))).toBe(false);
  });

  it("falls back to the vanilla install when no base mod is found", () => {
    const camp = { name: "imperial_campaign", dir: subCampDir, found: {} };
    const tree = [
      path.join(SUB, "world"),
      path.join(VAN, "world", "maps", "base", "map_regions.tga"),
      path.join(VAN, "descr_sm_factions.txt"),
    ];
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs(tree), findRelatedModDirs: () => [], getVanillaDataDir: () => VAN,
    });
    expect(camp.found["map_regions.tga"]).toBe(path.join(VAN, "world", "maps", "base", "map_regions.tga"));
    expect(camp.found["descr_sm_factions.txt"]).toBe(path.join(VAN, "descr_sm_factions.txt"));
  });

  it("skips a campaign whose dir is not in the <dataRoot>/world/maps/campaign/<name> layout", () => {
    const weird = path.join("C:", "somewhere", "loose_campaign");
    const camp = { name: "loose_campaign", dir: weird, found: {} };
    fillCampaignFilesFromBase([camp], CAMPAIGN_FILES, SHARED_FILES, {
      fs: fakeFs(baseTree), findRelatedModDirs: () => [BASE],
    });
    expect(Object.keys(camp.found)).toEqual([]);
    expect(camp.inheritedFrom).toBeUndefined();
  });
});
