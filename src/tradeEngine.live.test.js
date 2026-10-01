// Trade engine regression guard (2026-10-01): src/tradeEngine.js fed by a save alone against the game's own
// numbers. Truth: Rome's in-game turn-1 trade scroll (screenshot) and a memory read of every settlement's
// trade on turn 2, in the session that played turn 1 (scripts/ris-trade-live-turn2-2026-10-01.json) and with
// the turn-2 save freshly loaded (scripts/ris-trade-live-turn2-loaded-2026-10-02.json). Skips when the saves are absent.
import { describe, it, expect } from "vitest";
import fs from "fs";

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const T1 = `${SAVES}/save_01-10-2026   Rome   Turn 1.sav`;
const T2 = `${SAVES}/save_01-10-2026   Rome   Turn 2.sav`;
const have = fs.existsSync(T1) && fs.existsSync(T2) && fs.existsSync(`${MOD}/export_descr_buildings.txt`);
const d = have ? describe : describe.skip;

d("trade engine — save-driven, against the running game", () => {
  it("reproduces Rome's turn-1 trade scroll row by row", { timeout: 180000 }, async () => {
    const te = await import("./tradeEngine.js");
    const r = te.computeTrade(MOD, te.stateFromSave(MOD, T1)).Roma;
    const rows = (a, k) => Object.fromEntries(a.map(x => [x.to || x.from, x[k]]));
    expect(rows(r.land, "value")).toEqual({ "Camertia-Nahartia": 89, "Sabinia-Aequia": 93, Etruria_Meridionalis: 224, Faliscia: 144, Latium: 184 });
    expect(rows(r.fleets, "export")).toEqual({ Latium_Novum: 708, Campania: 387 });
    expect(rows(r.imports, "value")).toEqual({ Campania: 97, Etruria_Occidentalis: 22, Latium_Novum: 61 });
    expect(r.total).toBe(2009);
  });

  const offAgainst = (out, truthFile) => {
    const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")).settlements;
    const off = [];
    for (const reg in truth) {
      const o = out[reg]; const t = truth[reg];
      const game = t.land + t.sea + (o && o.wonder ? Math.ceil(Math.fround(t.sea * Math.fround(0.2))) : 0);
      if (!o || o.total !== game) off.push(reg);
    }
    return off.sort();
  };

  it("matches every faction-owned settlement of the turn-2 save as the game computes it right after loading", { timeout: 300000 }, async () => {
    const te = await import("./tradeEngine.js");
    const out = te.computeTrade(MOD, te.stateFromSave(MOD, T2));
    expect(offAgainst(out, "scripts/ris-trade-live-turn2-loaded-2026-10-02.json")).toEqual([]);
  });

  it("matches the continuous session (turn 1 played into turn 2) but for the two fresh-campaign frontiers", { timeout: 300000 }, async () => {
    const te = await import("./tradeEngine.js");
    const st = te.stateFromSave(MOD, T2);
    // memory holds what AI towns earned on THEIR last turn: their capabilities used the previous save's size events
    const prev = te.stateFromSave(MOD, T1);
    for (const f in st.sizeTier) if (f !== st.playerFaction && prev.sizeTier[f] != null) st.sizeTier[f] = prev.sizeTier[f];
    // a campaign started fresh builds its frontiers with the roads already laid (Karmania-Drangiane and Karmania-Gedrosia
    // are land there, sea-only once the save is loaded); the engine follows the loaded game
    expect(offAgainst(te.computeTrade(MOD, st), "scripts/ris-trade-live-turn2-2026-10-01.json")).toEqual(["Drangiane", "Karmania"]);
  });
});
