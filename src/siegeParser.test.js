import { describe, test, expect } from "vitest";
import { parseSieges } from "./siegeParser.js";

// Builds a synthetic save buffer with one well-formed siege:
//  - besieger back-ref at offset `bOff`:
//      +0 uuid  +4 0x00  +5 0x01  +6 siegeID  +10 hash  +14 uuid  +18 0  +22 turnsRemaining
//  - target occurrence at offset `tOff` (kept >64 bytes from bOff):
//      [0x01][siegeID][siegeWindow][turnsUnderSiege]
function makeSiegeBuffer({ uuid, siegeId, turnsRemaining, siegeWindow, turnsUnderSiege }) {
  const buf = Buffer.alloc(0x2000, 0xaa); // noise fill
  const bOff = 0x100;
  buf.writeUInt32LE(uuid >>> 0, bOff + 0);
  buf[bOff + 4] = 0x00;
  buf[bOff + 5] = 0x01;
  buf.writeUInt32LE(siegeId >>> 0, bOff + 6);
  buf.writeUInt32LE(0xdeadbeef, bOff + 10); // hash
  buf.writeUInt32LE(uuid >>> 0, bOff + 14); // self-check repeat
  buf.writeUInt32LE(0, bOff + 18);
  buf.writeUInt32LE(turnsRemaining >>> 0, bOff + 22);

  // Target occurrence, well clear of the besieger record.
  const tOff = 0x800;
  buf[tOff - 1] = 0x01;
  buf.writeUInt32LE(siegeId >>> 0, tOff + 0);
  buf.writeUInt32LE(siegeWindow >>> 0, tOff + 4);
  buf.writeUInt32LE(turnsUnderSiege >>> 0, tOff + 8);
  return buf;
}

describe("parseSieges — defender-side counters", () => {
  test("reads siegeWindow (static) and turnsUnderSiege (counts up) from the target block", () => {
    const buf = makeSiegeBuffer({
      uuid: 0x8747e378,
      siegeId: 0x78ed13bc,
      turnsRemaining: 4,
      siegeWindow: 5,
      turnsUnderSiege: 2,
    });
    const sieges = parseSieges(buf, []);
    expect(sieges.length).toBe(1);
    const s = sieges[0];
    expect(s.besiegerArmyUuid).toBe(0x8747e378);
    expect(s.siegeId).toBe(0x78ed13bc);
    expect(s.turnsRemaining).toBe(4);
    // CONFIRMED 2026-05-31: defender side is a distinct counter.
    expect(s.siegeWindow).toBe(5);
    expect(s.turnsUnderSiege).toBe(2);
  });

  test("turnsUnderSiege increments by one turn-step while siegeWindow stays constant", () => {
    // Models the controlled RoR Turn 2 End -> Turn 3 Start observation:
    // siegeWindow invariant (5), turnsUnderSiege +1 (1 -> 2).
    const before = parseSieges(
      makeSiegeBuffer({ uuid: 1, siegeId: 0x1234abcd, turnsRemaining: 0, siegeWindow: 5, turnsUnderSiege: 1 }),
      []
    )[0];
    const after = parseSieges(
      makeSiegeBuffer({ uuid: 1, siegeId: 0x1234abcd, turnsRemaining: 4, siegeWindow: 5, turnsUnderSiege: 2 }),
      []
    )[0];
    expect(after.siegeWindow).toBe(before.siegeWindow); // static
    expect(after.turnsUnderSiege - before.turnsUnderSiege).toBe(1); // counts up
  });

  test("rejects implausible defender reads (out-of-range -> null)", () => {
    const buf = makeSiegeBuffer({
      uuid: 0x1000,
      siegeId: 0x55667788,
      turnsRemaining: 3,
      siegeWindow: 9999, // > 100 -> null
      turnsUnderSiege: 9999, // > 100 -> null
    });
    const s = parseSieges(buf, [])[0];
    expect(s.siegeWindow).toBeNull();
    expect(s.turnsUnderSiege).toBeNull();
  });
});
