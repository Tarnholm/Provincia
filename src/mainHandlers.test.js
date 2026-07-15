// Integration tests over the REAL main.js IPC handlers, loaded under a mocked
// Electron via mainIpcHarness. This is the regression net that makes main.js
// refactors safe: it asserts handlers stay registered and that the security-
// sensitive file handlers still contain paths / round-trip correctly — behavior
// the boot smoke-launch can't exercise. Handlers needing an external mod/save
// dir are NOT covered here (they'd need local fixtures); this focuses on the
// handlers that run anywhere.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { loadMainHandlers } = require("./mainIpcHarness.js");

let H;
beforeAll(() => { H = loadMainHandlers(); });

describe("main.js IPC surface", () => {
  it("registers the full handler set (no channel silently dropped)", () => {
    expect(H.channels.length).toBeGreaterThanOrEqual(115);
    // A spread of load-bearing channels across domains must be present.
    for (const ch of [
      "get-app-version", "get-app-paths", "crack-save", "get-turn1-budget",
      "save-file", "read-user-file", "save-user-file", "write-binary-file",
      "copy-file", "read-campaign-file", "scan-folder", "select-folder",
    ]) {
      expect(H.channels, `missing channel: ${ch}`).toContain(ch);
    }
  });

  it("throws for an unregistered channel (harness contract)", () => {
    expect(() => H.invoke("no-such-channel-xyz")).toThrow(/no IPC handler/);
  });

  it("get-app-version returns a version string", () => {
    expect(typeof H.invoke("get-app-version")).toBe("string");
  });

  it("get-app-paths reports platform + base dirs", () => {
    const p = H.invoke("get-app-paths");
    expect(p).toMatchObject({ platform: expect.any(String) });
    expect(p).toHaveProperty("home");
    expect(p).toHaveProperty("appData");
  });
});

describe("userData file handlers — containment + round-trip (real handlers)", () => {
  // The mocked app.getPath('userData') is os.tmpdir(); save/read-user-file live
  // directly under it. These exercise the resolveInside() containment added in
  // the 2026-07 security pass, through the actual handler code.
  const uniq = "provincia-harness-roundtrip.txt";
  afterAll(() => { try { fs.unlinkSync(path.join(os.tmpdir(), uniq)); } catch { /* */ } });

  it("round-trips a normal user file (save then read)", async () => {
    const ok = await H.invoke("save-user-file", uniq, "hello-harness");
    expect(ok).toBe(true);
    expect(await H.invoke("read-user-file", uniq)).toBe("hello-harness");
  });

  it("refuses a path-traversal name on read (contained to userData)", async () => {
    expect(await H.invoke("read-user-file", "..\\..\\..\\Windows\\win.ini")).toBeNull();
    expect(await H.invoke("read-user-file", "../../etc/passwd")).toBeNull();
  });

  it("refuses a path-traversal name on write (returns false, writes nothing outside)", async () => {
    const escaped = path.join(os.tmpdir(), "..", "provincia-escaped.txt");
    const ok = await H.invoke("save-user-file", "../provincia-escaped.txt", "nope");
    expect(ok).toBe(false);
    expect(fs.existsSync(escaped)).toBe(false);
  });
});

describe("campaign_data file handlers — traversal rejection (real handlers)", () => {
  // Only the rejection paths are exercised (they return before any write), so
  // these don't touch the repo build/ dir the success path also writes to.
  const travNames = ["..\\..\\..\\Windows\\System32\\x.txt", "../../../etc/x", "..\\escape.tga"];

  it("save-file rejects traversal names (returns false)", async () => {
    for (const n of travNames) expect(await H.invoke("save-file", n, "x")).toBe(false);
  });

  it("write-binary-file rejects traversal names (returns false)", async () => {
    const buf = new Uint8Array([1, 2, 3]);
    for (const n of travNames) expect(await H.invoke("write-binary-file", n, buf)).toBe(false);
  });

  it("copy-file rejects a traversal destination name (returns false)", async () => {
    // src can be anything; only the destName is renderer-controlled + contained.
    for (const n of travNames) expect(await H.invoke("copy-file", os.tmpdir() + "/whatever.bin", n)).toBe(false);
  });

  it("read-campaign-file returns null for a traversal name", async () => {
    for (const n of travNames) expect(await H.invoke("read-campaign-file", n)).toBeNull();
  });
});
