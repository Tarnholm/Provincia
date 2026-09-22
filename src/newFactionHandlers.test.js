// The IPC layer for creating a new faction. These run against the installed RIS
// where it is present, because the point of the layer is path and encoding
// resolution — which a synthetic fixture cannot exercise.
//
// Nothing here writes: every apply is a dryRun, which runs the same plan the
// real write uses, so what is asserted is what would land on disk.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { registerNewFactionHandlers, gather } = require("./newFactionHandlers.js");

const MOD = "C:/RIS/RIS/data";
const haveRis = fs.existsSync(MOD + "/descr_sm_factions.txt");

// a one-line ipcMain stand-in
function bus() {
  const h = {};
  return { ipcMain: { handle: (name, fn) => { h[name] = fn; } }, call: (name, ...a) => h[name](null, ...a) };
}

describe.skipIf(!haveRis)("new-faction IPC", () => {
  let call;
  beforeAll(() => {
    const b = bus();
    registerNewFactionHandlers(b.ipcMain, { getActiveModDataDir: () => MOD });
    call = b.call;
  });

  it("scans the mod: donors, campaigns and the ceiling", async () => {
    const r = await call("new-faction-scan", MOD);
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(239);
    expect(r.atCap).toBe(true); // 239 is the ceiling, and RIS is on it
    expect(r.missingFiles).toEqual([]);
    expect(r.haveRecruitment).toBe(true);
    const parni = r.donors.find((d) => d.faction === "parni");
    expect(parni).toMatchObject({ culture: expect.any(String), namelistMen: "parni_men", inCampaign: true });
  });

  it("reads a donor: real names from its pool, towns and recruitment offers", async () => {
    const r = await call("new-faction-donor", MOD, "parni");
    expect(r.error).toBeUndefined();
    expect(r.names).toContain("Arsakes");
    expect(r.names).not.toContain("iranian_men"); // a pool, not a person
    expect(r.namelists.men).toBe("parni_men");
    expect(r.aiLabel).toMatch(/^ai_/);
    expect(r.settlements.length).toBeGreaterThan(1000);
    expect(r.settlements[0].suggested).toBe(true); // the donor's own towns lead
    expect(r.recruitCount).toBeGreaterThan(50);
  });

  it("plans the whole faction without writing, and warns about the ceiling", async () => {
    const donor = await call("new-faction-donor", MOD, "parni");
    const town = donor.settlements.find((s) => s.owner === "pontus");
    const r = await call("new-faction-apply", MOD, {
      dryRun: true, donor: "parni", newId: "tocharians", displayName: "Tocharians",
      settlements: [town.region], leader: { name: donor.names[0], age: 42 }, heir: { name: donor.names[1], age: 20 },
      aiLabel: donor.aiLabel, recruitLines: donor.recruit.slice(0, 5).map((o) => o.line),
    });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.summary.files).toEqual(expect.arrayContaining(["smFactions", "character", "modelStrat", "banners", "aiPersonality", "winConditions", "expandedText", "strat", "edb"]));
    expect(r.summary.recruitChanged).toBe(5);
    expect(r.summary.strat).toMatchObject({ faction: "tocharians", leader: donor.names[0], heir: donor.names[1] });
    expect(r.summary.strat.settlements[0]).toMatchObject({ region: town.region, from: "pontus" });
    expect(r.warnings.join(" ")).toMatch(/239 factions/);
  });

  it("refuses a bad ask, and never half-writes", async () => {
    const base = { dryRun: true, donor: "parni", newId: "tocharians", displayName: "T", settlements: ["Parnia"], leader: { name: "A" }, heir: { name: "B" } };
    for (const [bad, why] of [
      [{ newId: "pontus" }, /already exists/],
      [{ newId: "Not A Token" }, /not a usable faction id/],
      [{ donor: "nobody" }, /no entry/],
      [{ leader: null }, /leader/],
      [{ heir: null }, /heir/],
      [{ settlements: [] }, /settlement/],
    ]) {
      const r = await call("new-faction-apply", MOD, { ...base, ...bad });
      expect(r.ok, JSON.stringify(bad)).toBeUndefined();
      expect(r.error).toMatch(why);
    }
  });

  it("gathers the files with the right encoding", () => {
    const { files } = gather(MOD, MOD + "/world/maps/campaign/imperial_campaign/descr_strat.txt");
    expect(files.smFactions).toMatch(/"parni":/);
    expect(files.winConditions).toBeTruthy();
    // expanded_bi.txt is UTF-16LE; read as latin1 it would be full of NULs
    expect(files.expandedText).toMatch(/\{PARNI\}/);
    expect(files.expandedText.includes("\u0000")).toBe(false);
  });
});
