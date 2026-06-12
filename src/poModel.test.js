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
const d = have ? describe : describe.skip;

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

  it("save-aware: all 26 towns within ±10pp, ≥14 exact", { timeout: 120000 }, async () => {
    if (!fs.existsSync(SAVE)) return; // save deleted → no-save gate above still guards
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
