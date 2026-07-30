// Regression gate for the mod-file EPOCH (2026-07-30, "teammate edits
// map_regions.tga and the app doesn't update" bug): incomeModel's topology
// caches (adjacency, sea bodies, coords, trade lanes…) were keyed on modDataDir
// alone, so an external map repaint survived every in-app reload until a full
// app restart. The epoch stats the source files (throttled to 1 sweep/second)
// and wholesale-clears the registered caches when any mtime moves.
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { regionAdjacency } from "./incomeModel.js";

let modDir;

const REGIONS = [
  "region_a",
  "\tTown_A",
  "\tlegion_a",
  "\tsymbol",
  "\t25 60 130",
  "\tfarm1, hidden_x",
  "",
  "region_b",
  "\tTown_B",
  "\tlegion_b",
  "\tsymbol",
  "\t200 10 10",
  "\tfarm1, hidden_x",
  "",
].join("\n");

// 4×4 uncompressed 24bpp TGA. split=true → left half region A (25,60,130),
// right half region B (200,10,10); split=false → ALL region A (the "repaint").
function writeTGA(p, split) {
  const W = 4, H = 4;
  const buf = Buffer.alloc(18 + W * H * 3);
  buf[2] = 2; buf.writeUInt16LE(W, 12); buf.writeUInt16LE(H, 14); buf[16] = 24; buf[17] = 0;
  for (let i = 0; i < W * H; i++) {
    const o = 18 + i * 3, col = i % W;
    if (split && col >= 2) { buf[o] = 10; buf[o + 1] = 10; buf[o + 2] = 200; } // BGR of (200,10,10)
    else { buf[o] = 130; buf[o + 1] = 60; buf[o + 2] = 25; }                  // BGR of (25,60,130)
  }
  fs.writeFileSync(p, buf);
}

beforeEach(() => {
  modDir = fs.mkdtempSync(path.join(os.tmpdir(), "modepoch-"));
  const baseMap = path.join(modDir, "world", "maps", "base");
  fs.mkdirSync(baseMap, { recursive: true });
  fs.writeFileSync(path.join(baseMap, "descr_regions.txt"), REGIONS);
  writeTGA(path.join(baseMap, "map_regions.tga"), true);
});

describe("mod-file epoch — external map_regions.tga edits invalidate topology caches", () => {
  test("adjacency re-derives after a repaint (was: stale until app restart)", async () => {
    const adj1 = regionAdjacency(modDir);
    expect(adj1.region_a && adj1.region_a.has("region_b")).toBe(true);
    // teammate repaints region_b away; mtime moves past FS resolution
    const tga = path.join(modDir, "world", "maps", "base", "map_regions.tga");
    writeTGA(tga, false);
    const st = fs.statSync(tga);
    fs.utimesSync(tga, st.atime, new Date(st.mtimeMs + 2000));
    // the epoch sweep is throttled to one stat pass per second per mod dir
    await new Promise((r) => setTimeout(r, 1100));
    const adj2 = regionAdjacency(modDir);
    expect(adj2.region_a).toBeUndefined(); // single region left → no adjacency
  }, 10000);

  test("unchanged files → cache hit (same object back)", () => {
    const a = regionAdjacency(modDir);
    const b = regionAdjacency(modDir);
    expect(b).toBe(a);
  });
});
