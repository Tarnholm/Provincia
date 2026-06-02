import { describe, it, expect } from "vitest";
import { findNamedGarrisonCommander, garrisonCommanderTag, tagOverlayGarrisonUnits } from "./garrisonUnits";

// REGRESSION GATE for the v0.9.837 bug: the pending/applied army-units overlay
// merge dropped the commander tag, so governors with an overlay (Appius@Pisae,
// Decimus@Iguvium) rendered the plain bodyguard icon instead of their face.
describe("garrisonUnits — overlay commander tag survives the merge", () => {
  const pisaeGarrison = [
    { character: "Appius Claudius Pulcher", faction: "romans_julii", x: 263, y: 431, units: [{ name: "roman general" }] },
  ];

  it("findNamedGarrisonCommander skips generic 'Garrison of X' placeholders", () => {
    expect(findNamedGarrisonCommander([{ character: "Garrison of Pisae" }])).toBeNull();
    expect(findNamedGarrisonCommander([{ character: "Biggus Dickus" }])).toBeNull();
    expect(findNamedGarrisonCommander(pisaeGarrison)?.character).toBe("Appius Claudius Pulcher");
    expect(findNamedGarrisonCommander(null)).toBeNull();
  });

  it("garrisonCommanderTag splits the named general into first/last/faction", () => {
    expect(garrisonCommanderTag(pisaeGarrison, "romans_julii")).toEqual({
      firstName: "Appius",
      lastName: "Claudius Pulcher",
      faction: "romans_julii",
    });
    // No named commander → all-null (so the card simply doesn't swap).
    expect(garrisonCommanderTag([{ character: "Garrison of Pisae" }], "romans_julii"))
      .toEqual({ firstName: null, lastName: null, faction: "romans_julii" });
  });

  it("THE REGRESSION: an overlay rebuild keeps commanderName on unit 0", () => {
    const overlayUnits = [{ unit: "roman general", exp: 0 }, { unit: "hastati", exp: 1 }];
    const out = tagOverlayGarrisonUnits(overlayUnits, pisaeGarrison, "romans_julii");
    // Unit 0 (the bodyguard) MUST carry the commander tag so the portrait swaps.
    expect(out[0].commanderName).toBe("Appius");
    expect(out[0].commanderLastName).toBe("Claudius Pulcher");
    expect(out[0].commanderFaction).toBe("romans_julii");
    // Subsequent units are not commanders.
    expect(out[1].commanderName).toBeNull();
    // The unit data itself is preserved.
    expect(out.map((u) => u.unit)).toEqual(["roman general", "hastati"]);
    expect(out[1].xp).toBe(1);
  });

  it("0.9.856: preserves a per-unit commander tag after a reorder (general not at index 0)", () => {
    // After the user drags the general's card down, the staged list carries the
    // commanderName on the MOVED unit. The overlay must keep it there (not snap
    // it back to unit 0) so the general's face card follows the card.
    const reordered = [
      { unit: "hastati", xp: 1 },
      { unit: "roman general", xp: 0, commanderName: "Appius", commanderLastName: "Claudius Pulcher", commanderFaction: "romans_julii" },
    ];
    const out = tagOverlayGarrisonUnits(reordered, pisaeGarrison, "romans_julii");
    expect(out[0].commanderName).toBeNull();           // hastati stays a plain unit
    expect(out[1].commanderName).toBe("Appius");        // general keeps its face at its new spot
    expect(out[1].commanderLastName).toBe("Claudius Pulcher");
    expect(out[1].commanderFaction).toBe("romans_julii");
  });

  it("empty/edge inputs don't throw", () => {
    expect(tagOverlayGarrisonUnits([], pisaeGarrison, "romans_julii")).toEqual([]);
    expect(tagOverlayGarrisonUnits(null, null, null)).toEqual([]);
    // Overlay present but region has only a generic garrison → no tag, no throw.
    const out = tagOverlayGarrisonUnits([{ unit: "town watch" }], [{ character: "Garrison of Pisae" }], "romans_julii");
    expect(out[0].commanderName).toBeNull();
    expect(out[0].unit).toBe("town watch");
  });
});
