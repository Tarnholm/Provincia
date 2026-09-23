// The one campaign scanner (src/campaignScan.js) against every folder shape a
// user really picks — the v0.9.1481 regression shipped with six green tests
// because none of them encoded "the user selected the campaign folder itself".
// Fixtures sit deeper than findRelatedModDirs' 5-level walk so no concurrent
// test's fixture can be mistaken for a base mod.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { scanFolderForCampaigns, CAMPAIGN_FILES } = require("./campaignScan.js");

let root;
afterEach(() => { if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; } });

function makeMod() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "campscan-"));
  const data = path.join(root, "p1", "p2", "p3", "p4", "p5", "MyMod", "data");
  const base = path.join(data, "world", "maps", "base");
  const camp = path.join(data, "world", "maps", "campaign", "imperial_campaign");
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(camp, { recursive: true });
  for (const f of ["descr_regions.txt", "map_regions.tga", "map_heights.tga", "map_ground_types.tga"]) fs.writeFileSync(path.join(base, f), "base:" + f);
  for (const f of ["descr_strat.txt", "descr_win_conditions.txt"]) fs.writeFileSync(path.join(camp, f), "camp:" + f);
  fs.writeFileSync(path.join(data, "descr_sm_factions.txt"), "shared");
  fs.writeFileSync(path.join(data, "export_descr_unit.txt"), "edu"); // marks a full mod root for baseModFallback
  return { data, base, camp };
}
const opts = () => { const used = []; return { used, o: { onRootUsed: (r) => used.push(r), getVanillaDataDir: () => null, log: () => { } } }; };

describe("scanFolderForCampaigns", () => {
  it("mod data root: the campaign inherits the map files from base/", () => {
    const { data, base } = makeMod();
    const r = scanFolderForCampaigns(data, opts().o);
    expect(r.campaigns.map((c) => c.name)).toEqual(["imperial_campaign"]);
    const found = r.campaigns[0].found;
    for (const f of CAMPAIGN_FILES) expect(found[f], f).toBeTruthy();
    expect(found["map_regions.tga"]).toBe(path.join(base, "map_regions.tga"));
    expect(found["descr_sm_factions.txt"]).toBe(path.join(data, "descr_sm_factions.txt"));
    expect(Object.keys(r.baseFound).sort()).toEqual(["descr_regions.txt", "map_ground_types.tga", "map_heights.tga", "map_regions.tga"]);
  });

  it("the campaign folder picked DIRECTLY still gets its OWN mod's map files (not vanilla's)", () => {
    const { base, camp, data } = makeMod();
    const { used, o } = opts();
    const r = scanFolderForCampaigns(camp, o);
    expect(r.campaigns.length).toBe(1);
    expect(r.campaigns[0].found["map_regions.tga"]).toBe(path.join(base, "map_regions.tga"));
    expect(r.campaigns[0].found["map_heights.tga"]).toBe(path.join(base, "map_heights.tga"));
    // the mod root lay OUTSIDE the scanned tree, so it must be reported for consent
    expect(used.some((u) => path.resolve(u) === path.resolve(data))).toBe(true);
  });

  it("same-named campaign folders collapse to the fullest one (a backup copy deeper in the tree)", () => {
    const { data, camp } = makeMod();
    const stale = path.join(data, "_old", "imperial_campaign");
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, "descr_strat.txt"), "stale");
    const r = scanFolderForCampaigns(data, opts().o);
    expect(r.campaigns.length).toBe(1);
    expect(r.campaigns[0].dir).toBe(camp);
  });

  it("file names match case-insensitively and come back under their canonical key", () => {
    const { data, camp } = makeMod();
    fs.renameSync(path.join(camp, "descr_strat.txt"), path.join(camp, "DESCR_STRAT.TXT"));
    const r = scanFolderForCampaigns(data, opts().o);
    expect(path.basename(r.campaigns[0].found["descr_strat.txt"]).toLowerCase()).toBe("descr_strat.txt");
  });

  // User report 2026-09-22: picking the RIS repo root listed
  // _resources/backups/alternate_campaign, and every campaign got the LAST
  // base/ the walk met — some other mod's regions and map.
  it("a repo root: skips backups, gives each mod's campaign its OWN base/, keeps same-named campaigns of different mods apart", () => {
    const { data, base, camp } = makeMod();
    const repo = path.dirname(path.dirname(data)); // …/p5
    const sub = path.join(repo, "_submods", "Sub", "data");
    const subBase = path.join(sub, "world", "maps", "base");
    const subCamp = path.join(sub, "world", "maps", "campaign", "sub_campaign");
    const twin = path.join(repo, "_submods", "Twin", "data", "world", "maps", "campaign", "imperial_campaign");
    const backup = path.join(repo, "_resources", "backups", "alternate_campaign");
    for (const d of [subBase, subCamp, twin, backup]) fs.mkdirSync(d, { recursive: true });
    for (const f of ["descr_regions.txt", "map_regions.tga"]) fs.writeFileSync(path.join(subBase, f), "sub:" + f);
    fs.writeFileSync(path.join(subCamp, "descr_strat.txt"), "sub strat");
    fs.writeFileSync(path.join(twin, "descr_strat.txt"), "twin strat");
    fs.writeFileSync(path.join(backup, "descr_strat.txt"), "old strat");

    const r = scanFolderForCampaigns(repo, opts().o);
    const byDir = Object.fromEntries(r.campaigns.map((c) => [c.dir, c]));
    expect(r.campaigns.some((c) => c.name === "alternate_campaign")).toBe(false);
    expect(byDir[camp].found["map_regions.tga"]).toBe(path.join(base, "map_regions.tga"));
    expect(byDir[subCamp].found["map_regions.tga"]).toBe(path.join(subBase, "map_regions.tga"));
    expect(byDir[camp].rel).toBe(path.relative(repo, camp));
    // both imperial_campaigns are listed, and the twin never borrows the submod's map
    expect(r.campaigns.filter((c) => c.name === "imperial_campaign").length).toBe(2);
    expect(byDir[twin].found["map_regions.tga"] || "").not.toBe(path.join(subBase, "map_regions.tga"));
  });

  // RTW Remastered keeps a copy of the campaign under
  // data/original_overrides/resource_quantity/world/maps/campaign/<name>. It is
  // the SAME mod: one entry, and the real campaign wins (a reload once picked
  // the override copy, 2026-09-23).
  it("the original_overrides copy of a campaign is the same mod, and the real campaign wins", () => {
    const { data, camp } = makeMod();
    const ovr = path.join(data, "original_overrides", "resource_quantity", "world", "maps", "campaign", "imperial_campaign");
    fs.mkdirSync(ovr, { recursive: true });
    for (const f of ["descr_strat.txt", "descr_win_conditions.txt"]) fs.writeFileSync(path.join(ovr, f), "ovr:" + f);
    const r = scanFolderForCampaigns(data, opts().o);
    expect(r.campaigns.map((c) => c.dir)).toEqual([camp]);
  });

  it("a folder with no campaign answers with an empty list, not an error", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "campscan-"));
    const r = scanFolderForCampaigns(root, opts().o);
    expect(r.campaigns).toEqual([]);
    expect(r.sharedFound).toEqual({});
  });
});
