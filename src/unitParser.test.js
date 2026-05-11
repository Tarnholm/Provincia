import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findUnitRecords } from "./unitParser.js";

const FIXTURE_DIR = path.join("scripts", "save-cracker", "fixtures", "feral");

describe("findUnitRecords", () => {
  test("identical-state pair → identical unit output", () => {
    const a = path.join(FIXTURE_DIR, "identical_A.sav");
    const b = path.join(FIXTURE_DIR, "identical_B.sav");
    if (!fs.existsSync(a) || !fs.existsSync(b)) return;
    const ra = findUnitRecords(fs.readFileSync(a));
    const rb = findUnitRecords(fs.readFileSync(b));
    expect(ra.length).toBe(rb.length);
    expect(ra.map((r) => r.name)).toEqual(rb.map((r) => r.name));
    expect(ra.map((r) => r.region)).toEqual(rb.map((r) => r.region));
    expect(ra.map((r) => r.commanderUuid)).toEqual(rb.map((r) => r.commanderUuid));
    expect(ra.map((r) => r.soldiers)).toEqual(rb.map((r) => r.soldiers));
  });

  test("athens_t22mid finds RIS imperial unit count", () => {
    const fp = path.join(FIXTURE_DIR, "athens_t22mid.sav");
    if (!fs.existsSync(fp)) return;
    const recs = findUnitRecords(fs.readFileSync(fp));
    // Empirically validated 2026-05-09: 5626 units across 1208 regions on this save.
    expect(recs.length).toBeGreaterThanOrEqual(5500);
    expect(recs.length).toBeLessThanOrEqual(5800);
    // Every unit must have a region.
    expect(recs.every((u) => u.region && u.region.length > 0)).toBe(true);
  });

  test("captures long region names (RIS-imperial 26-35 char regions)", () => {
    const fp = path.join(FIXTURE_DIR, "athens_t22mid.sav");
    if (!fs.existsSync(fp)) return;
    const recs = findUnitRecords(fs.readFileSync(fp));
    const longRegions = new Set(recs.map((r) => r.region).filter((r) => r.length > 25));
    // RIS imperial has ~22 regions exceeding 25 chars; the vintage 25-char
    // cap silently dropped any unit in those regions.
    expect(longRegions.size).toBeGreaterThan(15);
  });

  test("extracts naval units with non-zero soldier counts", () => {
    const fp = path.join(FIXTURE_DIR, "athens_t22mid.sav");
    if (!fs.existsSync(fp)) return;
    const recs = findUnitRecords(fs.readFileSync(fp));
    const navy = recs.filter((u) => /^naval\s/.test(u.name));
    expect(navy.length).toBeGreaterThan(50);
    expect(navy.every((u) => u.soldiers > 0)).toBe(true);
  });
});
