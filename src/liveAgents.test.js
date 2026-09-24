// Agents (item 8, 2026-09-24): read from the save (saveCrackerExtras.parseAgents,
// 303/303 against the running engine) and moved live from message_log. Ground
// truth for the moves: the Turn 5 End save's agents, moved by every agent line
// of the AI phase that follows, against where the Turn 6 Start save has them.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { applyAgentMoves } from "./liveDiplomacy.js";

const require = createRequire(import.meta.url);
const x = require("./saveCrackerExtras.js");
const sc = require("./saveCracker.js");
const p = require("./messageLogParser.js");
const lw = require("./logWatchHandlers.js");
const { readTga } = require("./startingArmiesBuilder.js");

const MOD = "C:/RIS/RIS/data";
const R = path.resolve(__dirname, "../calibration/saves-2026-09-24/recruit");
const have = ["t5_end.sav", "t6_start.sav", "message_log_latest.txt"].every((n) => fs.existsSync(path.join(R, n))) && fs.existsSync(path.join(MOD, "world/maps/base/descr_regions.txt"));

const smOrder = () => {
  const out = [];
  for (const l of fs.readFileSync(path.join(MOD, "descr_sm_factions.txt"), "utf8").split("\n")) { const m = l.match(/^\t"([a-z_0-9]+)":/); if (m) out.push(m[1]); }
  return out;
};
// Town name -> tile: the black pixel next to its region's colour (map_regions.tga).
const townTiles = () => {
  const lines = fs.readFileSync(path.join(MOD, "world/maps/base/descr_regions.txt"), "latin1").split(/\r?\n/).map((l) => l.replace(/;.*$/, "").trim()).filter(Boolean);
  const byRgb = {};
  for (let i = 0; i + 4 < lines.length; i++) {
    const rgb = lines[i + 4].match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (/^[A-Za-z]/.test(lines[i]) && /^[A-Za-z]/.test(lines[i + 1]) && rgb) byRgb[`${rgb[1]},${rgb[2]},${rgb[3]}`] = lines[i + 1];
  }
  const { w, h, getPixel } = readTga(fs.readFileSync(path.join(MOD, "world/maps/base/map_regions.tga")));
  const out = new Map();
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const px = getPixel(xx, y);
    if (!px || px[0] || px[1] || px[2]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = getPixel(xx + dx, y + dy);
      const town = n && byRgb[n.join(",")];
      if (town) { const k = town.toLowerCase().replace(/[^a-z0-9]/g, ""); if (!out.has(k)) out.set(k, { x: xx, y }); break; }
    }
  }
  return out;
};

describe.skipIf(!have)("agents on a real RIS campaign", () => {
  const order = have ? smOrder() : [];
  const agents = (f) => {
    const buf = fs.readFileSync(path.join(R, f));
    const log = console.log; console.log = () => {};
    try { return x.parseAgents(buf, sc.crackSave(buf, MOD, {}).characters.v1, order); } finally { console.log = log; }
  };

  it("the AI phase's agent lines bring one save's agents to the next save's", async () => {
    const a5 = agents("t5_end.sav"), a6 = agents("t6_start.sav");
    // The watcher over the log, stopped at the Turn 6 Start save: collect the
    // agent events it sends for the AI phase after Turn 5 End.
    const text = fs.readFileSync(path.join(R, "message_log_latest.txt"), "latin1");
    const lines = text.split(/\r?\n/);
    const cut = lines.findIndex((l) => /Campaign saved:.*Turn 6 Start\.sav/.test(l));
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "provincia-agents-"));
    fs.writeFileSync(path.join(dir, "message_log.txt"), lines.slice(0, cut).join("\n") + "\n");
    const handlers = new Map(), sent = [];
    lw.registerLogWatchHandlers({ handle: (c, f) => handlers.set(c, f) }, {
      BrowserWindow: { getAllWindows: () => [{ webContents: { send: (c, pl) => { if (c === "live-char-moves") sent.push(pl); } } }] },
      getLogPath: () => null,
    });
    await handlers.get("log-watch-start")(null, dir);
    await handlers.get("log-watch-stop")();
    fs.rmSync(dir, { recursive: true, force: true });
    const moves = sent.flatMap((pl) => pl.agentMoves || []); // only after the newest save (Turn 5 End)
    const tiles = townTiles();
    const got = applyAgentMoves(a5, moves, () => true, (town) => tiles.get(String(town).toLowerCase().replace(/[^a-z0-9]/g, "")) || null);
    const key = (a) => `${a.faction}|${a.name}|${a.type}|${a.x},${a.y}`;
    const want = new Set(a6.map(key));
    const right = got.filter((a) => want.has(key(a))).length;
    const unmoved = a5.filter((a) => want.has(key(a))).length;
    // Measured 2026-09-24: 61 of 256 agents are where the Turn 5 End save had
    // them; with the log's moves, deaths, flights and new recruits, 245 are.
    // The other 11 stopped partway along a move (a tile or two short of the
    // line's end — nothing in the log says so); the next save corrects them.
    expect(unmoved).toBe(61);
    expect(right).toBeGreaterThanOrEqual(245);
    expect(got.length).toBe(a6.length);
  }, 240000);

  it("reads each agent's type, faction and name", () => {
    const a6 = agents("t6_start.sav");
    expect(a6.length).toBe(256);
    expect(a6.every((a) => a.name && a.faction && ["spy", "diplomat", "assassin", "merchant"].includes(a.type))).toBe(true);
  }, 120000);
});
