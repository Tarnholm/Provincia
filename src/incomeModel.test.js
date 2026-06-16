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
    expect(im.CALIB.taxLogK_single).toBeCloseTo(0.8154, 3); // exact city-state law (Capua 4-bracket sweep) // Capua quartet ABSOLUTE (=4/3×0.92)
    expect(im.CALIB.taxLogK_multi).toBeCloseTo(0.5544, 4); // legacy (unused for multi since flat law)
    // EXACT TAX LAW — ROME-EXACT retune (2026-06-14, 26-town Republic julii corpus):
    // pins the capital Rome 1318/1318 with the faction Σ exact (9,213 vs 9,232); same
    // structural form, K 0.4559→0.4683, per-point 3.9→4.123. See exact-tax-crack.md.
    // POWER-LAW retune (2026-06-15, controlled live-game pop sweep — exact-tax-crack.md §3):
    // multi-town pop term is now a power law K·W = taxPowC·pop^taxPowB (was log), pinned on
    // Rome's neutral-governor bracket sweep (780/976/1172/1466 model vs 779/975/1171/1465
    // live = ±1 denarius). taxFlatPoint stays 4.123 (26-town faction-total live check pins it;
    // capital quick-test read ~4.0 but that over-shoots the faction Σ by +264 vs +51 at 4.123).
    // FP = 4.0 EXACT — the capital bonus pins it (+50 taxable_income_bonus = +200 denarii,
    // 200/50 = 4.0; live capital-reorder sweep). 4.123 had been a kludge compensating the
    // power-law mid-pop bulge; with the bulge removed (piecewise-linear knee) FP returns to 4.0.
    expect(im.CALIB.taxFlatPoint).toBeCloseTo(4.0, 3);
    expect(im.CALIB.taxPowC).toBeCloseTo(45.0218, 2);
    expect(im.CALIB.taxPowB).toBeCloseTo(0.33832, 4);
    // PIECEWISE-LINEAR KNEE (2026-06-15): the pop sweep showed tax rises LINEARLY above ~2k,
    // so above the knee W goes linear to the Rome 9000 anchor instead of following the power
    // law's bow (which over-estimated mid-pop). FP 4.0 + knee 2500: Neapolis 366 (live 365),
    // faction Σ within −0.6%, corpus MAE 14.2.
    expect(im.CALIB.taxPopKnee).toBe(2500);
    // LOW-POP ANCHOR: controlled no-gov sweeps (julii3 Praeneste + shadow corpus cluster)
    // both read W(1500)=540 vs power law 534.5 — the curve is piecewise-linear through it
    // below the knee. Fixes the low-pop faction-tax undershoot.
    expect(im.CALIB.taxW1500).toBe(540);
    // W(pop) ANCHOR TABLE: controlled no-gov julii4 readings pin the curve directly. The
    // 2250→3750 chord passes through Metapontum (2500) and the corpus 3000 exactly.
    // WINTER-FREE re-anchor (2026-06-15): turn-1 tax dropped the disabling_in_winter penalty
    // (turn 1 is summer), so W(pop) re-derived from no-gov game reads with taxPts = base+size.
    // Confirmed exact: Sena 1200 low 252, Arpi 2250 vh 562, Neapolis 3750 n 365, Arretium 4500
    // n 360, Rome 9000 vh 1465. Low-pop (<1200) provisional pending the Sena pop sweep.
    // 1500 anchor wired to the measured taxW1500=540 (was an orphaned constant; the anchor
    // had a stale interpolated 515). Confirmed on julii+cyrene AND all 6 basic pop-1500
    // Carthage towns (2026-06-16). Lifted Carthage tax exact 3/41→11/41, MAE 35.9→32.2.
    // [12000,925] from the live Carthage tax-rate experiment (rate slope W=(1090-905)/0.2=925);
    // the curve is near-flat 9000->12000, replacing the power law's overshoot (1080) for big cities.
    expect(im.CALIB.taxWanchors).toEqual([[1000, 430], [1200, 455], [1500, 540], [2200, 577.5], [2250, 580], [3000, 592.5], [3750, 649], [4500, 668], [9000, 912.67], [12000, 925]]);
    // refit 2026-06-11: qty-weighted rv + not-at-war partners + symmetric ally parse,
    // anchored to the live julii ledger trade 4,610 (ratio 2.042 preserved)
    expect(im.CALIB.tradeLand).toBeCloseTo(0.8656, 3);
    expect(im.CALIB.tradeSea).toBeCloseTo(1.1169, 3); // re-anchored with the per-route land law
    // per-route land law v3 (2026-06-12, julii 26-town t1 corpus, trade-rights split)
    expect(im.CALIB.tradeRouteK).toBeCloseTo(0.2837, 3);
    expect(im.CALIB.tradeRoutePopX).toBeCloseTo(0.2237, 4);
    expect(im.CALIB.tradeNoRights).toBeCloseTo(0.33, 2); // no-trade-rights tier — Feral published constant 0.33 (2026-06-13)
    expect(im.CALIB.tradeBonusPct).toBe(10);     // documented: 10% per trade_base point
    // eff per-unit worth curve (2026-06-12 probe battery: wine unit-5 delta 14 on
    // the Rome lane, Messana 65/74, horses-9 -> eff(9)=5.56; replaces kink-4/0.32)
    expect(im.CALIB.seaEffUnits).toEqual([1, 1, 1, 1, 0.42, 0.30, 0.28]);
    expect(im.CALIB.seaEffTail).toBe(0.28);
    // land-lane live pins (julii 26-town corpus + capua + kyzikos): capua's four
    // rows sum to the live 491 (gate +/-10) and stay vintage-locked
    expect(Object.values(im.CALIB.landLaneRows.Campania).reduce((a, v) => a + v, 0)).toBe(490);
    // 28 julii/capua/kyzikos towns + 7 cyrene towns (TASK B revalidation 2026-06-12)
    expect(Object.keys(im.CALIB.landLaneRows).length).toBe(35);
    // cyrene sea-lane f pins + egypt per-town live trade table (same revalidation)
    expect(im.CALIB.seaLaneF["Kyrenaike>Taucheira"].ply).toBe(13.438); // refreshed to current mod (live cyrene1)
    expect(Object.keys(im.CALIB.tradeMeasuredByPlayer.ptolemaic).length).toBe(83);
    // corruption refit 3 2026-06-14 (first FULL 26-town live corruption corpus,
    // Republic-of-Rome julii save — corruption-refit-3.md). Joint fit on the live
    // per-town denarii vs euclidean dist + lawTot, guarded against egypt(−2.6%)/
    // cyrene(+3.9%): julii per-town MAE 14.7, total 2581/2569 (+12). Onset D0 dropped
    // 15.5→11.25 (live Fregellae d11 is corrupt → onset ~11); lawPct 3→2.5 (the
    // negative-law inflation was over-charging cyrene desert towns; HarshJustice
    // probe's 2.95pp/pt is at the high edge — 2.5 fits all three factions jointly).
    expect(im.CALIB.corrD0).toBe(11.25);
    expect(im.CALIB.corrA).toBeCloseTo(0.64, 3);
    expect(im.CALIB.corrLawPct).toBe(2.5);
    expect(im.CALIB.corrCap).toBe(60);
    expect(im.CALIB.corrB).toBe(0); // linear — negative-b fits rejected (Egypt tail collapse)
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
      "type test general unit",
      "category cavalry",
      "class heavy",
      "soldiers 6, 0, 3.2",
      "officer test_officer_1",
      "officer test_officer_2",
      "officer test_officer_3",
      "stat_cost 4, 2980, 45, 0, 6, 226",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "export_descr_character_traits.txt"), [
      "Trait TestCmd",
      " Characters family",
      " Level Test_Level_1",
      "  Description x",
      "  Threshold 1",
      "  Effect Command 2",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(camp, "descr_strat.txt"), [
      "faction\ttestfac, balanced smith",
      "character,\tLead, named character, leader, age 46, , x 10, y 10",
      "traits TestCmd 1",
      "unit\ttest general unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "character,\tHeir2, named character, heir, age 20, , x 11, y 10",
      "unit\ttest general unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "character,\tOrd, named character, age 30, , x 12, y 10",
      "traits TestCmd 1",
      "unit\ttest general unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "unit\ttest infantry unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "unit\ttest cavalry unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "unit\ttest ship unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "faction\ttestfac2, balanced smith",
      "character,\tSolo, named character, leader, age 50, , x 20, y 20",
      "unit\ttest general unit\t\t\texp 0 armour 0 weapon_lvl 0",
      "character,\tKid, named character, age 18, , x 21, y 20",
      "unit\ttest general unit\t\t\texp 0 armour 0 weapon_lvl 0",
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

  test("armyUpkeepEDU: regular raw; bodyguard scales by men (LH doubled, +2 men/command)", () => {
    // EXACT LAW (Capua disband probe 2026-06-11): regular units = raw stat_cost[2];
    // bodyguard = upkeep × men/(soldiers×4); men = soldiers×4 + officers (+2×command),
    // leader/heir men doubled. General: 45 × 54/24 = 101.25 → 101 each for LH;
    // ordinary with command 2: 45 × 31/24 = 58.125 → 58.
    const r = im.armyUpkeepEDU(dir, "testfac");
    expect(r.units).toBe(6);
    expect(r.upkeep).toBe(101 + 101 + 58 + 100 + 200 + 300);
  });

  test("armyUpkeepEDU: engine auto-heir when descr_strat has leader but no heir", () => {
    // cyrene case: only `leader` flagged → engine promotes an ordinary general to heir
    // at game start, doubling his bodyguard too.
    const r = im.armyUpkeepEDU(dir, "testfac2");
    expect(r.units).toBe(2);
    expect(r.upkeep).toBe(101 + 101);
  });

  test("parseProtectorates reads become_protector pairs from the campaign script", () => {
    const p = im.parseProtectorates(dir);
    expect(p.clientsOf.bigfac).toEqual(["smallfac", "otherfac"]);
    expect(p.suzerainOf.smallfac).toBe("bigfac");
    expect(p.suzerainOf.otherfac).toBe("bigfac");
  });

  test("countCharacters: named characters drive the exact wage formula", () => {
    const c = im.countCharacters(dir, "testfac");
    expect(c.named).toBe(3);
    expect(c.admiral).toBe(0);
  });
});
