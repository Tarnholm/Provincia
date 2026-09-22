// Creating a brand-new faction by cloning a donor (src/newFaction.js).
// What must hold: the donor is never damaged, the clone renames what is a NAME
// and keeps what is a REFERENCE (namelist pools, unit names), art is renamed
// with a source path that really exists, and a refusal writes nothing.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planNewFaction } = require("./newFaction.js");

const NL = String.fromCharCode(10);
const SM = [
  '\t"parni":',
  "\t{",
  '\t\t"string":      "PARNI",',
  '\t\t"description": "PARNI_DESCR",',
  '\t\t"culture":   "iranian",',
  '\t\t"namelists"',
  "\t\t{",
  '\t\t\t"men":      "parni_men",',
  '\t\t\t"women":    "parni_women",',
  "\t\t},",
  '\t\t"horde"',
  "\t\t{",
  '\t\t\t"horde units"',
  "\t\t\t[",
  '\t\t\t\t"horde parni horse archers",',
  "\t\t\t],",
  "\t\t},",
  '\t\t"loading screen icon": "data/ui/faction_icons/parni.tga",',
  '\t\t"primary":   [ 10, 20, 30, ]',
  "\t},",
  '\t"pontus":',
  "\t{",
  '\t\t"string":      "PONTUS",',
  "\t},",
].join(NL);
const BANNERS = ["faction\t\t\tparni", "standard_texture\tmodels/textures/standard_parni.tga", "routing_texture\tmodels/textures/standard_routing_eastern.tga", "", "faction\t\t\tpontus", "standard_texture\tmodels/textures/standard_pontus.tga"].join(NL);
const CHARACTER = ["faction\t\tparni", "dictionary\t2", "strat_model\tsm_east_general", "", "faction\t\tpontus", "dictionary\t2"].join(NL);
const AI = ["personality ai_parni", "building_priority parni", "military_priority parni", "", "personality ai_pontus", "building_priority pontus"].join(NL);
const MODEL = ["type sm_east_general", "texture parni, data/characters/textures/ris/parni/general_parni.tga", "texture pontus, data/characters/textures/ris/pontus/general_pontus.tga", "no_variation parni"].join(NL);
const WIN = ["parni", "hold_regions Rome", "take_regions 250", "", "pontus", "hold_regions Rome"].join(NL);
const TEXT = ["{PARNI}\t\t\tParni", "{PONTUS}\t\t\tPontus"].join(NL);

const files = () => ({ smFactions: SM, banners: BANNERS, character: CHARACTER, aiPersonality: AI, modelStrat: MODEL, winConditions: WIN, expandedText: TEXT });
const base = { donor: "parni", newId: "tocharians", displayName: "Tocharians", description: "Horse lords." };

