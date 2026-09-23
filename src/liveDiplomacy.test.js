// Diplomacy between saves, from message_log (user reports 2026-09-24): a war
// the player started against the Messapians didn't show until the next save,
// Picentes stayed "at war" after being destroyed, and the Picentes admiral who
// passed to the rebels kept the Picentes banner.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { applyLiveDiplomacy, liveFactionChanges } = require("./liveDiplomacy.js");
const { parseLine, battleMainArmies, battleSetupStarts } = require("./messageLogParser.js");
const lw = require("./logWatchHandlers.js");

const matrix = () => ({
  romans_julii: { war: ["picentes", "slave"], allied: ["samnites"], trade: ["samnites", "messapians"], hostile: [], protectorates: [], suzerains: [], rel: [{ to: "messapians", att: 200, bond: 46 }] },
  messapians: { war: [], allied: [], trade: ["romans_julii"], hostile: [], protectorates: [], suzerains: [], rel: [] },
  picentes: { war: ["romans_julii"], allied: [], trade: [], hostile: [], protectorates: [], suzerains: [], rel: [] },
  samnites: { war: [], allied: ["romans_julii"], trade: ["romans_julii"], hostile: [], protectorates: [], suzerains: [], rel: [] },
  _meta: { N: 4 },
});

describe("applyLiveDiplomacy", () => {
  it("a battle puts both sides at war and ends their treaties", () => {
    const m = matrix();
    const out = applyLiveDiplomacy(m, [{ type: "war", a: "romans_julii", b: "messapians", seq: 10 }]);
    expect(out.romans_julii.war).toContain("messapians");
    expect(out.messapians.war).toContain("romans_julii");
    expect(out.romans_julii.trade).toEqual(["samnites"]);
    expect(out.messapians.trade).toEqual([]);
    expect(m.romans_julii.war).toEqual(["picentes", "slave"]); // input untouched
  });

  it("a destroyed faction leaves every list and loses its row", () => {
    const out = applyLiveDiplomacy(matrix(), [{ type: "dead", faction: "picentes", seq: 5 }]);
    expect(out.romans_julii.war).toEqual(["slave"]);
    expect(out.picentes).toBeUndefined();
    expect(out._meta).toEqual({ N: 4 });
  });

  it("only events after the loaded save apply", () => {
    const m = matrix();
    expect(applyLiveDiplomacy(m, [{ type: "war", a: "romans_julii", b: "samnites", seq: 3 }], (e) => e.seq > 7)).toBe(m);
  });

  it("faction changes: last one after the save wins, ids padded to 8", () => {
    const m = liveFactionChanges([
      { charUuid: "ea86930", to: "slave", seq: 9 },
      { charUuid: "1234abcd", to: "egypt", seq: 2 },
    ], (e) => e.seq > 5);
    expect(m.get("0ea86930")).toBe("slave");
    expect(m.has("1234abcd")).toBe(false);
  });
});

describe("log lines", () => {
  it("reads the three shapes the game writes", () => {
    expect(parseLine("changing Admiral Herius(ea86930) from faction(picentes) to faction(slave)")).toMatchObject({ type: "faction_change", name: "Admiral Herius", charUuid: "ea86930", fromFaction: "picentes", toFaction: "slave" });
    expect(parseLine("picentes faction is dead")).toMatchObject({ type: "faction_dead", faction: "picentes", untilResurrected: false });
    expect(battleSetupStarts("promoting general(Bosat:5c6ad540) for sallying army(5bc93140) in Uria to attack army(Captain Quintus:276b1620)***** Battle Setup Phase Started *****")).toBe(true);
    expect(battleMainArmies("battle general created(cfd93200 - army(276b1620), unit(3be5c8f0))adding main army(276b1620:messapians:1 alnce1) to battle")).toEqual([{ faction: "messapians", alliance: 1 }]);
  });
});

const LOG = path.resolve(__dirname, "../calibration/saves-2026-09-24/message_log.txt");
describe.skipIf(!fs.existsSync(LOG))("the watcher on the real session log", () => {
  let stop;
  afterEach(async () => { if (stop) await stop(); });
  it("reports the Messapian war, both deaths, and the Picentes admiral turning rebel", async () => {
    const handlers = new Map();
    const sent = [];
    lw.registerLogWatchHandlers({ handle: (c, f) => handlers.set(c, f) }, {
      BrowserWindow: { getAllWindows: () => [{ webContents: { send: (c, p) => { if (c === "live-char-moves") sent.push(p); } } }] },
      getLogPath: () => null,
    });
    const res = await handlers.get("log-watch-start")(null, path.dirname(LOG));
    stop = () => handlers.get("log-watch-stop")();
    expect(res.ok).toBe(true);
    const diplo = sent.flatMap((p) => p.diplo || []);
    const changes = sent.flatMap((p) => p.factionChanges || []);
    const saves = sent.flatMap((p) => p.savesWritten || []);
    const war = (a, b) => diplo.find((e) => e.type === "war" && [e.a, e.b].sort().join("~") === [a, b].sort().join("~"));
    const t6 = saves.find((s) => /Turn 6 Start/.test(s.file));
    expect(war("romans_julii", "messapians").seq).toBeGreaterThan(t6.seq); // started in turn 6
    expect(diplo.filter((e) => e.type === "dead").map((e) => e.faction)).toEqual(["dummies", "picentes", "messapians"]);
    expect(changes).toContainEqual(expect.objectContaining({ name: "Admiral Herius", charUuid: "ea86930", from: "picentes", to: "slave" }));
  });
});
