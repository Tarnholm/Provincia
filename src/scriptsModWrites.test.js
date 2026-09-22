// Writes the Scripts suite (main-scripts.js) makes into the user's mod.
//  • sps:autofix-building-images promises "never overwritten", but its
//    "already there" test was a case-sensitive Set lookup while Windows file
//    names ignore case: a culture holding #ROMAN_temple.tga failed
//    has("#roman_temple.tga") and got another culture's temple copied over it,
//    with no backup. Now case-insensitive, and every copy is COPYFILE_EXCL.
//  • sps:save-back-to-mod wrote descr_strat first, then regions, then EDB, with
//    its own _backups copies and no rollback. It now goes through
//    safeWriteModFiles: stamped backups, descr_strat last, all-or-nothing.
import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-scripts-"));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
const put = (rel, body) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };

let invokeCached = null;
function loadScriptsHandlers() {
  if (invokeCached) return invokeCached;
  const captured = new Map();
  const noop = () => {};
  const userData = path.join(tmp, "userData");
  const electron = {
    app: { isPackaged: false, getPath: () => userData, getVersion: () => "0.0.0-test", on: noop, whenReady: () => new Promise(() => {}) },
    BrowserWindow: class { static getAllWindows() { return []; } },
    ipcMain: { handle: (ch, fn) => captured.set(ch, fn), on: noop, removeHandler: noop },
    dialog: {}, shell: {}, nativeTheme: { on: noop },
  };
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "electron") return electron;
    return orig.call(this, request, ...rest);
  };
  try { require(path.join(__dirname, "..", "main-scripts.js")); } finally { Module._load = orig; }
  invokeCached = (ch, ...args) => captured.get(ch)({ sender: { send: noop } }, ...args);
  return invokeCached;
}

describe("sps:autofix-building-images", () => {
  it("never replaces a culture's own art whose file name differs only in case", async () => {
    const invoke = loadScriptsHandlers();
    const mod = "iconmod";
    const own = put(`${mod}/ui/roman/buildings/#ROMAN_temple.tga`, "ROMAN ART");
    put(`${mod}/ui/greek/buildings/#greek_temple.tga`, "GREEK ART");
    put(`${mod}/ui/greek/buildings/#greek_barracks.tga`, "GREEK BARRACKS");

    const r = await invoke("sps:autofix-building-images", path.join(tmp, mod));
    expect(r.error).toBeNull();
    expect(fs.readFileSync(own, "utf8")).toBe("ROMAN ART");
    // what is genuinely missing still gets seeded
    const names = fs.readdirSync(path.join(tmp, mod, "ui/roman/buildings")).map((f) => f.toLowerCase());
    expect(names).toContain("#roman_barracks.tga");
    expect(r.copies.some((c) => /roman_temple\.tga$/i.test(c.to) && !/constructed|construction/.test(c.to))).toBe(false);
  });
});

describe("sps:save-back-to-mod", () => {
  const STRAT_OLD = "faction romans_julii, balanced smith\nsettlement\n{\n level town\n region Etruria\n}\n";
  const STRAT_NEW = STRAT_OLD + "; processed\n".repeat(3);
  const REGIONS_OLD = "Etruria\n\tArretium\n\tromans_julii\n";
  const campDir = (mod) => `${mod}/world/maps/campaign/imperial_campaign`;
  const out = (name, body) => put(`userData/scripts-suite/project/processed_output/${name}`, body);
  const baks = (p) => fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith(path.basename(p) + ".provincia-") && f.endsWith(".bak"));

  it("writes through stamped backups and reports the stamp", async () => {
    const invoke = loadScriptsHandlers();
    const mod = "savemod";
    const strat = put(`${campDir(mod)}/descr_strat.txt`, STRAT_OLD);
    const regions = put(`${campDir(mod)}/descr_regions.txt`, REGIONS_OLD);
    out("descr_strat.txt", STRAT_NEW);
    out("descr_regions.txt", REGIONS_OLD + "; hidden resources\n");

    const r = await invoke("sps:save-back-to-mod", path.join(tmp, mod), "imperial_campaign");
    expect(r.success, r.error).toBe(true);
    expect(fs.readFileSync(strat, "utf8")).toBe(STRAT_NEW);
    expect(fs.readFileSync(regions, "utf8")).toMatch(/hidden resources/);
    expect(baks(strat)).toEqual([`descr_strat.txt.provincia-${r.backupStamp}.bak`]);
    expect(fs.readFileSync(path.join(path.dirname(strat), baks(strat)[0]), "utf8")).toBe(STRAT_OLD);
    expect(fs.existsSync(path.join(path.dirname(strat), "_backups"))).toBe(false);
    // descr_strat is written last
    expect(r.saved.map((s) => s.split(" ")[0])).toEqual(["descr_regions.txt", "descr_strat.txt"]);
  });

  it("changes nothing when descr_strat cannot be written", async () => {
    const invoke = loadScriptsHandlers();
    const mod = "lockedmod";
    const strat = put(`${campDir(mod)}/descr_strat.txt`, STRAT_OLD);
    const regions = put(`${campDir(mod)}/descr_regions.txt`, REGIONS_OLD);
    out("descr_strat.txt", STRAT_NEW + "; newer\n");
    out("descr_regions.txt", REGIONS_OLD + "; hidden resources v2\n");
    // a directory where the rename must land makes the descr_strat write fail
    fs.rmSync(strat); fs.mkdirSync(strat); fs.writeFileSync(path.join(strat, "x"), "");
    const regionsBefore = fs.readFileSync(regions, "utf8");

    const r = await invoke("sps:save-back-to-mod", path.join(tmp, mod), "imperial_campaign");
    expect(r.success).toBe(false);
    expect(fs.readFileSync(regions, "utf8")).toBe(regionsBefore); // rolled back
  });
});
