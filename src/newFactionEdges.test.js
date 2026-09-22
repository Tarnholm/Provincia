// New Faction defects found after v0.9.1514 shipped.
//  • The LAST entry of descr_sm_factions (RIS: dummies) ran to end of file, so
//    its clone carried the file's closing `],` and landed after it.
//  • `slave` is the last faction of every descr_character `type` section; its
//    block ran on through the next `type` header, and the clone landed inside
//    the following section.
//  • The strat line pointed at the donor's AI label, so the cloned
//    `personality ai_<new>` was never used.
//  • Files were written one by one: a failure part-way left descr_sm_factions
//    holding the new id and every retry said "already exists".
//  • In export mode a second New Faction rebuilt from the live files and
//    dropped the first; a stale campaign name silently fell back to another.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planNewFaction } = require("./newFaction.js");
const { registerNewFactionHandlers, ordinal } = require("./newFactionHandlers.js");

const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

describe("block boundaries", () => {
  const SM = [
    ";; factions", "[",
    TAB + '"parni":', TAB + "{", TAB + TAB + '"string": "PARNI",', TAB + "},",
    TAB + '"dummies":', TAB + "{", TAB + TAB + '"string": "DUMMIES",', "", TAB + TAB + ";; trailing comment", TAB + TAB + '"allow reproduction": false,', TAB + "},",
    "],",
  ].join(NL);
  const CHARACTER = [
    "type" + TAB + "named character", "actions" + TAB + "none",
    "faction" + TAB + "parni", "dictionary" + TAB + "2", "",
    "faction" + TAB + "slave", "dictionary" + TAB + "2", "", "",
    ";;;;;;;;;;;;", "type" + TAB + "general", "actions" + TAB + "none", "wage_base" + TAB + "0",
    "faction" + TAB + "parni", "dictionary" + TAB + "3", "",
    "faction" + TAB + "slave", "dictionary" + TAB + "3",
  ].join(NL);
  const AI = ["personality ai_dummies", "building_priority dummies", "", "personality ai_slave", "building_priority slave"].join(NL);
  const files = () => ({ smFactions: SM, character: CHARACTER, banners: "faction dummies" + NL + "x y" + NL + "faction slave" + NL + "x y", aiPersonality: AI });

  it("clones the last descr_sm_factions entry inside the list, before its closing bracket", () => {
    const r = planNewFaction({ files: { ...files(), character: CHARACTER.replace(/slave/g, "dummies") }, donor: "dummies", newId: "tocharians" });
    expect(r.errors).toEqual([]);
    const L = r.edits.smFactions.split(NL);
    expect(L.filter((l) => l === "],").length).toBe(1);
    expect(L[L.length - 1]).toBe("],");
    expect(L.indexOf(TAB + '"tocharians":')).toBeGreaterThan(L.indexOf(TAB + '"dummies":'));
    expect(L.indexOf(TAB + '"tocharians":')).toBeLessThan(L.indexOf("],"));
    // the clone is whole and closed
    const at = L.indexOf(TAB + '"tocharians":');
    expect(L.slice(at, at + 7)).toContain(TAB + "},");
  });

  it("clones slave inside each type section, never across the next header", () => {
    const r = planNewFaction({ files: { ...files(), smFactions: SM.replace(/dummies/g, "slave") }, donor: "slave", newId: "tocharians" });
    expect(r.errors).toEqual([]);
    const L = r.edits.character.split(NL);
    expect(L.filter((l) => /^type\b/.test(l)).length).toBe(2);        // no duplicated header
    expect(L.filter((l) => /^wage_base\b/.test(l)).length).toBe(1);
    const general = L.indexOf("type" + TAB + "general");
    const clones = L.map((l, i) => (l === "faction" + TAB + "tocharians" ? i : -1)).filter((i) => i >= 0);
    expect(clones.length).toBe(2);
    expect(clones[0]).toBeLessThan(general);                            // named-character clone stays in its section
    expect(L[clones[0] + 1]).toBe("dictionary" + TAB + "2");
    expect(clones[1]).toBeGreaterThan(general);
    expect(L[clones[1] + 1]).toBe("dictionary" + TAB + "3");
  });

  it("says 240th, not 240st", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 240].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th", "240th"]);
  });
});

