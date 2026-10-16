// Submod campaigns: edits and Save writes go to the IMPORTED campaign's own
// files, never the base mod's imperial_campaign (2026-10-16: Hadrian's RIS Light
// farm edits were written into RIS's main campaign by region name). The sandbox
// mirrors the RIS layout: base mod <root>/RIS/data with imperial_campaign, and a
// thin submod <root>/_submods/Light/data with its own campaign + descr_regions.
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

const BASE = "RIS/data";
const SUB = "_submods/Light/data";
const MAIN_DS = `${BASE}/world/maps/campaign/imperial_campaign/descr_strat.txt`;
const LIGHT_DS = `${SUB}/world/maps/campaign/ris_light/descr_strat.txt`;
const LIGHT_REGIONS = `${SUB}/world/maps/base/descr_regions.txt`;
const BASE_REGIONS = `${BASE}/world/maps/base/descr_regions.txt`;

const settlement = (region, building) => [
  "settlement", "{", "\tlevel town", `\tregion ${region}`, "\tfaction_creator slave",
  "\tbuilding", "\t{", `\t\ttype ${building}`, "\t}", "}",
];
const strat = (...regions) => ["faction slave, comfortable caesar", ...regions.flatMap(([r, b]) => settlement(r, b)), ""].join("\r\n");
const MAIN_TEXT = strat(["Latium", "farms land_clearance"], ["Roma", "farms basin_irrigation"]);
const LIGHT_TEXT = strat(["Latium", "farms basin_irrigation"], ["Ay-Bushum", "farms land_clearance"]);

