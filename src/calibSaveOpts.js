// Calibration-save opts assembly for the turn-1 budget / strat-tax IPC handlers
// (extracted from main.js 2026-06-12 so the save-attach path is unit-testable —
// the "(no save)" header bug shipped twice because this path had no coverage).
//
// A CALIBRATION SAVE (a fresh turn-1 save) pins the campaign's start-randomized
// governor trait rolls (incl. the TaxCollection/Influence personality channels),
// the committed per-town populations, the marker−1528 growth dev values and the
// stored EXACT public-order values — for EVERY faction, from one save.
//
// Returns { opts, poAnchorByCity, growthDevByCity, saveApplied, saveError, counts }:
//   opts            — { govEffectByCity?, popByCity? } ready for computeTurn1Budget /
//                     computeStratTaxPlan, or null when the save contributed nothing.
//   poAnchorByCity  — { city: { po, bracket } } exact stored PO (live-verified
//                     2026-06-11: the save's publicOrder field IS the in-game %).
//   growthDevByCity — { city: { v1528, v1556 } } save-aware growth dev values.
//                     NOT used for turn-1 bracket planning (it reproduces THIS
//                     turn's growth tick incl. harvest/seasonal transients — live
//                     2026-06-11 falsification), but returned for callers that
//                     want the save-aware growth estimate.
//   saveApplied     — TRUE iff the save cracked and actually contributed data
//                     (gov effects and/or pops). This is what budget.saveAware
//                     must reflect — NOT the growth-dev usage flag, which has
//                     been deliberately false for bracket planning since the
//                     2026-06-11 decoupling (the old wiring made the budget
//                     header claim "(no save)" forever).
//   saveError       — message when the save was supplied but could not be used
//                     (missing file, crack failure, trait-read failure).
const fs = require("fs");

function buildCalibSaveOpts(modDataDir, savePath) {
  const out = {
    opts: null, poAnchorByCity: null, growthDevByCity: null,
    saveApplied: false, saveError: null,
    counts: { governors: 0, pops: 0, poAnchors: 0 },
  };
  if (!savePath) return out;
  try {
    if (!fs.existsSync(savePath)) throw new Error("calibration save not found: " + savePath);
    const { crackSave } = require("./saveCracker.js");
    const cr = crackSave(fs.readFileSync(savePath), modDataDir);
    const sf = (cr && cr.settlementFields) || {};
    // committed pops from the calibration save → the tax base tracks the actual
    // campaign state (turn-1 saves equal descr_strat; mid-campaign saves diverge).
    const popByCity = {};
    for (const c of Object.keys(sf)) { const pv = sf[c].committedPopulation; if (pv > 0) popByCity[c] = pv; }
    const growthDevByCity = {};
    for (const c of Object.keys(sf)) { const g = sf[c].growthDevValue; if (g != null) growthDevByCity[c] = { v1528: g, v1556: sf[c].growthDevValue2 }; }
    // PO anchor: project the stored exact PO to other brackets with the verified
    // tax-PO deltas (rel. to low: 0/−30/−50/−70).
    const TB = { 0: "low", 1: "normal", 2: "high", 3: "very_high" };
    let poAnchorByCity = {};
    for (const c of Object.keys(sf)) {
      const p = sf[c].publicOrder;
      if (typeof p === "number" && isFinite(p) && Math.abs(p) < 100000 && TB[sf[c].taxRate]) {
        poAnchorByCity[c] = { po: Math.round(p), bracket: TB[sf[c].taxRate] };
      }
    }
    if (!Object.keys(poAnchorByCity).length) poAnchorByCity = null;
    // governor trait effects (incl. follower/ancillary folds) per settlement
    let govEffectByCity = {};
    try {
      const te = require("./traitEffects.js");
      govEffectByCity = te.govEffectByCityFromSave(cr, te.parseTraitEffects(modDataDir), modDataDir) || {};
    } catch (e) { out.saveError = "governor-trait read failed: " + (e && e.message ? e.message : String(e)); }
    const opts = {};
    if (Object.keys(govEffectByCity).length) opts.govEffectByCity = govEffectByCity;
    if (Object.keys(popByCity).length) opts.popByCity = popByCity;
    out.opts = Object.keys(opts).length ? opts : null;
    out.poAnchorByCity = poAnchorByCity;
    out.growthDevByCity = Object.keys(growthDevByCity).length ? growthDevByCity : null;
    out.counts = {
      governors: Object.keys(govEffectByCity).length,
      pops: Object.keys(popByCity).length,
      poAnchors: poAnchorByCity ? Object.keys(poAnchorByCity).length : 0,
    };
    out.saveApplied = !!out.opts;
  } catch (e) {
    out.saveError = e && e.message ? e.message : String(e);
  }
  return out;
}

module.exports = { buildCalibSaveOpts };
