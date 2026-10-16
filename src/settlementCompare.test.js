// Compare Settlements (src/settlementCompare.js). What must hold: every
// difference is seen, a copy changes only what was ticked and only inside that
// one town, the town keeps its layout (lines in place, commented ;GOVPO
// buildings untouched), and "match the main mod" really leaves the town as the
// main mod has it.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sc = require("./settlementCompare.js");
const { readBuildingCatalogue, requiresBlocks } = require("./buildingCatalogue.js");

const NL = String.fromCharCode(10);
const b = (chain, level) => ["\tbuilding", "\t{", `\t\ttype ${chain} ${level}`, "\t}"];
const town = (region, level, pop, creator, buildings, extra = []) => [
  "settlement", "{", `\tlevel ${level}`, `\tregion ${region}`, "\tyear_founded 0", `\tpopulation ${pop}`, "\tplan_set default_set", `\tfaction_creator ${creator}`,
  ...extra, ...buildings.flatMap(([c, l]) => b(c, l)), "}",
];
const HERE = town("Etruria", "town", 400, "romans_julii", [["core_building", "governors_house"], ["market", "market"], ["smith", "blacksmith"]],
  ["\t;GOVPO building", "\t;GOVPO {", "\t\t;GOVPO type governmentA gov1", "\t;GOVPO }"]);
const THERE = town("Etruria", "large_town", 5100, "samnites", [["core_building", "governors_villa"], ["market", "trader"], ["food_storage", "granary"], ["wine_industry", "wine_1"]]);
const CAT = { chains: { core_building: ["governors_house", "governors_villa"], market: ["trader", "market"] } };

describe("compareSettlement", () => {
  it("sees every field and one row per building chain, with which side is bigger", () => {
    const c = sc.compareSettlement(HERE, THERE, CAT);
    expect(Object.fromEntries(c.fields.map((f) => [f.key, `${f.here}|${f.there}`]))).toEqual({
      level: "town|large_town", population: "400|5100", year_founded: "0|0", plan_set: "default_set|default_set", faction_creator: "romans_julii|samnites",
    });
    expect(Object.fromEntries(c.buildings.map((x) => [x.chain, x.status]))).toEqual({
      core_building: "higher_there", market: "lower_there", food_storage: "missing", wine_industry: "missing", smith: "only_here",
    });
  });

  it("does not read a commented-out ;GOVPO building as a building", () => {
    expect(sc.readSettlement(HERE).buildings.map((x) => x.chain)).toEqual(["core_building", "market", "smith"]);
  });

  it("knows which field values are more", () => {
    expect(sc.fieldIsMore("level", "town", "large_town")).toBe(true);
    expect(sc.fieldIsMore("level", "city", "large_town")).toBe(false);
    expect(sc.fieldIsMore("population", "6500", "5100")).toBe(false);
    expect(sc.fieldIsMore("faction_creator", "a", "b")).toBe(false);
  });
});

describe("applyToSettlement", () => {
  it("changes values in place, adds missing chains after the last building, and leaves the rest alone", () => {
    const r = sc.applyToSettlement(HERE, THERE, { fields: ["level", "population"], buildings: ["core_building", "food_storage"] });
    expect(r.changes).toEqual(["level town → large_town", "population 400 → 5100", "core_building governors_house → governors_villa", "food_storage granary added"]);
    const want = HERE.slice();
    want[2] = "\tlevel large_town"; want[5] = "\tpopulation 5100";
    want[want.indexOf("\t\ttype core_building governors_house")] = "\t\ttype core_building governors_villa";
    want.splice(want.length - 1, 0, ...b("food_storage", "granary"));
    expect(r.lines).toEqual(want);
  });

  it("removes only what it is told to, and never a chain the main mod also has", () => {
    const r = sc.applyToSettlement(HERE, THERE, { remove: ["smith"] });
    expect(r.lines.join(NL)).not.toMatch(/smith/);
    expect(r.lines.join(NL)).toMatch(/;GOVPO type governmentA gov1/);
    expect(sc.applyToSettlement(HERE, THERE, { remove: ["market"] }).error).toMatch(/main-mod town too/);
  });

  it("matching the main mod leaves the town's live content equal to it", () => {
    const c = sc.compareSettlement(HERE, THERE, CAT);
    const r = sc.applyToSettlement(HERE, THERE, {
      fields: c.fields.filter((f) => f.here !== f.there).map((f) => f.key),
      buildings: c.buildings.filter((x) => x.there && x.here !== x.there).map((x) => x.chain),
      remove: c.buildings.filter((x) => x.status === "only_here").map((x) => x.chain),
    });
    const live = (L) => { const s = sc.readSettlement(L); return { f: Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v.value])), b: s.buildings.map((x) => `${x.chain} ${x.level}`).sort() }; };
    expect(live(r.lines)).toEqual(live(THERE));
  });

  it("a chain listed twice is seen, and taking it keeps one copy", () => {
    const twice = [...HERE.slice(0, -1), ...b("market", "market"), "}"];
    const row = sc.compareSettlement(twice, THERE, CAT).buildings.find((x) => x.chain === "market");
    expect(row).toMatchObject({ duplicate: true, status: "lower_there" });
    const r = sc.applyToSettlement(twice, THERE, { buildings: ["market"] });
    expect(sc.readSettlement(r.lines).buildings.filter((x) => x.chain === "market").map((x) => x.level)).toEqual(["trader"]);
    expect(r.changes).toEqual(["market second copy removed", "market market → trader"]);
  });

  it("an unknown ask is refused", () => {
    expect(sc.applyToSettlement(HERE, THERE, { buildings: ["nope"] }).error).toMatch(/no nope building/);
  });
});

