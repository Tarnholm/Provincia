// Integration tests over the REAL main.js IPC handlers, loaded under a mocked
// Electron via mainIpcHarness. This is the regression net that makes main.js
// refactors safe: it asserts handlers stay registered and that the security-
// sensitive file handlers still contain paths / round-trip correctly — behavior
// the boot smoke-launch can't exercise. Handlers needing an external mod/save
// dir are NOT covered here (they'd need local fixtures); this focuses on the
// handlers that run anywhere.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { loadMainHandlers } = require("./mainIpcHarness.js");

let H;
beforeAll(() => { H = loadMainHandlers(); });

describe("main.js IPC surface", () => {
  it("registers the full handler set (no channel silently dropped)", () => {
    expect(H.channels.length).toBeGreaterThanOrEqual(115);
    // A spread of load-bearing channels across domains must be present.
    for (const ch of [
      "get-app-version", "get-app-paths", "crack-save", "get-turn1-budget",
      "save-file", "read-user-file", "save-user-file", "write-binary-file",
      "copy-file", "read-campaign-file", "scan-folder", "select-folder",
      // extracted domain modules — must survive the extraction
      "get-user-data-path", "select-log-folder",
      "read-vanilla-strat", "read-vanilla-sm-factions", "get-vanilla-faction-display-names",
      "log-message", "get-log-path", "reveal-log-file",
      "get-building-stats", "get-building-description", "get-building-chain-levels",
      "find-edb-chain", "find-edu-type",
      "get-unit-ownership", "get-unit-stats", "get-unit-upkeep-map", "get-building-recruits",
      "get-building-display-names", "resolve-building-icon", "resolve-building-icons-bulk",
      "replace-building-icon", "revert-building-icon", "resolve-building-banner",
      "resolve-unit-info", "resolve-unit-card",
      "resolve-trait-icon", "resolve-ancillary-icon", "resolve-portrait",
      "crack-save", "get-save-economy", "get-turn1-budget", "crack-trade-network",
      "get-faction-vision", "get-army-setup", "scan-saves-timeline",
    ]) {
      expect(H.channels, `missing channel: ${ch}`).toContain(ch);
    }
  });

  it("throws for an unregistered channel (harness contract)", () => {
    expect(() => H.invoke("no-such-channel-xyz")).toThrow(/no IPC handler/);
  });

  it("clear-mod-caches runs without throwing (guards against a leaked cache decl)", async () => {
    // Regression guard: an extraction that sweeps a shared cache declaration into
    // a domain module leaves clear-mod-caches referencing an undefined var — this
    // catches that by actually invoking it (v0.9.1249 shipped with exactly this
    // bug in _unitOwnershipCache; the structural registration check missed it).
    expect(await H.invoke("clear-mod-caches")).toBe(true);
  });

  it("get-app-version returns a version string", () => {
    expect(typeof H.invoke("get-app-version")).toBe("string");
  });

  it("get-app-paths reports platform + base dirs", () => {
    const p = H.invoke("get-app-paths");
    expect(p).toMatchObject({ platform: expect.any(String) });
    expect(p).toHaveProperty("home");
    expect(p).toHaveProperty("appData");
  });

  it("select-log-folder returns null when the dialog is canceled (extracted domain module)", async () => {
    // The harness's dialog mock returns { canceled: true }.
    expect(await H.invoke("select-log-folder")).toBeNull();
  });

  it("log handlers: get-log-path returns a string, log-message + reveal don't throw", async () => {
    expect(typeof H.invoke("get-log-path")).toBe("string");
    await expect(H.invoke("log-message", "info", "harness log line")).resolves.toBeUndefined();
    // reveal-log-file → true (the harness initLogging opened a real log under tmp).
    expect(H.invoke("reveal-log-file")).toBe(true);
  });
});

describe("userData file handlers — containment + round-trip (real handlers)", () => {
  // The mocked app.getPath('userData') is os.tmpdir(); save/read-user-file live
  // directly under it. These exercise the resolveInside() containment added in
  // the 2026-07 security pass, through the actual handler code.
  const uniq = "provincia-harness-roundtrip.txt";
  afterAll(() => { try { fs.unlinkSync(path.join(os.tmpdir(), uniq)); } catch { /* */ } });

  it("round-trips a normal user file (save then read)", async () => {
    const ok = await H.invoke("save-user-file", uniq, "hello-harness");
    expect(ok).toBe(true);
    expect(await H.invoke("read-user-file", uniq)).toBe("hello-harness");
  });

  it("refuses a path-traversal name on read (contained to userData)", async () => {
    expect(await H.invoke("read-user-file", "..\\..\\..\\Windows\\win.ini")).toBeNull();
    expect(await H.invoke("read-user-file", "../../etc/passwd")).toBeNull();
  });

  it("refuses a path-traversal name on write (returns false, writes nothing outside)", async () => {
    const escaped = path.join(os.tmpdir(), "..", "provincia-escaped.txt");
    const ok = await H.invoke("save-user-file", "../provincia-escaped.txt", "nope");
    expect(ok).toBe(false);
    expect(fs.existsSync(escaped)).toBe(false);
  });
});

