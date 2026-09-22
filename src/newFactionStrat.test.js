// The campaign side of a new faction (src/newFaction.js): declaring it, giving
// it a town, and giving it the family without which the engine destroys it on
// turn one. Plus the recruitment picker over export_descr_buildings.
//
// The rules these pin down were all learned from the real files: names come out
// of a namelist POOL (nothing is minted), and a `requires not factions { … }`
// list is an exclusion that must never be added to.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planFactionStratEntry, planRecruitment, listRecruitOptions, readNamelist } = require("./newFaction.js");

const NL = String.fromCharCode(10);
const STRAT = [
  "playable",
  "\tparni",
  "end",
  "nonplayable",
  "\tpontus",
  "end",
  "",
  "faction\tparni, ai_east",
  "denari\t5000",
  "settlement",
  "{",
  "\tlevel large_town",
  "\tregion Parnia",
  "\tpopulation 4400",
  "}",
  "settlement",
  "{",
  "\tlevel town",
  "\tregion Hyrkania",
  "\tpopulation 2000",
  "}",
  "character\tArsakes, named character, leader, age 40, , x 100, y 100",
  "",
  "faction\tpontus, ai_east",
  "denari\t3000",
  "settlement",
  "{",
  "\tlevel city",
  "\tregion Pontus",
  "}",
  "",
].join(NL);

const leader = { name: "Phraates", age: 42 };
const heir = { name: "Orodes", age: 20 };
const ok = { stratText: STRAT, newId: "tocharians", after: "parni", aiLabel: "ai_east", settlements: ["Hyrkania"], leader, heir, at: { x: 200, y: 150 } };

describe("planFactionStratEntry", () => {
  it("declares the faction, houses it, and gives it a leader and an heir", () => {
    const r = planFactionStratEntry(ok);
    expect(r.errors).toEqual([]);
    const L = r.text.split(NL);
    expect(L.filter((l) => l.trim() === "tocharians").length).toBe(1);
    const i = L.findIndex((l) => /^faction\ttocharians, ai_east/.test(l));
    expect(i).toBeGreaterThan(-1);
    const block = L.slice(i, i + 14).join(NL);
    expect(block).toMatch(/region Hyrkania/);
    expect(block).toMatch(/Phraates, named character, leader, age 42, , x 200, y 150/);
    expect(block).toMatch(/Orodes, named character, heir, age 20, , x 200, y 150/);
  });

  it("moves the settlement rather than copying it", () => {
    const r = planFactionStratEntry(ok);
    expect((r.text.match(/region Hyrkania/g) || []).length).toBe(1);
    const parni = r.text.slice(r.text.indexOf("faction\tparni"), r.text.indexOf("faction\ttocharians"));
    expect(parni).toMatch(/region Parnia/);
    expect(parni).not.toMatch(/region Hyrkania/);
    expect(r.warnings.join(" ")).toMatch(/taken from parni/);
  });

  it("is declared next to the faction it was cloned from, not at the end", () => {
    const r = planFactionStratEntry({ ...ok, playable: true });
    const L = r.text.split(NL);
    expect(L[L.indexOf("\tparni") + 1].trim()).toBe("tocharians");
  });

  it("warns when the old owner is left with nothing", () => {
    const r = planFactionStratEntry({ ...ok, settlements: ["Parnia", "Hyrkania"] });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/parni is left with NO settlements/);
  });

  it("refuses without a leader, an heir, a town or a position", () => {
    for (const [bad, why] of [
      [{ leader: null }, /leader/],
      [{ heir: null }, /heir/],
      [{ settlements: [] }, /settlement/],
      [{ at: null }, /position/],
      [{ settlements: ["Nowhere"] }, /no settlement in region/],
      [{ newId: "parni" }, /already has a block/],
    ]) {
      const r = planFactionStratEntry({ ...ok, ...bad });
      expect(r.errors.length, JSON.stringify(bad)).toBe(1);
      expect(r.errors[0]).toMatch(why);
      expect(r.text).toBe(STRAT); // a refusal changes nothing
    }
  });
});

const EDB = [
  "building foo",
  "{",
  "\tlevels foo_one",
  "\t{",
  '\t\tfoo_one requires factions { parni, pontus, }',
  "\t\t{",
  '\t\t\trecruit "parni horse archers" 0 requires factions { parni, }',
  '\t\t\trecruit "greek hoplites" 0 requires factions { pontus, }',
  "\t\t}",
  "\t}",
  "}",
  "alias steppe_chain",
  "{",
  "\trequires hidden_resource steppe and factions { parni, saka, }",
  "\trequires not factions { parni, germanic, }",
  "}",
].join(NL);

