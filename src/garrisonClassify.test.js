import { describe, test, expect } from "vitest";
import { isGarrisonUnit } from "./garrisonClassify.js";

// Models the live Rome bug (romans_julii, turn 1): settlement tile holds the
// governor Quintus's 15-unit garrison stack; two OTHER Roman generals (Marcus,
// Servius) stand on FIELD tiles a couple tiles away. All three are romans_julii.
// The garrison panel must contain ONLY the in-settlement units.
describe("isGarrisonUnit — Rome garrison vs field-army split", () => {
  const GOV = 0xa830077;        // Quintus, governor, on settlement tile
  const MARCUS = 0xbe940945;    // field general, off-tile
  const SERVIUS = 0x1c025951;   // field general, off-tile
  const ctx = { governorUuid: GOV, cmdsAtSettlement: new Set([GOV]) };

  test("leaderless defender → garrison", () => {
    expect(isGarrisonUnit({ commanderUuid: null, inferredCmd: null }, ctx)).toBe(true);
  });

  test("governor's bodyguard → garrison", () => {
    expect(isGarrisonUnit({ commanderUuid: GOV, inferredCmd: GOV }, ctx)).toBe(true);
  });

  test("governor's foot unit (inferredCmd) → garrison", () => {
    expect(isGarrisonUnit({ commanderUuid: null, inferredCmd: GOV }, ctx)).toBe(true);
  });

  test("off-tile same-faction general (Marcus) → field army, NOT garrison", () => {
    expect(isGarrisonUnit({ commanderUuid: MARCUS, inferredCmd: MARCUS }, ctx)).toBe(false);
  });

  test("off-tile same-faction general (Servius) → field army, NOT garrison", () => {
    expect(isGarrisonUnit({ commanderUuid: SERVIUS, inferredCmd: SERVIUS }, ctx)).toBe(false);
  });

  test("a general who marched ONTO the settlement tile → garrison", () => {
    const reinforced = { governorUuid: GOV, cmdsAtSettlement: new Set([GOV, MARCUS]) };
    expect(isGarrisonUnit({ commanderUuid: MARCUS, inferredCmd: MARCUS }, reinforced)).toBe(true);
  });

  test("full Rome region: 17 units → 15 garrison, 2 routed to field", () => {
    const region = [
      { commanderUuid: GOV, inferredCmd: GOV },                 // bodyguard
      ...Array.from({ length: 14 }, () => ({ commanderUuid: null, inferredCmd: GOV })), // foot
      { commanderUuid: MARCUS, inferredCmd: MARCUS },
      { commanderUuid: SERVIUS, inferredCmd: SERVIUS },
    ];
    const garrison = region.filter((u) => isGarrisonUnit(u, ctx));
    const field = region.filter((u) => !isGarrisonUnit(u, ctx));
    expect(garrison.length).toBe(15);
    expect(field.length).toBe(2);
    expect(garrison.length + field.length).toBe(region.length); // no unit dropped
  });
});
