import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { crackSave } = require("./saveCracker.js");
const {
  parseFinancialOverview,
  parseFactionEconomy,
  sumSettlementIncome,
  estimateTaxIncome,
  deriveMiningIncome,
  netFromHistory,
  emptyFactionEconomy,
  decodeFinancialBlock,
  DEFAULT_TAX_COEFFICIENT,
  INCOME_SLOTS,
  EXPENDITURE_SLOTS,
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
    // The DERIVED tax/mining estimates start null and are always flagged estimated.
    expect(e.incomeEstimate.tax).toBeNull();
    expect(e.incomeEstimate.mining).toBeNull();
    expect(e.incomeEstimate.estimated).toBe(true);
    expect(e.incomeEstimate.taxCoefficient).toBeNull();
    expect(e.incomeEstimate.citiesWithMine).toBe(0);
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

  test("deriveMiningIncome: player base mine = 0; export industries add EDB bonus", () => {
    const owner = {
      Rome: "romans_julii",       // no mine buildings
      Cosa: "romans_julii",       // basic mines only → 0 for player
      Hispania: "romans_julii",   // mines+1 + iron + lead export industries
      Athens: "athens",           // other faction's city, must be excluded
    };
    const settlements = [
      { name: "Rome", buildings: [{ name: "market", level: 3 }] },
      { name: "Cosa", buildings: [{ name: "mines", level: 0 }] }, // base only → 0
      { name: "Hispania", buildings: [
        { name: "mines", level: 1 },          // base cancelled → 0
        { name: "iron_industry", level: 0 },  // +2
        { name: "lead_industry", level: 0 },  // +2
      ] },
      { name: "Athens", buildings: [{ name: "mines", level: 1 }, { name: "tin_industry", level: 0 }] },
    ];
    const j = deriveMiningIncome("romans_julii", owner, settlements);
    // Only Hispania's export industries contribute: 2 + 2 = 4. Cosa's basic mine = 0.
    expect(j.mining).toBe(4);
    expect(j.citiesWithMine).toBe(2); // Cosa (basic) + Hispania (mines+1)
    expect(j.contributingCities).toEqual([{ city: "Hispania", mining: 4 }]);

    // A faction with cities but NO mine/metal buildings → 0 (real, not unknown).
    const noMine = deriveMiningIncome("romans_julii",
      { Rome: "romans_julii" }, [{ name: "Rome", buildings: [{ name: "market", level: 1 }] }]);
    expect(noMine.mining).toBe(0);
    expect(noMine.citiesWithMine).toBe(0);

    // No settlement data at all → null (unknown, never fabricated 0).
    expect(deriveMiningIncome("romans_julii", owner, null).mining).toBeNull();
    expect(deriveMiningIncome("romans_julii", owner, undefined).mining).toBeNull();
    // A faction not owning any of the supplied cities → null (no data seen).
    expect(deriveMiningIncome("gauls", owner, settlements).mining).toBeNull();
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

  test("decodeFinancialBlock maps slots → categories and sums the totals", () => {
    // Synthetic block mirroring the Julii crib: farming 18105 (f0), taxes 8928
    // (f1), mining 0 (f2), trade 4426 (f3), income-other 2026 (f9); wages 6350
    // (f11), army_upkeep 26594 (f12), exp-other 2242 (f22). All other slots 0.
    const block = new Array(23).fill(0);
    block[INCOME_SLOTS.farming] = 18105;
    block[INCOME_SLOTS.taxes] = 8928;
    block[INCOME_SLOTS.mining] = 0;
    block[INCOME_SLOTS.trade] = 4426;
    block[INCOME_SLOTS.other] = 2026;
    block[EXPENDITURE_SLOTS.wages] = 6350;
    block[EXPENDITURE_SLOTS.army_upkeep] = 26594;
    block[EXPENDITURE_SLOTS.other] = 2242;

    const d = decodeFinancialBlock(block);
    expect(d.income.farming).toBe(18105);
    expect(d.income.taxes).toBe(8928);
    expect(d.income.tax).toBe(8928); // back-compat alias
    expect(d.income.mining).toBe(0); // genuine stored 0
    expect(d.income.trade).toBe(4426);
    expect(d.income.other).toBe(2026);
    expect(d.income.merchants).toBe(0); // 0 only because totals are fully accounted
    expect(d.income.total).toBe(33485);

    expect(d.expenditure.wages).toBe(6350);
    expect(d.expenditure.army_upkeep).toBe(26594);
    expect(d.expenditure.upkeep).toBe(26594); // alias
    expect(d.expenditure.other).toBe(2242);
    expect(d.expenditure.recruitment).toBe(0);
    expect(d.expenditure.construction).toBe(0);
    expect(d.expenditure.total).toBe(35186);

    expect(d.net).toBe(-1701);
    expect(d.unattributed).toBeNull();

    // An all-zero block carries no economy → null (not a fabricated 0-breakdown).
    expect(decodeFinancialBlock(new Array(23).fill(0))).toBeNull();

    // A nonzero slot OUTSIDE the pinned set is still counted in the total AND
    // surfaced as unattributed (money never silently dropped; label never faked).
    const odd = new Array(23).fill(0);
    odd[INCOME_SLOTS.farming] = 1000;
    odd[5] = 250; // an unlabelled income slot
    odd[EXPENDITURE_SLOTS.wages] = 100;
    const od = decodeFinancialBlock(odd);
    expect(od.income.total).toBe(1250);          // includes the unattributed 250
    expect(od.income.merchants).toBeNull();      // cannot honestly label → null
    expect(od.unattributed).toEqual([{ slot: 5, side: "income", value: 250 }]);
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

// In-game Financial Overview cribs for save_Juliieco1.sav (faction romans_julii),
// read from the user's screenshots (tmp/econ-cribs.txt). The breakthrough is that
// these ARE stored in the save's econ-history block; the parser must reproduce
// them to the denarius.
const CRIB = {
  income: { farming: 18105, mining: 0, trade: 4426, merchants: 0, taxes: 8928, other: 2026, total: 33485 },
  expenditure: { wages: 6350, army_upkeep: 26594, recruitment: 0, construction: 0, total: 35186 },
  net: -1701,
};

describe("economyParser — Julii Financial Overview save (STORED breakdown)", () => {
  test("reproduces the in-game Financial Overview cribs to the denarius", () => {
    if (!fs.existsSync(ECO_SAVE) || !fs.existsSync(MOD)) {
      console.warn(`[test-skip] economyParser integration: missing ${ECO_SAVE} or mod data`);
      return;
    }
    const buf = fs.readFileSync(ECO_SAVE);
    const cracked = crackSave(buf, MOD);
    if (cracked.playerFaction !== "romans_julii") {
      console.warn(`[test-skip] economyParser: save not Julii (player=${cracked.playerFaction})`);
      return;
    }

    // parseFinancialOverview is the breakthrough entry point (alias of
    // parseFactionEconomy with the stored breakdown as the primary source).
    const out = parseFinancialOverview(buf, cracked);
    expect(out.playerFaction).toBe("romans_julii");
    expect(out.byFaction).toBeTruthy();
    expect(out._meta.factionsWithBreakdown).toBeGreaterThan(100); // most factions

    const j = out.byFaction.romans_julii;
    expect(j).toBeTruthy();

    // ── INCOME breakdown — STORED, matches the cribs EXACTLY ─────────────────
    expect(j.income.farming).toBe(CRIB.income.farming);   // 18105
    expect(j.income.taxes).toBe(CRIB.income.taxes);       // 8928
    expect(j.income.tax).toBe(CRIB.income.taxes);         // back-compat alias
    expect(j.income.mining).toBe(CRIB.income.mining);     // 0 (genuine stored zero)
    expect(j.income.trade).toBe(CRIB.income.trade);       // 4426
    expect(j.income.other).toBe(CRIB.income.other);       // 2026
    expect(j.income.merchants).toBe(CRIB.income.merchants); // 0 (fully accounted)
    expect(j.income.total).toBe(CRIB.income.total);       // 33485
    // The pinned income categories sum to the engine total (no fabricated split).
    expect(j.income.farming + j.income.taxes + j.income.mining + j.income.trade + j.income.other)
      .toBe(j.income.total);

    // ── EXPENDITURE breakdown — STORED, matches the cribs EXACTLY ────────────
    expect(j.expenditure.wages).toBe(CRIB.expenditure.wages);             // 6350
    expect(j.expenditure.army_upkeep).toBe(CRIB.expenditure.army_upkeep); // 26594
    expect(j.expenditure.upkeep).toBe(CRIB.expenditure.army_upkeep);      // alias
    expect(j.expenditure.recruitment).toBe(CRIB.expenditure.recruitment); // 0
    expect(j.expenditure.construction).toBe(CRIB.expenditure.construction); // 0
    expect(typeof j.expenditure.other).toBe("number");                    // 2242
    expect(j.expenditure.total).toBe(CRIB.expenditure.total);             // 35186
    expect(j.expenditure.wages + j.expenditure.army_upkeep + j.expenditure.other)
      .toBe(j.expenditure.total);

    // ── NET — STORED (income.total - expenditure.total) ──────────────────────
    expect(j.net).toBe(CRIB.net); // -1701
    expect(j.income.total - j.expenditure.total).toBe(CRIB.net);

    // ── Treasury & estimated next-turn ───────────────────────────────────────
    expect(typeof j.treasury).toBe("number");
    expect(j.treasury).toBeGreaterThan(0);
    expect(j.estimatedNextTurn).toBe(j.treasury + j.net);

    // ── No money is silently dropped ─────────────────────────────────────────
    expect(j._unattributed).toBeNull();

    // ── Confidence flags reflect the stored breakdown ────────────────────────
    expect(j._confidence.incomeTotal).toBe("confirmed");
    expect(j._confidence.incomeBreakdown).toBe("stored");
    expect(j._confidence.expenditure).toBe("stored");
    expect(j._confidence.net).toBe("stored");
    expect(j._confidence.treasury).toBe("confirmed");

    // ── Cross-faction sanity: every faction with a breakdown is internally
    //    consistent (each pinned income/exp slot ≥0; net = inc-exp) ───────────
    let checked = 0;
    for (const eco of Object.values(out.byFaction)) {
      if (eco._confidence.incomeBreakdown !== "stored") continue;
      checked++;
      expect(eco.income.total).toBeGreaterThanOrEqual(0);
      expect(eco.expenditure.total).toBeGreaterThanOrEqual(0);
      expect(eco.net).toBe(eco.income.total - eco.expenditure.total);
      for (const k of ["farming", "taxes", "mining", "trade", "other"]) {
        expect(eco.income[k]).toBeGreaterThanOrEqual(0);
      }
      for (const k of ["wages", "army_upkeep", "other"]) {
        expect(eco.expenditure[k]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(checked).toBeGreaterThan(100);

    console.log(
      `[economyParser] Julii STORED: farming=${j.income.farming} taxes=${j.income.taxes} ` +
      `trade=${j.income.trade} mining=${j.income.mining} incOther=${j.income.other} ` +
      `incTotal=${j.income.total} | wages=${j.expenditure.wages} upkeep=${j.expenditure.army_upkeep} ` +
      `expOther=${j.expenditure.other} expTotal=${j.expenditure.total} net=${j.net} ` +
      `treasury=${j.treasury} estNext=${j.estimatedNextTurn} | ${checked} factions consistent`
    );
  }, 30000); // crackSave on a 34 MB save
});
