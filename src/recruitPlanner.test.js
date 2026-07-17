// Recruit planner unit tests (2026-07-17) — hermetic, synthetic fixtures only.
// Pins planRecruitUpgrades' gating semantics (mirrored from
// regionInfoDerive.deriveRecruitable pass 1): new-unit deltas per upgrade,
// EDU ownership gating, faction/culture recruit-line gating, hidden_resource
// region gates, major_event / not-is_player drops, cross-chain
// building_present_min_level unlocks, tier aliases, strategic-resource gates,
// max-level flagging, and empty-settlement safety.
import { describe, it, expect } from "vitest";
import { planRecruitUpgrades, planResourceReqAllows } from "./recruitPlanner.js";

// --- Synthetic mod data ------------------------------------------------------

const buildingLevelsLookup = {
  barracks: ["militia_barracks", "city_barracks", "army_barracks"],
  stables: ["stables", "cavalry_stables"],
  temple_of_war: ["shrine_of_war"],
};

const buildingRecruits = {
  __aliases: {
    // mic_tier_2 = barracks at city level or better.
    mic_tier_2: [{ chain: "barracks", level: "city_barracks" }],
  },
  barracks: {
    militia_barracks: [{ unit: "town watch", factions: ["all"] }],
    city_barracks: [{ unit: "hastati", factions: ["romans_julii"] }],
    army_barracks: [
      { unit: "principes", factions: ["romans_julii"] },
      // Culture-gated line — owner culture "roman" must satisfy it.
      { unit: "triarii", factions: ["roman"] },
      // Other faction's line — must NOT appear for Julii.
      { unit: "gaul swords", factions: ["gauls"] },
      // hidden_resource the test region does NOT have.
      { unit: "samnite levy", factions: ["all"], requires: "hidden_resource samnite" },
      // hidden_resource the region DOES have — included.
      { unit: "italic auxilia", factions: ["all"], requires: "hidden_resource italic" },
      // Negative hidden_resource that the region HAS — excluded.
      { unit: "mainland levy", factions: ["all"], requires: "not hidden_resource latin" },
      // EDU says gauls own it — excluded despite factions all.
      { unit: "enemy owned", factions: ["all"] },
      // Reform-gated (positive major_event) — excluded.
      { unit: "marian legionaries", factions: ["all"], requires: "major_event marian_reforms" },
      // Pre-reform (negative major_event) — INCLUDED.
      { unit: "camillan spears", factions: ["all"], requires: "not major_event marian_reforms" },
      // AI freebie — excluded.
      { unit: "ai freebie", factions: ["all"], requires: "not is_player and hidden_resource italic" },
      // not factions exclusion hits the owner — excluded.
      { unit: "non roman levy", factions: ["all"], requires: "not factions { romans_julii, }" },
      // Strategic resource gate — included only with elephants resource.
      { unit: "war elephants", factions: ["all"], requires: "resource elephants" },
    ],
  },
  stables: {
    stables: [{ unit: "equites", factions: ["romans_julii"] }],
    cavalry_stables: [
      // Cross-chain gate: needs barracks at army level.
      { unit: "legionary cavalry", factions: ["romans_julii"], requires: "building_present_min_level barracks army_barracks" },
      // Tier alias gate: needs mic_tier_2 (= barracks >= city).
      { unit: "auxiliary cavalry", factions: ["all"], requires: "mic_tier_2" },
    ],
  },
  temple_of_war: {
    shrine_of_war: [{ unit: "zealots", factions: ["all"] }],
  },
};

const unitOwnership = {
  "town watch": ["all"],
  hastati: ["romans_julii"],
  principes: ["romans_julii"],
  triarii: ["romans_julii"],
  "gaul swords": ["gauls"],
  "samnite levy": ["all"],
  "italic auxilia": ["all"],
  "mainland levy": ["all"],
  "enemy owned": ["gauls"],
  "marian legionaries": ["romans_julii"],
  "camillan spears": ["romans_julii"],
  "ai freebie": ["all"],
  "non roman levy": ["all"],
  "war elephants": ["all"],
  equites: ["romans_julii"],
  "legionary cavalry": ["romans_julii"],
  "auxiliary cavalry": ["all"],
  zealots: ["all"],
  __dictionary: { hastati: "roman_hastati" },
};

const info = { region: "latium", city: "Roma", tags: "italic, latin", faction: "romans_julii" };
const factionCultures = { romans_julii: "roman" };

const baseBuildings = [
  { type: "barracks", level: "city_barracks" },
  { type: "stables", level: "stables" },
  { type: "temple_of_war", level: "shrine_of_war" },
];

