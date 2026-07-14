// Tests for the dialog-consented read-root store (extracted from main.js).
// Covers the persistence round-trip, strict containment, and the one-time
// grandfather migration window for scan-folder.
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConsentStore } from "./consentRoots.js";

let dir, storePath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "consent-"));
  storePath = path.join(dir, "consented-read-roots.json");
});

const mk = () => createConsentStore({ storePath, fs });

describe("consent store", () => {
  test("fresh store: nothing is consented", () => {
    const s = mk();
    expect(s.isConsented(path.join(dir, "anywhere"))).toBe(false);
    expect(s.hadStoreAtStartup).toBe(false);
  });

  test("add() consents the dir and its children, persists to disk", () => {
    const s = mk();
    const root = path.join(dir, "modA");
    s.add(root);
    expect(s.isConsented(root)).toBe(true);
    expect(s.isConsented(path.join(root, "data", "x.txt"))).toBe(true);
    expect(s.isConsented(path.join(dir, "modB"))).toBe(false);
    // a NEW store instance (fresh process) reads the persisted roots
    const s2 = mk();
    expect(s2.isConsented(path.join(root, "y"))).toBe(true);
    expect(s2.hadStoreAtStartup).toBe(true);
  });

  test("prefix-sibling of a consented root is refused", () => {
    const s = mk();
    s.add(path.join(dir, "mod"));
    expect(s.isConsented(path.join(dir, "mod-evil", "x"))).toBe(false);
  });

  test("add() dedupes case-insensitively", () => {
    const s = mk();
    s.add(path.join(dir, "ModA"));
    s.add(path.join(dir, "moda"));
    expect(s.roots).toHaveLength(1);
  });

  test("grandfather: first-ever scan consents; once a store exists, scans are strict", () => {
    const s = mk(); // no store on disk yet
    const restored = path.join(dir, "restoredImport");
    expect(s.allowScan(restored)).toBe(true);          // grandfathered + persisted
    expect(s.isConsented(path.join(restored, "f"))).toBe(true);

    const s2 = mk(); // next launch: store exists → strict
    expect(s2.hadStoreAtStartup).toBe(true);
    expect(s2.allowScan(path.join(dir, "other"))).toBe(false);
    expect(s2.allowScan(restored)).toBe(true);         // still consented
  });

  test("corrupt store file degrades to empty, not a crash", () => {
    fs.writeFileSync(storePath, "{not json", "utf8");
    const s = mk();
    expect(s.isConsented(path.join(dir, "x"))).toBe(false);
    expect(s.hadStoreAtStartup).toBe(true); // file existed → strict mode
    expect(s.allowScan(path.join(dir, "x"))).toBe(false);
  });

  test("non-string entries in the store are ignored", () => {
    fs.writeFileSync(storePath, JSON.stringify([42, null, path.join(dir, "ok")]), "utf8");
    const s = mk();
    expect(s.isConsented(path.join(dir, "ok", "child"))).toBe(true);
    expect(s.isConsented(path.join(dir, "42"))).toBe(false);
  });
});
