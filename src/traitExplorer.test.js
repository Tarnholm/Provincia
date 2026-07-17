// Hermetic unit tests for the Trait Explorer index/filter/carrier helpers.
// Synthetic traitData fixture (shaped like get-trait-data → modTraitLevels),
// no dependency on the user's mod files.
import { describe, test, expect } from "vitest";
import te, { buildTraitIndex, filterTraits, carriersByTrait } from "./traitExplorer.js";

// Mirrors traitData.levels: { [trait]: [{ levelIdx, levelName, threshold,
// effects: [{name,value}], desc, effectsDesc }] }
const TRAIT_DATA = {
  levels: {
    // Multiple levels, multiple effects per level (the required coverage case).
    GoodTrader: [
      { levelIdx: 1, levelName: "Fair_Dealer", threshold: 1, desc: "A fair dealer.", effects: [{ name: "Trading", value: 1 }, { name: "TaxCollection", value: 5 }] },
      { levelIdx: 2, levelName: "Shrewd_Merchant", threshold: 4, desc: "A shrewd merchant.", effects: [{ name: "Trading", value: 2 }, { name: "TaxCollection", value: 10 }, { name: "Influence", value: 1 }] },
    ],
    Corrupt: [
      { levelIdx: 1, levelName: "Embezzler", threshold: 2, desc: "Skims the treasury.", effects: [{ name: "TaxCollection", value: -10 }, { name: "Law", value: -2 }] },
    ],
    Fearless: [
      { levelIdx: 1, levelName: "Brave", threshold: 1, desc: "Unafraid in battle.", effects: [{ name: "Command", value: 2 }] },
    ],
  },
  epithets: {},
  ancillaries: {},
};

describe("buildTraitIndex", () => {
  const index = buildTraitIndex(TRAIT_DATA);

  test("indexes every trait, sorted by name", () => {
    expect(index.traits.map((t) => t.name)).toEqual(["Corrupt", "Fearless", "GoodTrader"]);
  });

  test("extracts the distinct effect vocabulary across all traits, sorted", () => {
    expect(index.allEffects).toEqual(["Command", "Influence", "Law", "TaxCollection", "Trading"]);
  });

  test("per-trait effectNames are the distinct effects across its levels", () => {
    const gt = index.traits.find((t) => t.name === "GoodTrader");
    expect(gt.effectNames).toEqual(["Influence", "TaxCollection", "Trading"]);
  });

  test("preserves multiple levels with thresholds, effects, and desc", () => {
    const gt = index.traits.find((t) => t.name === "GoodTrader");
    expect(gt.levels).toHaveLength(2);
    expect(gt.levels[1]).toMatchObject({
      levelIdx: 2,
      level: "Shrewd_Merchant",
      threshold: 4,
      desc: "A shrewd merchant.",
    });
    expect(gt.levels[1].effects).toEqual([
      { name: "Trading", value: 2 },
      { name: "TaxCollection", value: 10 },
      { name: "Influence", value: 1 },
    ]);
  });

  test("empty / missing traitData yields an empty index", () => {
    expect(buildTraitIndex(null)).toEqual({ traits: [], allEffects: [] });
    expect(buildTraitIndex({})).toEqual({ traits: [], allEffects: [] });
  });
});

describe("filterTraits", () => {
  const index = buildTraitIndex(TRAIT_DATA);

  test("no filter returns all traits", () => {
    expect(filterTraits(index, {}).map((t) => t.name)).toEqual(["Corrupt", "Fearless", "GoodTrader"]);
  });

  test("query matches trait name (case-insensitive)", () => {
    expect(filterTraits(index, { query: "trader" }).map((t) => t.name)).toEqual(["GoodTrader"]);
  });

  test("query matches level description text", () => {
    expect(filterTraits(index, { query: "treasury" }).map((t) => t.name)).toEqual(["Corrupt"]);
  });

  test("effect filter keeps traits with that effect on any level", () => {
    expect(filterTraits(index, { effect: "TaxCollection" }).map((t) => t.name)).toEqual(["Corrupt", "GoodTrader"]);
    expect(filterTraits(index, { effect: "Command" }).map((t) => t.name)).toEqual(["Fearless"]);
  });

  test("query and effect combine (AND)", () => {
    expect(filterTraits(index, { query: "merchant", effect: "TaxCollection" }).map((t) => t.name)).toEqual(["GoodTrader"]);
    expect(filterTraits(index, { query: "merchant", effect: "Law" })).toEqual([]);
  });
});

describe("carriersByTrait", () => {
  const CHARS = [
    { firstName: "Marcus", lastName: "Aurelius", faction: "romans_julii", traits: [{ name: "GoodTrader", level: 2, levelName: "Shrewd_Merchant" }, { name: "Fearless", level: 1 }] },
    { firstName: "Gaius", lastName: "Longus", faction: "romans_julii", traits: [{ name: "GoodTrader", level: 1, levelName: "Fair_Dealer" }] },
    { firstName: "Hannibal", lastName: "Barca", faction: "carthage", traits: [{ name: "Fearless", level: 1 }, { name: "Corrupt", points: 3 }] },
  ];

  test("groups characters under each trait they carry", () => {
    const c = carriersByTrait(CHARS);
    expect(Object.keys(c).sort()).toEqual(["Corrupt", "Fearless", "GoodTrader"]);
    expect(c.GoodTrader.map((x) => x.character)).toEqual(["Marcus Aurelius", "Gaius Longus"]);
    expect(c.Fearless).toHaveLength(2);
  });

  test("carries faction and level info per carrier", () => {
    const c = carriersByTrait(CHARS);
    expect(c.GoodTrader[0]).toEqual({ character: "Marcus Aurelius", faction: "romans_julii", level: 2, levelName: "Shrewd_Merchant" });
    // falls back to points when level is absent
    expect(c.Corrupt[0]).toMatchObject({ character: "Hannibal Barca", faction: "carthage", level: 3 });
  });

  test("non-array / empty input yields {}", () => {
    expect(carriersByTrait(null)).toEqual({});
    expect(carriersByTrait(undefined)).toEqual({});
    expect(carriersByTrait([])).toEqual({});
  });

  test("skips characters without a traits array", () => {
    expect(carriersByTrait([{ firstName: "No", lastName: "Traits", faction: "x" }])).toEqual({});
  });
});

describe("default export", () => {
  test("exposes the three helpers", () => {
    expect(typeof te.buildTraitIndex).toBe("function");
    expect(typeof te.filterTraits).toBe("function");
    expect(typeof te.carriersByTrait).toBe("function");
  });
});