describe("campaign_data file handlers — traversal rejection (real handlers)", () => {
  // Only the rejection paths are exercised (they return before any write), so
  // these don't touch the repo build/ dir the success path also writes to.
  const travNames = ["..\\..\\..\\Windows\\System32\\x.txt", "../../../etc/x", "..\\escape.tga"];

  it("save-file rejects traversal names (returns false)", async () => {
    for (const n of travNames) expect(await H.invoke("save-file", n, "x")).toBe(false);
  });

  it("write-binary-file rejects traversal names (returns false)", async () => {
    const buf = new Uint8Array([1, 2, 3]);
    for (const n of travNames) expect(await H.invoke("write-binary-file", n, buf)).toBe(false);
  });

  it("copy-file rejects a traversal destination name (returns false)", async () => {
    // src can be anything; only the destName is renderer-controlled + contained.
    for (const n of travNames) expect(await H.invoke("copy-file", os.tmpdir() + "/whatever.bin", n)).toBe(false);
  });

  it("read-campaign-file returns null for a traversal name", async () => {
    for (const n of travNames) expect(await H.invoke("read-campaign-file", n)).toBeNull();
  });
});

// Behavioral coverage of the cache-backed read handlers, driven against the
// real local mod via main.js's exported loadModCharacterData. Skips cleanly
// where C:/RIS is absent (CI, other machines). Thresholds, not exact counts,
// so a mod update doesn't break the gate — this guards the save-editing read
// path (families / starting roster) against a refactor silently zeroing it.
const MOD_DIR = "C:/RIS/RIS/data";
const haveMod = (() => { try { return fs.existsSync(path.join(MOD_DIR, "export_descr_buildings.txt")); } catch { return false; } })();

