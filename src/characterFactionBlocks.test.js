// Character faction labelling by contiguous faction blocks, anchored on governors
// (src/characterFactionBlocks.js). The rules it must keep: never guess across a
// boundary, drop an anchor that breaks the block order, spread through family
// links, and leave the rebels out.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { labelByFactionBlocks } = require("./characterFactionBlocks.js");

const ORDER = ["romans_julii", "carthage", "antigonid", "slave"];
// records in file order; sec = the id a settlement's governorUuid points at
const rec = (offset, extra = {}) => ({ offset, secondaryUuid: 1000 + offset, primaryUuid: 2000 + offset, faction: "seleucid_rebels2", ...extra });
const gov = (city, r) => [city, { governorUuid: r.secondaryUuid }];

describe("labelByFactionBlocks", () => {
  it("labels everything between two governors of the same faction, and nothing across a boundary", () => {
    const v1 = [10, 20, 30, 40, 50, 60, 70].map((o) => rec(o));
    const settlementFields = Object.fromEntries([gov("Rome", v1[0]), gov("Capua", v1[2]), gov("Carthage", v1[4]), gov("Utica", v1[6])]);
    const ownerByCity = { Rome: "romans_julii", Capua: "romans_julii", Carthage: "carthage", Utica: "carthage" };
    const rep = labelByFactionBlocks(v1, { settlementFields, ownerByCity, factionOrder: ORDER });
    expect(v1.map((c) => c.faction)).toEqual(["romans_julii", "romans_julii", "romans_julii", null, "carthage", "carthage", "carthage"]);
    expect(v1.map((c) => c.factionSource)).toEqual(["governor", "block", "governor", null, "governor", "block", "governor"]);
    expect(v1[3].factionByMarker).toBe("seleucid_rebels2"); // the old guess survives only as a diagnostic
    expect(rep).toMatchObject({ anchors: 4, anchorsDropped: 0, byBlock: 2, unlabelled: 1, usable: true, familyConflicts: 0 });
    expect(rep.selfTest).toEqual({ right: 0, wrong: 0, undecided: 4 }); // every governor here sits at a block edge
  });

  it("a governor keeps his town's faction even when he breaks the block order — and the block around him is still filled", () => {
    const v1 = Array.from({ length: 24 }, (_, i) => rec((i + 1) * 10));
    // eleven Julii governors in a row, ONE Antigonid governor filed among them, then Carthage
    const govs = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((i) => gov("J" + i, v1[i]));
    const settlementFields = Object.fromEntries([...govs, gov("Odd", v1[5]), gov("Carthage", v1[22]), gov("Utica", v1[23])]);
    const ownerByCity = { ...Object.fromEntries(govs.map(([c]) => [c, "romans_julii"])), Odd: "antigonid", Carthage: "carthage", Utica: "carthage" };
    const rep = labelByFactionBlocks(v1, { settlementFields, ownerByCity, factionOrder: ORDER });
    expect(rep.anchorsDropped).toBe(1);
    expect(rep.fragmented).toBe(false);              // 1 of 14 = 7%
    expect(v1[5].faction).toBe("antigonid");          // the fact wins over the neighbourhood
    expect(v1[5].factionSource).toBe("governor");
    expect(v1[3].faction).toBe("romans_julii");       // the block is still filled around him
    expect(v1[3].factionSource).toBe("block");
  });

  it("a FRAGMENTED save (many governors out of order) labels the governors and nothing else", () => {
    const v1 = Array.from({ length: 12 }, (_, i) => rec((i + 1) * 10));
    // alternating owners in file order: the campaign-start layout is gone
    const owners = ["romans_julii", "carthage", "romans_julii", "carthage", "romans_julii", "carthage"];
    const govs = owners.map((o, k) => [gov("T" + k, v1[k * 2]), o]);
    const settlementFields = Object.fromEntries(govs.map(([g]) => g));
    const ownerByCity = Object.fromEntries(govs.map(([[c], o]) => [c, o]));
    v1[0].childUuids = [v1[11].primaryUuid];
    const rep = labelByFactionBlocks(v1, { settlementFields, ownerByCity, factionOrder: ORDER });
    expect(rep.fragmented).toBe(true);
    expect(rep.byBlock).toBe(0);
    expect(v1.filter((c) => c.factionSource === "governor").length).toBe(6);
    expect(v1[1].faction).toBe(null);                 // between a Julii and a Carthaginian governor: unknown
    expect(v1[11].faction).toBe(null);                // nor do family links carry on a fragmented save
    expect(rep.byFamily).toBe(0);
  });

  it("family links carry the faction to records no block reaches, and never overwrite", () => {
    const v1 = [10, 20, 30, 40].map((o) => rec(o));
    v1[3].fatherUuid = v1[0].primaryUuid;             // a son filed far from his father
    v1[1].spouseUuid = v1[3].primaryUuid;             // would-be conflict: v1[1] is block-labelled julii too
    const settlementFields = Object.fromEntries([gov("Rome", v1[0]), gov("Capua", v1[2])]);
    const ownerByCity = { Rome: "romans_julii", Capua: "romans_julii" };
    v1[0].childUuids = [v1[3].primaryUuid];
    const rep = labelByFactionBlocks(v1, { settlementFields, ownerByCity, factionOrder: ORDER });
    expect(v1[3].faction).toBe("romans_julii");
    expect(v1[3].factionSource).toBe("family");
    expect(rep.byFamily).toBe(1);
  });

  it("the rebels are never an anchor (their records are scattered through the file)", () => {
    const v1 = [10, 20, 30].map((o) => rec(o));
    const settlementFields = Object.fromEntries([gov("A", v1[0]), gov("B", v1[2])]);
    labelByFactionBlocks(v1, { settlementFields, ownerByCity: { A: "slave", B: "slave" }, factionOrder: ORDER });
    expect(v1.map((c) => c.faction)).toEqual([null, null, null]);
  });

  it("with no usable anchors every label is null — an honest blank, not the old guess", () => {
    const v1 = [10, 20].map((o) => rec(o));
    const rep = labelByFactionBlocks(v1, { settlementFields: {}, ownerByCity: {}, factionOrder: ORDER });
    expect(v1.every((c) => c.faction === null)).toBe(true);
    expect(rep.usable).toBe(false);
    // and missing inputs leave the records alone rather than throwing
    const untouched = [rec(10)];
    expect(() => labelByFactionBlocks(untouched, {})).not.toThrow();
    expect(untouched[0].faction).toBe("seleucid_rebels2");
  });
});
