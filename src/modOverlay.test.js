// Tests for the submod overlay (2026-07-30, RIS_Four_Romans bug): a thin submod
// ships only the files it changes, so the analysis pipeline must read a merged
// submod-over-base view. Real temp dirs end-to-end, junctions included.
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveModDataDir } from "./modOverlay.js";

let root, subData, baseData, cacheRoot;

const write = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-"));
  cacheRoot = path.join(root, "cache");
  // layout mirrors C:\RIS: base mod at <root>/base/data, submod at <root>/_submods/four/data
  baseData = path.join(root, "base", "data");
  subData = path.join(root, "_submods", "four", "data");
  write(path.join(baseData, "export_descr_unit.txt"), "type base unit");
  write(path.join(baseData, "export_descr_buildings.txt"), "building core");
  write(path.join(baseData, "world", "maps", "base", "descr_regions.txt"), "region_a\n\tTown_A");
  write(path.join(baseData, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "BASE STRAT");
  write(path.join(baseData, "world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt"), "pool x");
  write(path.join(baseData, "ui", "roman", "icon.tga"), "tga");
  write(path.join(subData, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "SUBMOD STRAT");
  write(path.join(subData, "text", "campaign_descriptions.txt"), "four romans");
});

describe("effectiveModDataDir", () => {
  test("a full mod (has EDU) is returned unchanged", () => {
    expect(effectiveModDataDir(baseData, cacheRoot, null)).toBe(baseData);
  });

  test("a thin submod resolves to a merged view: submod wins, base fills the rest", () => {
    const eff = effectiveModDataDir(subData, cacheRoot, null);
    expect(eff).not.toBe(subData);
    // base-only files resolve (this is what was breaking: EDU parsed 0 units)
    expect(fs.readFileSync(path.join(eff, "export_descr_unit.txt"), "utf8")).toBe("type base unit");
    expect(fs.existsSync(path.join(eff, "world", "maps", "base", "descr_regions.txt"))).toBe(true);
    expect(fs.existsSync(path.join(eff, "ui", "roman", "icon.tga"))).toBe(true); // junctioned dir
    // the submod's descr_strat WINS over base's
    expect(fs.readFileSync(path.join(eff, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "utf8")).toBe("SUBMOD STRAT");
    // base's extra campaign files survive next to it
    expect(fs.existsSync(path.join(eff, "world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt"))).toBe(true);
    // submod-only files present too
    expect(fs.existsSync(path.join(eff, "text", "campaign_descriptions.txt"))).toBe(true);
  });

  test("an Army Setup-style write to the SUBMOD's descr_strat reaches the merged view", async () => {
    const eff = effectiveModDataDir(subData, cacheRoot, null);
    const srcStrat = path.join(subData, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    fs.writeFileSync(srcStrat, "SUBMOD STRAT EDITED");
    const st = fs.statSync(srcStrat);
    fs.utimesSync(srcStrat, st.atime, new Date(st.mtimeMs + 2000));
    await new Promise((r) => setTimeout(r, 1100)); // refresh throttle is 1s
    const eff2 = effectiveModDataDir(subData, cacheRoot, null);
    expect(fs.readFileSync(path.join(eff2, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "utf8")).toBe("SUBMOD STRAT EDITED");
  }, 10000);

  test("a submod with no findable base falls back to the submod dir unchanged", () => {
    // findRelatedModDirs walks FIVE levels up scanning siblings for */data/EDU —
    // from a shallow temp fixture that reaches os.tmpdir() itself, where OTHER
    // concurrently-running tests' fixtures live (a defloc-test-* dir carrying
    // data/export_descr_unit.txt got picked up as the "base mod" in the full
    // suite, 2026-07-30). Pad the fixture deeper than the walk so isolation is
    // structural, not luck.
    const iso = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-iso-"));
    const isoSub = path.join(iso, "pad1", "pad2", "pad3", "_submods", "four", "data");
    write(path.join(isoSub, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "x");
    expect(effectiveModDataDir(isoSub, cacheRoot, null)).toBe(isoSub);
  });
});
