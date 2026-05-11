import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findFactionRecords, summarizeFactionArray } from "./factionRecordParser.js";

const FIXTURE_DIR = path.join("scripts", "save-cracker", "fixtures", "feral");

describe("findFactionRecords", () => {
  test("finds 238 records in identical_A.sav (RIS imperial)", () => {
    const fp = path.join(FIXTURE_DIR, "identical_A.sav");
    if (!fs.existsSync(fp)) return; // skip if fixtures aren't staged
    const buf = fs.readFileSync(fp);
    const records = findFactionRecords(buf);
    expect(records.length).toBe(238);
    // Each record self-pointer at +4 should equal record_offset + 4.
    for (const r of records) {
      expect(buf.readUInt32LE(r.offset + 4)).toBe(r.offset + 4);
    }
  });

  test("identical-state pair produces identical output (parser determinism)", () => {
    const a = path.join(FIXTURE_DIR, "identical_A.sav");
    const b = path.join(FIXTURE_DIR, "identical_B.sav");
    if (!fs.existsSync(a) || !fs.existsSync(b)) return;
    const recA = findFactionRecords(fs.readFileSync(a));
    const recB = findFactionRecords(fs.readFileSync(b));
    expect(recA.length).toBe(recB.length);
    expect(recA.map((r) => r.offset)).toEqual(recB.map((r) => r.offset));
    expect(recA.map((r) => r.size)).toEqual(recB.map((r) => r.size));
  });

  test("array span grows with campaign turn (bloat curve)", () => {
    const t1 = path.join(FIXTURE_DIR, "ror_t1e.sav");
    const t11 = path.join(FIXTURE_DIR, "ror_t11s.sav");
    if (!fs.existsSync(t1) || !fs.existsSync(t11)) return;
    const sumT1 = summarizeFactionArray(findFactionRecords(fs.readFileSync(t1)));
    const sumT11 = summarizeFactionArray(findFactionRecords(fs.readFileSync(t11)));
    expect(sumT11.totalBytes).toBeGreaterThan(sumT1.totalBytes);
  });

  test("returns empty array on a buffer without the magic", () => {
    const buf = Buffer.alloc(1024);  // all zeros
    expect(findFactionRecords(buf)).toEqual([]);
  });
});
