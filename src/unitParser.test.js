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

  test("reads movementPoints at +4 for a non-bodyguard (commanderUuid==0) line unit", () => {
    // Verbatim 65-byte unit record lifted from a real RoR "Turn 3 Start"
    // autosave: a "roman leves" with no commander (uuid==0). Confirmed
    // 2026-05-31 — the variant-A header float at regionEnd+4 holds movement
    // points (here 128.0) even when commanderUuid is 0. Earlier the parser
    // only read MP for bodyguards, so line units reported movementPoints=null.
    const hex =
      "0c 00 72 6f 6d 61 6e 20 6c 65 76 65 73 00 00 ee 83 41 ac fe 15 84 12 " +
      "00 00 00 00 2c 01 00 00 03 00 00 00 04 00 52 00 6f 00 6d 00 61 00 ff " +
      "ff ff ff 00 00 00 00 00 00 00 43 a0 00 00 00 a0 00 00 00";
    const body = Buffer.from(hex.replace(/\s+/g, ""), "hex");
    // Pad with trailing zeros so the parser's forward bounds checks pass.
    const buf = Buffer.concat([body, Buffer.alloc(128)]);
    const recs = findUnitRecords(buf);
    const leves = recs.find((u) => u.name === "roman leves");
    expect(leves).toBeTruthy();
    expect(leves.region).toBe("Roma");
    expect(leves.commanderUuid).toBe(null); // non-bodyguard
    expect(leves.soldiers).toBe(160);
    expect(leves.maxSoldiers).toBe(160);
    // The crack under test: MP read from the +4 float of the variant-A header.
    expect(leves.movementPoints).toBeCloseTo(128.0, 3);
  });
});
