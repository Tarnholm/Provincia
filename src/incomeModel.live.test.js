// Live-ledger regression guard (2026-06-11): pins the income model against the two
// CURRENT-vintage in-game ledgers it was validated on. Skips when the user's saves
// are absent (fixture-gated like the other save-backed suites).
import { describe, it, expect } from "vitest";
import fs from "fs";

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const CYR_CALIB = `${SAVES}/save_cyrene calibration.sav`;
const have = fs.existsSync(CYR_CALIB) && fs.existsSync(`${MOD}/export_descr_buildings.txt`);
const d = have ? describe : describe.skip;

d("income model — live Cyrene ledger regression (cracked laws guard)", () => {
  // live financial overview at the user's brackets (read in-game 2026-06-11):
  const LIVE = { taxes: 4487, farming: 4563, admin: 538, corruption: 961, army: 8430 };
  const BR = { "Arsinoe-Kyrenaike": "high", Automala: "low", Euesperides: "low", Kyrene: "very_high", Paraitonion: "normal", "Ptolemais-Kyrenaike": "very_high", Tetrapyrgia: "normal" };
  let totals = null;
  it("computes the budget from the calibration save", { timeout: 60000 }, async () => {
    const { crackSave } = await import("./saveCracker.js");
    const te = await import("./traitEffects.js");
    const im = await import("./incomeModel.js");
    const cr = crackSave(fs.readFileSync(CYR_CALIB), MOD);
    const gov = te.govEffectByCityFromSave(cr, te.parseTraitEffects(MOD), MOD);
    const B = im.computeTurn1Budget(MOD, "cyrene", BR, { govEffectByCity: gov });
    expect(B.error).toBeFalsy();
    totals = B.totals;
  });
  it("taxes within 5% of the live ledger (flat-points law)", () => {
    expect(Math.abs(totals.taxes - LIVE.taxes) / LIVE.taxes).toBeLessThan(0.05);
  });
  it("farming exact (±1%)", () => {
    expect(Math.abs(totals.farming - LIVE.farming) / LIVE.farming).toBeLessThan(0.01);
  });
  it("admin within 10% (joint-refit governor formula)", () => {
    expect(Math.abs(totals.admin - LIVE.admin) / LIVE.admin).toBeLessThan(0.10);
  });
  it("corruption within 15% (distance-quadratic law)", () => {
    expect(Math.abs(totals.corruption - LIVE.corruption) / LIVE.corruption).toBeLessThan(0.15);
  });
  it("army upkeep within 3% (calibrated EDU)", () => {
    expect(Math.abs(totals.armyUpkeep - LIVE.army) / LIVE.army).toBeLessThan(0.03);
  });
});
