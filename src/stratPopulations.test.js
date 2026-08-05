// Tests for src/stratPopulations.js — surgical starting-population edits.
import { describe, it, expect } from "vitest";
import fs from "fs";
import { applyPopulations } from "./stratPopulations.js";

const SNIPPET = [
  "faction\tromans_julii, ai_romans_julii",
  "denari\t5000",
  "settlement",
  "{",
  "\tlevel huge_city",
  "\tregion Roma",
  "\tyear_founded 0",
  "\tpopulation 12000",
  "\tplan_set default_set",
  "\tfaction_creator romans_julii",
  "\tbuilding",
  "\t{",
  "\t\ttype core_building imperial_palace",
  "\t}",
  "\tbuilding",
  "\t{",
  "\t\ttype hinterland_roads roads",
  "\t}",
  "}",
  "settlement",
  "{",
  "\tlevel town",
  "\tregion Ostia",
  "\tyear_founded 0",
  "\tpopulation 2400",
  "\tplan_set default_set",
  "\tfaction_creator romans_julii",
  "}",
  "",
].join("\r\n");

describe("applyPopulations", () => {
  it("rewrites exactly the targeted population lines, preserving everything else byte-for-byte", () => {
    const r = applyPopulations(SNIPPET, { Roma: 15000, ostia: 1800 }); // second key lowercase on purpose
    expect(r.applied).toEqual([
      { region: "Roma", from: 12000, to: 15000, line: 8 },
      { region: "Ostia", from: 2400, to: 1800, line: 25 },
    ]);
    expect(r.missing).toEqual([]);
    expect(r.noPopLine).toEqual([]);
    // the only diffs are the two population lines
    const a = SNIPPET.split("\r\n"), b = r.text.split("\r\n");
    expect(b.length).toBe(a.length);
    const diffs = a.map((ln, i) => (ln !== b[i] ? i : -1)).filter((i) => i >= 0);
    expect(diffs).toEqual([7, 24]);
    expect(b[7]).toBe("\tpopulation 15000");
    expect(b[24]).toBe("\tpopulation 1800");
  });

  it("building-block braces do not end the settlement early (the 0.9.444 lesson)", () => {
    // Roma's population line sits BEFORE its building blocks; Ostia AFTER Roma's
    // nested braces — a first-} parser would attribute Roma's edit wrongly.
    const r = applyPopulations(SNIPPET, { Ostia: 9999 });
    expect(r.applied).toEqual([{ region: "Ostia", from: 2400, to: 9999, line: 25 }]);
  });

  it("reports unknown regions in missing, and blocks without a population line in noPopLine", () => {
    const noPop = SNIPPET.replace("\tpopulation 2400\r\n", "");
    const r = applyPopulations(noPop, { Ostia: 5000, Atlantis: 100 });
    expect(r.applied).toEqual([]);
    expect(r.noPopLine).toEqual(["Ostia"]);
    expect(r.missing).toEqual(["atlantis"]);
  });

  it("rejects non-positive / non-numeric values instead of writing them", () => {
    const r = applyPopulations(SNIPPET, { Roma: 0, Ostia: "abc" });
    expect(r.applied).toEqual([]);
    expect(r.text).toBe(SNIPPET);
  });

  it("preserves LF line endings when the input has no CRLF", () => {
    const lf = SNIPPET.replace(/\r\n/g, "\n");
    const r = applyPopulations(lf, { Roma: 100 });
    expect(r.text.includes("\r\n")).toBe(false);
    expect(r.text.split("\n")[7]).toBe("\tpopulation 100");
  });

  // No-corruption proof on the REAL RIS descr_strat: rewriting a region's
  // population to its CURRENT value must reproduce the file byte-for-byte.
  const RIS_STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
  it.runIf(fs.existsSync(RIS_STRAT))("identity round-trip on the real RIS descr_strat (1,305 settlements)", () => {
    const text = fs.readFileSync(RIS_STRAT, "latin1");
    const m = text.match(/^\s*region\s+(\S+)[\s\S]*?^\s*population\s+(\d+)/m);
    expect(m).toBeTruthy();
    const r = applyPopulations(text, { [m[1]]: +m[2] });
    expect(r.applied.length).toBe(1);
    expect(r.applied[0].from).toBe(+m[2]);
    expect(r.text).toBe(text);
  });
});
