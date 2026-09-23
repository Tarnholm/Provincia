// Build and recruit queues against a live RIS campaign (user request
// 2026-09-24: "make sure you get the live building progress right, aka how many
// turns are left"; turns differ per settlement).
//  • A NEW building (save record at health 0) was taken for a built one: the
//    queue then targeted the level above (colony_2) with no progress. Its own
//    record holds the progress, with the settlement's modifiers in the total.
//  • The RIS recruit queue never parsed (the block-end preamble isn't always
//    size 0x0c), so every settlement showed "No queue".
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const bp = require("./buildingParser.js");
const qp = require("./queueParser.js");
const DIR = path.resolve(__dirname, "../calibration/saves-2026-09-24");
const file = (n) => path.join(DIR, n);
const have = ["rome_t6_start.sav", "rome_t8_start.sav"].every((n) => fs.existsSync(file(n)));

describe.skipIf(!have)("construction queue on a real RIS campaign", () => {
  const q = (save, city) => {
    const s = bp.parseSettlements(fs.readFileSync(file(save)), null, null).settlements.find((x) => x.name === city);
    return s ? s.queued : null;
  };
  it("a new building shows its own progress; the settlement's modifiers are in the stored total", () => {
    expect(q("rome_t8_start.sav", "Ankon")).toEqual([
      { name: "colony", kind: "new", level: 0, percent: 16, turnsTotal: 6, turnsElapsed: 1, turnsRemaining: 5 },
    ]);
    // Rhegium's colony: the EDB says 6 turns; its mountains tag (construction
    // time -20%) makes it 7 in the game, and the save stores 7.
    expect(q("rome_t8_start.sav", "Rhegium")).toEqual([
      { name: "colony", kind: "new", level: 0, percent: 14, turnsTotal: 7, turnsElapsed: 1, turnsRemaining: 6 },
    ]);
  });
  it("an upgrade keeps reading from its queue entry", () => {
    expect(q("rome_t8_start.sav", "Capua")).toEqual([
      { name: "military_industrial_complex", kind: "upgrade", percent: 33, turnsTotal: 6, turnsElapsed: 2, turnsRemaining: 4 },
    ]);
  });
});

describe.skipIf(!have)("recruitment queue on a real RIS campaign", () => {
  it("reads the units being trained", () => {
    const buf = fs.readFileSync(file("rome_t6_start.sav"));
    const byCity = qp.parseQueuesForSettlements(buf, bp.findAllSettlementMarkers(buf));
    expect(byCity.get("Asculum").recruiting).toEqual([{ unit: "picentine swordsmen" }]);
  });
});
