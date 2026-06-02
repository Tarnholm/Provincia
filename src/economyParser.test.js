import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { crackSave } = require("./saveCracker.js");
const {
  parseFactionEconomy,
  sumSettlementIncome,
  estimateTaxIncome,
  netFromHistory,
  emptyFactionEconomy,
  DEFAULT_TAX_COEFFICIENT,
} = require("./economyParser.js");

// ── Pure-function tests (no save file required) ──────────────────────────────
describe("economyParser — pure functions", () => {
  test("emptyFactionEconomy is all-null (no fabricated defaults)", () => {
    const e = emptyFactionEconomy();
    for (const k of ["trade", "mining", "farming", "tax", "other", "total"]) {
      expect(e.income[k]).toBeNull();
    }
    for (const k of ["upkeep", "construction", "recruitment", "other", "total"]) {
      expect(e.expenditure[k]).toBeNull();
    }
    expect(e.net).toBeNull();
    expect(e.treasury).toBeNull();
    expect(e.estimatedNextTurn).toBeNull();
    // The DERIVED tax estimate starts null and is always flagged estimated.
    expect(e.incomeEstimate.tax).toBeNull();
    expect(e.incomeEstimate.estimated).toBe(true);
    expect(e.incomeEstimate.taxCoefficient).toBeNull();
  });

  test("estimateTaxIncome = Σ population × coefficient; null when no population", () => {
    const owner = { Rome: "romans_julii", Arretium: "romans_julii", Carthage: "carthage" };
    const fields = {
      Rome: { committedPopulation: 9000 },
      Arretium: { committedPopulation: 4500 },
      Carthage: { committedPopulation: 12000 },
    };
    // Rome 924 = 9000 × 0.10264; Arretium 462 = 4500 × 0.10264 → 1386 rounded.
    const j = estimateTaxIncome("romans_julii", owner, fields, DEFAULT_TAX_COEFFICIENT);
    expect(j.citiesWithPopulation).toBe(2);
    expect(j.tax).toBe(Math.round((9000 + 4500) * DEFAULT_TAX_COEFFICIENT)); // 1386
    expect(j.coefficient).toBe(DEFAULT_TAX_COEFFICIENT);
    // A faction with no resolvable population → tax null, NOT 0.
    const none = estimateTaxIncome("gauls", owner, fields, DEFAULT_TAX_COEFFICIENT);
    expect(none.tax).toBeNull();
    expect(none.citiesWithPopulation).toBe(0);
    // The single-Rome estimate reproduces the in-game Rome income to the denarius.
    const rome = estimateTaxIncome("romans_julii", { Rome: "romans_julii" },
      { Rome: { committedPopulation: 9000 } }, DEFAULT_TAX_COEFFICIENT);
    expect(rome.tax).toBe(924);
  });

  test("sumSettlementIncome sums only the faction's cities; null when none", () => {
    const owner = { Rome: "romans_julii", Capua: "romans_julii", Carthage: "carthage" };
    const fields = {
      Rome: { income: 924 },
      Capua: { income: 100 },
      Carthage: { income: 500 },
    };
    const j = sumSettlementIncome("romans_julii", owner, fields);
    expect(j.total).toBe(1024);
    expect(j.citiesWithIncome).toBe(2);
    // A faction with no resolvable income → total null, NOT 0.
    const none = sumSettlementIncome("gauls", owner, fields);
    expect(none.total).toBeNull();
  });

  test("netFromHistory uses last-two delta; null for <2 or all-zero (player) series", () => {
    expect(netFromHistory([100, 250])).toBe(150);
    expect(netFromHistory([10, 20, 35])).toBe(15);
    expect(netFromHistory([5485])).toBeNull();      // < 2 checkpoints
    expect(netFromHistory([])).toBeNull();
    expect(netFromHistory([0, 0])).toBeNull();       // player's all-zero series
    expect(netFromHistory(null)).toBeNull();
  });

  test("estimatedNextTurn = treasury + net only when net is known", () => {
    const ctx = {
      ownerByCity: { Rome: "romans_julii" },
      settlementFields: { Rome: { income: 924 } },
      factions: { romans_julii: { treasury: 22500 } },
      treasuryHistory: { romans_julii: [21000, 22000] }, // synthetic net=1000
      playerFaction: "romans_julii",
      turn: 3,
    };
    const out = parseFactionEconomy(null, ctx);
    const j = out.byFaction.romans_julii;
    expect(j.income.total).toBe(924);
    expect(j.treasury).toBe(22500);
    expect(j.net).toBe(1000);
    expect(j.estimatedNextTurn).toBe(23500);
    // breakdown stays null — not stored in the save.
    expect(j.income.trade).toBeNull();
    expect(j.expenditure.upkeep).toBeNull();
  });

  test("no net → net/estimatedNextTurn null (never fabricated)", () => {
    const ctx = {
      ownerByCity: { Rome: "romans_julii" },
      settlementFields: { Rome: { income: 924 } },
      factions: { romans_julii: { treasury: 22500 } },
      playerFaction: "romans_julii",
      turn: 1,
    };
    const j = parseFactionEconomy(null, ctx).byFaction.romans_julii;
    expect(j.income.total).toBe(924);
    expect(j.treasury).toBe(22500);
    expect(j.net).toBeNull();
    expect(j.estimatedNextTurn).toBeNull();
  });
});

