// @vitest-environment jsdom
//
// Tests for the BULK building-icon prefetch path (prefetchBuildingIconsBulk),
// which is what makes hovering a settlement load all its icons in one IPC
// round-trip — the fix for icons popping in one-by-one (2026-07-15). Verifies
// it populates the shared cache (so getCachedBuildingIcon sees the results),
// handles "none"/missing entries, dedupes already-cached keys, and falls back
// to the single loader when the bulk IPC isn't available.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

// A minimal valid uncompressed 32-bit BGRA TGA (2x2) the real tga.js decodes.
function tinyTga() {
  const header = Buffer.alloc(18);
  header.writeUInt16LE(2, 12); // width
  header.writeUInt16LE(2, 14); // height
  header[2] = 2;    // uncompressed true-color
  header[16] = 32;  // depth
  header[17] = 8 | 0x20; // 8 alpha bits, top-down
  const px = Buffer.alloc(2 * 2 * 4, 0x7f); // grey pixels
  const buf = Buffer.concat([header, px]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

beforeAll(() => {
  // canvas.toBlob → a fake blob; URL.createObjectURL → a stable string.
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
    };
  };
  HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob([""], { type: "image/png" })); };
  let n = 0;
  global.URL.createObjectURL = () => `blob:icon-${++n}`;
  global.URL.revokeObjectURL = () => {};
});

let mod;
beforeEach(async () => {
  // Fresh module each test so the internal cache/inflight maps reset.
  vi.resetModules?.();
  mod = await import("./buildingIcons.js?bulk=" + Math.random());
});

// vitest global
import { vi } from "vitest";

describe("prefetchBuildingIconsBulk", () => {
  it("resolves a batch in one IPC call and populates the cache", async () => {
    const calls = [];
    window.electronAPI = {
      resolveBuildingIconsBulk: async (dir, list) => {
        calls.push(list.length);
        return list.map((it) => ({ culture: it.culture, level: it.level, buffer: tinyTga(), path: "x.tga" }));
      },
    };
    const triples = [["roman", "barracks", "core_building"], ["roman", "temple", "temple"]];
    await mod.prefetchBuildingIconsBulk("MOD", triples, null);
    // ONE bulk call for both icons (not one per icon).
    expect(calls).toEqual([2]);
    // Both now resolvable from the shared cache.
    expect(mod.getCachedBuildingIcon("MOD", "roman", "barracks")).toMatch(/^blob:/);
    expect(mod.getCachedBuildingIcon("MOD", "roman", "temple")).toMatch(/^blob:/);
  });

  it("caches misses as 'none' (getCached returns null)", async () => {
    window.electronAPI = {
      resolveBuildingIconsBulk: async (dir, list) => list.map((it) => ({ culture: it.culture, level: it.level, buffer: null, path: null })),
    };
    await mod.prefetchBuildingIconsBulk("MOD", [["greek", "missing", "x"]], null);
    expect(mod.getCachedBuildingIcon("MOD", "greek", "missing")).toBeNull();
  });

  it("skips keys already cached (no duplicate IPC work)", async () => {
    let requested = null;
    window.electronAPI = {
      resolveBuildingIconsBulk: async (dir, list) => { requested = list; return list.map((it) => ({ culture: it.culture, level: it.level, buffer: tinyTga(), path: "x" })); },
    };
    await mod.prefetchBuildingIconsBulk("MOD", [["roman", "walls", "wall"]], null);
    // Second call for the same key requests nothing.
    requested = null;
    await mod.prefetchBuildingIconsBulk("MOD", [["roman", "walls", "wall"]], null);
    expect(requested).toBeNull(); // early-returned, no IPC
  });

  it("falls back to the single loader when bulk IPC is unavailable", async () => {
    const singleCalls = [];
    window.electronAPI = {
      // no resolveBuildingIconsBulk
      resolveBuildingIcon: async (dir, culture, level) => { singleCalls.push([culture, level]); return { buffer: tinyTga(), path: "x" }; },
    };
    await mod.prefetchBuildingIconsBulk("MOD", [["roman", "forum", "forum"]], null);
    expect(singleCalls).toEqual([["roman", "forum"]]);
    expect(mod.getCachedBuildingIcon("MOD", "roman", "forum")).toMatch(/^blob:/);
  });

  it("does not hang when a decode is impossible (invalid buffer)", async () => {
    window.electronAPI = {
      resolveBuildingIconsBulk: async (dir, list) => list.map((it) => ({ culture: it.culture, level: it.level, buffer: new ArrayBuffer(4), path: "x" })),
    };
    // Should settle (cache 'none'), not throw or hang.
    await mod.prefetchBuildingIconsBulk("MOD", [["roman", "weird", "x"]], null);
    expect(mod.getCachedBuildingIcon("MOD", "roman", "weird")).toBeNull();
  });
});
