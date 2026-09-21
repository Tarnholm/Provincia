// Export mode ("export instead of overwrite"): edits land under the export
// folder and the live mod is never touched. Two edits in a row must BOTH be in
// the exported file — each handler reads its base text, and if that base is
// always the live file, the second edit silently throws the first away.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { loadMainHandlers } = require("./mainIpcHarness.js");
const { makeModSandbox } = require("./modSandbox.js");

let H;
beforeAll(() => { H = loadMainHandlers(); });

const DS_REL = "world/maps/campaign/imperial_campaign/descr_strat.txt";
const SYNTH_DS = [
  "faction romans_julii, comfortable caesar",
  "character\tTestus Maximus, named character, age 30, , x 100, y 100",
  "traits GoodCommander 1, Energetic 2",
  "",
  "faction carthage, comfortable hannibal",
  "character\tHannibalus Barca, named character, age 40, , x 200, y 200",
  "traits GoodAttacker 2",
  "",
].join("\r\n");

describe("export mode", () => {
  let sb, prevDir, exportDir;
  afterEach(async () => {
    await H.invoke("set-mod-export-dir", null);
    if (prevDir !== undefined) { H.main.__setActiveModDataDir(prevDir); prevDir = undefined; }
    if (sb) { sb.cleanup(); sb = null; }
    if (exportDir) { fs.rmSync(exportDir, { recursive: true, force: true }); exportDir = null; }
  });

  it("leaves the live mod untouched and keeps EVERY edit in the exported file", async () => {
    sb = makeModSandbox([{ rel: DS_REL, content: SYNTH_DS }]);
    prevDir = H.main.__setActiveModDataDir(sb.dir);
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-export-"));
    expect((await H.invoke("set-mod-export-dir", exportDir)).ok).toBe(true);

    const a = await H.invoke("update-character-traits", "Testus", "romans_julii", [{ name: "BadCommander", level: 3 }]);
    expect(a.ok).toBe(true);
    const b = await H.invoke("update-character-traits", "Hannibalus", "carthage", [{ name: "GoodDefender", level: 1 }]);
    expect(b.ok).toBe(true);

    expect(sb.read(DS_REL)).toBe(SYNTH_DS); // live file byte-identical
    const exported = fs.readFileSync(path.join(exportDir, DS_REL), "utf8");
    expect(exported).toContain("traits GoodDefender 1");
    expect(exported, "the FIRST export-mode edit must survive the second").toContain("traits BadCommander 3");
    // no backup files appear beside the live file in export mode
    expect(fs.readdirSync(path.dirname(path.join(sb.dir, DS_REL))).filter((f) => f.endsWith(".bak"))).toEqual([]);
  });
});
