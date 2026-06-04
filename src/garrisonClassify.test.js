import { describe, test, expect } from "vitest";
import { isGarrisonUnit, isOnSettlementTile } from "./garrisonClassify.js";

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

// Non-live (descr_strat import / bundle) coordinate rule. Models the recurring
// "faction leader / governor renders with NO portrait" bug — Appius Claudius
// Pulcher at Pisae. The settlement-tile scan can land 1 px off from the
// commander's descr_strat coord; an exact match then mis-buckets him into FIELD
// and his Garrison commander card loses its portrait.
describe("isOnSettlementTile — EXACT settlement-tile garrison rule (0.9.887)", () => {
  test("exact match → garrison (Pisae / Appius: char at 263,431 AND settlement 263,431)", () => {
    expect(isOnSettlementTile(268, 426, 268, 426)).toBe(true);
    expect(isOnSettlementTile(263, 431, 263, 431)).toBe(true);
  });

  test("a commander ONE tile off the settlement is a FIELD army, not garrison", () => {
    // The scan is exact; a stack one tile away (e.g. Capua's heir Auls @302,393
    // beside the town tile 303,392) must NOT be folded into the garrison.
    expect(isOnSettlementTile(302, 393, 303, 392)).toBe(false);
    expect(isOnSettlementTile(263, 431, 262, 430)).toBe(false);
    expect(isOnSettlementTile(263, 431, 264, 432)).toBe(false);
    expect(isOnSettlementTile(263, 431, 263, 430)).toBe(false);
  });

  test("a genuine field army 2+ tiles away stays field", () => {
    expect(isOnSettlementTile(263, 431, 261, 431)).toBe(false); // dx=2
    expect(isOnSettlementTile(263, 431, 263, 428)).toBe(false); // dy=3
    expect(isOnSettlementTile(283, 402, 285, 404)).toBe(false); // Marcus near Rome, dx=dy=2
  });

  test("missing coords are never garrison", () => {
    expect(isOnSettlementTile(null, 431, 263, 431)).toBe(false);
    expect(isOnSettlementTile(263, 431, null, 431)).toBe(false);
    expect(isOnSettlementTile(263, undefined, 263, 431)).toBe(false);
  });
});
