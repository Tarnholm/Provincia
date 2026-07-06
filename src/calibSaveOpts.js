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
    // SET BRACKET per town from the save (tax byte @ marker−2269, verified 26/26 vs
    // live): the budget should show each town at the rate the PLAYER SET in-game, not
    // the app's "optimal" guess — so save-attached taxes match the game's brackets.
    const setBracketByCity = {};
    for (const c of Object.keys(sf)) {
      const tr = sf[c].taxRate;
      if (TB[tr]) setBracketByCity[c] = TB[tr];
      const p = sf[c].publicOrder;
      if (typeof p === "number" && isFinite(p) && Math.abs(p) < 100000 && TB[tr]) {
        // Keep the save's FRACTIONAL public order (2026-07-06): RTW PO is fractional (Volaterrae
        // 134.5) — the graduated CULTURE penalty is a fraction of a pip (−0.5% = 0.1 pip). Rounding
        // the anchor dropped exactly that half-point. The unrounded stored PO IS the in-game % and
        // carries the exact culture/religion penalty already, so the anchor path needs no separate
        // culture term. Round only where a component-model consumer needs an integer.
        poAnchorByCity[c] = { po: p, bracket: TB[tr] };
      }
    }
    if (!Object.keys(poAnchorByCity).length) poAnchorByCity = null;
    out.setBracketByCity = Object.keys(setBracketByCity).length ? setBracketByCity : null;
    // EXACT per-settlement CULTURE penalty from the save (order-breakdown slot 12 = culture/religion
    // unrest, in pips → ×5 for the poModel's % unit). Graduated (Volaterrae 0.1→0.5%, a foreign town
    // →22%+), so the component PO gets the real value instead of the flat foreign estimate.
    const cultPenByCity = {};
    for (const c of Object.keys(sf)) {
      const ob = sf[c].orderBreakdown;
      if (Array.isArray(ob) && typeof ob[12] === "number" && isFinite(ob[12])) cultPenByCity[c] = ob[12] * 5;
    }
    // governor trait effects (incl. follower/ancillary folds) per settlement
    let govEffectByCity = {};
    try {
      const te = require("./traitEffects.js");
      const fx = te.parseTraitEffects(modDataDir);
      govEffectByCity = te.govEffectByCityFromSave(cr, fx, modDataDir) || {};
      // ESTATES SQUALOR CORRECTION (2026-07-06, A/B-confirmed on Rome + Volaterrae): the save
      // stores accumulated Estates POINTS (e.g. 26) that threshold-decode to Large_Estate
      // (Squalor +2), but a descr_strat-seeded governor sits at the SEEDED ORDINAL level
      // (descr_strat "Estates 2" = Medium_Estate = Squalor +1) and the engine keeps it there on
      // turn 1 (in-game trait card reads "Medium Estate +1 squalor"). Since Provincia is a
      // turn-1 planner and every governor is exactly as seeded, the descr_strat ordinal is
      // authoritative for the Estates land-holding squalor. Overlay it: correct the total
      // squalor by the Estates delta and pin squalorEstates to the seeded value (this fixes
      // BOTH the PO squalor row and the growth Estates-squalor whitelist).
      try {
        const stratGov = te.govEffectByCityFromStrat(modDataDir, fx) || {};
        for (const city of Object.keys(govEffectByCity)) {
          const g = govEffectByCity[city], s = stratGov[city];
          if (!g || !s || s.squalorEstates == null || g.squalorEstates == null) continue;
          if (s.squalorEstates !== g.squalorEstates) {
            g.squalor = (g.squalor || 0) - g.squalorEstates + s.squalorEstates;
            g.squalorEstates = s.squalorEstates;
          }
        }
      } catch { /* strat overlay best-effort */ }
    } catch (e) { out.saveError = "governor-trait read failed: " + (e && e.message ? e.message : String(e)); }
    // General bodyguard units per faction from the save — actual soldier counts so army upkeep
    // uses the engine's real retinue sizes (leader/heir rank + influence + PersonalSecurity incl.
    // start-assigned traits) instead of the descr_strat formula estimate. Grouped by the faction
    // the save attributes each unit to (region-owner based); incomeModel scales for mis-filed ones.
    const bodyguardUnitsByFaction = {};
    for (const u of (cr.units || [])) {
      if (!u.faction || u.naval) continue;
      if (!/general|bodyguard/i.test(u.name || "")) continue;
      (bodyguardUnitsByFaction[u.faction] = bodyguardUnitsByFaction[u.faction] || []).push({ name: u.name, soldiers: u.soldiers });
    }
    const opts = {};
    if (Object.keys(govEffectByCity).length) opts.govEffectByCity = govEffectByCity;
    if (Object.keys(popByCity).length) opts.popByCity = popByCity;
    if (Object.keys(cultPenByCity).length) opts.cultPenByCity = cultPenByCity;
    if (Object.keys(bodyguardUnitsByFaction).length) opts.bodyguardUnitsByFaction = bodyguardUnitsByFaction;
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
