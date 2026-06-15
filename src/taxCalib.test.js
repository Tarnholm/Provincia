// taxCalib.test.js — PER-CAMPAIGN TAX CALIBRATION (H lock), 2026-06-12.
// Unit tests for the flexible reading parser + snap, and the SHIP GATE:
// pasting the 14:30 fresh-julii live tax corpus must reproduce live within ±6
// denarii for all 19 non-governor towns (resource-tax-fit.md law: live = model
// × H, H quantized 0.05 — the wired tax law is denarius-grade modulo H).
import { describe, test, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import { parseTaxReadings, matchSettlement, snapH, computeTaxCalibration } from "./taxCalib.js";
const require = createRequire(import.meta.url);

describe("taxCalib — parsing + snapping", () => {
  test("flexible line formats parse (space, tab, bracket variants)", () => {
    const { readings, skipped } = parseTaxReadings([
      "Arpi 618 vh",
      "Cosa\t568\thigh",
      "Sena Gallica 252 l",
      "Camerinum: 189, low",
      "Reate 449 n",
      "Fregellae 356 very high",
      "Praeneste 105", // no bracket → null (falls back to the budget's set bracket)
      "", "# comment line",
      "garbage line with no number",
    ].join("\n"));
    expect(readings).toHaveLength(7);
    expect(readings[0]).toMatchObject({ name: "Arpi", live: 618, bracket: "very_high" });
    expect(readings[1]).toMatchObject({ name: "Cosa", live: 568, bracket: "high" });
    expect(readings[2]).toMatchObject({ name: "Sena Gallica", live: 252, bracket: "low" });
    expect(readings[3]).toMatchObject({ name: "Camerinum", live: 189, bracket: "low" });
    expect(readings[4]).toMatchObject({ name: "Reate", live: 449, bracket: "normal" });
    expect(readings[5]).toMatchObject({ name: "Fregellae", live: 356, bracket: "very_high" });
    expect(readings[6]).toMatchObject({ name: "Praeneste", live: 105, bracket: null });
    expect(skipped).toHaveLength(1);
  });

  test("snapH returns the EXACT ratio within the fortune band (no 0.05 snap), rejects out-of-band", () => {
    expect(snapH(1.0617)).toBe(1.0617); // exact — calibration reproduces the pasted tax to the denarius
    expect(snapH(0.91)).toBe(0.91);
    expect(snapH(1.004)).toBe(1.004);
    expect(snapH(1.543)).toBe(1.543); // bracket-gap ratio kept (app normal vs game VH)
    expect(snapH(2.132)).toBe(2.132);
    expect(snapH(0.8)).toBe(0.8);
    expect(snapH(2.7)).toBe(null);  // beyond a one-step bracket gap = wrong match, rejected
    expect(snapH(0.3)).toBe(null);  // population paste (9000/854 ≈ 10) rejected far above
    expect(snapH(0)).toBe(null);
    expect(snapH(NaN)).toBe(null);
  });

  test("fuzzy settlement matching (underscores, prefixes, epithets)", () => {
    const sets = [
      { settlement: "Sena_Gallica", region: "Ager_Gallicus" },
      { settlement: "Epizephyrian_Locri", region: "Lokroi_Epizephyrioi" },
      { settlement: "Rome", region: "Roma" },
    ];
    expect(matchSettlement("Sena Gallica", sets).settlement).toBe("Sena_Gallica");
    expect(matchSettlement("sena", sets).settlement).toBe("Sena_Gallica");
    expect(matchSettlement("Locri", sets).settlement).toBe("Epizephyrian_Locri");
    expect(matchSettlement("Rome", sets).settlement).toBe("Rome");
    expect(matchSettlement("Atlantis", sets)).toBe(null);
  });

  test("computeTaxCalibration: H from taxParts at the pasted bracket", () => {
    // tax(b) = max(0, mult·w + flat): w=400, flat=20 → @high 500; live 525 → H 1.05
    const sets = [{ settlement: "Testopolis", region: "Testia", bracket: "normal", taxParts: { w: 400, flat: 20 } }];
    const { byCity, unmatched } = computeTaxCalibration("Testopolis 525 h\nNowhere 100 n", sets);
    expect(byCity.Testopolis).toMatchObject({ h: 1.05, live: 525, bracket: "high", model: 500 });
    expect(unmatched).toHaveLength(1);
  });
});

// ── SHIP GATE: the 14:30 fresh-julii 26-town live corpus (memory: APP TAX TABLE
// + LIVE TAX VALUES COMPLETE). Fixture-gated on the HEAD-strat shadow mod.
const MOD = "C:/dev/rtw-sav-parser/calib-data/data";
const dGate = fs.existsSync(`${MOD}/export_descr_buildings.txt`) ? describe : describe.skip;

dGate("taxCalib — julii 26-town live-corpus gate (±6 after H lock)", () => {
  // [bracket, live]; 👤 towns (live governor rolls ≠ strat seeds) excluded from the gate
  const TABLE = {
    Arpi: ["very_high", 618], Arretium: ["normal", 424], Camerinum: ["low", 189],
    Canusium: ["normal", 213, "gov"], Corfinium: ["low", 180], Cosa: ["high", 568],
    Croton: ["low", 207, "gov"], Epizephyrian_Locri: ["low", 206, "gov"], Falerii: ["low", 179],
    Fregellae: ["normal", 356], Iguvium: ["low", 223], Larinum: ["low", 180],
    Maleventum: ["low", 358], Metapontum: ["very_high", 583], Neapolis: ["normal", 365, "gov"],
    Paestum: ["very_high", 791, "gov"], Perusia: ["low", 180], Pisae: ["low", 155],
    Praeneste: ["low", 105], Reate: ["normal", 449], Rome: ["very_high", 1465, "gov"],
    Sena_Gallica: ["low", 252], Teate: ["low", 179], Thurii: ["very_high", 542, "gov"],
    Venusia: ["low", 342], Volaterrae: ["low", 178],
  };
  const BRTOK = { low: "l", normal: "n", high: "h", very_high: "vh" };
  const br = {};
  for (const k of Object.keys(TABLE)) br[k] = TABLE[k][0];
  let im, byCity, recomputed;

  it("computes the budget + calibration from a pasted corpus", { timeout: 120000 }, () => {
    im = require("./incomeModel.js");
    const b0 = im.computeTurn1Budget(MOD, "romans_julii", br, {});
    expect(b0.error).toBeFalsy();
    // paste text with human-style names + short bracket tokens
    const text = Object.keys(TABLE)
      .map(k => `${k.replace(/_/g, " ")} ${TABLE[k][1]} ${BRTOK[TABLE[k][0]]}`).join("\n");
    const res = computeTaxCalibration(text, b0.settlements);
    byCity = res.byCity;
    expect(res.unmatched).toHaveLength(0);
    expect(Object.keys(byCity)).toHaveLength(26);
    recomputed = im.computeTurn1Budget(MOD, "romans_julii", br, { taxHByCity: byCity });
    expect(recomputed.error).toBeFalsy();
  });

  it("all 19 non-governor towns reproduce live to the denarius (exact-H calibration)", () => {
    let checked = 0;
    for (const s of recomputed.settlements) {
      const row = TABLE[s.settlement] || TABLE[s.settlement.replace(/[\s-]+/g, "_")];
      if (!row || row[2] === "gov") continue;
      checked++;
      // exact-ratio H (no 0.05 snap) → calibrated taxes reproduce the pasted value
      // to within rounding (±1)
      expect(Math.abs(s.taxes - row[1]), `${s.settlement}: model ${s.taxes} vs live ${row[1]} (H ${s.taxH})`).toBeLessThanOrEqual(1);
    }
    expect(checked).toBe(19);
  });

  it("H assignments are the exact live/model ratio (calibration is exact, not snapped)", () => {
    // FP=4.0 + PIECEWISE-LINEAR-KNEE retune 2026-06-15: FP returned to the capital-derived
    // 4.0 and the knee to 2500 (where the pop sweep shows linearity starting). The power
    // law's mid-pop bow is replaced by a linear chord to the Rome 9000 anchor. Mid/high-pop H
    // collapsed toward 1.0: Arretium (4500) 0.952→1.006, Neapolis (3750) →0.998 — model
    // reproduces live within ~0.5% with no calibration. Low-pop towns shift slightly with FP;
    // their residual H scatter (Fregellae .. Praeneste at the SAME pop 1500) is per-town
    // pts/governor noise the paste absorbs, NOT a curve issue.
    expect(byCity.Fregellae.h).toBeCloseTo(0.899, 2);  // low extreme (W(1500)=540 anchor)
    expect(byCity.Arpi.h).toBeCloseTo(1.099, 2);       // pop 2250 (W anchor 614.8)
    expect(byCity.Volaterrae.h).toBeCloseTo(0.997, 2); // pop 3000 on the 2250→3750 chord (658) → ~exact
    expect(byCity.Arretium.h).toBeCloseTo(1.006, 2);   // pop 4500: ~exact
    expect(byCity.Camerinum.h).toBeGreaterThan(1.0);
  });

  it("uncalibrated rows expose taxParts and a null taxH; calibrated rows carry H", () => {
    const b0 = im.computeTurn1Budget(MOD, "romans_julii", br, {});
    const r0 = b0.settlements.find(s => s.settlement === "Arpi");
    expect(r0.taxParts && typeof r0.taxParts.w).toBe("number");
    expect(r0.taxH).toBe(null);
    const r1 = recomputed.settlements.find(s => s.settlement === "Arpi");
    expect(r1.taxH).toBeCloseTo(1.099, 2);
  });
});