describe("planNewFaction", () => {
  it("writes an entry in every mandatory file and counts the faction", () => {
    const r = planNewFaction({ files: files(), ...base });
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.edits).sort()).toEqual(["aiPersonality", "banners", "character", "expandedText", "modelStrat", "smFactions", "winConditions"]);
    expect(r.summary).toMatchObject({ newId: "tocharians", donor: "parni", factionCountBefore: 2, factionCountAfter: 3 });
  });

  it("renames the key but NOT the references inside the entry", () => {
    const r = planNewFaction({ files: files(), ...base });
    const entry = r.edits.smFactions.split(NL);
    const i = entry.findIndex((l) => /^\t"tocharians":/.test(l));
    expect(i).toBeGreaterThan(-1);
    const body = entry.slice(i, i + 20).join(NL);
    expect(body).toMatch(/"string":\s+"TOCHARIANS"/);
    expect(body).toMatch(/"description": "TOCHARIANS_DESCR"/);
    // a namelist pool is shared on purpose, and a horde unit is a unit that exists
    expect(body).toMatch(/"men":\s+"parni_men"/);
    expect(body).toMatch(/"horde parni horse archers"/);
    // but the icon is art, so it is renamed and copied
    expect(body).toMatch(/faction_icons\/tocharians\.tga/);
  });

  it("records art copies whose SOURCE is the donor's real path", () => {
    const r = planNewFaction({ files: files(), ...base });
    const froms = r.artCopies.map((c) => c.from);
    expect(froms).toContain("data/ui/faction_icons/parni.tga");
    expect(froms).toContain("models/textures/standard_parni.tga");
    // the directory carries the donor's name too — the source must not be renamed
    expect(froms).toContain("data/characters/textures/ris/parni/general_parni.tga");
    expect(r.artCopies.find((c) => /general_parni/.test(c.from)).to).toBe("data/characters/textures/ris/tocharians/general_tocharians.tga");
    // shared art (not named after the donor) is left alone
    expect(froms.some((f) => /routing_eastern/.test(f))).toBe(false);
    expect(new Set(froms).size).toBe(froms.length); // no duplicates
  });

  it("leaves every donor line in place, and takes nothing from other factions", () => {
    const f = files();
    const r = planNewFaction({ files: f, ...base });
    for (const key of Object.keys(r.edits)) {
      const before = (f[key].match(/parni/g) || []).length;
      const after = (r.edits[key].match(/parni/g) || []).length;
      expect(after, key).toBeGreaterThanOrEqual(before);
      expect(r.edits[key], key).toMatch(/pontus/i); // the neighbour survives (the text file keys it uppercase)
    }
    expect(r.edits.banners).toMatch(/faction\s+pontus/);
  });

  it("clones the AI personality by REFERENCE, not by duplicating the priority tables", () => {
    const r = planNewFaction({ files: files(), ...base });
    const block = r.edits.aiPersonality.split(NL);
    const i = block.findIndex((l) => /^personality ai_tocharians/.test(l));
    expect(block.slice(i, i + 3).join(NL)).toMatch(/building_priority parni/);
  });

  it("adds the display name, so the game does not show the raw key", () => {
    const r = planNewFaction({ files: files(), ...base });
    expect(r.edits.expandedText).toMatch(/\{TOCHARIANS\}\s+Tocharians/);
    expect(r.edits.expandedText).toMatch(/\{TOCHARIANS_DESCR\}\s+Horse lords\./);
  });

  it("takes overrides for culture, namelists and colours", () => {
    const r = planNewFaction({ files: files(), ...base, culture: "eastern", namelists: { men: "saka_men" }, colours: { primary: [120, 40, 160] } });
    const entry = r.edits.smFactions;
    expect(entry).toMatch(/"culture":\s+"eastern"/);
    expect(entry).toMatch(/"men":\s+"saka_men"/);
    expect(entry).toMatch(/"primary":\s+\[ 120, 40, 160, \]/);
  });

  it("refuses, writing nothing, on a bad ask", () => {
    for (const bad of [
      { newId: "Tocharians!" },              // not a token
      { newId: "pontus" },                    // already exists
      { newId: "parni" },                     // same as the donor
      { donor: "nobody" },                    // donor has no entry
      { files: {} },                          // no descr_sm_factions
    ]) {
      const r = planNewFaction({ files: files(), ...base, ...bad });
      expect(r.errors.length, JSON.stringify(bad)).toBe(1);
      expect(r.edits).toEqual({});
      expect(r.artCopies).toEqual([]);
    }
  });

  it("says what is missing rather than writing half a faction", () => {
    const f = files();
    delete f.modelStrat;
    delete f.expandedText;
    const r = planNewFaction({ files: f, ...base });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/descr_model_strat/);
    expect(r.warnings.join(" ")).toMatch(/raw key/);
  });
});

// ── against the installed mod ───────────────────────────────────────────────
const D = "C:/RIS/RIS/data";
const haveRis = fs.existsSync(D + "/descr_sm_factions.txt");
describe.skipIf(!haveRis)("against the installed RIS", () => {
  it("clones a real faction across all seven files without disturbing it", () => {
    const read = (p, enc) => fs.readFileSync(D + "/" + p, enc || "latin1");
    const f = {
      smFactions: read("descr_sm_factions.txt"), character: read("descr_character.txt"),
      modelStrat: read("descr_model_strat.txt"), banners: read("descr_banners.txt"),
      aiPersonality: read("feral_descr_ai_personality.txt"),
      winConditions: read("world/maps/campaign/imperial_campaign/descr_win_conditions.txt"),
      expandedText: read("text/expanded_bi.txt", "utf16le"),
    };
    const r = planNewFaction({ files: f, donor: "parni", newId: "tocharians", displayName: "Tocharians" });
    expect(r.errors).toEqual([]);
    expect(r.summary.factionCountBefore).toBe(239);
    expect(r.summary.art).toBeGreaterThanOrEqual(6);
    // every recorded source is a path the donor really uses
    for (const c of r.artCopies) expect(f.smFactions + f.banners + f.character + f.modelStrat).toContain(c.from);
    // nothing of the donor's was consumed
    for (const key of Object.keys(r.edits)) {
      expect((r.edits[key].match(/parni/gi) || []).length, key).toBeGreaterThanOrEqual((f[key].match(/parni/gi) || []).length);
    }
    expect(r.edits.smFactions.split(/\r?\n/).length - f.smFactions.split(/\r?\n/).length).toBe(103);
  });
});
