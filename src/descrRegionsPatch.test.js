// descr_regions Save: line 3 is the descr_regions faction (rebelDefault), never
// the descr_strat owner the app overlays onto `faction` (2026-10-16: one
// hidden-resource save rewrote 352 of RIS Light's 605 owners).
import { describe, it, expect } from "vitest";
import { patchDescrRegions } from "./descrRegionsPatch.js";

const TEXT = [
  ";",
  "; descr_regions.txt",
  ";",
  "Rhegion",
  "\tRhegium",
  "\tsparta",
  "\tRheginians",
  "\t157 43 58",
  "\titaly, s_italy, Farm6, mountain_valley, mediterranean",
  "\t5",
  "\t6",
  "\tionian 70 italic 30",
  "",
  "Latium",
  "\tRome",
  "\troman_senate",
  "\tRomans",
  "\t52 13 198",
  "\titaly, Farm10, river_valley",
  "\t5",
  "\t10",
  "\titalic 100",
  "",
].join("\r\n");

// What the app holds after load: `faction` overlaid with the descr_strat owner.
const loaded = () => ({
  "157,43,58": { region: "Rhegion", city: "Rhegium", faction: "slave", rebelDefault: "sparta", culture: "Rheginians", tags: "italy, s_italy, Farm6, mountain_valley, mediterranean" },
  "52,13,198": { region: "Latium", city: "Rome", faction: "romans_julii", rebelDefault: "roman_senate", culture: "Romans", tags: "italy, Farm10, river_valley" },
});

describe("patchDescrRegions", () => {
  it("an unedited round trip gives back the same file", () => {
    expect(patchDescrRegions(TEXT, loaded())).toBe(TEXT);
  });

  it("a hidden-resource edit changes only that tags line, owners stay", () => {
    const r = loaded();
    r["157,43,58"].tags = "italy, s_italy, Farm6, mediterranean, mountains";
    const out = patchDescrRegions(TEXT, r);
    expect(out).toBe(TEXT.replace("Farm6, mountain_valley, mediterranean", "Farm6, mediterranean, mountains"));
    expect(out).toContain("\tRhegium\r\n\tsparta\r\n");
    expect(out).not.toMatch(/\tslave\r\n/);
  });

  it("a rebel-default edit writes line 3", () => {
    const r = loaded();
    r["157,43,58"].rebelDefault = "athens";
    expect(patchDescrRegions(TEXT, r)).toBe(TEXT.replace("\tRhegium\r\n\tsparta", "\tRhegium\r\n\tathens"));
  });

  it("falls back to faction when no overlay ran (no rebelDefault)", () => {
    const r = loaded();
    delete r["157,43,58"].rebelDefault;
    r["157,43,58"].faction = "sparta";
    expect(patchDescrRegions(TEXT, r)).toBe(TEXT);
  });
});
