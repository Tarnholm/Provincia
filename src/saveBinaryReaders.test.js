// Tests for the pure save-buffer readers extracted from main.js. These build
// synthetic buffers matching each documented byte format and assert the
// decoders round-trip — locking the formats so the extraction can't silently
// drift from the inline originals.
import { describe, test, expect } from "vitest";
import {
  parseWorldObjectPositions,
  findDescrStratAnchorEnd,
  readCurrentYearFromSave,
  readTurnFromSave,
  readUtf16Name,
} from "./saveBinaryReaders.js";

// Build a world-object position record at offset N inside a larger buffer.
function withPositionRecord(uuid, x, y) {
  const buf = Buffer.alloc(64);
  const N = 24;
  buf.writeUInt32LE(6, N - 12);
  buf.writeUInt32LE(uuid, N - 8);
  buf.writeUInt32LE(N - 4, N - 4);
  buf.writeUInt32LE(x, N);
  buf.writeUInt32LE(y, N + 4);
  return buf;
}

describe("parseWorldObjectPositions", () => {
  test("decodes a valid record", () => {
    const m = parseWorldObjectPositions(withPositionRecord(4242, 21, 45));
    expect(m.get(4242)).toEqual({ x: 21, y: 45 });
  });
  test("rejects out-of-bounds coordinates", () => {
    expect(parseWorldObjectPositions(withPositionRecord(1, 5000, 45)).size).toBe(0);
    expect(parseWorldObjectPositions(withPositionRecord(1, 21, 9000)).size).toBe(0);
  });
  test("skips uuid 0", () => {
    expect(parseWorldObjectPositions(withPositionRecord(0, 21, 45)).size).toBe(0);
  });
  test("empty/tiny buffer yields empty map", () => {
    expect(parseWorldObjectPositions(Buffer.alloc(8)).size).toBe(0);
  });
});

// Build a header whose descr_strat UTF-16 anchor is followed by the
// [0x00 0x00 0x00 0x00 0x01] marker byte and then turn(u32)+year(i32).
function withHeader(turnCounter, year) {
  const prefix = Buffer.alloc(64);
  const anchor = Buffer.from("d\0e\0s\0c\0r\0_\0s\0t\0r\0a\0t\0", "binary");
  // After the anchor's trailing 0x00, findDescrStratAnchorEnd stops at the
  // first byte that isn't printable-ascii+0x00. Give it a non-ascii byte.
  const tail = Buffer.alloc(32);
  tail[0] = 0xff;                 // ends the ascii run → anchorEnd points here
  tail.writeUInt8(0x01, 4);       // marker consulted at anchorEnd+4
  tail.writeUInt32LE(turnCounter, 5);
  tail.writeInt32LE(year, 9);
  return Buffer.concat([prefix, anchor, tail]);
}

describe("findDescrStratAnchorEnd + turn/year", () => {
  test("finds anchor end and reads turn (stored turn-1 → +1)", () => {
    const buf = withHeader(4, -270);
    expect(findDescrStratAnchorEnd(buf)).toBeGreaterThan(0);
    expect(readTurnFromSave(buf)).toBe(5);
  });
  test("reads a BC year (negative)", () => {
    expect(readCurrentYearFromSave(withHeader(0, -270))).toBe(-270);
  });
  test("no anchor → null via fallback offset out of range", () => {
    expect(findDescrStratAnchorEnd(Buffer.alloc(40))).toBe(-1);
    expect(readTurnFromSave(Buffer.alloc(40))).toBeNull();
  });
  test("implausible turn/year rejected", () => {
    expect(readTurnFromSave(withHeader(99999, 0))).toBeNull();
    expect(readCurrentYearFromSave(withHeader(0, 99999))).toBeNull();
  });
});

describe("readUtf16Name", () => {
  function nameBuf(str) {
    const b = Buffer.alloc(2 + str.length * 2 + 2);
    b[0] = str.length;
    b[1] = 0;
    for (let i = 0; i < str.length; i++) b.writeUInt16LE(str.charCodeAt(i), 2 + i * 2);
    return b;
  }
  test("decodes a capitalized name and reports end offset", () => {
    const b = nameBuf("Roma");
    const r = readUtf16Name(b, 0, b.length);
    expect(r).toEqual({ name: "Roma", end: 2 + 8 + 2 });
  });
  test("rejects names not starting with A-Z", () => {
    const b = nameBuf("roma");
    expect(readUtf16Name(b, 0, b.length)).toBeNull();
  });
  test("rejects too-short length", () => {
    const b = nameBuf("Ab");
    expect(readUtf16Name(b, 0, b.length)).toBeNull();
  });
});
