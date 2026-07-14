// PO exact-component model gate (task #10, cracked 2026-06-12).
// Truth: julii 26-town settlement-details corpus (jcrops/julii/po-corpus.tsv,
// screenshots 20260611231429-231448, all @normal tax, same campaign as
// save_Julii1.sav). Gate: within ±10pp on ≥80% of towns (no-save), 100% save-aware.
// Fixture-gated: skips when the corpus / mod / save are absent.
import { describe, it, expect } from "vitest";
import fs from "fs";

const MOD = "C:/RIS/RIS/data";
const CORPUS = "C:/Users/vtarn/jcrops/julii/po-corpus.tsv";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii1.sav";
const have = fs.existsSync(CORPUS) && fs.existsSync(`${MOD}/export_descr_buildings.txt`);
// VINTAGE GUARD (2026-07-15): the model computes from the CURRENT mod files;
// when RIS is updated after the corpus screenshots (e.g. the 2026-07 alternate
// maps update rewrote every data file) the panel values legitimately drift and
// the gate would fail on stale truth, not on a model bug. Skip on drift;
// re-capture the julii corpus (and save_Julii1.sav) to re-enable.
const mt = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return -1; } };
const corpusFresh = have && Math.max(
  mt(`${MOD}/export_descr_buildings.txt`),
  mt(`${MOD}/world/maps/campaign/imperial_campaign/descr_strat.txt`),
) <= mt(CORPUS);
const d = (have && corpusFresh) ? describe : describe.skip;
if (have && !corpusFresh) console.warn("[test-skip] poModel gate: RIS mod is newer than po-corpus.tsv — re-capture the julii corpus to re-enable");

function loadTruth() {
  const truth = {};
  for (const ln of fs.readFileSync(CORPUS, "utf8").split(/\r?\n/)) {
    if (!ln || ln.startsWith("#") || ln.startsWith("town\t")) continue;
    const p = ln.split("\t");
    truth[p[0]] = +p[2];
  }
  return truth;
}

function score(model, truth) {
  let n = 0, within = 0, exact = 0;
  for (const town of Object.keys(truth)) {
    const k = Object.keys(model).find(x => x === town || x.replace(/_/g, " ") === town);
    if (!k) continue;
    const err = model[k].poAt.normal - truth[town];
    n++;
    if (Math.abs(err) <= 10) within++;
    if (err === 0) exact++;
  }
  return { n, within, exact };
}

d("PO exact component model — julii live-panel gate", () => {
  it("no-save: ≥80% of towns within ±10pp of the live panels", { timeout: 120000 }, async () => {
    const po = await import("./poModel.js");
    const truth = loadTruth();
    const m = po.computeStartingPO(MOD, "romans_julii", {});
    const { n, within } = score(m, truth);
    expect(n).toBe(26);
    expect(within / n).toBeGreaterThanOrEqual(0.8);
  });

  // runIf, not a silent early return: a missing save must show as SKIPPED in the
  // summary, not as a vacuous green pass that hides the un-exercised gate.
  it.runIf(fs.existsSync(SAVE))("save-aware: all 26 towns within ±10pp, ≥14 exact", { timeout: 120000 }, async () => {
    const po = await import("./poModel.js");
    const te = await import("./traitEffects.js");
    const { crackSave } = await import("./saveCracker.js");
    const truth = loadTruth();
    const cr = crackSave(fs.readFileSync(SAVE), MOD);
    const gov = te.govEffectByCityFromSave(cr, te.parseTraitEffects(MOD), MOD);
    const m = po.computeStartingPO(MOD, "romans_julii", { govEffectByCity: gov });
    const { n, within, exact } = score(m, truth);
    expect(n).toBe(26);
    expect(within).toBe(26);
    expect(exact).toBeGreaterThanOrEqual(14);
  });
});
