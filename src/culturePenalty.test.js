// Settlement culture penalty (engine PO factor 12) — src/culturePenalty.js.
//
// Ground truth used (2026-10-10):
//  * save_24-09-2026 "Rome Turn 1" (RIS main, 239 factions, data = RIS_239_REV): the save's
//    order-breakdown slot 12 × 5 for all 1,306 settlements — the formula matches 1,304.
//    The two misses (Athens 2% vs 0.5%, Carthage 3.5% vs 0%) are the start-placed wonder
//    levels scriptorium_sp3 and dockyard_sp1, which count as foreign-made in game; the
//    static creator rule does not reproduce that. Same two on the Four Romans turn-1 saves
//    (Claudii 1,304/1,306; Antigonid 1,305/1,306, where Carthage matches).
//  * The June julii in-game panel corpus (jcrops/julii/po-corpus.tsv, RIS 9e553c5e0c):
//    the "culture penalty" row matches on 26/26 towns.
// The pinned values below were read from that save; the data comes from git (risDataSnapshot),
// so the test does not drift with C:\RIS. Skips where the RIS repo is absent (CI).
import { describe, it, expect } from "vitest";

const cp = require("./culturePenalty.js");

function ctxOf({ cultures, levels = {}, pyramidsOwner = null, regionCreator = {} }) {
  return { order: Object.keys(cultures), cultureOf: cultures, levels, pyramidsOwner, regionCreator };
}
const town = (owner, creator, buildings, region = "R") => ({ owner, creator, region, buildings: buildings.map(([chain, level, by]) => ({ chain, level, creator: by || null })) });

describe("culture shares — the engine formula", () => {
  const cultures = { rome: "roman", sparta: "greek", athens: "greek", carthage: "carthaginian", egypt: "egyptian", ptolemaic: "e_hellenistic", slave: "libyan" };
  const levels = {
    "core:villa": { construction: 4, req: "factions { all, }" },
    "temple:shrine": { construction: 2, req: "factions { all, }" },
    "wonder:sp": { construction: 5, req: "not factions { slave, } and factions { athens, }" },
    "port:dock": { construction: 12, req: "factions { carthaginian, }" },
  };

  it("founder 40 + builders 60 → (100 − S)/2", () => {
    // Neapolis: Spartan-founded, Roman-built → S = 60 → 20%
    const r = cp.settlementCulture(town("rome", "sparta", [["core", "villa"], ["temple", "shrine"]]), ctxOf({ cultures, levels }));
    expect(r.S).toBe(60);
    expect(r.pct).toBe(20);
  });

  it("per-faction floor(sum·60/W), creator +40", () => {
    // sparta built the shrine (2 of 6 turns): floor(120/6)=20, rome floor(240/6)=40, +40 founder sparta
    const r = cp.settlementCulture(town("rome", "sparta", [["core", "villa"], ["temple", "shrine", "sparta"]]), ctxOf({ cultures, levels }));
    expect(r.shares.find((s) => s.faction === "sparta").pts).toBe(60);
    expect(r.S).toBe(40);
    expect(r.pct).toBe(30);
  });

  it("no buildings → the founder holds 100", () => {
    expect(cp.settlementCulture(town("rome", "sparta", []), ctxOf({ cultures, levels })).pct).toBe(50);
    expect(cp.settlementCulture(town("rome", null, []), ctxOf({ cultures, levels })).pct).toBe(0);
  });

  it("a builder outside the level's faction set → first faction that can, else the last faction", () => {
    // rome cannot build wonder:sp (athens only) → athens (greek) gets its points
    const r = cp.settlementCulture(town("rome", "rome", [["core", "villa"], ["wonder", "sp"]]), ctxOf({ cultures, levels }));
    expect(r.buildings.find((b) => b.level === "sp")).toMatchObject({ creator: "athens", fallback: true });
    // carthaginian-only dock in an empty-set case: nobody can → last faction (slave)
    const noCarth = { rome: "roman", sparta: "greek", slave: "libyan" };
    const r2 = cp.settlementCulture(town("rome", "rome", [["port", "dock"]]), ctxOf({ cultures: noCarth, levels }));
    expect(r2.buildings[0].creator).toBe("slave");
  });

  it("the pyramids' owner counts egyptian shares as its own", () => {
    const t = town("ptolemaic", "egypt", [["core", "villa"]]);
    expect(cp.settlementCulture(t, ctxOf({ cultures, levels })).pct).toBe(20);
    expect(cp.settlementCulture(t, ctxOf({ cultures, levels, pyramidsOwner: "ptolemaic" })).pct).toBe(0);
  });

  it("rebel towns are built by the descr_regions creator", () => {
    const t = town("slave", "sparta", [["core", "villa"]], "Libya");
    const r = cp.settlementCulture(t, ctxOf({ cultures, levels, regionCreator: { Libya: "slave" } }));
    expect(r.buildings[0].creator).toBe("slave");
    expect(r.pct).toBe(20); // libyan builder 60, greek founder 40
  });

  it("static faction sets: not = complement, and/or grouped from the right", () => {
    const order = ["a", "b", "c"], cult = { a: "x", b: "x", c: "y" };
    const s = (req) => [...cp.levelFactionSet(req, order, cult)].sort();
    expect(s("not factions { a, } and factions { all, }")).toEqual(["b", "c"]);
    expect(s("factions { y, } or factions { a, } and hidden_resource q")).toEqual(["a", "c"]);
    expect(s("factions { a, } and factions { c, } or factions { b, }")).toEqual([]); // a ∧ (c ∨ b)
    expect(s("not hidden_resource q")).toEqual([]);
  });

  it("byte wrap of a faction's construction sum (engine stores u8)", () => {
    const lv = { "big:x": { construction: 200, req: "" }, "big:y": { construction: 100, req: "" } };
    // rome: (200+100) & 0xff = 44 → floor(44·60/300) = 8, +40 founder
    const r = cp.settlementCulture(town("rome", "rome", [["big", "x"], ["big", "y"]]), ctxOf({ cultures, levels: lv }));
    expect(r.S).toBe(48);
  });
});