describe("planSettlementCopy", () => {
  const wrap = (fac, t) => [`faction\t${fac}, ai_x`, "denari\t5000", ...t];
  const TARGET = [...wrap("romans_julii", HERE), ...wrap("slave", town("Latium", "town", 900, "slave", [["core_building", "governors_house"]])), ""].join("\r\n");
  const SOURCE = [...wrap("italics", THERE), ""].join("\n");

  it("touches only that one town and keeps the file's CRLF", () => {
    const r = sc.planSettlementCopy({ targetText: TARGET, sourceText: SOURCE, targetRegion: "Etruria", choice: { fields: ["population"] } });
    expect(r.errors).toEqual([]);
    expect(r.text).toBe(TARGET.replace("\tpopulation 400", "\tpopulation 5100"));
  });

  it("refuses, leaving the text as it was, when a town is not there", () => {
    const r = sc.planSettlementCopy({ targetText: TARGET, sourceText: SOURCE, targetRegion: "Latium", choice: { fields: ["population"] } });
    expect(r.errors[0]).toMatch(/no settlement in region "Latium" in the main mod/);
    expect(r.text).toBe(TARGET);
  });
});

describe("requiresBlocks", () => {
  it("reads factions (with cultures and the all wildcard) and hidden resources", () => {
    expect(requiresBlocks(" requires factions { roman, } and hidden_resource wine", { faction: "romans_julii", culture: "roman", tags: ["wine"] })).toBe(null);
    expect(requiresBlocks(" requires factions { greek, }", { faction: "romans_julii", culture: "roman" })).toEqual({ kind: "faction", what: "romans_julii" });
    expect(requiresBlocks(" requires not factions { slave, } and factions { all, }", { faction: "slave" })).toEqual({ kind: "faction", what: "slave" });
    expect(requiresBlocks(" requires factions { all, } and hidden_resource wine", { faction: "x", tags: ["olive_oil"] })).toEqual({ kind: "resource", what: "wine" });
    expect(requiresBlocks(" requires not hidden_resource desert", { tags: ["desert"] })).toEqual({ kind: "resource", what: "not desert" });
  });
});

// ── against the real mod, when it is installed ──────────────────────────────
const MAIN = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const SUBS = [
  ["RIS_Light", "C:/RIS/_submods/RIS_Light/data/world/maps/campaign/ris_light/descr_strat.txt"],
  ["RIS_Classic", "C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_strat.txt"],
];
const EDB = "C:/RIS/RIS/data/export_descr_buildings.txt";

for (const [name, file] of SUBS) {
  describe.skipIf(!fs.existsSync(MAIN) || !fs.existsSync(file) || !fs.existsSync(EDB))(`${name} against the installed main campaign`, () => {
    it("matching every shared town to the main mod changes nothing outside it, and each equals its main-mod self", () => {
      const main = fs.readFileSync(MAIN, "latin1");
      let text = fs.readFileSync(file, "latin1");
      const cat = readBuildingCatalogue(fs.readFileSync(EDB, "utf8"));
      const mainTowns = new Map(sc.settlementIndex(main).map((s) => [s.region, s]));
      const before = sc.settlementIndex(text);
      const shared = before.filter((s) => mainTowns.has(s.region)).map((s) => s.region);
      expect(shared.length).toBeGreaterThan(100);
      const blk = (t, s) => t.split(/\r?\n/).slice(s.start, s.end);
      for (const region of shared) {
        const here = sc.settlementIndex(text).find((s) => s.region === region);
        const c = sc.compareSettlement(blk(text, here), blk(main, mainTowns.get(region)), cat);
        const r = sc.planSettlementCopy({
          targetText: text, sourceText: main, targetRegion: region, choice: {
            fields: c.fields.filter((f) => f.there != null && f.here !== f.there).map((f) => f.key),
            buildings: c.buildings.filter((x) => x.there && (x.here !== x.there || x.duplicate)).map((x) => x.chain),
            remove: c.buildings.filter((x) => x.status === "only_here").map((x) => x.chain),
          },
        });
        expect(r.errors, region).toEqual([]);
        text = r.text;
      }
      const after = sc.settlementIndex(text);
      expect(after.map((s) => `${s.owner}:${s.region}`)).toEqual(before.map((s) => `${s.owner}:${s.region}`));
      const live = (L) => { const s = sc.readSettlement(L); return JSON.stringify({ f: Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v.value]).sort()), b: s.buildings.map((x) => `${x.chain} ${x.level}`).sort() }); };
      for (const region of shared) {
        expect(live(blk(text, after.find((s) => s.region === region))), region).toBe(live(blk(main, mainTowns.get(region))));
      }
      // outside the settlement blocks, not a byte moved
      const outside = (t, idx) => { const L = t.split(/\r?\n/); const keep = new Array(L.length).fill(true); for (const s of idx) for (let i = s.start; i < s.end; i++) keep[i] = false; return L.filter((_, i) => keep[i]).join("\n"); };
      expect(outside(text, after)).toBe(outside(fs.readFileSync(file, "latin1"), before));
    }, 180000); // every shared town, one at a time (Light: ~590)
  });
}
