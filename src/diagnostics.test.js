import { describe, test, expect } from "vitest";
import {
  SEV,
  runDiagnostics,
  checkPortraits,
  checkPublicOrder,
  checkDiplomacy,
  checkGarrison,
  checkFamily,
  checkTurnYear,
  checkUnitAttribution,
} from "./diagnostics.js";
import { isGarrisonUnit } from "./garrisonClassify.js";

describe("diagnostics — portraits", () => {
  test("all resolved → PASS, no anomaly", () => {
    const cmds = [
      { name: "A", savePath: "data/ui/roman/portraits/cards/272.tga", coordKey: "1,1" },
      { name: "B", savePath: "data/ui/greek/portraits/cards/010.tga", coordKey: "2,2" },
    ];
    const r = checkPortraits(cmds, {}, "live");
    expect(r.ok).toBe(true);
    expect(r.severity).toBe(SEV.INFO);
  });

  test("everyone on hash pool → ERROR (nomad-faces class)", () => {
    const cmds = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, savePath: null, coordKey: `${i},0` }));
    const r = checkPortraits(cmds, {}, "live");
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toMatch(/hash pool/);
  });

  test("card-vs-family-tree mismatch → ERROR", () => {
    const fam = { "1,1": "data/ui/roman/portraits/cards/086.tga" };
    const cmds = [{ name: "Marcus", savePath: "data/ui/roman/portraits/cards/000.tga", coordKey: "1,1" }];
    const r = checkPortraits(cmds, fam, "live");
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toMatch(/mismatch/);
  });

  test("ambiguous (colliding) coords are excluded from cross-check", () => {
    // Family map holds a DIFFERENT portrait at the shared tile (collision).
    const fam = { "5,5": "data/ui/roman/portraits/cards/999.tga" };
    const cmds = [{ name: "X", savePath: "data/ui/roman/portraits/cards/001.tga", coordKey: "5,5", ambiguousKey: true }];
    const r = checkPortraits(cmds, fam, "live");
    expect(r.ok).toBe(true); // not counted as mismatch
    expect(r.detail).toMatch(/cross-check N\/A|0 mismatch/);
  });

  test("empty commander list is INFO, not an anomaly", () => {
    const r = checkPortraits([], {}, "non-live");
    expect(r.ok).toBe(true);
    expect(r.severity).toBe(SEV.INFO);
  });
});

describe("diagnostics — public order", () => {
  test("values in band, no card divergence → PASS", () => {
    const r = checkPublicOrder({ Rome: { publicOrder: 300 }, Capua: { publicOrder: 120 } }, null);
    expect(r.ok).toBe(true);
  });

  test("card value diverges from confirmed publicOrder → ERROR (40-vs-295 class)", () => {
    const sf = { Rome: { publicOrder: 295 } };
    const card = { Rome: 40 };
    const r = checkPublicOrder(sf, card);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toMatch(/diverges/);
  });

  test("implausible out-of-band value → WARN", () => {
    const r = checkPublicOrder({ Rome: { publicOrder: 9000 } }, null);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.WARN);
  });
});

describe("diagnostics — diplomacy", () => {
  test("symmetric matrix with player wars → PASS", () => {
    const dip = {
      romans_julii: { war: ["carthage"], allied: [], hostile: [] },
      carthage: { war: ["romans_julii"], allied: [], hostile: [] },
      _meta: { symmetry: 1.0, warPairs: 1, N: 2 },
    };
    const r = checkDiplomacy(dip, "romans_julii", true);
    expect(r.ok).toBe(true);
  });

  test("empty player war list when wars expected → ERROR (empty-war-list class)", () => {
    const dip = {
      romans_julii: { war: [], allied: [], hostile: [] },
      _meta: { symmetry: 1.0, warPairs: 0, N: 1 },
    };
    const r = checkDiplomacy(dip, "romans_julii", true);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toMatch(/war list EMPTY/);
  });

  test("one-sided war relation → WARN", () => {
    const dip = {
      a: { war: ["b"], allied: [], hostile: [] },
      b: { war: [], allied: [], hostile: [] }, // b doesn't list a back
      _meta: { symmetry: 1.0, warPairs: 1, N: 2 },
    };
    const r = checkDiplomacy(dip, null, null);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.WARN);
  });

  test("war vs a placeholder column (no row) is NOT counted asymmetric", () => {
    const dip = {
      romans_julii: { war: ["slave", "roman_rebels_1"], allied: [], hostile: [] },
      _meta: { symmetry: 1.0, warPairs: 2, N: 1 },
    };
    const r = checkDiplomacy(dip, "romans_julii", true);
    expect(r.ok).toBe(true); // slave/rebels have no row → one-sided by design
  });

  test("null matrix is cleanly INFO", () => {
    const r = checkDiplomacy(null, "romans_julii", true);
    expect(r.ok).toBe(true);
    expect(r.severity).toBe(SEV.INFO);
  });
});

