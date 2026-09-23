// Two ways the live log watcher put armies in the wrong place or lost them.
//  • `found flee tile(x,y)` was read as a move. It is only the tile a battle
//    sets aside in case the army loses — winners log one too. User report
//    2026-09-24: Lucius Valerius Flaccus reinforced the assault on Rhegium,
//    won, stayed beside the town, and was drawn at his flee tile 41 tiles
//    away. The real retreats (`is fleeing to tile/settlement`) never parsed.
//  • The 2 s tail read to the end of the file. The game writes the log in
//    blocks that end mid-line, so a line caught at a block edge was split in
//    two unparseable halves and lost.
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const lw = require("./logWatchHandlers.js");
const { parseLine } = require("./messageLogParser.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-livelogflee-"));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const FLACCUS_MOVE = "Lucius Valerius Flaccus(6ca10e40:army(94250260):romans_julii:named character):MOVING_NORMAL:start(321,352):end(320,349)";
const FLACCUS_FLEE_TILE = "Lucius Valerius Flaccus(6ca10e40:romans_julii)army(94250260) found flee tile(320,390)";
const ROUTED = "Admiral Assandros(c20c0cf0:macedon)army(c3551750) is fleeing to tile(17,38)";
const ROUTED_HOME = "Captain Aristonous(d18c2400)army(1f3a5750) is fleeing to settlement Pella(7,49)";

describe("flee lines in the parser", () => {
  it("reads both real retreat shapes", () => {
    expect(parseLine(ROUTED)).toMatchObject({ type: "fleeing_to_tile", name: "Admiral Assandros", charUuid: "c20c0cf0", faction: "macedon", x: 17, y: 38 });
    expect(parseLine(ROUTED_HOME)).toMatchObject({ type: "fleeing_to_settlement", name: "Captain Aristonous", charUuid: "d18c2400", settlement: "Pella", x: 7, y: 49 });
  });

  const LOG = path.resolve(__dirname, "../calibration/logs-archive/message_log-97turns.txt");
  it.skipIf(!fs.existsSync(LOG))("on a 97-turn log: a flee tile is not where the army goes; a retreat line is", () => {
    const pend = new Map();
    const tally = { flee_tile: [0, 0], fleeing_to_tile: [0, 0] };
    let retreatLines = 0, retreatParsed = 0;
    for (const line of fs.readFileSync(LOG, "utf8").split(/\r?\n/)) {
      if (/ is fleeing to /.test(line)) retreatLines++;
      const ev = parseLine(line);
      if (!ev) continue;
      if (/^fleeing_to_/.test(ev.type)) retreatParsed++;
      if (tally[ev.type] && ev.charUuid) { pend.set(ev.charUuid + ev.type, ev); continue; }
      if (ev.type !== "character_move") continue;
      for (const t of Object.keys(tally)) {
        const f = pend.get(ev.charUuid + t);
        if (f) tally[t][ev.fromX === f.x && ev.fromY === f.y ? 0 : 1]++;
        pend.delete(ev.charUuid + t);
      }
    }
    expect(retreatParsed).toBe(retreatLines); // 59 of 59; was 0
    const rate = ([hit, miss]) => hit / (hit + miss);
    expect(rate(tally.flee_tile)).toBeLessThan(0.1);        // measured 16 of 222
    expect(rate(tally.fleeing_to_tile)).toBeGreaterThan(0.6); // measured 26 of 37
  });
});

describe("live log watcher", () => {
  let handlers, sent, dir, logPath;
  const start = async (text) => {
    handlers = new Map();
    sent = [];
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
    const win = { webContents: { send: (ch, payload) => { if (ch === "live-char-moves") sent.push(payload); } } };
    lw.registerLogWatchHandlers(ipcMain, { BrowserWindow: { getAllWindows: () => [win] }, getLogPath: () => dir });
    dir = fs.mkdtempSync(path.join(tmp, "logs-"));
    logPath = path.join(dir, "message_log.txt");
    fs.writeFileSync(logPath, text);
    const res = await handlers.get("log-watch-start")(null, dir);
    expect(res.ok).toBe(true);
  };
  const moves = () => sent.flatMap((p) => p.moves || []);
  afterEach(async () => {
    if (handlers) await handlers.get("log-watch-stop")();
    vi.useRealTimers();
  });

  it("a winner's flee tile does not move it; a real retreat does", async () => {
    await start([FLACCUS_MOVE, FLACCUS_FLEE_TILE, ROUTED, ROUTED_HOME, ""].join("\n"));
    const at = Object.fromEntries(moves().map((m) => [m.name, [m.x, m.y]]));
    expect(at["Lucius Valerius Flaccus"]).toEqual([320, 349]);
    expect(at["Admiral Assandros"]).toEqual([17, 38]);
    expect(at["Captain Aristonous"]).toEqual([7, 49]);
  });

  it("a line the game has only half written is read once it is whole", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const unfinished = "Lucius Cornelius Scipio(6ca09970:army(942516a0):romans_julii:named character):MOVING_NORMAL:start(3";
    await start("header\n" + unfinished);
    expect(moves()).toEqual([]); // backfill stops before the half line
    fs.appendFileSync(logPath, "20,350):end(3");
    vi.advanceTimersByTime(2100);
    expect(moves()).toEqual([]);
    fs.appendFileSync(logPath, "19,349)\n");
    vi.advanceTimersByTime(2100);
    expect(moves().map((m) => [m.name, m.x, m.y])).toEqual([["Lucius Cornelius Scipio", 319, 349]]);
  });
});
