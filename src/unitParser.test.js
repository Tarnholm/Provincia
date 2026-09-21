import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import { findUnitRecords } from "./unitParser.js";
const require = createRequire(import.meta.url);
const { fixture, fixtures, read } = require("./saveFixtures.js");

// Real-save fixtures: build them with `node scripts/build-save-fixtures.js`.
// Without them every test here SKIPS (visibly). The saves are older than the
// current mod, so counts are compared against the manifest recorded beside the
// fixture — never against today's C:/RIS.
describe("findUnitRecords", () => {
  test("identical-state pair → identical unit output", (ctx) => {
    // Two saves of the SAME game state, made a second apart: different bytes,
    // so this is a real determinism check and not a file compared with itself.
    const pair = fixtures("identical_A.sav", "identical_B.sav");
    if (!pair) return ctx.skip();
    const [a, b] = pair;
    expect(read(a).equals(read(b))).toBe(false);
    const ra = findUnitRecords(read(a));
    const rb = findUnitRecords(read(b));
    expect(ra.length).toBe(rb.length);
    expect(ra.map((r) => r.name)).toEqual(rb.map((r) => r.name));
    expect(ra.map((r) => r.region)).toEqual(rb.map((r) => r.region));
    expect(ra.map((r) => r.commanderUuid)).toEqual(rb.map((r) => r.commanderUuid));
    expect(ra.map((r) => r.soldiers)).toEqual(rb.map((r) => r.soldiers));
  });

  test("a mid-campaign save yields the recorded unit count, every unit in a region", (ctx) => {
    const f = fixture("ror_t17s.sav");
    if (!f) return ctx.skip();
    const recs = findUnitRecords(read(f));
    expect(recs.length).toBe(f.expect.units);
    expect(new Set(recs.map((r) => r.region)).size).toBe(f.expect.unitRegions);
    // invariant, whatever the mod: a unit without a region means the record
    // walk lost its place
    expect(recs.every((u) => u.region && u.region.length > 0)).toBe(true);
  });

  test("captures long region names (the old 25-char cap silently dropped those units)", (ctx) => {
    const f = fixture("ror_t17s.sav");
    if (!f) return ctx.skip();
    const recs = findUnitRecords(read(f));
    const longRegions = new Set(recs.map((r) => r.region).filter((r) => r.length > 25));
    expect(longRegions.size).toBe(f.expect.longRegions);
    expect(longRegions.size).toBeGreaterThan(15); // RIS-era maps have ~21 of them
  });

  test("extracts naval units, all of them crewed", (ctx) => {
    const f = fixture("ror_t17s.sav");
    if (!f) return ctx.skip();
    const navy = findUnitRecords(read(f)).filter((u) => /^naval\s/.test(u.name));
    expect(navy.length).toBe(f.expect.navy);
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

  test("upgradeLevel is null or an integer 0..9 on a real save", (ctx) => {
    // Was pinned to save_julii3.sav in the user's live save folder, which is long
    // gone — so it silently no-opped. Runs on the fixture instead.
    const f = fixture("ror_t17s.sav");
    if (!f) return ctx.skip();
    const recs = findUnitRecords(read(f));
    expect(recs.length).toBe(f.expect.units);
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
