// Waking a dormant faction on a campaign map (src/factionTransfer.js).
// The rules that matter: nothing outside the two factions involved may move,
// the map keeps exactly as many settlements as it had, a character brought from
// another map gets new coordinates, and any refusal leaves the file untouched.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { readFactionRoster, settlementOwners, planFactionImport, factionBlocks } = require("./factionTransfer.js");

const NL = String.fromCharCode(10);
const settle = (region, level, owner) => [
  "settlement", "{", `\tlevel ${level}`, `\tregion ${region}`, "\tyear_founded 0", "\tpopulation 2000",
  "\tbuilding", "\t{", `\t\ttype core_building governors_house`, "\t}", `\tfaction_creator ${owner}`, "}",
];
const SOURCE = [
  "faction\tathens, ai_athens",
  "denari\t7100",
  ...settle("Attike", "large_city", "athens"),
  "character\tPhilochoros, named character, leader, age 70, , x 413, y 350",
  "traits GoodCommander 2",
  "army",
  "unit\t\tathenian general\t\texp 0 armour 0 weapon_lvl 0",
  "unit\t\tathenian hoplites\t\texp 0 armour 0 weapon_lvl 0",
  "character\tSosistratos, admiral, age 40, , x 411, y 348",
  "army",
  "unit\t\tnaval triremes\t\texp 2 armour 0 weapon_lvl 0",
  "character_record\t\tHarmonia,\t female, age 65, alive, never_a_leader",
  "character_record\t\tOrphan,\t male, age 20, alive",
  "relative\t Philochoros,\t Harmonia, end",
  "faction\tslave, ai_rebel",
  "denari\t1000",
  "",
].join(NL);
const TARGET = [
  "faction\tathens, ai_athens",
  "dead_until_resurrected",
  "re_emergent",
  "denari\t5000",
  "faction\tslave, ai_rebel",
  "denari\t1000",
  ...settle("Attike", "town", "slave"),
  ...settle("Elsewhere", "town", "slave"),
  "faction\tmacedon, ai_greek",
  "denari\t9000",
  ...settle("Pella", "city", "macedon"),
  "character\tAntigonos, named character, leader, age 50, , x 1, y 2",
  "",
].join(NL);

describe("readFactionRoster", () => {
  it("reads settlements, characters with their armies, family and links", () => {
    const r = readFactionRoster(SOURCE, "athens");
    expect(r.denari).toBe(7100);
    expect(r.dormant).toBe(false);
    expect(r.settlements.map((s) => s.region)).toEqual(["Attike"]);
    expect(r.characters.map((c) => `${c.name}:${c.role || c.kind}:${c.unitCount}`)).toEqual(["Philochoros:leader:2", "Sosistratos:admiral:1"]);
    expect(r.characters[0].army).toEqual(["athenian general", "athenian hoplites"]);
    expect(r.characters[0]).toMatchObject({ x: 413, y: 350, age: 70 });
    expect(r.family.map((f) => `${f.name}:${f.gender}`)).toEqual(["Harmonia:female", "Orphan:male"]);
    expect(r.relatives[0].names).toEqual(["Philochoros", "Harmonia"]);
  });

  it("sees a dormant stub for what it is", () => {
    const r = readFactionRoster(TARGET, "athens");
    expect(r).toMatchObject({ dormant: true, reEmergent: true, denari: 5000 });
    expect(r.settlements).toEqual([]);
    expect(r.characters).toEqual([]);
  });
});