// ── real data: RIS main @ RIS_239_REV vs the turn-1 save's stored values ─────────────
const snap = require("./risDataSnapshot.js");
const dir = snap.risData239();
const real = dir ? describe : describe.skip;
// region → stored culture penalty % (save_24-09-2026 Rome Turn 1, order slot 12 × 5)
const SAVE_T1 = {
  Roma: 0,
  Kroton: 20,                          // Spartan-founded, Roman-owned
  Gynaikopolites_Nomos: 1.5,           // Alexandria: scriptorium_sp1 falls back to `dummies`
  "Memphites-Letopolites_Nomoi": 0,    // egypt-founded, Ptolemies own the pyramids
  Tektosagia: 2.5,                     // builder fallback outside the owner's culture
  Desertum: 0,                         // rebel town, libyan region creator builds
  Rhegion: 50,                         // rebel town, no libyan points at all
  "Perorsia-Dararitaea": 20,           // rebel: axum founded, libyan region creator built
  Arsa: 50,                            // rebel + builder fallback
};

real("culture penalty on real RIS data (pinned)", () => {
  it("matches the turn-1 save on the pinned settlements", () => {
    for (const [region, want] of Object.entries(SAVE_T1)) {
      const r = cp.culturePenaltyForRegion(dir, region);
      expect([region, r && r.pct]).toEqual([region, want]);
    }
  });

  it("finds the pyramids' owner from descr_strat + map_regions.tga", () => {
    expect(cp.loadContext(dir).pyramidsOwner).toBe("ptolemaic");
  });

  it("poModel uses it without a save: Croton −20 settlement row (+15 leader/governor rows)", { timeout: 120000 }, () => {
    const po = require("./poModel.js").computeStartingPO(dir, "romans_julii", {});
    expect(po.Croton.rows.cultureSettlement).toBe(-20);
    expect(po.Croton.rows.culture).toBe(-35); // was a flat −37 before 2026-10-10
    expect(po.Croton.culture.S).toBe(60);
    expect(po.Rome.rows.culture === 0).toBe(true); // -0 from the row negation
  });
});
