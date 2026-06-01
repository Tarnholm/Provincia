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

  // Build a synthetic variant-A unit record whose identity block carries a
  // known weapon/armor upgrade level at H+17 (H = name-start + 2 + nameLen,
  // nameLen incl trailing NUL). CONFIRMED layout (findings-weapon-armor-
  // 2026-06-01 + RIS verification): H+17 = upgrade level, H+18/19/20 == 0.
  function buildUnitRecord(name, upgrade, { corruptNeighbour = false } = {}) {
    const nameBuf = Buffer.from(name + "\0", "ascii");
    const nameLen = nameBuf.length; // incl NUL
    const head = Buffer.alloc(2);
    head.writeUInt16LE(nameLen, 0);
    // Identity block H (21 bytes up to the region pstr).
    const H = Buffer.alloc(21);
    H.writeUInt32LE(0x12345678, 0);   // hash
    H.writeUInt32LE(0x0abcde01, 4);   // per-unit id
    H[8] = 0;
    H.writeUInt32LE(0, 9);            // army/faction group id
    H.writeUInt16LE(0x012c, 13);     // class-id "2c 01"
    H[15] = 0;
    H[16] = 0;
    H[17] = upgrade;                  // *** the field under test ***
    H[18] = corruptNeighbour ? 7 : 0; // H+18/19/20 must be 0 for a valid read
    H[19] = 0;
    H[20] = 0;
    // Region pstr: [u8 rlen][0x00][UTF-16 name][u32 0xffffffff].
    const region = "Roma";
    const reg = Buffer.alloc(2 + region.length * 2 + 4);
    reg[0] = region.length; reg[1] = 0;
    for (let k = 0; k < region.length; k++) { reg[2 + k * 2] = region.charCodeAt(k); reg[2 + k * 2 + 1] = 0; }
    reg.writeUInt32LE(0xffffffff, 2 + region.length * 2);
    // Variant-A header: [u32 commanderUuid=0][f32 mp][u32 max][u32 cur][pad].
    const hdr = Buffer.alloc(32);
    hdr.writeUInt32LE(0, 0);
    hdr.writeFloatLE(100.0, 4);
    hdr.writeUInt32LE(160, 8);
    hdr.writeUInt32LE(160, 12);
    return Buffer.concat([head, nameBuf, H, reg, hdr, Buffer.alloc(64)]);
  }

  test("reads upgradeLevel from identity H+17 (synthetic record)", () => {
    const buf = buildUnitRecord("roman hastati", 3);
    const recs = findUnitRecords(buf);
    const u = recs.find((r) => r.name === "roman hastati");
    expect(u).toBeTruthy();
    expect(u.region).toBe("Roma");
    // The crack under test: combined smithy upgrade level at H+17.
    expect(u.upgradeLevel).toBe(3);
  });

  test("upgradeLevel is null (not a fake 0) when the H+18/19/20 envelope is dirty", () => {
    // A misaligned read corrupts the confirmed-zero neighbour H+18 — the
    // parser must reject it as unknown rather than emit a bogus number.
    const buf = buildUnitRecord("roman hastati", 2, { corruptNeighbour: true });
    const recs = findUnitRecords(buf);
    const u = recs.find((r) => r.name === "roman hastati");
    expect(u).toBeTruthy();
    expect(u.upgradeLevel).toBeNull();
  });

  test("upgradeLevel on a real RIS save is in 0..9 or null (skip if no save)", () => {
    // Skip-if-fixture-absent, mirroring the corpus tests above. Uses the
    // user's live Feral save dir; if absent (CI / other machines), the test
    // no-ops. CONFIRMED 2026-06-01: julii3 dist {0:1854 1:2343 2:25 3:24 9:4}.
    const saveDir = path.join(
      process.env.LOCALAPPDATA || "",
      "Feral Interactive", "Total War ROME REMASTERED",
      "VFS", "Local", "Rome", "saves"
    );
    const candidate = path.join(saveDir, "save_julii3.sav");
    if (!fs.existsSync(candidate)) return;
    const recs = findUnitRecords(fs.readFileSync(candidate));
    expect(recs.length).toBeGreaterThan(0);
    // Every emitted upgradeLevel is either null (unknown) or an integer 0..9.
    for (const r of recs) {
      if (r.upgradeLevel === null) continue;
      expect(Number.isInteger(r.upgradeLevel)).toBe(true);
      expect(r.upgradeLevel).toBeGreaterThanOrEqual(0);
      expect(r.upgradeLevel).toBeLessThanOrEqual(9);
    }
    // At least some units carry a non-zero upgrade (RIS bakes base levels).
    const withUpgrade = recs.filter((r) => r.upgradeLevel > 0).length;
    expect(withUpgrade).toBeGreaterThan(0);
  });
});