describe("recruitment", () => {
  it("offers every list that grants the donor something, labelled", () => {
    const o = listRecruitOptions(EDB, "parni");
    expect(o.map((x) => `${x.building}|${x.level}|${x.unit || ""}`)).toEqual([
      "foo|foo_one|", "foo|foo_one|parni horse archers", "alias steppe_chain|null|",
    ].map((s) => s.replace("|null|", "|null|")));
    expect(o.every((x) => !/not factions/.test(x.text))).toBe(true);
  });

  it("never offers — or edits — an exclusion list, which would FORBID the faction", () => {
    const excl = EDB.split(NL).findIndex((l) => /not factions/.test(l));
    expect(listRecruitOptions(EDB, "parni").some((o) => o.line === excl)).toBe(false);
    const r = planRecruitment({ edbText: EDB, donor: "parni", newId: "tocharians", lines: [excl] });
    expect(r.changed).toBe(0);
    expect(r.text).toBe(EDB);
  });

  it("adds the new token beside the donor only on the lines picked", () => {
    const o = listRecruitOptions(EDB, "parni");
    const r = planRecruitment({ edbText: EDB, donor: "parni", newId: "tocharians", lines: [o[1].line] });
    expect(r.changed).toBe(1);
    const L = r.text.split(NL);
    expect(L[o[1].line]).toMatch(/factions \{ parni, tocharians, \}/);
    expect(L[o[0].line]).not.toMatch(/tocharians/); // not picked, not touched
  });
});

describe("readNamelist", () => {
  const POOL = [
    '"iranian_men":', "{", '\t"names":', "\t[", '\t\t"Bagoas",', "\t],", "},",
    '"parni_men":', "{", '\t"inherit": "iranian_men",', '\t"names":', "\t[", '\t\t"Arsakes",', '\t\t"Orodes",', "\t],", "},",
  ].join(NL);

  it("reads the pool's own names and inherits the parent's", () => {
    expect(readNamelist(POOL, "parni_men")).toEqual(["Arsakes", "Orodes", "Bagoas"]);
  });

  it("never mistakes the inherited POOL name for a person", () => {
    expect(readNamelist(POOL, "parni_men")).not.toContain("iranian_men");
  });

  it("is empty for a pool that is not there", () => {
    expect(readNamelist(POOL, "nope_men")).toEqual([]);
  });
});

// ── against the installed mod ───────────────────────────────────────────────
const D = "C:/RIS/RIS/data";
const haveRis = fs.existsSync(D + "/descr_namelists.txt");
describe.skipIf(!haveRis)("against the installed RIS", () => {
  it("draws real names, rehouses a real region and leaves the map whole", () => {
    const nl = fs.readFileSync(D + "/descr_namelists.txt", "latin1");
    const names = readNamelist(nl, "parni_men");
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain("Arsakes");

    const strat = fs.readFileSync(D + "/world/maps/campaign/imperial_campaign/descr_strat.txt", "latin1");
    const { settlementOwners } = require("./factionTransfer.js");
    const before = settlementOwners(strat);
    const region = Object.keys(before).find((k) => before[k].faction === "pontus");
    const r = planFactionStratEntry({
      stratText: strat, newId: "tocharians", after: "parni", aiLabel: "ai_east",
      settlements: [region], leader: { name: names[0], age: 42 }, heir: { name: names[1], age: 20 }, at: { x: 200, y: 150 },
    });
    expect(r.errors).toEqual([]);
    const after = settlementOwners(r.text);
    // one settlement changed hands; none was lost or duplicated
    expect(Object.keys(after).length).toBe(Object.keys(before).length);
    expect(after[region].faction).toBe("tocharians");
    expect(r.text.split(/\r?\n/).filter((l) => l.trim() === "tocharians").length).toBe(1);
  });

  it("finds real recruitment offers and skips the real exclusion lists", () => {
    const edb = fs.readFileSync(D + "/export_descr_buildings.txt", "latin1");
    const all = edb.split(/\r?\n/).filter((l) => /(^|[^A-Za-z0-9_])parni(?![A-Za-z0-9_])/.test(l)).length;
    const o = listRecruitOptions(edb, "parni");
    expect(o.length).toBeGreaterThan(50);
    expect(o.length).toBeLessThan(all); // exclusions were dropped
    expect(o.filter((x) => x.kind === "recruit").length).toBeGreaterThan(20);
    expect(o.filter((x) => x.building).length / o.length).toBeGreaterThan(0.9); // nearly all labelled
  });
});
