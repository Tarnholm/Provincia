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

// ── LATE-SAVE REGRESSION (2026-05-31) ───────────────────────────────────────
// Real mid/late campaigns store MOST family members with an assigned portrait,
// so the record is preceded by a "/NNN.tga" string instead of the 0xffffffff
// pad that the original parser required at p-7. That sentinel silently dropped
// every portrait-bearing member (Turn-34 RIS save read 304 of 2185). This
// synthetic buffer reproduces BOTH layouts and asserts both are recovered, so
// the sentinel can never be re-added without a red test.
describe("parseFamilyRecords — both record layouts (no p-7 sentinel dependence)", () => {
  const MARKER = 1325;       // RIS family-record tag
  const NAME_IDX_M = 60;     // "male" name index in the synthetic lookup
  const NAME_IDX_F = 61;     // "female" name index
  const STRIDE = 0x200;      // generous spacing so records never overlap

  // Build a lookup where indices 60/61 are valid (>=50, len>=3, /^[A-Z][a-z]/).
  function synthLookup() {
    const nl = new Array(200).fill("");
    nl[NAME_IDX_M] = "Marcus";
    nl[NAME_IDX_F] = "Iulia";
    return nl;
  }

  // Write one family record at offset p. prefix = "sentinel" | "portrait".
  function writeRecord(buf, p, { female, alive, ageRaw, uuid, prefix }) {
    if (prefix === "sentinel") {
      buf.writeUInt32LE(0xffffffff, p - 7); // legacy pad
    } else {
      // emulate "/046.tga\0" + portrait index just before the self-pointer
      buf.write("/046.tga\0", p - 13, "latin1");
      buf.writeUInt32LE(46, p - 4);
    }
    buf.writeUInt32LE(p >>> 0, p);          // self-pointer
    buf.writeUInt32LE(uuid, p + 4);         // uuid
    buf.writeUInt32LE(30, p + 16);          // record-type constant
    const nameOff = p + 51;
    buf.writeUInt32LE(female ? NAME_IDX_F : NAME_IDX_M, nameOff);
    buf[nameOff + 4] = 0;                   // hasSurname = 0
    const markerOff = nameOff + 6;
    buf.writeUInt32LE(MARKER, markerOff);
    const m = markerOff + 4;
    buf.writeInt32LE(-ageRaw, m + 12);      // age stored as -(raw)
    buf.writeUInt32LE(0, m + 28);           // childCount
    buf.writeUInt32LE(0, m + 32);           // father
    buf.writeUInt32LE(0, m + 36);           // spouse
    buf.writeUInt32LE(0xffffffff, m + 56);  // children sentinel
    const flags = (alive ? 1 : 0) | (female ? 0 : 2);
    buf.writeUInt32LE(flags, m + 76);
  }

  test("recovers a portrait-prefixed record the old sentinel would have dropped", () => {
    const buf = Buffer.alloc(0x4000);
    const base = 0x1000 + 0x40;
    // record 0: legacy sentinel layout (would have been found before)
    writeRecord(buf, base, { female: false, alive: true, ageRaw: 300, uuid: 0xA001, prefix: "sentinel" });
    // record 1: portrait layout (the late-save case the old parser MISSED)
    writeRecord(buf, base + STRIDE, { female: true, alive: false, ageRaw: 320, uuid: 0xA002, prefix: "portrait" });

    const recs = parseFamilyRecords(buf, synthLookup(), { marker: MARKER });
    expect(recs.length).toBe(2);

    const byUuid = new Map(recs.map((r) => [r.uuid >>> 0, r]));
    const m = byUuid.get(0xA001), f = byUuid.get(0xA002);
    expect(m).toBeTruthy();
    expect(f).toBeTruthy();
    expect(m.firstName).toBe("Marcus");
    expect(m.gender).toBe("male");
    expect(m.alive).toBe(true);
    // the portrait record must come through with correct gender / alive / name
    expect(f.firstName).toBe("Iulia");
    expect(f.gender).toBe("female");
    expect(f.alive).toBe(false);
    // ages decode relative to the youngest (epoch = min raw = 300 here)
    expect(m.age).toBe(0);
    expect(f.age).toBe(20);
  });

  test("auto-detect picks the marker even when most records are portrait-prefixed", () => {
    const buf = Buffer.alloc(0x8000);
    let p = 0x1000 + 0x40;
    // 1 sentinel + 9 portrait records — modal marker must still resolve.
    for (let i = 0; i < 10; i++) {
      writeRecord(buf, p, {
        female: i % 2 === 0, alive: i % 3 !== 0, ageRaw: 300 + i,
        uuid: 0xB000 + i, prefix: i === 0 ? "sentinel" : "portrait",
      });
      p += STRIDE;
    }
    const det = detectMarker(buf, synthLookup());
    expect(det.marker).toBe(MARKER);
    expect(det.count).toBe(10);
    // and a no-marker (auto) parse finds all 10
    const recs = parseFamilyRecords(buf, synthLookup());
    expect(recs.length).toBe(10);
  });
});
