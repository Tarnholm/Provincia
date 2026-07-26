// @vitest-environment node
/**
 * Regression test for 32bpp RLE TGA decoding.
 *
 * The building icons and unit cards in the RIS wiki shipped as horizontal colour stripes.
 * tgaToRaw assumed 24bpp source pixels and advanced its read pointer 3 bytes per pixel, so
 * on a 32bpp file the source drifted one byte per pixel. Output was the right SIZE with
 * progressively rotated channels.
 *
 * That is the point of this test. Every size and "did it throw" check passed while the
 * images were garbage, so the assertions below are about CONTENT: a UI icon has a uniform
 * transparent border, and under the old decoder the drift turned every row after the first
 * few into noise. Asserting a single distinct colour on a late row fails loudly on the old
 * code and passes on the new — verified by reverting the stride before committing this.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import dgMod from "./descrStratGeneral.js";

const dg = dgMod;

const RIS = "C:/RIS/RIS/data";
const ICON = path.join(RIS, "ui", "roman", "buildings", "#roman_agroforestry_1.tga");
const MAP = path.join(RIS, "world", "maps", "base", "map_regions.tga");

const distinctColoursInRow = (t, y) => {
  const seen = new Set();
  for (let x = 0; x < t.W; x++) {
    const i = (y * t.W + x) * 3;
    seen.add(`${t.raw[i]},${t.raw[i + 1]},${t.raw[i + 2]}`);
  }
  return seen.size;
};

describe("tgaToRaw on 32bpp RLE art", () => {
  const have = fs.existsSync(ICON);
  it.skipIf(!have)("decodes a 32bpp RLE icon without channel drift", () => {
    const t = dg.tgaToRaw(fs.readFileSync(ICON));
    expect(t.srcBpp).toBe(4);
    expect(t.raw.length).toBe(t.W * t.H * 3);

    // The border rows of this icon are a single flat colour. Under the 3-byte-stride bug
    // the drift accumulates, so rows far from the start decode as noise: the last row went
    // from 1 distinct colour to dozens. This is the assertion that catches the regression.
    expect(distinctColoursInRow(t, 0)).toBe(1);
    expect(distinctColoursInRow(t, t.H - 1)).toBe(1);
    // ...and the middle of the image must still contain actual picture.
    expect(distinctColoursInRow(t, Math.floor(t.H / 2))).toBeGreaterThan(20);
  });

  it.skipIf(!have)("returns the alpha channel a 32bpp source carries", () => {
    const t = dg.tgaToRaw(fs.readFileSync(ICON));
    expect(t.alpha).toBeTruthy();
    expect(t.alpha.length).toBe(t.W * t.H);
    // Roughly half this icon is fully transparent. Dropping alpha and writing opaque RGB
    // painted the transparent region as a solid slab, which is why the wiki needed RGBA.
    let clear = 0;
    for (const a of t.alpha) if (a === 0) clear++;
    expect(clear).toBeGreaterThan(t.alpha.length * 0.25);
  });

  it.skipIf(!fs.existsSync(MAP))("still decodes the 24bpp map unchanged", () => {
    // The map files are 24bpp and took the path this fix did not touch. Asserted so a
    // future change to the stride handling cannot quietly break every map pixel scan.
    const t = dg.tgaToRaw(fs.readFileSync(MAP));
    expect(t.srcBpp).toBe(3);
    expect(t.alpha).toBeFalsy();
    expect(t.raw.length).toBe(t.W * t.H * 3);
  });

  it("rejects a pixel depth it cannot stride correctly", () => {
    // A 16bpp truecolour TGA is not handled. Throwing beats mis-striding it into stripes.
    const buf = Buffer.alloc(18 + 64);
    buf[2] = 10;                  // RLE truecolour
    buf.writeUInt16LE(4, 12);     // W
    buf.writeUInt16LE(4, 14);     // H
    buf[16] = 16;                 // 16bpp
    expect(() => dg.tgaToRaw(buf)).toThrow(/pixel depth/i);
  });
});