// What App's deriveRecruitable would report for the base state: currently
// available units, plus a faded upgrade-only entry (available:false) that
// must NOT be treated as already recruitable.
const recruitableNow = [
  { unit: "town watch", available: true },
  { unit: "hastati", available: true },
  { unit: "equites", available: true },
  { unit: "principes", available: false }, // future/faded — planner attributes it
];

const basePlan = () =>
  planRecruitUpgrades({
    info,
    buildings: baseBuildings,
    buildingRecruits,
    buildingLevelsLookup,
    unitOwnership,
    ownerFaction: "romans_julii",
    factionCultures,
    recruitableNow,
  });

const entryFor = (plan, chain) => plan.find((e) => e.chain === chain);
const unitNames = (entry) => entry.newUnits.map((u) => u.unit);

// --- Tests -------------------------------------------------------------------

describe("planRecruitUpgrades — new-unit deltas", () => {
  it("reports the units the next barracks level adds, respecting every gate", () => {
    const plan = basePlan();
    const barracks = entryFor(plan, "barracks");
    expect(barracks).toBeTruthy();
    expect(barracks.fromLevel).toBe("city_barracks");
    expect(barracks.toLevel).toBe("army_barracks");
    expect(barracks.alreadyMax).toBe(false);
    const names = unitNames(barracks);
    // Included: own-faction, own-culture, satisfied-HR, pre-reform lines.
    expect(names).toContain("principes");
    expect(names).toContain("triarii"); // culture "roman" satisfies factions
    expect(names).toContain("italic auxilia"); // hidden_resource italic present
    expect(names).toContain("camillan spears"); // not major_event = pre-reform, kept
    // Excluded, each for its own reason:
    expect(names).not.toContain("gaul swords"); // recruit-line faction gate
    expect(names).not.toContain("enemy owned"); // EDU ownership gate (gauls only)
    expect(names).not.toContain("samnite levy"); // positive HR missing
    expect(names).not.toContain("mainland levy"); // negative HR present (latin)
    expect(names).not.toContain("marian legionaries"); // positive major_event
    expect(names).not.toContain("ai freebie"); // not is_player
    expect(names).not.toContain("non roman levy"); // not factions { romans_julii }
    expect(names).not.toContain("war elephants"); // resource elephants absent
    // Baseline subtraction: already-recruitable units never re-listed.
    expect(names).not.toContain("hastati");
    expect(names).not.toContain("town watch");
  });

  it("subtracts recruitableNow as the baseline but NOT its available:false entries", () => {
    // principes is listed in recruitableNow with available:false (faded
    // future unit) — it must still be attributed to the barracks upgrade.
    const plan = basePlan();
    expect(unitNames(entryFor(plan, "barracks"))).toContain("principes");
    // A plain-string baseline is also accepted and fully subtracted.
    const plan2 = planRecruitUpgrades({
      info,
      buildings: baseBuildings,
      buildingRecruits,
      buildingLevelsLookup,
      unitOwnership,
      ownerFaction: "romans_julii",
      factionCultures,
      recruitableNow: ["principes"],
    });
    expect(unitNames(entryFor(plan2, "barracks"))).not.toContain("principes");
  });

  it("honours cross-chain building_present_min_level and tier-alias gates", () => {
    // Base state: barracks only at city level → stables upgrade unlocks the
    // alias-gated auxiliary cavalry (mic_tier_2 satisfied) but NOT
    // legionary cavalry (needs barracks army_barracks).
    const plan = basePlan();
    const stables = entryFor(plan, "stables");
    expect(stables.toLevel).toBe("cavalry_stables");
    expect(unitNames(stables)).toContain("auxiliary cavalry");
    expect(unitNames(stables)).not.toContain("legionary cavalry");
    // With barracks already at army level, the same stables upgrade now
    // ALSO yields legionary cavalry.
    const plan2 = planRecruitUpgrades({
      info,
      buildings: [
        { type: "barracks", level: "army_barracks" },
        { type: "stables", level: "stables" },
      ],
      buildingRecruits,
      buildingLevelsLookup,
      unitOwnership,
      ownerFaction: "romans_julii",
      factionCultures,
      recruitableNow: [],
    });
    expect(unitNames(entryFor(plan2, "stables"))).toContain("legionary cavalry");
  });

  it("gates strategic-resource units on resourcesData", () => {
    const withElephants = planRecruitUpgrades({
      info,
      buildings: baseBuildings,
      buildingRecruits,
      buildingLevelsLookup,
      unitOwnership,
      ownerFaction: "romans_julii",
      factionCultures,
      recruitableNow,
      resourcesData: { latium: [{ type: "elephants" }] },
    });
    expect(unitNames(entryFor(withElephants, "barracks"))).toContain("war elephants");
    // Without resourcesData the resource set is empty → conservatively excluded.
    expect(unitNames(entryFor(basePlan(), "barracks"))).not.toContain("war elephants");
  });
});

