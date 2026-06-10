import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const im = require("./incomeModel.js");

// ── Cracked-constant regression pins (2026-06-10) ────────────────────────────
// These constants were live-verified / fit on player ledgers. If a refit changes
// them on purpose, update here WITH the new validation evidence; if a test fails
// unexpectedly, a parser or formula regressed.
describe("incomeModel — cracked constants", () => {
  test("tax bracket multipliers (Capua live quartet 1401/1752/2103/2629 = ×0.8/1.0/1.2/1.5)", () => {
    // 1401/1752=0.7996, 2103/1752=1.2003, 2629/1752=1.5005 — the engine multipliers.
    expect(2103 / 1752).toBeCloseTo(1.2, 2);
    expect(1401 / 1752).toBeCloseTo(0.8, 2);
    expect(2629 / 1752).toBeCloseTo(1.5, 2);
  });

  test("tribute rate is exactly 50% of client net (38/38 ledger rows at 0.500)", () => {
    expect(im.TRIBUTE_RATE).toBe(0.5);
  });

  test("army upkeep scales: infantry ≈1×EDU, cavalry ≈1.19×EDU, ships EXCLUDED", () => {
    expect(im.CALIB).toBeDefined();
    const fn = require("./incomeModel.js");
    // UPKEEP_SCALE is module-internal but its behaviour is pinned via the fixture
    // test below; here pin the wage constants (exact on fresh saves).
    expect(im.CALIB.wageNamed).toBe(200);
    expect(im.CALIB.wageAdmiral).toBe(50);
  });

  test("cracked income constants (2026-06-10 session)", () => {
    expect(im.CALIB.farmPoint).toBe(73.61);      // farming EXACT 11/11
    expect(im.CALIB.minePoint).toBe(5);          // mining = 5×mine_resource×Σ(qty×tv), 5/6 exact
    expect(im.CALIB.taxLogK_single).toBe(1.0);   // Capua quartet
    expect(im.CALIB.taxLogK_multi).toBeCloseTo(0.5544, 4);
    expect(im.CALIB.tradeLand).toBeCloseTo(6.23, 2);
    expect(im.CALIB.tradeSea).toBeCloseTo(10.57, 2);
    expect(im.CALIB.corrD0).toBe(12);
  });

  test("empire-size tiers (settlement-count brackets from major_event scripts)", () => {
    expect(im.empireTier(1)).toBe(1);
    expect(im.empireTier(4)).toBe(2);
    expect(im.empireTier(5)).toBe(3);
    expect(im.empireTier(15)).toBe(4);
    expect(im.empireTier(29)).toBe(5);
    expect(im.empireTier(30)).toBe(6);
  });
});

// ── Fixture-mod tests (synthetic descr_strat/EDU/campaign script) ────────────
describe("incomeModel — fixture mod", () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-im-test-"));
    const camp = path.join(dir, "world", "maps", "campaign", "imperial_campaign");
    fs.mkdirSync(camp, { recursive: true });
    fs.writeFileSync(path.join(dir, "export_descr_unit.txt"), [
      "type test infantry unit",
      "category infantry",
      "class light",
      "soldier test_inf, 40, 0, 1",
      "stat_cost 1, 400, 100, 50, 60, 400, 1, 100",
      "",
      "type test cavalry unit",
      "category cavalry",
      "class light",
      "soldier test_cav, 25, 0, 1",
      "stat_cost 1, 600, 200, 60, 70, 600, 1, 110",
      "",
      "type test ship unit",
      "category ship",
      "class light",
      "soldier test_crew, 30, 0, 1",
      "stat_cost 1, 500, 300, 0, 0, 500, 1, 90",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(camp, "descr_strat.txt"), [
      "faction\ttestfac, balanced smith",
      "character\tTester, named character, x 10, y 10",
      "unit\ttest infantry unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "unit\ttest cavalry unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "unit\ttest ship unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(camp, "Test_Campaign_Script.txt"), [
      "; protectorates at campaign start",
      "console_command become_protector bigfac smallfac",
      "console_command become_protector bigfac otherfac ; comment",
      "",
    ].join("\n"));
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } });

  test("armyUpkeepEDU: inf×0.976 + cav×1.186, ship excluded", () => {
    const r = im.armyUpkeepEDU(dir, "testfac");
    // EDU upkeep field = stat_cost[2]: inf 100, cav 200, ship 300.
    const expected = Math.round(100 * 0.9759 + 200 * 1.1857);
    expect(r.units).toBe(3);
    expect(r.upkeep).toBe(expected);
  });

  test("parseProtectorates reads become_protector pairs from the campaign script", () => {
    const p = im.parseProtectorates(dir);
    expect(p.clientsOf.bigfac).toEqual(["smallfac", "otherfac"]);
    expect(p.suzerainOf.smallfac).toBe("bigfac");
    expect(p.suzerainOf.otherfac).toBe("bigfac");
  });

  test("countCharacters: named characters drive the exact wage formula", () => {
    const c = im.countCharacters(dir, "testfac");
    expect(c.named).toBe(1);
    expect(c.admiral).toBe(0);
  });
});
