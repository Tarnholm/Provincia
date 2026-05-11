import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findLuaCounters, indexCountersByName } from "./luaCounterParser.js";

const FIXTURE_DIR = path.join("scripts", "save-cracker", "fixtures", "feral");

describe("findLuaCounters", () => {
  test("finds 115 counters in identical_A.sav (RIS imperial)", () => {
    const fp = path.join(FIXTURE_DIR, "identical_A.sav");
    if (!fs.existsSync(fp)) return;
    const buf = fs.readFileSync(fp);
    const counters = findLuaCounters(buf);
    expect(counters.length).toBe(115);
  });

  test("known faction UUIDs match cross-validation", () => {
    const fp = path.join(FIXTURE_DIR, "identical_A.sav");
    if (!fs.existsSync(fp)) return;
    const counters = findLuaCounters(fs.readFileSync(fp));
    const byName = indexCountersByName(counters);
    // Verified against Python rtw-sav-parser cracker output 2026-05-09.
    expect(byName.get("id_sparta")).toBe(1330481);
    expect(byName.get("id_romans_julii")).toBe(1110011);
    expect(byName.get("id_athens")).toBe(1330201);
  });

  test("identical-state pair produces identical counter output", () => {
    const a = path.join(FIXTURE_DIR, "identical_A.sav");
    const b = path.join(FIXTURE_DIR, "identical_B.sav");
    if (!fs.existsSync(a) || !fs.existsSync(b)) return;
    const ca = findLuaCounters(fs.readFileSync(a));
    const cb = findLuaCounters(fs.readFileSync(b));
    expect(ca.length).toBe(cb.length);
    expect(ca.map((r) => r.name)).toEqual(cb.map((r) => r.name));
    expect(ca.map((r) => r.value)).toEqual(cb.map((r) => r.value));
  });

  test("returns empty array on a buffer without the table", () => {
    const buf = Buffer.alloc(1024);
    expect(findLuaCounters(buf)).toEqual([]);
  });
});
