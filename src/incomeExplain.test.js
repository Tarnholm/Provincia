// Income explainer assembly tests (2026-07-17). The incomeModel fixture mod
// (incomeModel.test.js) has no export_descr_buildings.txt, so
// computeIncomeFeatures cannot run against it — per spec these tests exercise
// the pure row→payload assembly (assembleExplainPayload, exported from
// src/incomeExplainHandlers.js) with a synthetic computeIncomeFeatures-shaped
// object, plus the IPC registration/arg-guard path with a fake ipcMain.
import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { registerIncomeExplainHandlers, assembleExplainPayload } = require("./incomeExplainHandlers.js");
const { CALIB } = require("./incomeModel.js");

// Synthetic computeIncomeFeatures(…, { explain: true }) result — shape mirrors
// incomeModel.js L207-215: taxableLines is the MIXED explain array (taxable
// entries {chain,val,req} + trade entries {kind:"trade",chain,val,req}).
const FEATURES = {
  faction: "testfac",
  isPlayer: true,
  tier: 2,
  nSettlements: 2,
  settlements: [
    {
      region: "Latium", settlement: "Roma", pop: 6000, level: "large_town", capital: true,
      taxablePct: 25, tradePct: 30, mineSum: 3, farmLevel: 2, farmN: 5,
      taxableLines: [
        { chain: "government:governors_villa", val: 10, req: "" },
        { chain: "hinterland_region:fertile", val: 15, req: "resource fertile and not building_present_min_level farms farms+1" },
        { kind: "trade", chain: "market:market", val: 20, req: "" },
        { kind: "trade", chain: "port_buildings:port", val: 10, req: "factionwide" },
      ],
      resources: [
        { name: "grain", tradeValue: 2, mineable: false },
        { name: "iron", tradeValue: 3, mineable: true },
      ],
    },
    {
      region: "Etruria", settlement: "Arretium", pop: 2000, level: "town", capital: false,
      taxablePct: 0, tradePct: 0, mineSum: 0, farmLevel: 0, farmN: 3,
      taxableLines: [],
      resources: [],
    },
  ],
};

const PROSPECTS = {
  Latium: { settlement: "Roma", owner: "testfac", qtyVal: 9, minerals: ["iron"], currentIncome: 135, levels: [] },
};

describe("assembleExplainPayload", () => {
  test("splits the mixed explain array into tax vs trade lines and keeps totals", () => {
    const p = assembleExplainPayload(FEATURES, PROSPECTS, "Latium", "testfac");
    expect(p.error).toBeUndefined();
    expect(p.settlement).toBe("Roma");
    expect(p.region).toBe("Latium");
    expect(p.faction).toBe("testfac");
    expect(p.tax.taxablePct).toBe(25);
    expect(p.tax.lines).toHaveLength(2);
    expect(p.tax.lines.map((l) => l.chain)).toEqual(["government:governors_villa", "hinterland_region:fertile"]);
    // req strings survive (the UI dims/truncates them)
    expect(p.tax.lines[1].req).toMatch(/resource fertile/);
    expect(p.trade.tradePct).toBe(30);
    expect(p.trade.lines).toHaveLength(2);
    expect(p.trade.lines.every((l) => l.kind === undefined)).toBe(true);
    expect(p.trade.lines.map((l) => l.val)).toEqual([20, 10]);
    expect(p.resources).toHaveLength(2);
  });

  test("farming income = CALIB.farmPoint × (farmN + farmLevel), rounded", () => {
    const p = assembleExplainPayload(FEATURES, PROSPECTS, "Latium", "testfac");
    expect(p.farming.farmN).toBe(5);
    expect(p.farming.farmLevel).toBe(2);
    expect(p.farming.income).toBe(Math.round(CALIB.farmPoint * 7)); // 73.6/pt on Hard → 515
  });

  test("mining uses the mineProspects real number when present", () => {
    const p = assembleExplainPayload(FEATURES, PROSPECTS, "Latium", "testfac");
    expect(p.mining.mineSum).toBe(3);
    expect(p.mining.qtyVal).toBe(9);
    expect(p.mining.income).toBe(135); // prospects.currentIncome passthrough
  });

  test("no mine prospect → qtyVal 0 and zero income (honest fallback)", () => {
    const p = assembleExplainPayload(FEATURES, {}, "Etruria", "testfac");
    expect(p.error).toBeUndefined();
    expect(p.mining).toEqual({ mineSum: 0, qtyVal: 0, income: 0 });
    expect(p.tax.lines).toEqual([]);
    expect(p.trade.lines).toEqual([]);
  });

  test("region match is case-insensitive with settlement-name fallback", () => {
    expect(assembleExplainPayload(FEATURES, {}, "latium", "testfac").settlement).toBe("Roma");
    expect(assembleExplainPayload(FEATURES, {}, "roma", "testfac").settlement).toBe("Roma");
  });

  test("error paths: model error, unknown region", () => {
    expect(assembleExplainPayload({ error: "descr_strat or EDB not found" }, {}, "Latium", "x").error)
      .toBe("descr_strat or EDB not found");
    expect(assembleExplainPayload(null, {}, "Latium", "x").error).toBeTruthy();
    expect(assembleExplainPayload(FEATURES, {}, "Gaul", "testfac").error).toMatch(/Gaul/);
  });
});

describe("registerIncomeExplainHandlers", () => {
  test("registers explain-settlement-income and guards missing args", async () => {
    const handlers = {};
    const fakeIpc = { handle: (name, fn) => { handlers[name] = fn; } };
    registerIncomeExplainHandlers(fakeIpc);
    expect(typeof handlers["explain-settlement-income"]).toBe("function");
    const r = await handlers["explain-settlement-income"](null, null, "julii", "Latium");
    expect(r.error).toMatch(/required/);
    const r2 = await handlers["explain-settlement-income"](null, "C:\\mods\\x", "", "Latium");
    expect(r2.error).toMatch(/required/);
  });
});
