// Ankon (user report 2026-09-24): Provincia offered 9 soldier units + 2 ships,
// the game 5 + 2. The colony there was still being built — a save building
// record at health 0 is a queued one — and counting it unlocked four Roman
// units whose recruit lines need colony_tier_1. Also: compound aliases
// (aor_tier_1 = "gov_tier_1 and not colony_tier_2") were never evaluated.
import { describe, it, expect, vi } from "vitest";

vi.mock("./unitIcons", () => ({ getCachedUnitIcon: () => null, prefetchUnitIcons: () => {} }));
import { deriveRecruitable } from "./regionInfoDerive";
import { evalAlias, aliasesAllow } from "./edbAlias";

// RIS export_descr_buildings aliases, verbatim.
const ALIAS_EXPRS = {
  mic_tier_1: "building_present_min_level military_industrial_complex mic_1 or building_present garrison",
  gov_tier_1: "building_present_min_level governmentA gov1 or building_present_min_level governmentB gov2 or building_present_min_level governmentC gov3",
  gov_tier_3: "building_present_min_level governmentC gov3",
  colony_tier_1: "building_present_min_level colony colony_1",
  colony_tier_2: "building_present_min_level colony colony_2",
  aor_tier_1: "gov_tier_1 and not colony_tier_2",
  aor_tier_2: "gov_tier_1 and not gov_tier_3 and not colony_tier_1",
  no_other_government: "no_building_tagged government queued",
};
const LEGACY = { // what iconHandlers keeps for OR-of-building aliases
  mic_tier_1: [{ chain: "military_industrial_complex", level: "mic_1" }, { chain: "garrison", level: null }],
  gov_tier_1: [{ chain: "governmentA", level: "gov1" }, { chain: "governmentB", level: "gov2" }, { chain: "governmentC", level: "gov3" }],
  gov_tier_3: [{ chain: "governmentC", level: "gov3" }],
  colony_tier_1: [{ chain: "colony", level: "colony_1" }],
  colony_tier_2: [{ chain: "colony", level: "colony_2" }],
};

const RECRUITS = {
  __aliases: LEGACY,
  __aliasExprs: ALIAS_EXPRS,
  governmentC: { gov3: [
    { unit: "roman rorarii", factions: ["romans_julii"], requires: "factions { romans_julii, } and is_player and mic_tier_1 and colony_tier_1" },
    { unit: "roman leves", factions: ["romans_julii"], requires: "factions { romans_julii, } and is_player and mic_tier_1 and colony_tier_1" },
  ] },
  hinterland_region: { region_base: [
    { unit: "aor psiloi", factions: ["all"], requires: "factions { all, } and is_player and mic_tier_1 and aor_tier_1" },
  ] },
};
const LEVELS = { governmentC: ["gov3"], colony: ["colony_1", "colony_2"], garrison: ["garrison"], hinterland_region: ["region_base"] };

const ankon = (colony) => deriveRecruitable({
  regionInfo: { city: "Ankon", region: "Ankon_Petra", tags: "", faction: "slave" },
  buildingRecruits: RECRUITS,
  buildingLevelsLookup: LEVELS,
  unitOwnership: null,
  resourcesData: {},
  currentOwnerByCity: { Ankon: "romans_julii" },
  initialOwnerByCity: {},
  factionCultures: { romans_julii: "roman" },
  activeDataDir: null,
  getBuildings: () => [
    { type: "governmentC", level: "gov3", health: 100 },
    { type: "garrison", level: "garrison", health: 100 },
    { type: "hinterland_region", level: "region_base", health: 100 },
    ...(colony ? [colony] : []),
  ],
  bumpIconCacheVersionCoalesced: () => {},
});
const units = (res) => (res || []).filter((e) => e.available).map((e) => e.unit); // not greyed out

describe("a building still in the queue unlocks nothing", () => {
  it("colony queued (health 0): only the AOR unit, as in the game", () => {
    const got = units(ankon({ type: "colony", level: "colony_1", health: 0 }));
    expect(got).toEqual(["aor psiloi"]);
  });
  it("colony built: the Roman units come", () => {
    const got = units(ankon({ type: "colony", level: "colony_1", health: 100 }));
    expect(got).toEqual(expect.arrayContaining(["roman rorarii", "roman leves", "aor psiloi"]));
  });
  it("colony_2 built: aor_tier_1 fails, the AOR unit goes", () => {
    const got = units(ankon({ type: "colony", level: "colony_2", health: 100 }));
    expect(got).not.toContain("aor psiloi");
    expect(got).toContain("roman rorarii");
  });
});

describe("evalAlias", () => {
  const built = (list) => ({ hasMinLevel: (c, l) => list.some(([bc, bl]) => bc === c && (l == null || LEVELS[c].indexOf(bl) >= LEVELS[c].indexOf(l))), isPlayer: true });
  it("resolves nested aliases with and / not", () => {
    expect(evalAlias("aor_tier_1", ALIAS_EXPRS, built([["governmentC", "gov3"]]))).toBe(true);
    expect(evalAlias("aor_tier_1", ALIAS_EXPRS, built([["governmentC", "gov3"], ["colony", "colony_2"]]))).toBe(false);
    expect(evalAlias("aor_tier_2", ALIAS_EXPRS, built([["governmentC", "gov3"]]))).toBe(false); // not gov_tier_3
  });
  it("gives up (null) on terms it cannot judge, and aliasesAllow then defers", () => {
    expect(evalAlias("no_other_government", ALIAS_EXPRS, built([]))).toBe(null);
    expect(aliasesAllow("no_other_government and is_player", ALIAS_EXPRS, built([]))).toBe(true);
  });
});
