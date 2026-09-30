// Provincia's renderer windows (main process, electron-free so it unit-tests).
//
// The PRIMARY window owns everything with side effects on the main process:
// the save watcher, the log watcher and its read offsets. The optional second
// MAP window (a second screen showing another map mode) runs the same renderer
// but only FOLLOWS: it attaches to the primary's watchers instead of
// restarting them, and receives the same live broadcasts. The Scripts window
// is not registered here and never gets these broadcasts.
//
// live-char-moves is journaled since its last reset so a map window opened
// mid-session can be brought up to the primary's live army positions (the log
// watcher's backfill ran once, long before that window existed).
"use strict";

const LIVE_JOURNAL_CAP = 20000;

function createAppWindows({ log = () => {} } = {}) {
  let primary = null;
  const followers = new Set();
  let liveJournal = [];
  let journalCapLogged = false;

  const alive = (win) => {
    try {
      if (!win || win.isDestroyed()) return false;
      const wc = win.webContents;
      if (!wc || wc.isDestroyed() || wc.isCrashed()) return false;
      return true;
    } catch { return false; }
  };

  function setPrimary(win) { primary = win; }
  function getPrimary() { return alive(primary) ? primary : null; }
  function addFollower(win) {
    followers.add(win);
    win.on("closed", () => followers.delete(win));
  }
  function getFollowers() { return [...followers].filter(alive); }
  function all() { return [getPrimary(), ...getFollowers()].filter(Boolean); }
  function isFollower(sender) {
    if (!sender) return false;
    for (const w of followers) { try { if (w.webContents === sender) return true; } catch { /* destroyed */ } }
    return false;
  }

  // Send to every live app window; a window whose frame is gone is skipped
  // (sending to it throws "Render frame was disposed"). Returns how many got it.
  function send(channel, payload) {
    let n = 0;
    for (const win of all()) {
      try { win.webContents.send(channel, payload); n++; } catch { /* frame gone */ }
    }
    return n;
  }

  function sendLiveMoves(payload) {
    if (payload && payload.reset) { liveJournal = []; journalCapLogged = false; }
    liveJournal.push(payload);
    if (liveJournal.length > LIVE_JOURNAL_CAP) {
      liveJournal.splice(0, liveJournal.length - LIVE_JOURNAL_CAP);
      if (!journalCapLogged) {
        journalCapLogged = true;
        log(`[app-windows] live-char-moves journal passed ${LIVE_JOURNAL_CAP} batches — a map window opened now misses the oldest`);
      }
    }
    return send("live-char-moves", payload);
  }

  // Replay the journal to one window (a map window attaching mid-session).
  function replayLiveMoves(webContents) {
    let n = 0;
    for (const payload of liveJournal) {
      try { webContents.send("live-char-moves", payload); n++; } catch { break; }
    }
    return n;
  }

  return {
    alive, setPrimary, getPrimary, addFollower, getFollowers, all, isFollower,
    send, sendLiveMoves, replayLiveMoves,
    _journalLength: () => liveJournal.length,
  };
}

// The pre-registry behaviour: everything goes to getAllWindows()[0]. Handler
// modules fall back to this when registered without an appWindows instance
// (their unit tests inject a fake BrowserWindow that way).
function legacyAppWindows(BrowserWindow) {
  const first = () => {
    const w = BrowserWindow && BrowserWindow.getAllWindows()[0];
    return w || null;
  };
  const send = (channel, payload) => {
    const w = first();
    if (!w) return 0;
    try { w.webContents.send(channel, payload); return 1; } catch { return 0; }
  };
  return {
    getPrimary: first,
    isFollower: () => false,
    send,
    sendLiveMoves: (payload) => send("live-char-moves", payload),
    replayLiveMoves: () => 0,
  };
}

module.exports = { createAppWindows, legacyAppWindows, LIVE_JOURNAL_CAP };
