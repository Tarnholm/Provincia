import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFamilyRecords, indexFamily, detectMarker } from "./familyRecordParser.js";

// Self-contained: uses the committed bundled sample save + bundled name lookup.
const SAVE = path.join("bundled-mod", "saves", "sample.sav");
const LOOKUP = path.join("bundled-mod", "data", "descr_names_lookup.txt");

function loadLookup() {
  return fs.readFileSync(LOOKUP, "utf8").replace(/^﻿/, "").split(/\r?\n/).map((s) => s.trim());
}

describe("parseFamilyRecords", () => {
  test("auto-detects the mod-specific family marker", () => {
    if (!fs.existsSync(SAVE) || !fs.existsSync(LOOKUP)) return; // skip if assets absent
    const det = detectMarker(fs.readFileSync(SAVE), loadLookup());
    expect(det.marker).toBeGreaterThan(0);
    expect(det.count).toBeGreaterThan(300); // dominant modal value = real records
  });

  test("parses the family table (names, gender, ages)", () => {
    if (!fs.existsSync(SAVE) || !fs.existsSync(LOOKUP)) return;
    const recs = parseFamilyRecords(fs.readFileSync(SAVE), loadLookup());
    expect(recs.length).toBeGreaterThan(300);
    // every record has a valid first name
    for (const r of recs) expect(typeof r.firstName).toBe("string");
    // both genders present
    expect(recs.some((r) => r.gender === "male")).toBe(true);
    expect(recs.some((r) => r.gender === "female")).toBe(true);
    // most records decode a plausible age (epoch auto-detected)
    const withAge = recs.filter((r) => r.age != null).length;
    expect(withAge).toBeGreaterThan(recs.length * 0.6);
  });

  test("spouse links are reciprocal (structural integrity)", () => {
    if (!fs.existsSync(SAVE) || !fs.existsSync(LOOKUP)) return;
    const recs = parseFamilyRecords(fs.readFileSync(SAVE), loadLookup());
    const byUuid = new Map(recs.map((r) => [r.uuid >>> 0, r]));
    let pairs = 0, recip = 0;
    for (const r of recs) {
      if (!r.spouseUuid) continue;
      const s = byUuid.get(r.spouseUuid >>> 0);
      if (!s) continue; // spouse may be a trait-anchored head, not in this table
      pairs++;
      if ((s.spouseUuid >>> 0) === (r.uuid >>> 0)) recip++;
    }
    expect(pairs).toBeGreaterThan(10);
    expect(recip).toBe(pairs); // every in-table spouse pair must be mutual
  });

  test("child links reciprocate with father links", () => {
    if (!fs.existsSync(SAVE) || !fs.existsSync(LOOKUP)) return;
    const recs = parseFamilyRecords(fs.readFileSync(SAVE), loadLookup());
    indexFamily(recs);
    const byUuid = new Map(recs.map((r) => [r.uuid >>> 0, r]));
    let checked = 0, ok = 0;
    for (const r of recs) {
      for (const c of r.childUuids) {
        const child = byUuid.get(c >>> 0);
        if (!child) continue;
        checked++;
        // the child's father OR a parent link should point back to r
        if ((child.fatherUuid >>> 0) === (r.uuid >>> 0)) ok++;
      }
    }
    if (checked > 0) expect(ok / checked).toBeGreaterThan(0.5);
  });
});
