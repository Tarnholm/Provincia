import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import { findLuaCounters, indexCountersByName } from "./luaCounterParser.js";
const require = createRequire(import.meta.url);
const { fixture, fixtures, read } = require("./saveFixtures.js");

// Real-save fixtures: `node scripts/build-save-fixtures.js`. Absent → these skip.
describe("findLuaCounters", () => {
  test("finds the recorded number of counters in a turn-1 save", (ctx) => {
    const f = fixture("identical_A.sav");
    if (!f) return ctx.skip();
    expect(findLuaCounters(read(f)).length).toBe(f.expect.luaCounters);
  });

  test("known faction UUIDs match cross-validation", (ctx) => {
    const f = fixture("identical_A.sav");
    if (!f) return ctx.skip();
    const byName = indexCountersByName(findLuaCounters(read(f)));
    // Verified against the Python rtw-sav-parser cracker 2026-05-09. These ids
    // are the engine's own faction ids, not mod data, so they hold across mod
    // versions — unlike the counter COUNT above, which is per-save.
    expect(byName.get("id_sparta")).toBe(1330481);
    expect(byName.get("id_romans_julii")).toBe(1110011);
    expect(byName.get("id_athens")).toBe(1330201);
  });

  test("identical-state pair produces identical counter output", (ctx) => {
    const pair = fixtures("identical_A.sav", "identical_B.sav");
    if (!pair) return ctx.skip();
    const [a, b] = pair;
    expect(read(a).equals(read(b))).toBe(false); // same state, different bytes
    const ca = findLuaCounters(read(a));
    const cb = findLuaCounters(read(b));
    expect(ca.length).toBe(cb.length);
    expect(ca.map((r) => r.name)).toEqual(cb.map((r) => r.name));
    expect(ca.map((r) => r.value)).toEqual(cb.map((r) => r.value));
  });

  test("returns empty array on a buffer without the table", () => {
    const buf = Buffer.alloc(1024);
    expect(findLuaCounters(buf)).toEqual([]);
  });
});
