// Tests for the icon directory-listing cache. Uses a real temp dir so the
// readdir + case-insensitive resolve + invalidation are exercised end-to-end,
// plus a fake fs to assert readdir is called ONCE per dir (the whole point —
// collapsing per-file syscalls to one readdir).
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIconDirCache } from "./iconDirCache.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "icondir-"));
});

describe("createIconDirCache (real fs)", () => {
  test("resolves a filename case-insensitively to the actual on-disk name", () => {
    fs.writeFileSync(path.join(dir, "#Roman_Barracks.tga"), "x");
    const c = createIconDirCache(fs);
    expect(c.resolve(dir, "#roman_barracks.tga")).toBe("#Roman_Barracks.tga");
    expect(c.resolve(dir, "#ROMAN_BARRACKS.TGA")).toBe("#Roman_Barracks.tga");
  });

  test("returns null for a missing file and a missing dir", () => {
    const c = createIconDirCache(fs);
    expect(c.resolve(dir, "nope.tga")).toBeNull();
    expect(c.resolve(path.join(dir, "no-such-subdir"), "x.tga")).toBeNull();
    expect(c.files(path.join(dir, "no-such-subdir"))).toBeNull();
  });

  test("clear(dir) picks up a newly-written file; stale cache does not", () => {
    const c = createIconDirCache(fs);
    expect(c.resolve(dir, "late.tga")).toBeNull(); // caches the (empty) listing
    fs.writeFileSync(path.join(dir, "late.tga"), "x");
    expect(c.resolve(dir, "late.tga")).toBeNull(); // still stale (cached)
    c.clear(dir);
    expect(c.resolve(dir, "late.tga")).toBe("late.tga"); // refreshed
  });

  test("clear() with no arg wipes the whole cache", () => {
    fs.writeFileSync(path.join(dir, "a.tga"), "x");
    const c = createIconDirCache(fs);
    c.resolve(dir, "a.tga");
    c.clear();
    // still resolvable after a full clear (re-reads)
    expect(c.resolve(dir, "a.tga")).toBe("a.tga");
  });
});

describe("createIconDirCache (fake fs — readdir called once per dir)", () => {
  test("caches the listing so repeated lookups don't re-readdir", () => {
    let readdirs = 0;
    const fakeFs = {
      readdirSync: (d) => { readdirs++; return d === "/mod/ui" ? ["#roman_x.tga", "#roman_y.tga"] : []; },
    };
    const c = createIconDirCache(fakeFs);
    // Many lookups in the same dir…
    c.resolve("/mod/ui", "#roman_x.tga");
    c.resolve("/mod/ui", "#roman_y.tga");
    c.resolve("/mod/ui", "#roman_missing.tga");
    c.files("/mod/ui");
    expect(readdirs).toBe(1); // …one readdir total
  });

  test("a dir whose readdir throws is cached as absent (no repeat throws)", () => {
    let calls = 0;
    const fakeFs = { readdirSync: () => { calls++; throw new Error("ENOENT"); } };
    const c = createIconDirCache(fakeFs);
    expect(c.resolve("/x", "a")).toBeNull();
    expect(c.resolve("/x", "b")).toBeNull();
    expect(calls).toBe(1); // absence cached, not re-probed
  });
});
