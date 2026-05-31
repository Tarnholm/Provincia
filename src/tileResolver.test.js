import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildTileIndex, parseRgbToRegion, openTga } from "./tileResolver.js";

// Live RIS mod (dev box only). The CI/bundled box won't have it, so gate on
// existence — the resolver is validated exact (6026/6026 vs resolve.py) by
// scripts; this test just guards the wiring on a dev machine.
const RIS_MOD = "C:/RIS/RIS/data";

describe("tileResolver", () => {
  test("openTga reads a 24bpp TGA header + BGR pixels", () => {
    // Hand-built minimal 2x1 uncompressed TGA: pixel0 = red, pixel1 = green.
    const buf = Buffer.alloc(18 + 6);
    buf[2] = 2; // image type: uncompressed true-color
    buf.writeUInt16LE(2, 12); // width
    buf.writeUInt16LE(1, 14); // height
    buf[16] = 24; // bpp
    buf[17] = 0x20; // top-left origin (bit5 set) so row 0 = top directly
    // BGR storage: red = 00 00 FF, green = 00 FF 00
    buf[18] = 0x00; buf[19] = 0x00; buf[20] = 0xff;
    buf[21] = 0x00; buf[22] = 0xff; buf[23] = 0x00;
    const { W, H, px } = openTga(buf);
    expect(W).toBe(2);
    expect(H).toBe(1);
    expect(px(0, 0)).toEqual([255, 0, 0]);
    expect(px(1, 0)).toEqual([0, 255, 0]);
  });

  test("parseRgbToRegion + buildTileIndex resolve known RIS settlements", () => {
    if (!fs.existsSync(RIS_MOD)) return;
    const idx = buildTileIndex(RIS_MOD);
    // RIS world map: ~1310 region settlement pixels, 1020x700, none unmatched.
    expect(idx.W).toBe(1020);
    expect(idx.H).toBe(700);
    expect(idx.regionCount).toBeGreaterThan(1000);
    expect(idx.unmatched).toBe(0);
    // resolve() returns {region, settlement} for a real tile, null off-map.
    let found = 0;
    for (const [, v] of idx.index) {
      if (v.settlement) {
        const k = [...idx.index].find(([, vv]) => vv === v)[0];
        const [x, y] = k.split(",").map(Number);
        const hit = idx.resolve(x, y);
        expect(hit.region).toBe(v.region);
        expect(hit.settlement).toBe(v.settlement);
        if (++found >= 5) break;
      }
    }
    expect(found).toBeGreaterThan(0);
    // an obviously-out-of-bounds tile resolves to null
    expect(idx.resolve(99999, 99999)).toBe(null);
  });

  test("buildTileIndex throws clearly when map files are absent", () => {
    const empty = path.join(process.cwd(), "node_modules", ".tile-resolver-nope");
    expect(() => buildTileIndex(empty)).toThrow(/not found/);
  });
});
