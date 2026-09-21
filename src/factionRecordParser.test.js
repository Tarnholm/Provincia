import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import { findFactionRecords, summarizeFactionArray } from "./factionRecordParser.js";
const require = createRequire(import.meta.url);
const { fixture, fixtures, read } = require("./saveFixtures.js");

// Real-save fixtures: `node scripts/build-save-fixtures.js`. Absent → these skip.
// The saves predate the current mod, so counts come from the manifest recorded
// beside each fixture, not from today's C:/RIS.
describe("findFactionRecords", () => {
  test("finds the recorded number of records in a turn-1 save", (ctx) => {
    const f = fixture("identical_A.sav");
    if (!f) return ctx.skip();
    const recs = findFactionRecords(read(f));
    expect(recs.length).toBe(f.expect.factionRecords);
    expect(recs.length).toBeGreaterThan(200); // a whole-map mod, not a handful
  });

  test("identical-state pair produces identical output (parser determinism)", (ctx) => {
    const pair = fixtures("identical_A.sav", "identical_B.sav");
    if (!pair) return ctx.skip();
    const [a, b] = pair;
    expect(read(a).equals(read(b))).toBe(false); // same state, different bytes
    const recA = findFactionRecords(read(a));
    const recB = findFactionRecords(read(b));
    expect(recA.length).toBe(recB.length);
    expect(recA.map((r) => r.offset)).toEqual(recB.map((r) => r.offset));
    expect(recA.map((r) => r.size)).toEqual(recB.map((r) => r.size));
  });

  test("the array grows with campaign turn (same campaign, 12 turns apart)", (ctx) => {
    const pair = fixtures("ror_t5s.sav", "ror_t17s.sav");
    if (!pair) return ctx.skip();
    const [early, late] = pair;
    const sumEarly = summarizeFactionArray(findFactionRecords(read(early)));
    const sumLate = summarizeFactionArray(findFactionRecords(read(late)));
    expect(sumLate.totalBytes).toBeGreaterThan(sumEarly.totalBytes);
    // and the span each fixture was accepted with
    expect(findFactionRecords(read(early)).reduce((m, r) => Math.max(m, r.offset), 0) - findFactionRecords(read(early)).reduce((m, r) => Math.min(m, r.offset), Infinity)).toBe(early.expect.factionArraySpan);
    expect(findFactionRecords(read(late)).reduce((m, r) => Math.max(m, r.offset), 0) - findFactionRecords(read(late)).reduce((m, r) => Math.min(m, r.offset), Infinity)).toBe(late.expect.factionArraySpan);
  });

  test("returns empty array on a buffer without the magic", () => {
    const buf = Buffer.alloc(1024);  // all zeros
    expect(findFactionRecords(buf)).toEqual([]);
  });
});