describe("submod campaign writes", () => {
  let sb, prevDir, exportDir;
  afterEach(async () => {
    await H.invoke("set-active-campaign", null);
    await H.invoke("set-mod-export-dir", null);
    if (prevDir !== undefined) { H.main.__setActiveModDataDir(prevDir); prevDir = undefined; }
    if (sb) { sb.cleanup(); sb = null; }
    if (exportDir) { fs.rmSync(exportDir, { recursive: true, force: true }); exportDir = null; }
  });
  const setup = async () => {
    sb = makeModSandbox([
      { rel: MAIN_DS, content: MAIN_TEXT },
      { rel: LIGHT_DS, content: LIGHT_TEXT },
      { rel: LIGHT_REGIONS, content: "Latium\r\n\tRome\r\n\tsparta\r\n" },
      { rel: BASE_REGIONS, content: "Roma\r\n\tRome\r\n\tromans_julii\r\n" },
    ]);
    // The renderer's modDataDir for a submod is the BASE mod (icons dir).
    prevDir = H.main.__setActiveModDataDir(sb.path(BASE));
    const r = await H.invoke("set-active-campaign", path.dirname(sb.path(LIGHT_DS)));
    expect(r.ok).toBe(true);
    expect(path.resolve(r.stratPath)).toBe(path.resolve(sb.path(LIGHT_DS)));
  };

  it("building edits land in the submod's own campaign and leave the base campaign alone", async () => {
    await setup();
    const res = await H.invoke("update-region-buildings", "Ay-Bushum", [{ type: "farms", level: "irrigation_ditches" }]);
    expect(res.ok).toBe(true);
    expect(sb.read(LIGHT_DS)).toContain("type farms irrigation_ditches");
    expect(sb.read(MAIN_DS)).toBe(MAIN_TEXT);
  });

  it("a region shared by name edits the submod's town, not the base mod's", async () => {
    await setup();
    expect((await H.invoke("update-region-buildings", "Latium", [{ type: "farms", level: "terraces" }])).ok).toBe(true);
    expect(sb.read(LIGHT_DS)).toContain("type farms terraces");
    expect(sb.read(MAIN_DS)).toBe(MAIN_TEXT);
  });

  it("export mode puts the submod's files under the export folder by their own path", async () => {
    await setup();
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-export-"));
    expect((await H.invoke("set-mod-export-dir", exportDir)).ok).toBe(true);
    expect((await H.invoke("update-region-buildings", "Latium", [{ type: "farms", level: "terraces" }])).ok).toBe(true);
    expect((await H.invoke("update-region-buildings", "Ay-Bushum", [{ type: "farms", level: "irrigation_ditches" }])).ok).toBe(true);
    const out = fs.readFileSync(path.join(exportDir, "world/maps/campaign/ris_light/descr_strat.txt"), "utf8");
    expect(out).toContain("type farms terraces");
    expect(out, "the first export-mode edit survives the second").toContain("type farms irrigation_ditches");
    expect(sb.read(LIGHT_DS)).toBe(LIGHT_TEXT); // live submod untouched
    expect(sb.read(MAIN_DS)).toBe(MAIN_TEXT);
    expect(fs.existsSync(path.join(exportDir, "world/maps/campaign/imperial_campaign"))).toBe(false);
  });

  it("Save writes (descr_strat / descr_regions) resolve to the submod's files", async () => {
    await setup();
    const ds = await H.invoke("write-active-mod-file", "world/maps/campaign/imperial_campaign/descr_strat.txt", LIGHT_TEXT.replace("land_clearance", "terraces"));
    expect(ds.ok).toBe(true);
    expect(sb.read(LIGHT_DS)).toContain("terraces");
    expect(sb.read(MAIN_DS)).toBe(MAIN_TEXT);
    const rg = await H.invoke("write-active-mod-file", "world/maps/base/descr_regions.txt", "Latium\r\n\tRome\r\n\tsparta\r\n\tx\r\n");
    expect(rg.ok).toBe(true);
    expect(sb.read(LIGHT_REGIONS)).toContain("\tx");
    expect(sb.read(BASE_REGIONS)).toBe("Roma\r\n\tRome\r\n\tromans_julii\r\n");
  });

  it("the Save preflight names the regions the target descr_strat lacks", async () => {
    await setup();
    const ok = await H.invoke("check-strat-regions", ["Latium", "ay-bushum"]);
    expect(ok.ok).toBe(true);
    expect(ok.missing).toEqual([]);
    const miss = await H.invoke("check-strat-regions", ["Latium", "Roma"]);
    expect(miss.missing).toEqual(["Roma"]);
  });

  it("read-active-strat returns the current (exported) campaign text", async () => {
    await setup();
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-export-"));
    expect((await H.invoke("set-mod-export-dir", exportDir)).ok).toBe(true);
    await H.invoke("update-region-buildings", "Latium", [{ type: "farms", level: "terraces" }]);
    const cur = await H.invoke("read-active-strat");
    expect(cur.ok).toBe(true);
    expect(path.resolve(cur.stratPath)).toBe(path.resolve(sb.path(LIGHT_DS)));
    expect(cur.text).toContain("type farms terraces");
  });

  it("a rejected campaign folder clears the setting instead of keeping the old one", async () => {
    await setup();
    const bad = await H.invoke("set-active-campaign", path.join(sb.dir, "nope/world/maps/campaign/x"));
    expect(bad.ok).toBe(false);
    expect((await H.invoke("update-region-buildings", "Roma", [{ type: "farms", level: "terraces" }])).ok).toBe(true);
    expect(sb.read(MAIN_DS)).toContain("terraces"); // back to the base mod's imperial_campaign
    expect(sb.read(LIGHT_DS)).toBe(LIGHT_TEXT);
  });

  it("no imported campaign keeps the old imperial_campaign behaviour", async () => {
    sb = makeModSandbox([{ rel: MAIN_DS, content: MAIN_TEXT }]);
    prevDir = H.main.__setActiveModDataDir(sb.path(BASE));
    expect((await H.invoke("set-active-campaign", null)).ok).toBe(true);
    expect((await H.invoke("update-region-buildings", "Roma", [{ type: "farms", level: "terraces" }])).ok).toBe(true);
    expect(sb.read(MAIN_DS)).toContain("terraces");
  });
});