// ── the IPC layer, writing for real into a copy of the installed RIS ─────────
const RIS = "C:/RIS/RIS/data";
const haveRis = fs.existsSync(RIS + "/descr_sm_factions.txt") && fs.existsSync(RIS + "/world/maps/base/map_regions.tga");
const NEEDED = [
  "descr_sm_factions.txt", "descr_character.txt", "descr_model_strat.txt", "descr_banners.txt",
  "feral_descr_ai_personality.txt", "descr_namelists.txt", "text/expanded_bi.txt",
  "world/maps/base/descr_regions.txt", "world/maps/base/map_regions.tga",
  "world/maps/campaign/imperial_campaign/descr_strat.txt", "world/maps/campaign/imperial_campaign/descr_win_conditions.txt",
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-newfaction-"));
afterAll(() => {
  for (const f of walk(tmp)) { try { fs.chmodSync(f, 0o666); } catch { /* */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
});
function walk(d) { const out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function copyMod(name) {
  const dir = path.join(tmp, name);
  for (const rel of NEEDED) { const to = path.join(dir, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(RIS, rel), to); }
  return dir;
}
function handlers(opts) {
  const h = {};
  registerNewFactionHandlers({ handle: (n, fn) => { h[n] = fn; } }, opts);
  return (n, ...a) => h[n](null, ...a);
}
async function choiceFor(call, dir, newId) {
  const donor = await call("new-faction-donor", dir, "parni");
  const town = donor.settlements.find((s) => s.owner === "pontus");
  return { donor: "parni", newId, campaign: "imperial_campaign", settlements: [town.region],
    leader: { name: donor.names[0], age: 42 }, heir: { name: donor.names[1], age: 20 }, aiLabel: donor.aiLabel };
}

describe.skipIf(!haveRis)("new-faction-apply, writing", () => {
  it("points the strat line at the new faction's own AI personality", async () => {
    const dir = copyMod("ai");
    const call = handlers({ getActiveModDataDir: () => dir });
    const r = await call("new-faction-apply", dir, await choiceFor(call, dir, "tocharians"));
    expect(r.error).toBeUndefined();
    const strat = fs.readFileSync(path.join(dir, NEEDED[9]), "latin1");
    expect(strat).toMatch(/^faction\s+tocharians\s*,\s*ai_tocharians\b/m);
    expect(fs.readFileSync(path.join(dir, "feral_descr_ai_personality.txt"), "latin1")).toMatch(/^personality ai_tocharians\s*$/m);
    // one stamp for the whole set
    expect(new Set(r.written.map((w) => w.backupStamp)).size).toBe(1);
    expect(r.written[r.written.length - 1].key).toBe("strat");
  });

  it("changes nothing when one file cannot be written, so a retry works", async () => {
    const dir = copyMod("locked");
    const call = handlers({ getActiveModDataDir: () => dir });
    const choice = await choiceFor(call, dir, "tocharians");
    const sm = path.join(dir, "descr_sm_factions.txt");
    const before = fs.readFileSync(sm);
    // a read-only descr_banners refuses the rename (EPERM), as a file the
    // running game holds would
    const banners = path.join(dir, "descr_banners.txt");
    fs.chmodSync(banners, 0o444);
    const r = await call("new-faction-apply", dir, choice);
    expect(r.error).toBeTruthy();
    expect(fs.readFileSync(sm).equals(before)).toBe(true);           // rolled back
    fs.chmodSync(banners, 0o666);
    const again = await call("new-faction-apply", dir, choice);
    expect(again.error).toBeUndefined();                              // not "already exists"
  });

  it("in export mode, a second new faction keeps the first", async () => {
    const dir = copyMod("live");
    const exportDir = path.join(tmp, "export");
    const modOut = (p) => path.join(exportDir, path.relative(dir, p));
    const call = handlers({ getActiveModDataDir: () => dir, getModExportDir: () => exportDir, modOut });
    const a = await call("new-faction-apply", dir, await choiceFor(call, dir, "tocharians"));
    expect(a.error).toBeUndefined();
    const b = await call("new-faction-apply", dir, await choiceFor(call, dir, "sakas"));
    expect(b.error).toBeUndefined();
    const sm = fs.readFileSync(path.join(exportDir, "descr_sm_factions.txt"), "latin1");
    expect(sm).toMatch(/^\t"tocharians":/m);
    expect(sm).toMatch(/^\t"sakas":/m);
    expect(fs.readFileSync(path.join(dir, "descr_sm_factions.txt"), "latin1")).not.toMatch(/tocharians/); // live untouched
  });

  it("refuses a campaign this mod does not have instead of using another", async () => {
    const dir = copyMod("camp");
    const call = handlers({ getActiveModDataDir: () => dir });
    const choice = { ...(await choiceFor(call, dir, "tocharians")), campaign: "ris_light" };
    const r = await call("new-faction-apply", dir, choice);
    expect(r.error).toMatch(/no campaign "ris_light"/);
  });
});