describe("planFactionImport", () => {
  const base = { targetText: TARGET, sourceText: SOURCE, faction: "athens" };

  it("wakes the faction, moves the town, and leaves every other faction byte-identical", () => {
    const r = planFactionImport({ ...base, settlements: ["Attike"], characters: ["Philochoros"], family: ["Harmonia"], placements: { Philochoros: { x: 55, y: 66 } } });
    expect(r.errors).toEqual([]);
    const after = readFactionRoster(r.text, "athens");
    expect(after.dormant).toBe(false);
    expect(after.reEmergent).toBe(false);
    expect(after.settlements.map((s) => s.region)).toEqual(["Attike"]);
    // the town keeps the TARGET map's version of itself, not the source's
    expect(after.settlements[0].level).toBe("town");
    expect(after.characters[0]).toMatchObject({ name: "Philochoros", x: 55, y: 66, unitCount: 2 });
    expect(after.family.map((f) => f.name)).toEqual(["Harmonia"]);
    expect(after.relatives.length).toBe(1);

    // macedon is untouched, and the map still has the same number of settlements
    const blockText = (t, f) => { const L = t.split(/\r?\n/); const b = factionBlocks(L).find((x) => x.faction === f); return L.slice(b.start, b.end).join(NL); };
    expect(blockText(r.text, "macedon")).toBe(blockText(TARGET, "macedon"));
    expect(Object.keys(settlementOwners(r.text)).length).toBe(Object.keys(settlementOwners(TARGET)).length);
    expect(settlementOwners(r.text).Attike.faction).toBe("athens");
    expect(settlementOwners(r.text).Elsewhere.faction).toBe("slave");
  });

  it("warns when a town is taken from a living faction, not the rebels", () => {
    const r = planFactionImport({ ...base, settlements: ["Pella"], characters: [], family: [], placements: {} });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/Pella is taken from macedon/);
    expect(r.summary.takenFrom).toEqual({ macedon: 1 });
  });

  it("carries a character's army across and rewrites only its coordinates", () => {
    const r = planFactionImport({ ...base, settlements: ["Attike"], characters: ["Philochoros", "Sosistratos"], family: [], placements: { Philochoros: { x: 10, y: 20 }, Sosistratos: { x: 11, y: 21 } } });
    const after = readFactionRoster(r.text, "athens");
    expect(after.characters.map((c) => [c.name, c.x, c.y, c.unitCount])).toEqual([["Philochoros", 10, 20, 2], ["Sosistratos", 11, 21, 1]]);
    expect(after.characters[0].army).toEqual(["athenian general", "athenian hoplites"]);
    // the trait line travelled with its character
    expect(r.text).toMatch(/traits GoodCommander 2/);
  });

  it("leaves behind a family link whose people did not travel", () => {
    const r = planFactionImport({ ...base, settlements: ["Attike"], characters: ["Philochoros"], family: [], placements: { Philochoros: { x: 1, y: 1 } } });
    expect(readFactionRoster(r.text, "athens").relatives.length).toBe(0); // Harmonia stayed
    expect(r.warnings.join(" ")).toMatch(/family link/);
  });

  it("says so when the result would be a faction that cannot survive", () => {
    const noTown = planFactionImport({ ...base, settlements: [], characters: ["Philochoros"], placements: { Philochoros: { x: 1, y: 1 } } });
    expect(noTown.warnings.join(" ")).toMatch(/no settlement/);
    const noLeader = planFactionImport({ ...base, settlements: ["Attike"], characters: ["Sosistratos"], placements: { Sosistratos: { x: 1, y: 1 } } });
    expect(noLeader.warnings.join(" ")).toMatch(/no leader/);
    const nothing = planFactionImport({ ...base, settlements: [], characters: [] });
    expect(nothing.warnings.join(" ")).toMatch(/holds nothing/);
  });

  it("refuses, without touching the file, on a bad ask", () => {
    for (const bad of [
      { settlements: ["Nowhere"] },
      { characters: ["Philochoros"] },                                   // no placement given
      { characters: ["Nobody"], placements: { Nobody: { x: 1, y: 1 } } }, // not in the source
      { faction: "carthage", settlements: ["Attike"] },                   // no block in the target
    ]) {
      const r = planFactionImport({ ...base, ...bad });
      expect(r.errors.length, JSON.stringify(bad)).toBe(1);
      expect(r.text).toBe(TARGET);
    }
  });
});

// ── against the real mod, when it is installed ──────────────────────────────
const MAIN = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const LIGHT = "C:/RIS/_submods/RIS_Light/data/world/maps/campaign/ris_light/descr_strat.txt";
const haveReal = fs.existsSync(MAIN) && fs.existsSync(LIGHT);

describe.skipIf(!haveReal)("against the installed RIS and its Light submod", () => {
  it("wakes a dormant faction and disturbs nothing else on a 28,000-line campaign", () => {
    const main = fs.readFileSync(MAIN, "latin1");
    const light = fs.readFileSync(LIGHT, "latin1");
    const fac = "minaeans";
    expect(readFactionRoster(light, fac).dormant, `${fac} is expected to be dormant in RIS_Light`).toBe(true);

    const src = readFactionRoster(main, fac);
    const owners = settlementOwners(light);
    const towns = src.settlements.map((s) => s.region).filter((r) => owners[r]);
    expect(towns.length).toBeGreaterThan(0);

    const names = src.characters.map((c) => c.name);
    const placements = Object.fromEntries(names.map((n) => [n, { x: 100, y: 200 }]));
    const r = planFactionImport({ targetText: light, sourceText: main, faction: fac, settlements: towns, characters: names, family: src.family.map((f) => f.name), placements, denari: 6000 });
    expect(r.errors).toEqual([]);

    const after = readFactionRoster(r.text, fac);
    expect(after.dormant).toBe(false);
    expect(after.denari).toBe(6000);
    expect(after.settlements.map((s) => s.region).sort()).toEqual(towns.slice().sort());
    expect(after.characters.length).toBe(names.length);
    expect(after.characters.every((c) => c.x === 100 && c.y === 200)).toBe(true);

    // the map neither gained nor lost a settlement, and only the two factions moved
    const before = settlementOwners(light), now = settlementOwners(r.text);
    expect(Object.keys(now).length).toBe(Object.keys(before).length);
    const changed = Object.keys(before).filter((k) => before[k].faction !== now[k].faction);
    expect(changed.sort()).toEqual(towns.slice().sort());
    const blocks = (t) => { const L = t.split(/\r?\n/); return Object.fromEntries(factionBlocks(L).map((b) => [b.faction, L.slice(b.start, b.end).join(NL)])); };
    const A = blocks(light), B = blocks(r.text);
    const movedFactions = Object.keys(A).filter((f) => A[f] !== B[f]).sort();
    expect(movedFactions).toEqual([fac, "slave"].sort());
  });
});