describe("diagnostics — garrison vs field (uses real isGarrisonUnit)", () => {
  const GOV = 0xa830077, FIELD = 0xbe940945;
  test("field commander correctly routed out of garrison → PASS", () => {
    const settlements = [{
      city: "Rome",
      governorUuid: GOV,
      cmdsAtSettlement: new Set([GOV]),
      fieldCommanders: new Set([FIELD]),
      units: [
        { commanderUuid: GOV, inferredCmd: GOV },     // garrison
        { commanderUuid: FIELD, inferredCmd: FIELD }, // field — must NOT be garrison
      ],
    }];
    const r = checkGarrison(settlements, isGarrisonUnit);
    expect(r.ok).toBe(true);
  });

  test("field stack leaking into garrison → ERROR (garrison-dup class)", () => {
    // A buggy rule that always returns true would leak the field cmd in.
    const alwaysGarrison = () => true;
    const settlements = [{
      city: "Rome",
      cmdsAtSettlement: new Set(),
      fieldCommanders: new Set([FIELD]),
      units: [{ commanderUuid: FIELD, inferredCmd: FIELD }],
    }];
    const r = checkGarrison(settlements, alwaysGarrison);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
  });
});

describe("diagnostics — family", () => {
  test("healthy roster + adult leader → PASS", () => {
    const fam = [{ faction: "romans_julii" }, { faction: "romans_julii" }, { faction: "romans_julii" }];
    const r = checkFamily(fam, "romans_julii", { name: "Quintus", age: 60 }, 3);
    expect(r.ok).toBe(true);
  });

  test("member tagged to _rebel placeholder → ERROR", () => {
    const fam = [{ faction: "commagene_rebel" }, { faction: "romans_julii" }, { faction: "romans_julii" }];
    const r = checkFamily(fam, "romans_julii", null, 1);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
  });

  test("child-aged faction leader → ERROR", () => {
    const fam = [{ faction: "romans_julii" }];
    const r = checkFamily(fam, "romans_julii", { name: "Kid", age: 4 }, 1);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
  });

  test("under-read roster → WARN", () => {
    const r = checkFamily([], "romans_julii", null, 3);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.WARN);
  });
});

describe("diagnostics — turn / year", () => {
  test("consistent turn/year → PASS", () => {
    // turn 5 → year -270 + floor(4/4) = -269
    expect(checkTurnYear(5, -269, 0).ok).toBe(true);
    expect(checkTurnYear(1, -270, 0).ok).toBe(true);
    expect(checkTurnYear(34, -262, 1).ok).toBe(true);
  });

  test("year inconsistent with turn → ERROR", () => {
    const r = checkTurnYear(5, -250, 0);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
  });

  test("season out of range → WARN", () => {
    const r = checkTurnYear(5, -269, 9);
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.WARN);
  });
});

describe("diagnostics — unit attribution", () => {
  test("100% attributed → PASS", () => {
    const r = checkUnitAttribution({ total: 100, naval: 10, land: 90, landAttributed: 90, landAttributedFrac: 1 });
    expect(r.ok).toBe(true);
  });

  test("below soft floor → WARN", () => {
    const r = checkUnitAttribution({ total: 100, naval: 0, land: 100, landAttributed: 80, landAttributedFrac: 0.8 });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.WARN);
  });

  test("badly broken attribution → ERROR", () => {
    const r = checkUnitAttribution({ total: 100, naval: 0, land: 100, landAttributed: 10, landAttributedFrac: 0.1 });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
  });
});

describe("diagnostics — orchestrator", () => {
  test("runDiagnostics returns a structured report and aggregates severities", () => {
    const report = runDiagnostics({
      label: "synthetic",
      commanders: [{ name: "A", savePath: null, coordKey: "1,1" }, { name: "B", savePath: null, coordKey: "2,2" }],
      settlementFields: { Rome: { publicOrder: 295 } },
      cardHappinessByCity: { Rome: 40 }, // divergence → ERROR
      diplomacy: null,
      turn: 5, currentYear: -269, seasonIndex: 0,
      unitAttribution: { land: 100, naval: 0, landAttributed: 100, landAttributedFrac: 1 },
    });
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.summary.errors).toBeGreaterThanOrEqual(1); // public-order divergence + portrait hash
    expect(report.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(report.summary.ok).toBe(false);
  });

  test("all-empty input produces only INFO skips and ok=true", () => {
    const report = runDiagnostics({ label: "empty" });
    expect(report.summary.errors).toBe(0);
    expect(report.summary.ok).toBe(true);
  });
});
