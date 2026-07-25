import { describe, test, expect } from "vitest";
import {
  SEV,
  runDiagnostics,
  checkPortraits,
  checkNonLiveCommanders,
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

describe("diagnostics — non-live commander cards", () => {
  test("resolvable commander on hash pool → ERROR (the royal-family bug)", () => {
    const cmds = [
      { name: "Quintus Ogulnius Gallus", savePath: null, resolvable: true },
      { name: "Vibius", savePath: "data/ui/roman/portraits/cards/old/generals/012.tga", resolvable: true },
    ];
    const r = checkNonLiveCommanders(cmds, "non-live");
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toMatch(/FELL TO HASH POOL/);
    expect(r.detail).toMatch(/Quintus Ogulnius Gallus/);
  });

  test("all resolvable commanders resolved → PASS", () => {
    const cmds = [
      { name: "Quintus", savePath: "data/ui/roman/portraits/cards/old/generals/000.tga", resolvable: true },
      { name: "Marcus", savePath: "data/ui/roman/portraits/cards/young/generals/000.tga", resolvable: true },
    ];
    const r = checkNonLiveCommanders(cmds, "non-live");
    expect(r.ok).toBe(true);
    expect(r.severity).toBe(SEV.INFO);
  });

  test("a NON-resolvable commander on the hash pool is acceptable (no fabricated face)", () => {
    const cmds = [
      { name: "UnknownGuy", savePath: null, resolvable: false },
      { name: "Quintus", savePath: "data/ui/roman/portraits/cards/old/generals/000.tga", resolvable: true },
    ];
    const r = checkNonLiveCommanders(cmds, "non-live");
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/no resolvable commander hash-pooled/);
  });

  test("empty list is INFO, not an anomaly", () => {
    const r = checkNonLiveCommanders([], "non-live");
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

  // ── REAL-LEADER identification (the family-tree `"leader"`-tag method) ──

  test("identifies the REAL leader by the \"leader\" tag (not an arbitrary member)", () => {
    // The roster has many members; only Quintus carries the leader tag. The old
    // code reported whichever member it grabbed first ("Biggus_Dickus age 16");
    // the check must name the tagged leader instead.
    const fam = [
      { name: "Biggus Dickus", age: 16, faction: "romans_julii" },
      { name: "Atia", age: 44, faction: "romans_julii", gender: "female" },
      { name: "Quintus Ogulnius Gallus", age: 60, faction: "romans_julii", tags: ["leader"] },
      { name: "Marcus Ogulnius Gallus", age: 30, faction: "romans_julii", tags: ["heir"] },
    ];
    const r = checkFamily(fam, "romans_julii", null, 3, { expectLeader: true });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("Quintus Ogulnius Gallus");
    expect(r.detail).toContain("age 60");
    expect(r.detail).not.toContain("Biggus");
  });

  test("isLeader flag is equivalent to the \"leader\" tag", () => {
    const fam = [
      { name: "Some Captain", age: 22, faction: "romans_julii" },
      { name: "Quintus", age: 55, faction: "romans_julii", isLeader: true },
    ];
    const r = checkFamily(fam, "romans_julii", null, 1, { expectLeader: true });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("Quintus");
  });

  test("CHILD tagged leader → ERROR (the age-4 / overwritten-leader regression)", () => {
    // Quintus (the real, age-60 leader) was overwritten by a child sharing the
    // praenomen → the leader-tagged member now reads age 4. Must ERROR.
    const fam = [
      { name: "Atia", age: 44, faction: "romans_julii" },
      { name: "Quintus", age: 4, faction: "romans_julii", tags: ["leader"] },
    ];
    const r = checkFamily(fam, "romans_julii", null, 1, { expectLeader: true });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toContain("child");
  });

  test("MISSING leader when one is expected → ERROR", () => {
    // No member carries the leader tag and the caller knows one is expected.
    const fam = [
      { name: "Atia", age: 44, faction: "romans_julii" },
      { name: "Marcus", age: 30, faction: "romans_julii", tags: ["heir"] },
    ];
    const r = checkFamily(fam, "romans_julii", null, 1, { expectLeader: true });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toContain("no faction leader identified");
  });

  test("DEAD leader when one is expected → ERROR", () => {
    const fam = [
      { name: "Quintus", age: 60, faction: "romans_julii", tags: ["leader"], alive: false },
    ];
    const r = checkFamily(fam, "romans_julii", null, 1, { expectLeader: true });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).toContain("dead");
  });

  test("no leader identifiable and NOT expected → INFO-skip (not a pass-on-arbitrary)", () => {
    const fam = [
      { name: "Someone", age: 30, faction: "romans_julii" },
      { name: "Another", age: 25, faction: "romans_julii" },
      { name: "Third", age: 40, faction: "romans_julii" },
    ];
    const r = checkFamily(fam, "romans_julii", null, 3); // no expectLeader
    expect(r.ok).toBe(true);
    expect(r.severity).toBe(SEV.INFO);
    expect(r.detail).toContain("leader check skipped");
  });

  test("tagged leader of ANOTHER faction is not crowned for the player", () => {
    // A shared roster: only Carthage's leader is tagged. The player is Julii, so
    // the Carthaginian leader must NOT be mistaken for ours.
    const fam = [
      { name: "Julii Member", age: 30, faction: "romans_julii" },
      { name: "Hannibal", age: 45, faction: "carthage", tags: ["leader"] },
    ];
    const r = checkFamily(fam, "romans_julii", null, 1, { expectLeader: true });
    // No Julii leader found → ERROR (expected), and detail must not name Hannibal.
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(SEV.ERROR);
    expect(r.detail).not.toContain("Hannibal");
  });

  test("caller-supplied leader is used when the roster carries no tags (LIVE mode)", () => {
    // The live save roster has no leader tag; the caller passes the descr_strat
    // leader. The check must validate THAT leader (adult) and name it.
    const fam = [
      { name: "Atia", age: 44, faction: "romans_julii" },
      { name: "Fabia", age: 46, faction: "romans_julii" },
      { name: "Marcus", age: 1, faction: "romans_julii" },
    ];
    const r = checkFamily(fam, "romans_julii", { name: "Quintus Ogulnius Gallus", age: 60 }, 3, { expectLeader: true });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("Quintus Ogulnius Gallus");
    expect(r.detail).toContain("via caller");
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

// ── checkFamily must catch a PARTIAL roster, not just an unread one ──
//
// The count floor catches "the family table wasn't read". It did not catch, and could
// not catch, what actually went wrong on 2026-07-25: a roster of 2,846 well-formed
// records — every one named, no duplicate uuids — in which only 15% of its own father
// references and 11% of its spouse references resolved. 416 referenced fathers were
// absent, 257 of them present in `characters.v1` instead. A floor of 1 waves that
// through, and the wrongness is invisible downstream: the missing members are mostly
// male, so the survivors read 19% male and yield 48 "alive adult males" map-wide
// against 848 settlements that demonstrably have a governor.
describe("checkFamily — partial-read detection", () => {
  const roster = (n, opts = {}) => {
    const out = [];
    for (let i = 1; i <= n; i++) {
      out.push({
        uuid: i, firstName: "N" + i, alive: true, age: 30,
        gender: i % 2 ? "male" : "female",
        // resolve inside the array, or point outside it
        fatherUuid: opts.dangling ? 90000 + i : (i > 2 ? 1 : 0),
        spouseUuid: opts.dangling ? 95000 + i : (i % 2 ? i + 1 : i - 1),
      });
    }
    return out;
  };

  test("flags a roster whose own references point outside it", () => {
    const r = runDiagnostics({ family: roster(40, { dangling: true }), playerFaction: "dummies" });
    const fam = (r.checks || r).find((c) => c.name === "family");
    expect(fam.ok).toBe(false);
    expect(fam.detail).toMatch(/references resolve within it/);
    // Must name the SKEW, not just the shortfall: a uniform undercount would still
    // give correct ratios, and this failure does not.
    expect(fam.detail).toMatch(/skewed|% male/);
    // And point at the fix, since the missing members are recoverable.
    expect(fam.detail).toMatch(/characters\.v1/);
  });

  test("stays quiet on a roster whose references resolve", () => {
    // A guard that fires on good data is noise, and noise gets ignored — which is how
    // the original floor came to be trusted.
    const r = runDiagnostics({ family: roster(40), playerFaction: "dummies" });
    const fam = (r.checks || r).find((c) => c.name === "family");
    expect(fam.detail || "").not.toMatch(/references resolve within it/);
  });

  test("does not judge a roster too small to measure", () => {
    // Three relatives with no resolvable parents is a fresh campaign, not a bad read.
    const r = runDiagnostics({ family: roster(3, { dangling: true }), playerFaction: "dummies" });
    const fam = (r.checks || r).find((c) => c.name === "family");
    expect(fam.detail || "").not.toMatch(/references resolve within it/);
  });
});
