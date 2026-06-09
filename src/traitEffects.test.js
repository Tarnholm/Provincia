// Hermetic unit tests for governor trait → growth-effect resolution.
// Uses an inline EDCT-shaped fixture (no dependency on the user's mod files), so
// it guards the threshold-selection + summation logic the growth estimate relies on.
import { describe, test, expect } from "vitest";
import te from "./traitEffects.js";
const { growthEffectOfTraits } = te;

// Mirrors parseTraitEffects() output: trait → [{threshold, Farming, Fertility, Health, Squalor}] asc.
const PARSED = {
  GoodFarmer: [
    { threshold: 1, Farming: 1, Fertility: 0, Health: 0, Squalor: 0 },
    { threshold: 4, Farming: 2, Fertility: 0, Health: 0, Squalor: 0 },
    { threshold: 8, Farming: 3, Fertility: 0, Health: 0, Squalor: 0 },
  ],
  BadFarmer: [
    { threshold: 1, Farming: -1, Fertility: 0, Health: 0, Squalor: 0 },
    { threshold: 8, Farming: -3, Fertility: 0, Health: 0, Squalor: 0 },
  ],
  Health_Conscious: [
    { threshold: 1, Farming: 0, Fertility: 0, Health: 1, Squalor: 0 },
    { threshold: 3, Farming: 0, Fertility: 0, Health: 2, Squalor: 0 },
  ],
  Fertile: [{ threshold: 1, Farming: 0, Fertility: 2, Health: 0, Squalor: 0 }],
};

describe("growthEffectOfTraits", () => {
  test("picks the highest level whose threshold <= points", () => {
    expect(growthEffectOfTraits([{ name: "GoodFarmer", level: 1 }], PARSED).farm).toBe(1);
    expect(growthEffectOfTraits([{ name: "GoodFarmer", level: 5 }], PARSED).farm).toBe(2);
    expect(growthEffectOfTraits([{ name: "GoodFarmer", level: 9 }], PARSED).farm).toBe(3);
    expect(growthEffectOfTraits([{ name: "Health_Conscious", level: 2 }], PARSED).health).toBe(1); // below thr 3
    expect(growthEffectOfTraits([{ name: "Health_Conscious", level: 3 }], PARSED).health).toBe(2);
  });

  test("negative traits subtract", () => {
    expect(growthEffectOfTraits([{ name: "BadFarmer", level: 8 }], PARSED).farm).toBe(-3);
  });

  test("growthFarm = Farming only; Fertility is the character's stat, not settlement growth", () => {
    const e = growthEffectOfTraits([{ name: "GoodFarmer", level: 5 }, { name: "Fertile", level: 1 }], PARSED);
    expect(e.farm).toBe(2);
    expect(e.fert).toBe(2);          // still tracked (character fertility)
    expect(e.growthFarm).toBe(2);    // but only Farming feeds settlement growth (user 2026-06-09)
  });

  test("unknown / non-growth traits contribute nothing", () => {
    const e = growthEffectOfTraits([{ name: "GoodCommander", level: 5 }, { name: "Senator", level: 25 }], PARSED);
    expect(e.growthFarm).toBe(0);
    expect(e.health).toBe(0);
  });

  test("empty / missing input is safe", () => {
    expect(growthEffectOfTraits([], PARSED).growthFarm).toBe(0);
    expect(growthEffectOfTraits(null, PARSED).growthFarm).toBe(0);
    expect(growthEffectOfTraits([{ name: "GoodFarmer", level: 5 }], null).growthFarm).toBe(0);
  });

  test("points below the lowest threshold → no effect", () => {
    // GoodFarmer's lowest threshold is 1; a 0-point trait shouldn't apply.
    expect(growthEffectOfTraits([{ name: "GoodFarmer", level: 0 }], PARSED).farm).toBe(0);
  });
});
