// Unit tests for the main-process path-containment helpers. These guard the
// security fixes made 2026-07-15 (consent-root reads, sps: project containment,
// profile-name traversal) from regressing. Pure path logic — no electron.
import { describe, test, expect } from "vitest";
import path from "node:path";
import { containedPath, isInsideAny, safeSegment } from "./pathSafety.js";

// Use an absolute base that exists on any platform's resolver semantics.
const BASE = path.resolve("/srv/app/project");

describe("containedPath", () => {
  test("resolves a plain child path inside the base", () => {
    expect(containedPath(BASE, "config/rules.txt")).toBe(path.join(BASE, "config", "rules.txt"));
  });

  test("allows nested subdirectories", () => {
    expect(containedPath(BASE, "a/b/c.py")).toBe(path.join(BASE, "a", "b", "c.py"));
  });

  test("rejects `..` traversal that escapes the base", () => {
    expect(containedPath(BASE, "../secrets.txt")).toBeNull();
    expect(containedPath(BASE, "a/../../secrets.txt")).toBeNull();
  });

  test("rejects an absolute path outside the base", () => {
    expect(containedPath(BASE, path.resolve("/etc/passwd"))).toBeNull();
  });

  test("rejects the base directory itself (must be strictly inside)", () => {
    expect(containedPath(BASE, "")).toBeNull();
    expect(containedPath(BASE, ".")).toBeNull();
  });

  test("does NOT treat a sibling sharing the base prefix as inside", () => {
    // classic startsWith(base) bug: `/srv/app/project-evil` must not pass
    const sibling = BASE + "-evil";
    expect(containedPath(path.dirname(BASE), path.basename(BASE) + "-evil/x")).toBe(path.join(sibling, "x"));
    expect(containedPath(BASE, "../project-evil/x")).toBeNull();
  });

  test("`..` that stays inside is allowed", () => {
    expect(containedPath(BASE, "a/../b.txt")).toBe(path.join(BASE, "b.txt"));
  });
});

describe("isInsideAny", () => {
  const roots = [path.resolve("/data/modA"), path.resolve("/data/modB")];

  test("path inside a consented root is allowed", () => {
    expect(isInsideAny(roots, path.resolve("/data/modA/ui/icon.tga"))).toBe(true);
  });

  test("a consented root itself is allowed (equality)", () => {
    expect(isInsideAny(roots, path.resolve("/data/modA"))).toBe(true);
  });

  test("path outside every root is refused", () => {
    expect(isInsideAny(roots, path.resolve("/data/other/x"))).toBe(false);
    expect(isInsideAny(roots, path.resolve("/etc/passwd"))).toBe(false);
  });

  test("prefix-sibling is refused (not a real child)", () => {
    expect(isInsideAny(roots, path.resolve("/data/modA-evil/x"))).toBe(false);
  });

  test("case-insensitive match (Windows semantics)", () => {
    expect(isInsideAny([path.resolve("/Data/Mod")], path.resolve("/data/mod/x.txt"))).toBe(true);
  });

  test("empty / bad inputs are false, not throwing", () => {
    expect(isInsideAny(roots, null)).toBe(false);
    expect(isInsideAny(null, "/x")).toBe(false);
    expect(isInsideAny([null, undefined], "/x")).toBe(false);
  });
});

describe("safeSegment", () => {
  test("accepts a plain name", () => {
    expect(safeSegment("my-profile")).toBe("my-profile");
    expect(safeSegment("  spaced  ")).toBe("spaced");
  });

  test("rejects separators (traversal into another dir)", () => {
    expect(safeSegment("../evil")).toBeNull();
    expect(safeSegment("a/b")).toBeNull();
    expect(safeSegment("a\\b")).toBeNull();
  });

  test("rejects dot segments and empties", () => {
    expect(safeSegment("")).toBeNull();
    expect(safeSegment("   ")).toBeNull();
    expect(safeSegment(".")).toBeNull();
    expect(safeSegment("..")).toBeNull();
    expect(safeSegment(null)).toBeNull();
    expect(safeSegment(undefined)).toBeNull();
  });

  test("rejects absolute / drive-prefixed names", () => {
    expect(safeSegment(path.resolve("/abs"))).toBeNull();
  });
});
