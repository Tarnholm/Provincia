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
});
