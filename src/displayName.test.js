// Unit tests for displayName — engine-name → in-game display conversion.
// Pure functions, no fixtures.
import { describe, it, expect } from "vitest";
import { displayFirstName, displayFullName } from "./displayName.js";

describe("displayFirstName", () => {
  it("returns '?' for empty/nullish input", () => {
    expect(displayFirstName("")).toBe("?");
    expect(displayFirstName(null)).toBe("?");
    expect(displayFirstName(undefined)).toBe("?");
  });

  it("leaves a plain name (no disambiguation suffix) unchanged", () => {
    expect(displayFirstName("Marcus")).toBe("Marcus");
    expect(displayFirstName("Antigonos")).toBe("Antigonos");
  });

  it("converts a trailing uppercase disambiguator to a roman numeral", () => {
    // B is the engine's 2nd-of-name marker → "II", C → "III", etc.
    expect(displayFirstName("AntigonosB")).toBe("Antigonos II");
    expect(displayFirstName("AntigonosC")).toBe("Antigonos III");
    expect(displayFirstName("PhilipD")).toBe("Philip IV");
  });

  it("maps the 'A' suffix to 'I'", () => {
    expect(displayFirstName("AntigonosA")).toBe("Antigonos I");
  });

  it("falls back to the raw letter for suffixes past X (index > 9)", () => {
    // 'K' is the 11th letter (index 10) — beyond the roman table.
    expect(displayFirstName("NameK")).toBe("Name K");
  });

  it("does not treat a single all-caps token as a suffix", () => {
    expect(displayFirstName("A")).toBe("A");
  });

  it("ignores names ending in two capitals (only a single trailing cap disambiguates)", () => {
    expect(displayFirstName("AntigonosBC")).toBe("AntigonosBC");
  });
});

describe("displayFullName", () => {
  it("combines a numeral first name with an underscore-normalized last name", () => {
    expect(displayFullName("AntigonosB", "of_Macedon")).toBe("Antigonos II of Macedon");
    expect(displayFullName("Marcus", "Iulius_Caesar")).toBe("Marcus Iulius Caesar");
  });

  it("omits the last name when empty or nullish", () => {
    expect(displayFullName("Marcus", "")).toBe("Marcus");
    expect(displayFullName("Marcus", null)).toBe("Marcus");
    expect(displayFullName("Marcus", undefined)).toBe("Marcus");
  });

  it("returns '?' first name when the first name is missing", () => {
    expect(displayFullName(null, null)).toBe("?");
    expect(displayFullName("", "Barca")).toBe("? Barca");
  });
});
