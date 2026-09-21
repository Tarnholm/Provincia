// log-read-full hands the renderer both game logs for the first parse and tells
// the watcher where to continue. It reads asynchronously now (a sync read of a
// long campaign's logs froze the window), so the contract is pinned here: the
// text comes back whole, a missing log is a quiet null, and nothing throws.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { loadMainHandlers } = require("./mainIpcHarness.js");

let H, dir;
beforeAll(() => { H = loadMainHandlers(); });
afterEach(() => { if (dir) { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); dir = null; } });

describe("log-read-full", () => {
  it("returns both logs whole, multi-byte text intact", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "logfull-"));
    const msg = "12:00:01 battle at Ῥώμη\r\n".repeat(2000);
    const ai = "AI: faction romans_julii start\r\n".repeat(5000);
    fs.writeFileSync(path.join(dir, "message_log.txt"), msg, "utf8");
    fs.writeFileSync(path.join(dir, "campaign_ai_log.txt"), ai, "utf8");
    const r = await H.invoke("log-read-full", dir);
    expect(r.msg).toBe(msg);
    expect(r.ai).toBe(ai);
  });

  it("a missing log is null, not an error", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "logfull-"));
    fs.writeFileSync(path.join(dir, "message_log.txt"), "only this one\r\n");
    const r = await H.invoke("log-read-full", dir);
    expect(r.msg).toBe("only this one\r\n");
    expect(r.ai).toBe(null);
  });
});
