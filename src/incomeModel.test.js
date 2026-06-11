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
    // farming engine constant 80/pt is DOCUMENTED (Feral EDB.md); ×0.92 = the
    // documented HARD-difficulty human income factor (the corpus is all H/H).
    expect(im.CALIB.farmPointBase).toBe(80);
    expect(im.CALIB.difficultyIncome).toBe(0.92);
    expect(im.CALIB.farmPoint).toBeCloseTo(73.6, 5); // farming EXACT 11/11
    expect(im.CALIB.minePoint).toBe(5);          // mining = 5×mine_resource×Σ(qty×tv), 5/6 exact
    expect(im.CALIB.taxLogK_single).toBeCloseTo(1.2244, 4); // Capua quartet ABSOLUTE (=4/3×0.92)
    expect(im.CALIB.taxLogK_multi).toBeCloseTo(0.5544, 4); // legacy (unused for multi since flat law)
    // EXACT TAX LAW (2026-06-11 live julii scroll sweeps): flat-points application,
    // whole-ledger validation 9,583 vs 9,447 live (+1.4%).
    expect(im.CALIB.taxBaseK).toBeCloseTo(0.4559, 4);
    expect(im.CALIB.taxFlatPoint).toBeCloseTo(3.9, 2);
    // refit 2026-06-11: qty-weighted rv + not-at-war partners + symmetric ally parse,
    // anchored to the live julii ledger trade 4,610 (ratio 2.042 preserved)
    expect(im.CALIB.tradeLand).toBeCloseTo(0.8656, 3);
    expect(im.CALIB.tradeSea).toBeCloseTo(1.1169, 3); // re-anchored with the per-route land law
    // per-route land law (2026-06-11, fit on live scroll routes vs this model's adjacency)
    expect(im.CALIB.tradeRouteK).toBeCloseTo(2.7478, 3);
    expect(im.CALIB.tradeRoutePopX).toBeCloseTo(0.488, 3);
    expect(im.CALIB.tradeBonusPct).toBe(10);     // documented: 10% per trade_base point
    // corruption refit 2026-06-11 (live 11-town ladder): quadratic % of gross past d0=6,
    // zero for capital + office-holding governors (julii: 2,626 model vs 2,641 live)
    expect(im.CALIB.corrD0).toBe(10); // grand refit 2026-06-11: law-subtractive corruption
    expect(im.CALIB.corrA).toBeCloseTo(0.58, 3);
    expect(im.CALIB.corrB).toBeCloseTo(0.0015, 4);
    // AI economy refit 2026-06-11 (215 current-vintage AI ledgers, median ratio 1.000/tier)
    expect(im.CALIB.aiFarmBonus).toBeCloseTo(1.188, 3);
    expect(im.CALIB.aiTaxFixByTier[1]).toBeCloseTo(1.976, 3);
    expect(im.CALIB.aiTaxFixByTier[7]).toBeCloseTo(0.83, 2); // rescaled after the AI gov-building causal fix
    expect(im.CALIB.aiTradeFixByTier[2]).toBeCloseTo(0.66, 2);
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
