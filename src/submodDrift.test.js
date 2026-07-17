// Hermetic tests for the submod drift scanner (src/submodDrift.js). Builds tiny
// base+submod fixture trees in a temp dir covering the four classification
// cases (stale+danger, identical, submod-only, newer-than-base) plus Windows-
// style case-insensitive path matching and the skip-dirs rule.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanSubmodDrift, DANGER_FILES } from "./submodDrift.js";

let root, base, submod, result;

const write = (dir, rel, content, mtime) => {
  const p = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mtime) fs.utimesSync(p, mtime, mtime);
};

const OLD = new Date("2025-01-01T12:00:00Z");
const NEW = new Date("2026-06-01T12:00:00Z");

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "submod-drift-"));
  base = path.join(root, "base");
  submod = path.join(root, "submod");
  fs.mkdirSync(base); fs.mkdirSync(submod);

  // 1. STALE + DANGER: base updated (new token), submod copy older + different.
  write(base, "text/expanded_bi.txt", "{mine_from_coal_ga}Coal mine income\n", NEW);
  write(submod, "text/expanded_bi.txt", "{old_token}Old string\n", OLD);

  // 2. IDENTICAL content (danger file — danger tag still applies, but harmless).
  write(base, "descr_sm_resources.txt", "type gold\n", OLD);
  write(submod, "descr_sm_resources.txt", "type gold\n", NEW);

  // 3. SUBMOD-ONLY file — not an override, must not appear at all.
  write(submod, "text/submod_readme.txt", "only in submod\n", NEW);

  // 4. NEWER-than-base override, content differs — deliberate override, NOT stale.
  write(base, "export_descr_unit.txt", "soldier roman_hastati 40\n", OLD);
  write(submod, "export_descr_unit.txt", "soldier roman_hastati 41\n", NEW);

  // 5. Case-insensitive match: submod uses different casing than base.
  write(base, "text/strat.txt", "SETTLEMENT Roma\n", NEW);
  write(submod, "Text/Strat.TXT", "SETTLEMENT Rome\n", OLD);

  // 6. Non-danger identical override + a .git dir that must be skipped.
  write(base, "world/notes.txt", "same\n", OLD);
  write(submod, "world/notes.txt", "same\n", OLD);
  write(submod, ".git/config", "[core]\n", NEW);
  write(base, ".git/config", "[core]\n", NEW);

  result = scanSubmodDrift(base, submod);
});

afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* */ } });

const byRel = (relLower) => result.overrides.find(o => o.rel.toLowerCase() === relLower);

describe("scanSubmodDrift classification", () => {
  test("stale + danger: older submod copy of a risky file", () => {
    const o = byRel("text/expanded_bi.txt");
    expect(o).toBeTruthy();
    expect(o.sameContent).toBe(false);
    expect(o.stale).toBe(true);
    expect(o.danger).toMatch(/Could not find string/);
    expect(o.submodMtime).toBeLessThan(o.baseMtime);
  });

  test("identical content is harmless — never stale, even when submod is older-or-newer", () => {
    const o = byRel("descr_sm_resources.txt");
    expect(o).toBeTruthy();
    expect(o.sameContent).toBe(true);
    expect(o.stale).toBe(false);
    expect(o.danger).toBe(DANGER_FILES["descr_sm_resources.txt"]); // danger tag independent of staleness
    const plain = byRel("world/notes.txt");
    expect(plain.sameContent).toBe(true);
    expect(plain.stale).toBe(false);
    expect(plain.danger).toBeNull();
  });

  test("submod-only file is not an override", () => {
    expect(byRel("text/submod_readme.txt")).toBeUndefined();
  });

  test("newer-than-base differing override is NOT stale", () => {
    const o = byRel("export_descr_unit.txt");
    expect(o).toBeTruthy();
    expect(o.sameContent).toBe(false);
    expect(o.stale).toBe(false);
    expect(o.danger).toMatch(/silently reverted/);
  });

  test("case-insensitive path matching finds the override and its danger entry", () => {
    const o = byRel("text/strat.txt"); // submod casing was Text/Strat.TXT
    expect(o).toBeTruthy();
    expect(o.stale).toBe(true);
    expect(o.danger).toMatch(/cosmetic/);
  });

  test(".git contents are skipped", () => {
    expect(byRel(".git/config")).toBeUndefined();
  });

  test("summary counts + worst-first ordering", () => {
    const s = result.summary;
    expect(s.overrides).toBe(5);
    expect(s.identical).toBe(2);
    expect(s.differing).toBe(3);
    expect(s.stale).toBe(2);
    expect(s.danger).toBe(4);
    expect(s.dangerStale).toBe(2);
    expect(s.submodFiles).toBe(6); // 5 overrides + the submod-only file (.git skipped)
    // stale danger rows sort first, identical last
    expect(result.overrides[0].stale && !!result.overrides[0].danger).toBe(true);
    expect(result.overrides[result.overrides.length - 1].sameContent).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("missing dirs throw (handler wraps to { error })", () => {
    expect(() => scanSubmodDrift(path.join(root, "nope"), submod)).toThrow(/not found/);
    expect(() => scanSubmodDrift(base, path.join(root, "nope"))).toThrow(/not found/);
  });

  test("self-scan: base === submod → every override identical, none stale", () => {
    const r = scanSubmodDrift(base, base);
    expect(r.overrides.length).toBeGreaterThan(0);
    expect(r.overrides.every(o => o.sameContent && !o.stale)).toBe(true);
  });
});
