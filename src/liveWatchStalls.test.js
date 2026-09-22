// Two live-mode stalls, both in the main process.
//  • reparseLatestSave set `_reparsing` and then had three early exits (no
//    save, same save at the same mtime, stat failure) ahead of the try/finally
//    that clears it. The same-mtime skip is routine, so every later save sat
//    "queued" until the 120 s watchdog fired.
//  • log-watch-start read the whole message_log with readFileSync on the main
//    thread (hundreds of MB: the window froze; past V8's string limit the
//    backfill silently vanished). It now streams up to the watcher's offset.
import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "..");
const lw = require("./logWatchHandlers.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-livewatch-"));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("reparseLatestSave releases its lock on every early exit", () => {
  const src = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const start = src.indexOf("  _reparsing = true;");
  const end = src.indexOf("emitSaveProgress(\"Reading save file\"", start);
  const head = src.slice(start, end);

  it("finds the stretch between taking the lock and the guarded try", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("every return before the try releases the lock", () => {
    const lines = head.split(/\r?\n/).filter((l) => /\breturn\b/.test(l) && !/=>/.test(l.split("return")[0].slice(-3)));
    const exits = lines.filter((l) => !/^\s*\/\//.test(l) && !/setTimeout|watchdog: /.test(l));
    expect(exits.length).toBeGreaterThanOrEqual(4); // !win, !latestFile, same mtime, stat failure
    for (const l of exits) expect(l, l.trim()).toMatch(/bail\(\)|_reparsing = false/);
  });
});

describe("forEachLineUpTo", () => {
  const collect = async (text, bytes, chunk) => {
    const p = path.join(tmp, `log-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(p, text);
    const out = [];
    await lw.forEachLineUpTo(p, bytes ?? Buffer.byteLength(text), (l) => out.push(l), chunk);
    return out;
  };

  it("yields the same lines as a whole-file split, CRLF included, at any chunk size", async () => {
    const text = "alpha\r\nbeta\ngamma\r\n\r\ndelta";
    const want = text.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l);
    for (const chunk of [1, 2, 3, 5, 7, 64]) expect(await collect(text, undefined, chunk)).toEqual(want);
  });

  it("keeps a multi-byte character whole when a chunk splits it", async () => {
    const text = "Ἀλέξανδρος\nMārcus Æmilius\n";
    for (const chunk of [1, 2, 3]) expect(await collect(text, undefined, chunk)).toEqual(["Ἀλέξανδρος", "Mārcus Æmilius"]);
  });

  it("stops at the byte offset it was given — lines appended later belong to the watcher", async () => {
    const first = "turn one\nturn two\n";
    expect(await collect(first + "appended while reading\n", Buffer.byteLength(first), 4)).toEqual(["turn one", "turn two"]);
  });
});

describe("log-watch-start / log-watch-stop", () => {
  it("a stop that lands during the backfill leaves no poll running", async () => {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
    const win = { webContents: { send() {} } };
    lw.registerLogWatchHandlers(ipcMain, { BrowserWindow: { getAllWindows: () => [win] }, getLogPath: () => tmp });
    const dir = path.join(tmp, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "message_log.txt"), "line\n".repeat(1000));
    const started = handlers.get("log-watch-start")(null, dir);
    await handlers.get("log-watch-stop")();
    const res = await started;
    expect(res.superseded).toBe(true);
    expect(lw.isLogWatchActive()).toBe(false);

    const again = await handlers.get("log-watch-start")(null, dir);
    expect(again.ok).toBe(true);
    expect(lw.isLogWatchActive()).toBe(true);
    await handlers.get("log-watch-stop")();
    expect(lw.isLogWatchActive()).toBe(false);
  });
});