describe("planRecruitUpgrades — chain bookkeeping", () => {
  it("flags max-level chains and sorts them last", () => {
    const plan = basePlan();
    const temple = entryFor(plan, "temple_of_war");
    expect(temple.alreadyMax).toBe(true);
    expect(temple.toLevel).toBe(null);
    expect(temple.newUnits).toEqual([]);
    expect(plan[plan.length - 1].alreadyMax).toBe(true);
    // Upgrades with new units sort before those without / max rows.
    expect(plan[0].newUnits.length).toBeGreaterThan(0);
  });

  it("covers every chain present in the settlement exactly once", () => {
    const plan = planRecruitUpgrades({
      info,
      buildings: [...baseBuildings, { type: "barracks", level: "militia_barracks" }], // dup
      buildingRecruits,
      buildingLevelsLookup,
      unitOwnership,
      ownerFaction: "romans_julii",
      factionCultures,
      recruitableNow,
    });
    expect(plan.map((e) => e.chain).sort()).toEqual(["barracks", "stables", "temple_of_war"]);
  });

  it("treats a chain with an unknown ladder as a dimmed terminal row", () => {
    const plan = planRecruitUpgrades({
      info,
      buildings: [{ type: "mystery_chain", level: "mystery_1" }],
      buildingRecruits,
      buildingLevelsLookup,
      unitOwnership,
      ownerFaction: "romans_julii",
      factionCultures,
      recruitableNow: [],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ chain: "mystery_chain", alreadyMax: true, unknownLadder: true });
  });

  it("optionally proposes unbuilt chains whose first level adds units", () => {
    const plan = planRecruitUpgrades({
      info,
      buildings: [{ type: "barracks", level: "city_barracks" }], // no temple built
      buildingRecruits,
      buildingLevelsLookup,
      unitOwnership,
      ownerFaction: "romans_julii",
      factionCultures,
      recruitableNow: [],
      includeUnbuilt: true,
    });
    const temple = entryFor(plan, "temple_of_war");
    expect(temple).toMatchObject({ notBuilt: true, fromLevel: null, toLevel: "shrine_of_war" });
    expect(unitNames(temple)).toContain("zealots");
    // Default is off.
    expect(entryFor(basePlan(), "nonexistent")).toBeUndefined();
  });
});

describe("planRecruitUpgrades — safety", () => {
  it("is safe on an empty settlement", () => {
    expect(
      planRecruitUpgrades({
        info,
        buildings: [],
        buildingRecruits,
        buildingLevelsLookup,
        unitOwnership,
        ownerFaction: "romans_julii",
        factionCultures,
        recruitableNow: [],
      })
    ).toEqual([]);
  });

  it("is safe on missing inputs", () => {
    expect(planRecruitUpgrades({ info: null, buildings: baseBuildings, buildingRecruits, buildingLevelsLookup, unitOwnership, ownerFaction: "x", factionCultures: {}, recruitableNow: [] })).toEqual([]);
    expect(planRecruitUpgrades({ info, buildings: null, buildingRecruits, buildingLevelsLookup, unitOwnership, ownerFaction: "x", factionCultures: {}, recruitableNow: null })).toEqual([]);
    expect(planRecruitUpgrades({ info, buildings: baseBuildings, buildingRecruits: null, buildingLevelsLookup, unitOwnership, ownerFaction: "x", factionCultures: {}, recruitableNow: [] })).toEqual([]);
  });
});

describe("planResourceReqAllows (mirror of regionInfoDerive.resourceReqAllows)", () => {
  it("requires positive resources, rejects excluded ones, ignores hidden_resource", () => {
    const set = new Set(["elephants"]);
    expect(planResourceReqAllows("resource elephants", set)).toBe(true);
    expect(planResourceReqAllows("resource camels", set)).toBe(false);
    expect(planResourceReqAllows("not resource elephants", set)).toBe(false);
    expect(planResourceReqAllows("not resource camels", set)).toBe(true);
    // `hidden_resource X` must NOT be read as `resource X` (word-boundary rule).
    expect(planResourceReqAllows("hidden_resource italic", set)).toBe(true);
    expect(planResourceReqAllows(null, set)).toBe(true);
  });
});
