// @vitest-environment node
//
// The settlement -> governor link, and the check that must run before anyone uses it.
//
// The link is real: `settlementFields.governorUuid` shares an id space with
// `characters.v1[].secondaryUuid` (645 of 848 resolve; 0 against primaryUuid or
// family.uuid). The character records are real too. What is NOT usable is `v1[].faction`
// — a governor's recorded faction agrees with the settlement's owner just 1% of the
// time, against 18% for random pairing.
//
// That mattered: a supply-vs-assignment verdict was computed from the faction field and
// read entirely plausibly ("20 factions have spare characters, 1 is short") before the
// falsifier showed the attribution was worse than chance. These tests keep that falsifier
// working, because a plausible wrong answer is more expensive than a missing one.
import { describe, it, expect } from "vitest";
import { governorLink, governorCoverage } from "./governorLink.js";

const sf = (m) => Object.fromEntries(Object.entries(m).map(([c, g]) => [c, { governorUuid: g }]));

describe("governorLink", () => {
  it("accepts a save where the governor's faction matches the settlement's owner", () => {
    const r = governorLink({
      settlementFields: sf({ Rome: 11, Capua: 12, Athens: 13 }),
      ownerByCity: { Rome: "romans_julii", Capua: "romans_julii", Athens: "athens" },
      v1: [
        { secondaryUuid: 11, firstName: "Numerius", faction: "romans_julii" },
        { secondaryUuid: 12, firstName: "Gaius", faction: "romans_julii" },
        { secondaryUuid: 13, firstName: "Kleon", faction: "athens" },
      ],
    });
    expect(r.resolved).toBe(3);
    expect(r.agreement).toBe(1);
    expect(r.factionFieldUsable).toBe(true);
    expect(r.worseThanRandom).toBe(false);
    expect(r.note).toMatch(/Both may be used/);
  });

  it("rejects the faction field when it disagrees with settlement ownership", () => {
    // The reference save's shape: Roman cities governed by Roman-named characters who
    // are nonetheless labelled seleucid_rebels2.
    const r = governorLink({
      settlementFields: sf({ Rome: 11, Capua: 12, Arretium: 13, Falerii: 14 }),
      ownerByCity: {
        Rome: "romans_julii", Capua: "romans_julii",
        Arretium: "romans_julii", Falerii: "romans_julii",
      },
      v1: [
        { secondaryUuid: 11, firstName: "Numerius", faction: "seleucid_rebels2" },
        { secondaryUuid: 12, firstName: "Gaius", faction: "seleucid_rebels2" },
        { secondaryUuid: 13, firstName: "Publius", faction: "seleucid_rebels2" },
        { secondaryUuid: 14, firstName: "Quintus", faction: "seleucid_rebels2" },
      ],
    });
    expect(r.factionFieldUsable).toBe(false);
    expect(r.agreement).toBe(0);
    expect(r.note).toMatch(/USE factionFromSettlement/);
    // The link itself still resolves — the two conclusions must stay separate, or a
    // reader will throw away a working join along with the broken label.
    expect(r.resolved).toBe(4);
    // Every link must carry BOTH labels so nothing silently prefers one.
    for (const l of r.links) {
      expect(l.factionFromSettlement).toBe("romans_julii");
      expect(l.factionOnRecord).toBe("seleucid_rebels2");
    }
  });

  it("compares agreement against a random-pairing baseline", () => {
    // Without the baseline, "1% agreement" has no scale. Falling BELOW it is what rules
    // out "noisy but roughly right" — and the reference save does fall below.
    const r = governorLink({
      settlementFields: sf({ A: 1, B: 2, C: 3, D: 4 }),
      ownerByCity: { A: "x", B: "x", C: "x", D: "y" },
      v1: [1, 2, 3, 4].map((u) => ({ secondaryUuid: u, faction: "z" })),
    });
    expect(r.randomBaseline).toBeGreaterThan(0);
    expect(r.worseThanRandom).toBe(true);
  });

  it("requires a minimum sample before calling a relabel consistent", () => {
    // An owner with ONE governor trivially has a 100% dominant label. Counting those
    // gave "65 of 102 owners consistently relabelled" on the reference save; requiring
    // three gives 17 of 38. The floor is reported so the ratio cannot be quoted alone.
    const singles = {};
    const owners = {};
    const chars = [];
    for (let i = 1; i <= 20; i++) {
      singles["S" + i] = i;
      owners["S" + i] = "owner" + i;      // one settlement each
      chars.push({ secondaryUuid: i, faction: "wrong" + i });
    }
    const r = governorLink({ settlementFields: sf(singles), ownerByCity: owners, v1: chars });
    expect(r.systematicRelabel.minSample).toBe(3);
    // Every owner has a single governor, so none may be counted.
    expect(r.systematicRelabel.ownersConsidered).toBe(0);
    expect(r.systematicRelabel.partlyConsistent).toBe(false);
  });

  it("surfaces a large-sample consistent relabel as a concrete lead", () => {
    // romans_julii -> seleucid_rebels2, 25 of 25, is not arguable and is the actionable
    // detail for whoever fixes the parser. It must be reported even though the GLOBAL
    // pattern does not hold.
    const cities = {};
    const owners = {};
    const chars = [];
    for (let i = 1; i <= 12; i++) {
      cities["C" + i] = i;
      owners["C" + i] = "romans_julii";
      chars.push({ secondaryUuid: i, faction: "seleucid_rebels2" });
    }
    const r = governorLink({ settlementFields: sf(cities), ownerByCity: owners, v1: chars });
    expect(r.systematicRelabel.strongExamples).toHaveLength(1);
    expect(r.systematicRelabel.strongExamples[0]).toMatchObject({
      owner: "romans_julii", mislabelledAs: "seleucid_rebels2", n: 12, of: 12,
    });
    expect(r.note).toMatch(/romans_julii -> seleucid_rebels2/);
  });

  it("reports nothing when no governor id resolves", () => {
    const r = governorLink({
      settlementFields: sf({ Rome: 999 }),
      ownerByCity: { Rome: "romans_julii" },
      v1: [{ secondaryUuid: 11, faction: "romans_julii" }],
    });
    expect(r.resolved).toBe(0);
    expect(r.unresolved).toBe(1);
    expect(r.factionFieldUsable).toBe(false);
    expect(r.note).toMatch(/not available from this save/);
  });

  it("says nothing without the inputs", () => {
    expect(governorLink({})).toBeNull();
    expect(governorLink({ settlementFields: sf({ A: 1 }), ownerByCity: { A: "x" } })).toBeNull();
  });
});

describe("governorCoverage", () => {
  it("counts governed and ungoverned per faction from ownership alone", () => {
    // Needs no character data at all, which is why it survives the faction-field problem.
    const r = governorCoverage({
      settlementFields: sf({ A: 5, B: 0, C: 0, D: 7 }),
      ownerByCity: { A: "x", B: "x", C: "x", D: "y" },
    });
    const x = r.rows.find((v) => v.faction === "x");
    expect(x).toMatchObject({ owned: 3, governed: 1, ungoverned: 2 });
    expect(x.ungovernedShare).toBeCloseTo(0.667, 2);
    expect(r.totalUngoverned).toBe(2);
    // Sorted worst-first so the panel needs no further ordering.
    expect(r.rows[0].faction).toBe("x");
  });

  it("treats the 0xffffffff sentinel as no governor", () => {
    const r = governorCoverage({
      settlementFields: sf({ A: 0xffffffff }),
      ownerByCity: { A: "x" },
    });
    expect(r.rows[0].ungoverned).toBe(1);
  });
});
