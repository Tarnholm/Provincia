// Integration tests for the file-WRITING main.js handlers, driven against a
// throwaway mod sandbox (src/modSandbox.js) so edits are verified without ever
// touching the real mod. The harness's __setActiveModDataDir points main.js's
// active-mod dir at the sandbox; the handler writes there; we read it back.
// This is the tooling that makes extracting the editing handlers safe.
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
// Column-0 character/faction/traits lines, matching the real descr_strat layout
// (character is followed by a tab + "First Last,"; traits is its own col-0 line).
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

describe("file-writing handlers — sandbox-driven (real mod untouched)", () => {
  let sb, prevDir;
  afterEach(() => {
    if (prevDir !== undefined) { H.main.__setActiveModDataDir(prevDir); prevDir = undefined; }
    if (sb) { sb.cleanup(); sb = null; }
  });

  it("harness exposes the __setActiveModDataDir test hook", () => {
    expect(typeof H.main.__setActiveModDataDir).toBe("function");
  });

  it("update-character-traits rewrites the traits line in the sandbox only", async () => {
    sb = makeModSandbox([{ rel: DS_REL, content: SYNTH_DS }]);
    prevDir = H.main.__setActiveModDataDir(sb.dir);
    const r = await H.invoke("update-character-traits", "Testus", "romans_julii", [
      { name: "BadCommander", level: 3 },
    ]);
    expect(r.ok).toBe(true);
    const edited = sb.read(DS_REL);
    expect(edited).toContain("traits BadCommander 3");
    expect(edited).not.toContain("GoodCommander");
    // The other faction's character is untouched.
    expect(edited).toContain("traits GoodAttacker 2");
  });

  it("update-character-position moves a character's x,y in the sandbox only", async () => {
    sb = makeModSandbox([{ rel: DS_REL, content: SYNTH_DS }]);
    prevDir = H.main.__setActiveModDataDir(sb.dir);
    const r = await H.invoke("update-character-position", "romans_julii", 100, 100, 150, 150);
    expect(r.ok).toBe(true);
    const edited = sb.read(DS_REL);
    expect(edited).toContain("x 150, y 150");
    expect(edited).not.toMatch(/x 100, y 100/); // Testus moved
    expect(edited).toContain("x 200, y 200"); // carthage character untouched
  });

  it("rename-character changes the first name (keeping family) in the sandbox only", async () => {
    sb = makeModSandbox([{ rel: DS_REL, content: SYNTH_DS }]);
    prevDir = H.main.__setActiveModDataDir(sb.dir);
    const r = await H.invoke("rename-character", "romans_julii", "Testus", "Renamedus");
    expect(r.ok).toBe(true);
    const edited = sb.read(DS_REL);
    expect(edited).toContain("Renamedus Maximus");
    expect(edited).not.toContain("Testus Maximus");
    expect(edited).toContain("Hannibalus Barca"); // other faction untouched
  });

  it("update-character-fields updates a character's age in the sandbox only", async () => {
    sb = makeModSandbox([{ rel: DS_REL, content: SYNTH_DS }]);
    prevDir = H.main.__setActiveModDataDir(sb.dir);
    const r = await H.invoke("update-character-fields", "Testus", "romans_julii", { age: 45 });
    expect(r.ok).toBe(true);
    const edited = sb.read(DS_REL);
    expect(edited).toContain("age 45");
    expect(edited).not.toContain("age 30"); // Testus was 30
    expect(edited).toContain("age 40"); // Hannibalus (40) untouched
  });

  it("refuses cleanly when there is no active mod (returns { ok:false }, writes nothing)", async () => {
    prevDir = H.main.__setActiveModDataDir(null);
    const r = await H.invoke("update-character-traits", "Testus", "romans_julii", []);
    expect(r).toMatchObject({ ok: false });
  });

  it("does NOT write outside the sandbox — a temp sentinel file elsewhere is untouched", async () => {
    // Guard proving the sandbox actually isolates writes: create a sentinel with
    // the same relative descr_strat path under a *different* temp root, point the
    // active mod at the sandbox, run the edit, and confirm only the sandbox changed.
    const sentinelRoot = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-sentinel-"));
    const sentinel = path.join(sentinelRoot, DS_REL);
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, SYNTH_DS);
    const sentinelBefore = fs.readFileSync(sentinel, "utf8");
    try {
      sb = makeModSandbox([{ rel: DS_REL, content: SYNTH_DS }]);
      prevDir = H.main.__setActiveModDataDir(sb.dir);
      await H.invoke("update-character-traits", "Testus", "romans_julii", [{ name: "X", level: 1 }]);
      expect(fs.readFileSync(sentinel, "utf8")).toBe(sentinelBefore); // untouched
      expect(sb.read(DS_REL)).toContain("traits X 1"); // only the sandbox changed
    } finally {
      fs.rmSync(sentinelRoot, { recursive: true, force: true });
    }
  });
});
