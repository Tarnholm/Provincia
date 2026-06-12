// Calibration-save attach path guard (2026-06-12): the Turn-1 budget panel showed
// "computed from the mod files alone (no save)" with a save attached — TWICE
// (v1085 stale-closure, v1095 saveAware flag wired to the deliberately-disabled
// growth-dev usage). This suite pins the whole save→opts→budget chain so the
// next regression fails a test instead of a live session. Fixture-gated on the
// user's real capua calibration save, like the other live guards.
import { describe, it, expect } from "vitest";
import fs from "fs";

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const CALIB = `${SAVES}/save_capuacalibrate.sav`;
const have = fs.existsSync(CALIB) && fs.existsSync(`${MOD}/export_descr_buildings.txt`);
const d = have ? describe : describe.skip;

d("calibration-save opts — turn-1 budget save-attach path (capua)", () => {
  let cs = null;
  it("cracks the save and reports saveApplied", { timeout: 60000 }, async () => {
    const { buildCalibSaveOpts } = await import("./calibSaveOpts.js");
    cs = buildCalibSaveOpts(MOD, CALIB);
    expect(cs.saveError).toBeFalsy();
    expect(cs.saveApplied).toBe(true); // this is what budget.saveAware / the header must reflect
    expect(cs.opts).toBeTruthy();
  });
  it("carries the save's committed pops (world-wide) incl. Capua 6750", () => {
    expect(cs.counts.pops).toBeGreaterThan(1000);
    expect(cs.opts.popByCity.Capua).toBe(6750);
  });
  it("carries the save's rolled governor traits (Capua governor TaxCollection +10)", () => {
    expect(cs.counts.governors).toBeGreaterThan(500);
    const g = cs.opts.govEffectByCity.Capua;
    expect(g).toBeTruthy();
    expect(g.tax).toBe(10);          // STRating L1 → Effect TaxCollection 10 (rolled at campaign start)
    expect(g.influenceStat).toBe(2); // signed card stats decoded from the save frame
  });
  it("carries exact PO anchors (Capua stored PO 210 @normal)", () => {
    expect(cs.counts.poAnchors).toBeGreaterThan(1000);
    expect(cs.poAnchorByCity.Capua).toEqual({ po: 210, bracket: "normal" });
  });
  it("save governor traits move the capua taxes vs the no-save model (×1.1 gov factor)", { timeout: 60000 }, async () => {
    const im = await import("./incomeModel.js");
    // very_high = capua's optimal bracket in the panel; pin the law's response
    const BR = { Capua: "very_high" };
    const noSave = im.computeTurn1Budget(MOD, "capua", BR, {});
    const withSave = im.computeTurn1Budget(MOD, "capua", BR, { ...cs.opts });
    expect(noSave.error).toBeFalsy();
    expect(withSave.error).toBeFalsy();
    // descr_strat seeds carry no Capua governor income traits; the save's rolled
    // governor (TaxCollection +10) must lift taxes by the gov factor exactly.
    expect(withSave.totals.taxes).toBeGreaterThan(noSave.totals.taxes);
    expect(withSave.totals.taxes / noSave.totals.taxes).toBeCloseTo(1.10, 2);
  });
  it("reports saveApplied=false + saveError for a missing save (header must say no-save, with a warning)", async () => {
    const { buildCalibSaveOpts } = await import("./calibSaveOpts.js");
    const bad = buildCalibSaveOpts(MOD, `${SAVES}/save_does_not_exist_${Date.now()}.sav`);
    expect(bad.saveApplied).toBe(false);
    expect(bad.opts).toBeFalsy();
    expect(bad.saveError).toMatch(/not found/);
  });
  it("returns inert defaults when no save path is supplied", async () => {
    const { buildCalibSaveOpts } = await import("./calibSaveOpts.js");
    const none = buildCalibSaveOpts(MOD, "");
    expect(none.saveApplied).toBe(false);
    expect(none.saveError).toBeFalsy();
    expect(none.opts).toBeFalsy();
  });
});
