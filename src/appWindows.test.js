// The second map window: live broadcasts reach both app windows, the map window
// only follows (attaches, reads) and never moves the main window's log offsets.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createAppWindows, LIVE_JOURNAL_CAP } = require("./appWindows.js");
const lw = require("./logWatchHandlers.js");

function fakeWindow() {
  const sent = [];
  const listeners = {};
  const wc = {
    sent,
    send: (channel, payload) => sent.push({ channel, payload }),
    isDestroyed: () => false,
    isCrashed: () => false,
  };
  return {
    webContents: wc,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    on: (ev, fn) => { listeners[ev] = fn; },
    emit: (ev) => listeners[ev] && listeners[ev](),
  };
}

describe("appWindows", () => {
  it("sends to the main window and every map window, skipping dead ones", () => {
    const aw = createAppWindows();
    const main = fakeWindow(), map = fakeWindow(), gone = fakeWindow();
    aw.setPrimary(main); aw.addFollower(map); aw.addFollower(gone);
    gone.destroyed = true;
    expect(aw.send("save-snapshot", { n: 1 })).toBe(2);
    expect(main.webContents.sent).toEqual([{ channel: "save-snapshot", payload: { n: 1 } }]);
    expect(map.webContents.sent).toEqual([{ channel: "save-snapshot", payload: { n: 1 } }]);
    expect(gone.webContents.sent).toEqual([]);
  });

  it("a closed map window leaves the registry", () => {
    const aw = createAppWindows();
    const main = fakeWindow(), map = fakeWindow();
    aw.setPrimary(main); aw.addFollower(map);
    expect(aw.isFollower(map.webContents)).toBe(true);
    map.emit("closed");
    expect(aw.isFollower(map.webContents)).toBe(false);
    expect(aw.getFollowers()).toEqual([]);
  });

  it("the main window is never a follower; an unknown sender is not either", () => {
    const aw = createAppWindows();
    const main = fakeWindow();
    aw.setPrimary(main);
    expect(aw.isFollower(main.webContents)).toBe(false);
    expect(aw.isFollower(undefined)).toBe(false);
    expect(aw.isFollower({})).toBe(false);
  });

  it("replays live moves since the last reset to a window that attaches late", () => {
    const aw = createAppWindows();
    aw.setPrimary(fakeWindow());
    aw.sendLiveMoves({ moves: [{ id: "old" }] });
    aw.sendLiveMoves({ moves: [], reset: true });
    aw.sendLiveMoves({ moves: [{ id: "a" }] });
    aw.sendLiveMoves({ moves: [], deaths: [{ id: "b" }] });
    const late = fakeWindow();
    expect(aw.replayLiveMoves(late.webContents)).toBe(3);
    expect(late.webContents.sent.map((m) => m.payload)).toEqual([
      { moves: [], reset: true }, { moves: [{ id: "a" }] }, { moves: [], deaths: [{ id: "b" }] },
    ]);
  });

  it("caps the journal and says so once", () => {
    const logs = [];
    const aw = createAppWindows({ log: (s) => logs.push(s) });
    for (let i = 0; i < LIVE_JOURNAL_CAP + 5; i++) aw.sendLiveMoves({ moves: [{ i }] });
    expect(aw._journalLength()).toBe(LIVE_JOURNAL_CAP);
    expect(logs.length).toBe(1);
  });
});

describe("log watcher with a map window", () => {
  let dir;
  afterEach(async () => {
    if (dir) { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); dir = null; }
  });

  const setup = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-map2-"));
    fs.writeFileSync(path.join(dir, "message_log.txt"), "12:00:00 old line\n");
    const aw = createAppWindows();
    const main = fakeWindow(), map = fakeWindow();
    aw.setPrimary(main); aw.addFollower(map);
    const handlers = new Map();
    lw.registerLogWatchHandlers({ handle: (c, f) => handlers.set(c, f) }, { BrowserWindow: null, getLogPath: () => null, appWindows: aw });
    return { aw, main, map, handlers };
  };
  const logLines = (w) => w.webContents.sent.filter((m) => m.channel === "log-lines").map((m) => m.payload.text).join("");

  it("new log lines reach both windows; the map window's full read leaves the offsets alone", async () => {
    const { main, map, handlers } = setup();
    await handlers.get("log-watch-start")(null, dir);
    // The map window attaches: it gets the journal (the start's reset), nothing restarts.
    const att = await handlers.get("log-watch-attach")({ sender: map.webContents });
    expect(att).toMatchObject({ ok: true, attached: true, running: true });
    expect(att.replayed).toBeGreaterThanOrEqual(1);
    fs.appendFileSync(path.join(dir, "message_log.txt"), "12:00:05 new line\n");
    const r = await handlers.get("log-read-full")({ sender: map.webContents }, dir);
    expect(r.msg).toContain("new line");
    await new Promise((res) => setTimeout(res, 2300)); // one poll
    await handlers.get("log-watch-stop")();
    expect(logLines(main)).toContain("new line");
    expect(logLines(map)).toContain("new line");
  }, 10000);

  it("control: the MAIN window's full read does move them (the poll then skips the line)", async () => {
    const { main, handlers } = setup();
    await handlers.get("log-watch-start")(null, dir);
    fs.appendFileSync(path.join(dir, "message_log.txt"), "12:00:05 new line\n");
    await handlers.get("log-read-full")({ sender: main.webContents }, dir);
    await new Promise((res) => setTimeout(res, 2300));
    await handlers.get("log-watch-stop")();
    expect(logLines(main)).not.toContain("new line");
  }, 10000);
});
