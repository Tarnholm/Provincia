// Unit tests for tgaCodec — the pure 32-bit BGRA TGA encoder used for
// building-icon replacement. Verifies the 18-byte header layout RTW requires
// (uncompressed true-color, top-down) and that pixel bytes are appended verbatim.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { encodeTga32BGRA } = require("./tgaCodec.js");

describe("encodeTga32BGRA", () => {
  it("writes an 18-byte header followed by the pixel bytes", () => {
    const bgra = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); // 2 BGRA pixels
    const out = encodeTga32BGRA(2, 1, bgra);
    expect(out.length).toBe(18 + bgra.length);
    expect(out.subarray(18)).toEqual(bgra); // pixels appended verbatim
  });

  it("sets the RTW-required header fields (uncompressed true-color, 32-bit, top-down)", () => {
    const out = encodeTga32BGRA(4, 3, Buffer.alloc(4 * 3 * 4));
    expect(out[2]).toBe(2);           // image type: uncompressed true-color
    expect(out[16]).toBe(32);         // pixel depth
    expect(out[17]).toBe(8 | 0x20);   // 8 alpha bits + top-down (descriptor bit 5)
    expect(out.readUInt16LE(12)).toBe(4); // width
    expect(out.readUInt16LE(14)).toBe(3); // height
  });

  it("encodes width/height as little-endian uint16 (values above 255)", () => {
    const out = encodeTga32BGRA(300, 512, Buffer.alloc(0));
    expect(out.readUInt16LE(12)).toBe(300);
    expect(out.readUInt16LE(14)).toBe(512);
  });

  it("leaves the color-map and origin header fields zeroed", () => {
    const out = encodeTga32BGRA(1, 1, Buffer.alloc(4));
    // bytes 0 (id length), 1 (color-map type), 3-11 (color-map spec + origin) are 0
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out.subarray(3, 12).every((b) => b === 0)).toBe(true);
  });
});