(haveMod ? describe : describe.skip)("mod-data read handlers (real local mod)", () => {
  beforeAll(() => { H.main.loadModCharacterData(MOD_DIR); }, 30000);

  it("get-descr-strat-families returns a populated faction→family map", async () => {
    const fam = await H.invoke("get-descr-strat-families");
    expect(fam.ok).toBe(true);
    expect(Object.keys(fam.byFaction).length).toBeGreaterThan(50);
  });

  it("get-starting-characters returns the descr_strat roster", async () => {
    const sc = await H.invoke("get-starting-characters");
    expect(sc.ok).toBe(true);
    expect(sc.characters.length).toBeGreaterThan(100);
  });

  it("get-building-chain-levels parses the EDB chain→levels ladder (extracted domain)", async () => {
    const chains = await H.invoke("get-building-chain-levels", MOD_DIR);
    expect(chains && typeof chains).toBe("object");
    expect(Object.keys(chains).length).toBeGreaterThan(10);
  });

  it("get-unit-ownership + get-building-display-names return populated maps (use _unitOwnershipCache)", async () => {
    const uo = await H.invoke("get-unit-ownership", MOD_DIR);
    expect(Object.keys(uo).length).toBeGreaterThan(100);
    const bdn = await H.invoke("get-building-display-names", MOD_DIR);
    expect(Object.keys(bdn).length).toBeGreaterThan(100);
  });

  it("iconHandlers domain: unit stats/upkeep + building icon + banner resolve", async () => {
    const someUnit = Object.keys(await H.invoke("get-unit-ownership", MOD_DIR))[0];
    expect(await H.invoke("get-unit-stats", MOD_DIR, someUnit)).toBeTruthy();
    expect(Object.keys(await H.invoke("get-unit-upkeep-map", MOD_DIR) || {}).length).toBeGreaterThan(100);
    const icon = await H.invoke("resolve-building-icon", MOD_DIR, "roman", "core_building", null);
    expect(icon && icon.buffer).toBeTruthy(); // resolved a real TGA
    expect(await H.invoke("get-building-recruits", MOD_DIR)).toBeTruthy();
  });

  const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
  const saveFile = (() => { try { const s = fs.readdirSync(SAVE_DIR).filter((f) => f.endsWith(".sav")); return s.length ? path.join(SAVE_DIR, s[0]) : null; } catch { return null; } })();

  it.runIf(saveFile)("saveAnalysis domain: crack-save / get-save-economy / get-turn1-budget against a real save", { timeout: 40000 }, async () => {
    const cr = await H.invoke("crack-save", saveFile, MOD_DIR);
    expect(cr.factions && Object.keys(cr.factions).length).toBeGreaterThan(50);
    const eco = await H.invoke("get-save-economy", saveFile, MOD_DIR);
    expect(eco.byFaction && Object.keys(eco.byFaction).length).toBeGreaterThan(50);
    const b = await H.invoke("get-turn1-budget", MOD_DIR, "romans_julii", saveFile, false, null, null, null);
    expect(b && typeof b).toBe("object");
    expect(b.error).toBeUndefined();
  });

  // Locks the economyOnly fast-path invariant: get-save-economy runs crackSave
  // with { economyOnly: true } to skip the character/unit/family/siege/agent/
  // event/diplomacy parses it never reads (~1.8x faster, less main-thread block).
  // This MUST stay behaviour-identical for the Financial Overview — if a future
  // edit makes parseFinancialOverview depend on a skipped field, this fails.
  it.runIf(saveFile)("crackSave economyOnly yields identical Financial Overview to the full crack", { timeout: 40000 }, () => {
    const { crackSave } = require("./saveCracker.js");
    const { parseFinancialOverview } = require("./economyParser.js");
    const buf = fs.readFileSync(saveFile);
    const full = crackSave(buf, MOD_DIR);
    const eco = crackSave(buf, MOD_DIR, { economyOnly: true });
    expect(parseFinancialOverview(buf, eco)).toEqual(parseFinancialOverview(buf, full));
    // Economy-relevant crack fields must match exactly (skipped fields — chars,
    // units, family, sieges, diplomacy — are intentionally empty in economyOnly).
    expect(eco.playerFaction).toEqual(full.playerFaction);
    expect(eco.turn).toEqual(full.turn);
    expect(eco.ownerByCity).toEqual(full.ownerByCity);
    expect(eco.settlementFields).toEqual(full.settlementFields);
    for (const name of Object.keys(full.factions)) {
      expect(eco.factions[name].treasury).toEqual(full.factions[name].treasury);
      expect(eco.factions[name].regionCount).toEqual(full.factions[name].regionCount);
    }
    // And the fast path is meaningfully cheaper on the skipped parses.
    expect(eco.characters.v1.length).toBe(0);
    expect(eco.units.length).toBe(0);
    expect(full.characters.v1.length).toBeGreaterThan(0);
  });

  // Locks the tradeOnly fast-path invariant: crack-trade-network runs crackSave
  // with { tradeOnly: true } — same heavy-parse skip as economyOnly, but KEEPS
  // the diplomacy matrix (trade-rights gating needs it). computeTradeNetwork
  // uses only settlements/diplomacy/settlementFields/ownerByCity/playerFaction/
  // turn, so those must match the full crack byte-for-byte.
  it.runIf(saveFile)("crackSave tradeOnly matches the full crack on every field computeTradeNetwork reads", { timeout: 40000 }, () => {
    const { crackSave } = require("./saveCracker.js");
    const buf = fs.readFileSync(saveFile);
    const full = crackSave(buf, MOD_DIR);
    const trade = crackSave(buf, MOD_DIR, { tradeOnly: true });
    for (const k of ["settlements", "diplomacy", "settlementFields", "ownerByCity", "playerFaction", "turn"]) {
      expect(trade[k]).toEqual(full[k]);
    }
    // tradeOnly KEEPS diplomacy (unlike economyOnly) but still skips the heavy parses.
    expect(trade.diplomacy).not.toBeNull();
    expect(trade.characters.v1.length).toBe(0);
    expect(trade.units.length).toBe(0);
  });

  it("portraitHandlers domain: trait/ancillary/portrait resolvers run and degrade gracefully", async () => {
    // All three return a structured result (never throw) for the real mod.
    const ti = await H.invoke("resolve-trait-icon", MOD_DIR, "roman", "GoodCommander");
    expect(ti).toHaveProperty("ok");
    const ai = await H.invoke("resolve-ancillary-icon", MOD_DIR, "philosopher");
    expect(ai).toHaveProperty("ok");
    const pt = await H.invoke("resolve-portrait", MOD_DIR, "roman", "young", { faction: "romans_julii" });
    expect(pt === null || typeof pt === "object").toBe(true); // resolved image, or graceful null/{ok:false}
  });
});

describe("iconHandlers write handlers — safe no-op path (no active mod)", () => {
  it("revert-building-icon refuses when there is no active mod (getActiveModDataDir getter)", async () => {
    // activeModDataDir is null in the harness → the injected getter returns null →
    // the handler returns { ok:false } without touching the filesystem. This
    // exercises the getter injection for the extracted write handler.
    const r = await H.invoke("revert-building-icon", "C:/whatever/x.tga", null);
    expect(r).toMatchObject({ ok: false });
  });
});
