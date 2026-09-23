// Where an army stands after a message_log move line. A siege's end(x,y) is
// the town, so the besieging army was drawn on the town's own tile, under its
// icon (user report 2026-09-22, Marcus Ogulnius Gallus before Asculum).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseLine, restingTile } = require("./messageLogParser.js");

describe("restingTile", () => {
  it("keeps a besieging army outside the town it besieges", () => {
    const ev = parseLine("Marcus Ogulnius Gallus(5747adf0:army(a0ed5e20):romans_julii:named character):BESIEGE:start(296,419):end(296,418)");
    expect(ev.status).toBe("BESIEGE");
    expect(restingTile(ev)).toEqual({ x: 296, y: 419 });
  });

  it("puts an army that WALKED into its siege beside the town (engine-measured)", () => {
    // user report 2026-09-24: drawn at start(320,350); the running game had it at (319,349)
    const ev = parseLine("Lucius Cornelius Scipio(6ca09970:army(942516a0):romans_julii:named character):BESIEGE:start(320,350):end(319,348):loco(MOVING_NORMAL)");
    expect(ev.loco).toBe("MOVING_NORMAL");
    expect(restingTile(ev)).toEqual({ x: 319, y: 349 });
  });

  it("moves an ordinary march to its end tile", () => {
    const ev = parseLine("Marcus Ogulnius Gallus(5747adf0:army(a0ed5e20):romans_julii:named character):MOVING_NORMAL:start(295,421):end(296,420)");
    expect(restingTile(ev)).toEqual({ x: 296, y: 420 });
  });

  const LOG = "calibration/logs-archive/message_log-97turns.txt";
  it.skipIf(!fs.existsSync(LOG))("agrees with where each army's NEXT move starts, on a 97-turn log", () => {
    const last = new Map();
    let right = 0, wrong = 0;
    for (const line of fs.readFileSync(LOG, "utf8").split(/\r?\n/)) {
      const ev = parseLine(line);
      if (!ev || ev.type !== "character_move") continue;
      const prev = last.get(ev.charUuid);
      if (prev) {
        const at = restingTile(prev);
        const startsAtTo = ev.fromX === prev.toX && ev.fromY === prev.toY;
        const startsAtFrom = ev.fromX === prev.fromX && ev.fromY === prev.fromY;
        if (startsAtTo !== startsAtFrom) { // only lines that tell the two apart
          if (ev.fromX === at.x && ev.fromY === at.y) right++; else wrong++;
        }
      }
      last.set(ev.charUuid, ev);
    }
    expect(right).toBeGreaterThan(1500);
    expect(wrong / (right + wrong)).toBeLessThan(0.02);
  });
});