// ── Integration test against the user's exact test save (machine-local) ──────
// PRIMARY save the user is viewing in-game: save_Juliieco1.sav (player romans_julii).
// Skips (visibly) when the local save / mod data aren't on this machine, matching
// the pattern the other parser tests use.
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const ECO_SAVE = path.join(SAVES_DIR, "save_Juliieco1.sav");
const MOD = "C:\\RIS\\RIS\\data";

describe("economyParser — Julii Financial Overview save", () => {
  test("derives an internally-consistent Julii economy object", () => {
    if (!fs.existsSync(ECO_SAVE) || !fs.existsSync(MOD)) {
      console.warn(`[test-skip] economyParser integration: missing ${ECO_SAVE} or mod data`);
      return;
    }
    const buf = fs.readFileSync(ECO_SAVE);
    const cracked = crackSave(buf, MOD);
    // PRECONDITION: the save must still be the Julii economy save (it is a live
    // file the user may re-save). Skip visibly if it has drifted.
    if (cracked.playerFaction !== "romans_julii") {
      console.warn(`[test-skip] economyParser: save not Julii (player=${cracked.playerFaction})`);
      return;
    }

    const out = parseFactionEconomy(buf, cracked);
    expect(out.playerFaction).toBe("romans_julii");
    expect(out.byFaction).toBeTruthy();

    const j = out.byFaction.romans_julii;
    expect(j).toBeTruthy();

    // ── SHAPE ──────────────────────────────────────────────────────────────
    expect(j.income).toBeTruthy();
    expect(j.expenditure).toBeTruthy();
    expect("trade" in j.income).toBe(true);
    expect("upkeep" in j.expenditure).toBe(true);

    // ── CONFIRMED fields ─────────────────────────────────────────────────────
    // Gross income total = Σ settlement income. CONFIRMED julii sum = 6347 in
    // this exact save (matches econ-history f11 6350; Rome alone = 924).
    expect(typeof j.income.total).toBe("number");
    expect(j.income.total).toBeGreaterThan(0);
    // Internal consistency: the parser's total must equal an independent re-sum
    // of the player's settlement income from the cracked output.
    let reSum = 0, n = 0;
    for (const [city, owner] of Object.entries(cracked.ownerByCity)) {
      if (owner !== "romans_julii") continue;
      const inc = cracked.settlementFields[city] && cracked.settlementFields[city].income;
      if (typeof inc === "number") { reSum += inc; n++; }
    }
    expect(j.income.total).toBe(reSum);
    expect(n).toBeGreaterThan(10); // Julii hold ~25 cities

    // Treasury = record +0 (start-of-turn balance), a finite positive int here.
    expect(typeof j.treasury).toBe("number");
    expect(Number.isFinite(j.treasury)).toBe(true);
    expect(j.treasury).toBeGreaterThan(0);

    // ── NULL-by-design fields ([[provincia-no-fallbacks]]) ───────────────────
    // Category breakdown is NOT stored — must be null, never a fabricated split.
    for (const k of ["trade", "mining", "farming", "tax", "other"]) {
      expect(j.income[k]).toBeNull();
    }
    // Expenditure has no save ledger — all null.
    for (const k of ["upkeep", "construction", "recruitment", "other", "total"]) {
      expect(j.expenditure[k]).toBeNull();
    }
    // Net is unavailable for the player faction (all-zero f13 series) and at
    // turn 1 (no history). It must be null, and estimatedNextTurn with it.
    expect(j.net).toBeNull();
    expect(j.estimatedNextTurn).toBeNull();

    // The category breakdown must NOT silently sum to the total (i.e. nobody
    // fabricated a split). With all components null, this holds trivially, but
    // assert it explicitly as a guard against a future regression.
    const parts = [j.income.trade, j.income.mining, j.income.farming, j.income.tax]
      .filter((v) => typeof v === "number");
    expect(parts.length).toBe(0);

    // ── DERIVED tax estimate (flagged; NOT the stored split) ─────────────────
    // On this turn-1 save the per-settlement income is ≈ pop × 0.10264, so the
    // pop-based tax estimate should land within ~1% of the gross total (trade/
    // farming are still tiny). It is ALWAYS flagged estimated and lives in
    // incomeEstimate, never in the (null) stored income.tax.
    expect(j.incomeEstimate).toBeTruthy();
    expect(j.incomeEstimate.estimated).toBe(true);
    expect(typeof j.incomeEstimate.tax).toBe("number");
    expect(j.incomeEstimate.tax).toBeGreaterThan(0);
    expect(j.incomeEstimate.citiesWithPopulation).toBeGreaterThan(10);
    expect(j.incomeEstimate.taxCoefficient).toBe(DEFAULT_TAX_COEFFICIENT);
    // Within 1% of the confirmed gross on this early-turn save.
    const rel = Math.abs(j.incomeEstimate.tax - j.income.total) / j.income.total;
    expect(rel).toBeLessThan(0.01);
    // The stored category tax stays null — the estimate must NOT have leaked in.
    expect(j.income.tax).toBeNull();

    // Confidence flags are honest about what was cracked.
    expect(j._confidence.incomeTotal).toBe("confirmed");
    expect(j._confidence.incomeBreakdown).toBe("not-stored");
    expect(j._confidence.expenditure).toBe("not-stored");
    expect(j._confidence.treasury).toBe("confirmed");

    console.log(
      `[economyParser] Julii: incomeTotal=${j.income.total} treasury=${j.treasury} ` +
      `net=${j.net} estNext=${j.estimatedNextTurn} cities=${n} ` +
      `taxEstimate=${j.incomeEstimate.tax} (rel=${(rel * 100).toFixed(2)}%)`
    );
  }, 30000); // crackSave on a 34 MB save
});
