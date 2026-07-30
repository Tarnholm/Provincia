// Regression gate for the Army Setup "PO isn't updated" bug (2026-07-30):
// poModel.garrisonMenByTile cached descr_strat's garrison table keyed on
// modDataDir ALONE, with no invalidation. The Army Setup applies (Add ➕ /
// Recruit ↗ / Replace ♻) write descr_strat in the same main process, so the
// 🔄 Reload re-ran computeStartingPO against the stale table and the PO row
// never moved until an app restart. The cache is now mtime-keyed (same pattern
// as incomeModel._stratLines and recruitPool.parseUnitStats).
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { garrisonMenByTile } from "./poModel.js";

let modDir, stratPath;

const STRAT = (units) => [
  "faction\tromans_julii, balanced smith",
  "character,\tFlavius Julius, named character, male, age 40, , x 90, y 88",
  "army",
  ...units.map(u => `unit\t\t${u}\t\t\texp 0 armour 0 weapon_lvl 0`),
  "",
].join("\r\n");

// minimal EDU so parseUnitStats yields real soldier counts (men = soldiers×4, HUGE)
const EDU = [
  "type roman hastati",
  "category infantry",
  "class heavy",
  "soldiers 20, 0, 1.2",
  "stat_cost 1, 400, 100, 50, 60, 400",
  "",
  "type roman principes",
  "category infantry",
  "class heavy",
  "soldiers 30, 0, 1.2",
  "stat_cost 1, 500, 120, 50, 60, 500",
  "",
].join("\n");

beforeEach(() => {
  modDir = fs.mkdtempSync(path.join(os.tmpdir(), "pomodel-gar-"));
  const campDir = path.join(modDir, "world", "maps", "campaign", "imperial_campaign");
  fs.mkdirSync(campDir, { recursive: true });
  stratPath = path.join(campDir, "descr_strat.txt");
  fs.writeFileSync(modDir + "/export_descr_unit.txt", EDU);
  fs.writeFileSync(stratPath, STRAT(["roman hastati"]));
});

describe("garrisonMenByTile — mtime invalidation", () => {
  test("re-reads descr_strat after an Army Setup-style write (the PO bug)", () => {
    const before = garrisonMenByTile(modDir);
    expect(before["90,88"]).toBe(20 * 4);
    // simulate an Army Setup apply: append a unit, bump mtime past FS resolution
    fs.writeFileSync(stratPath, STRAT(["roman hastati", "roman principes"]));
    const st = fs.statSync(stratPath);
    fs.utimesSync(stratPath, st.atime, new Date(st.mtimeMs + 2000));
    const after = garrisonMenByTile(modDir);
    expect(after["90,88"]).toBe((20 + 30) * 4); // was stuck at 80 pre-fix
  });

  test("same mtime → cache hit (same object back, no re-parse)", () => {
    const a = garrisonMenByTile(modDir);
    const b = garrisonMenByTile(modDir);
    expect(b).toBe(a);
  });
});
