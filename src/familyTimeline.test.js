// Unit tests for familyTimeline — lifespan/visibility math for the
// FamilyTree campaign-history scrubber. Pure functions, no fixtures.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TURNS_PER_YEAR,
  lifespanFor,
  visibilityAt,
  timelineTicks,
  turnToYear,
  formatYear,
} from "./familyTimeline.js";

describe("lifespanFor", () => {
  it("passes through explicit birthTurn/deathTurn unchanged", () => {
    const life = lifespanFor({ birthTurn: 8, deathTurn: 40 }, { currentTurn: 100 });
    expect(life).toMatchObject({ birthTurn: 8, deathTurn: 40, hasBirth: true, hasDeath: true });
  });

  it("derives birthTurn from birthYear via the epoch (currentTurn/currentYear)", () => {
    // currentTurn 8, currentYear -268, 4 turns/yr → epochYear = -268 - 2 = -270.
    // birthYear -269 → (−269 − −270) * 4 = turn 4.
    const life = lifespanFor({ birthYear: -269 }, { currentTurn: 8, currentYear: -268 });
    expect(life.birthTurn).toBe(4);
    expect(life.hasBirth).toBe(true);
  });

  it("derives deathTurn from deathYear via the same epoch", () => {
    const life = lifespanFor(
      { birthTurn: 0, deathYear: -260 },
      { currentTurn: 8, currentYear: -268 },
    );
    expect(life.deathTurn).toBe(40); // (−260 − −270) * 4
  });

  it("falls back to age + currentTurn when no year is known", () => {
    // birthTurn = currentTurn - age*turnsPerYear = 40 - 5*4 = 20.
    const life = lifespanFor({ age: 5 }, { currentTurn: 40 });
    expect(life.birthTurn).toBe(20);
    expect(life.hasDeath).toBe(false);
  });

  it("clamps a derived birthTurn to 0 (no negative turns)", () => {
    const life = lifespanFor({ age: 100 }, { currentTurn: 10 });
    expect(life.birthTurn).toBe(0);
  });

  it("marks a known-dead character (no death date) as dying at the current turn", () => {
    const life = lifespanFor({ birthTurn: 2, isDead: true }, { currentTurn: 50 });
    expect(life.deathTurn).toBe(50);
    expect(life.hasDeath).toBe(true);
  });

  it("reports hasBirth=false when there is no birth data", () => {
    const life = lifespanFor({}, { currentTurn: 10 });
    expect(life.hasBirth).toBe(false);
    expect(life.birthTurn).toBeNull();
  });
});

describe("visibilityAt", () => {
  const opts = { currentTurn: 100 };
  const char = { birthTurn: 4, deathTurn: 40 };

  it("is visible and 'born this turn' exactly at the birth turn", () => {
    const v = visibilityAt(char, 4, opts);
    expect(v.visible).toBe(true);
    expect(v.bornThisTurn).toBe(true);
    expect(v.diedThisTurn).toBe(false);
  });

  it("is hidden before birth", () => {
    expect(visibilityAt(char, 3, opts).visible).toBe(false);
  });

  it("is visible mid-life", () => {
    expect(visibilityAt(char, 20, opts).visible).toBe(true);
  });

  it("is hidden on the death turn and flags diedThisTurn (death is exclusive)", () => {
    const v = visibilityAt(char, 40, opts);
    expect(v.visible).toBe(false);
    expect(v.diedThisTurn).toBe(true);
  });

  it("treats a character with no birth data as always visible", () => {
    const v = visibilityAt({}, 5, opts);
    expect(v.visible).toBe(true);
    expect(v.bornThisTurn).toBe(false);
    expect(v.diedThisTurn).toBe(false);
  });
});

describe("timelineTicks", () => {
  it("dedupes and sorts births (excluding turn 0) and deaths", () => {
    const chars = [
      { birthTurn: 8 },
      { birthTurn: 4 },
      { birthTurn: 4 }, // dup
      { birthTurn: 0 }, // excluded
      { birthTurn: 6, deathTurn: 10 },
      { birthTurn: 2, deathTurn: 5 },
    ];
    const ticks = timelineTicks(chars, {});
    expect(ticks.births).toEqual([2, 4, 6, 8]);
    expect(ticks.deaths).toEqual([5, 10]);
  });

  it("returns empty arrays for no characters", () => {
    expect(timelineTicks([], {})).toEqual({ births: [], deaths: [] });
  });
});

describe("turnToYear", () => {
  it("is the inverse of the birthYear→turn epoch math", () => {
    const opts = { currentTurn: 8, currentYear: -268 }; // epoch -270, 4 turns/yr
    expect(turnToYear(0, opts)).toBe(-270);
    expect(turnToYear(4, opts)).toBe(-269);
    expect(turnToYear(8, opts)).toBe(-268); // back to currentYear
  });

  it("returns null when currentYear is unknown", () => {
    expect(turnToYear(4, { currentTurn: 8 })).toBeNull();
  });
});

describe("formatYear", () => {
  it("formats BC / AD / the year-zero edge and null", () => {
    expect(formatYear(null)).toBe("—");
    expect(formatYear(-270)).toBe("270 BC");
    expect(formatYear(0)).toBe("1 BC");
    expect(formatYear(14)).toBe("AD 14");
  });
});

describe("DEFAULT_TURNS_PER_YEAR", () => {
  it("is 4 (RTW Imperial default)", () => {
    expect(DEFAULT_TURNS_PER_YEAR).toBe(4);
  });
});
