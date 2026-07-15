// Drives the extracted parseSaveData (via makeParseSaveData) against a real
// save. Skip-guarded on a local .sav (skips on CI). Verifies the extraction
// still parses a 30-45 MB save into the expected structure. The mod-state deps
// are stubbed empty — the core binary parse doesn't need them.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { makeParseSaveData } = require("./parseSaveData.js");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const saveFile = (() => {
  try { const s = fs.readdirSync(SAVE_DIR).filter((f) => f.endsWith(".sav")); return s.length ? path.join(SAVE_DIR, s[0]) : null; }
  catch { return null; }
})();

describe("parseSaveData (extracted from main.js)", () => {
  it("makeParseSaveData returns a parse function", () => {
    const psd = makeParseSaveData({ KNOWN_BUILDINGS: new Set(), getModAiByFaction: () => ({}), getModAiPersonalityOrder: () => [], getModFactionOrder: () => [] });
    expect(typeof psd).toBe("function");
  });

  it.runIf(saveFile)("parses a real save into the expected structure", { timeout: 30000 }, async () => {
    const psd = makeParseSaveData({ KNOWN_BUILDINGS: new Set(), getModAiByFaction: () => ({}), getModAiPersonalityOrder: () => [], getModFactionOrder: () => [] });
    const d = await psd(saveFile, () => {}, null);
    for (const k of ["buildings", "armies", "taxByCity", "factionRecords", "saveHeader", "treasuryByFaction"]) {
      expect(d, `missing ${k}`).toHaveProperty(k);
    }
  });

  // Locks the worker-offload invariant: the live-load parse runs in
  // src/parseSaveDataWorker.js (off the Electron main thread so a turn no longer
  // freezes the window). The worker output MUST be byte-identical to the
  // synchronous parse, and it must stream progress + forward diagnostics back.
  it.runIf(saveFile)("parseSaveDataWorker output is identical to the synchronous parse", { timeout: 40000 }, async () => {
    const { Worker } = require("worker_threads");
    const WORKER = require.resolve("./parseSaveDataWorker.js");
    const KB = new Set(["core_building", "farms", "market", "barracks", "temples_of_trade"]);
    const deps = { KNOWN_BUILDINGS: KB, getModAiByFaction: () => ({}), getModAiPersonalityOrder: () => [], getModFactionOrder: () => [] };
    const sync = await makeParseSaveData(deps)(saveFile, () => {}, null);

    const runWorker = () => new Promise((resolve, reject) => {
      const w = new Worker(WORKER);
      let progress = 0;
      w.on("message", (m) => {
        if (m && m.type === "progress") { progress++; return; }
        w.terminate();
        (m && m.ok) ? resolve({ result: m.result, logs: m.logs, progress }) : reject(new Error((m && m.error) || "worker failed"));
      });
      w.once("error", (e) => { w.terminate(); reject(e); });
      w.postMessage({ savePath: saveFile, saveBuf: null, knownBuildings: Array.from(KB), modAiByFaction: {}, modAiPersonalityOrder: [], modFactionOrder: [] });
    });

    const wk = await runWorker();
    expect(wk.result).toEqual(sync);            // byte-identical parse
    expect(wk.progress).toBeGreaterThan(0);      // progress streamed back
    expect(wk.logs.length).toBeGreaterThan(0);   // diagnostics forwarded for provincia.log
  });
});
