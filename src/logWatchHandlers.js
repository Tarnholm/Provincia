// Live RTW:R log watcher (message_log.txt / campaign_ai_log.txt tailing,
// passenger/unit-flow/split tracking) + the log-watch-reset / log-watch-start /
// log-watch-stop / log-read-full IPC handlers, extracted verbatim from main.js
// (2026-07-17). All watcher state lives here; main.js re-anchors it via the
// exported clearPassengers / isLogWatchActive / reanchorLogOffsetsToEof (the
// save-watch reparse + save-watch-start re-anchor sites). _logPath is injected
// as the getLogPath dep. Logic unchanged.
"use strict";
const fs = require("fs");
const path = require("path");
const { parseLine: parseLogLineV2 } = require("./messageLogParser.js");

// ── Live log watcher for Rome Remastered ──────────────────────────────────
// Watches message_log.txt and campaign_ai_log.txt, tails new lines, sends to renderer.
let logWatcher = null;
let logWatcherAI = null;
let logOffset = 0;
let logOffsetAI = 0;
let logPollInterval = null;
// Current turn index for events (1-based). Increments on each "end round"
// marker encountered while processing message_log lines.
let logPollTurnIdx = 1;

// Track army merges so the leader's MOVING_NORMAL events propagate to
// passengers (lesser generals stacked into the leader's army).
//
// In RTW: when general A walks onto general B's tile and the user accepts
// the merge prompt, the engine emits a `transferring general(A:uuid) unit(uuid)
// from army(A_army) to named general(B:uuid):army(B_army)` line. From that
// point on the engine tracks the merged stack under B's army_uuid, and
// future moves emit MOVING_NORMAL only for B (the leader). A's marker
// goes dark — until the next save snapshot updates A's character record
// with the new (x, y).
//
// Map: leaderCharUuid → array of { charUuid, name, faction } passengers.
// Cleared on log-watch-start (new campaign / fresh attach).
const armyPassengers = new Map();
// Reverse map for fast "is this character a passenger?" lookup, used to
// drop a stale passenger relationship when the same character later
// becomes a passenger of someone else (or the leader of their own stack).
const passengerToLeader = new Map();
// Live unit-flow tracking. Each transfer event in the log either moves
// ONE unit between armies (so its leader chars), or moves a general (with
// their bodyguard unit) between armies. We track the cumulative count of
// units that flowed from one leader to another, then send a snapshot to
// the renderer so the field-army `byCmd` grouping can re-bucket save
// units accordingly.
//
// Why count-based instead of identity-based: the engine's runtime memory
// uuid for a unit (e.g. `8f4f1c10` in the log) has no mapping to a save
// unit (save units are identified by file offset and don't carry a stable
// uuid that matches the runtime pointer). So we can't say "unit X moved
// from save's-Aulus-roster to save's-Marcus-roster" by identity. But we
// CAN say "13 units moved from Aulus's leader-runtime to Marcus's
// leader-runtime", which we then apply by donating 13 generic foot units
// from save-Aulus's roster to save-Marcus's roster on the renderer.
//
// Structure: unitFlow[fromRuntimeCharUuid][toRuntimeCharUuid] = count
const unitFlowFromTo = new Map();
// Who leads each army at any given time. Updated on transfer events.
// Needed to identify the donor character when a unit transfer says
// "from army(A) to named general(Y):army(B)" — Y is explicit, but the
// donor is whoever leads A.
const armyLeaderByArmyUuid = new Map();
// Runtime char uuid → { name } as seen in log events. Lets us attach
// names to flow snapshots so the renderer can match against save chars
// by (firstName, lastName, faction) instead of via the unstable runtime
// uuid → save secondaryUuid bridge. 0.9.271 used a weak first-name-only
// fallback which caused the Uria misattribution flood; tracking the
// full name from the log event itself avoids that class of bug.
const charNameByRuntimeUuid = new Map();
function recordCharName(uuid, name) {
  if (uuid && name && !charNameByRuntimeUuid.has(uuid)) {
    charNameByRuntimeUuid.set(uuid, name);
  }
}
function unitFlowAdd(from, to) {
  if (!from || !to || from === to) return;
  if (!unitFlowFromTo.has(from)) unitFlowFromTo.set(from, new Map());
  const inner = unitFlowFromTo.get(from);
  inner.set(to, (inner.get(to) || 0) + 1);
}
function unitFlowSnapshot() {
  const out = [];
  for (const [from, inner] of unitFlowFromTo) {
    for (const [to, count] of inner) {
      out.push({
        from, to, count,
        fromName: charNameByRuntimeUuid.get(from) || null,
        toName: charNameByRuntimeUuid.get(to) || null,
      });
    }
  }
  return out;
}

// Last seen army_uuid per character. Used to detect SPLITS: when a
// character's MOVING_NORMAL event reports a different army_uuid than we
// last saw, AND we already had passengers attached, it means they split
// off into a new army WITHOUT bringing their passengers along (the
// passengers stay in the old army at the split tile). Per save_rome10's
// log, the BESIEGE-to-Brundisium event for Marcus comes BEFORE the
// `transferring general(Marcus:X) ... to named general(Marcus:X):army(NEW)`
// transfer line — so we can't wait for the self-transfer to fire to clear
// the relationship; we have to read the new army_uuid off the move itself.
const armyUuidByCharUuid = new Map();
function setPassenger(leaderUuid, passengerUuid, passengerName, passengerFaction) {
  if (!leaderUuid || !passengerUuid) return;
  // Self-transfer (movedChar === toCommander) signals a SPLIT: the
  // general is moving themselves into a new empty army. Adding them to
  // their own passenger list would synthesize duplicate move events
  // forever. Skip — the split-detection in detectAndApplySplit already
  // cleared any prior passengers when the move event with the new
  // army_uuid fired.
  if (leaderUuid === passengerUuid) return;
  // Remove the passenger from any prior leader's list.
  const priorLeader = passengerToLeader.get(passengerUuid);
  if (priorLeader && priorLeader !== leaderUuid) {
    const priorList = armyPassengers.get(priorLeader);
    if (priorList) {
      const filtered = priorList.filter(p => p.charUuid !== passengerUuid);
      if (filtered.length) armyPassengers.set(priorLeader, filtered);
      else armyPassengers.delete(priorLeader);
    }
  }
  if (!armyPassengers.has(leaderUuid)) armyPassengers.set(leaderUuid, []);
  const list = armyPassengers.get(leaderUuid);
  if (!list.some(p => p.charUuid === passengerUuid)) {
    list.push({ charUuid: passengerUuid, name: passengerName, faction: passengerFaction });
  }
  passengerToLeader.set(passengerUuid, leaderUuid);
}
function clearPassengers() {
  armyPassengers.clear();
  passengerToLeader.clear();
  armyUuidByCharUuid.clear();
  unitFlowFromTo.clear();
  armyLeaderByArmyUuid.clear();
  charNameByRuntimeUuid.clear();
}
// Called on every character_move BEFORE fanout. If the moving character's
// army_uuid doesn't match the last seen value AND they have passengers,
// they've split off — clear the passenger list so we don't drag the lesser
// general(s) along to the new army's destination. Returns true if a split
// was detected (caller can skip fanout entirely).
function detectAndApplySplit(charUuid, newArmyUuid) {
  if (!charUuid || !newArmyUuid) return false;
  const prev = armyUuidByCharUuid.get(charUuid);
  armyUuidByCharUuid.set(charUuid, newArmyUuid);
  if (!prev || prev === newArmyUuid) return false;
  const passengers = armyPassengers.get(charUuid);
  if (!passengers || passengers.length === 0) return false;
  for (const p of passengers) passengerToLeader.delete(p.charUuid);
  armyPassengers.delete(charUuid);
  return true;
}

// Handle a unit-transfer event for the flow tracker. Pass in the transfer's
// fromArmyUuid, toArmyUuid, the named-general char uuid of the to-army
// (recipient = explicit), and OPTIONALLY the runtime char uuid of the
// general moving for general-transfer events. The donor is `armyLeader[from]`.
function recordUnitTransfer(fromArmyUuid, toArmyUuid, recipientCharUuid, movingGeneralUuid) {
  // Update leader tracking. When a general transfer fires, set the named
  // general as the recipient army's leader (if no one's there yet) AND
  // ensure the moving general was the from-army's leader (so we know
  // who's donating). This handles both merge and split forms.
  if (movingGeneralUuid && fromArmyUuid && !armyLeaderByArmyUuid.has(fromArmyUuid)) {
    armyLeaderByArmyUuid.set(fromArmyUuid, movingGeneralUuid);
  }
  if (recipientCharUuid && toArmyUuid && !armyLeaderByArmyUuid.has(toArmyUuid)) {
    armyLeaderByArmyUuid.set(toArmyUuid, recipientCharUuid);
  }
  const donor = fromArmyUuid ? armyLeaderByArmyUuid.get(fromArmyUuid) : null;
  const recipient = recipientCharUuid || (toArmyUuid ? armyLeaderByArmyUuid.get(toArmyUuid) : null);
  if (donor && recipient && donor !== recipient) unitFlowAdd(donor, recipient);
  // Update leader-after-the-move logic for general-transfer events.
  if (movingGeneralUuid) {
    // If the moving general was the from-army's leader, then they're
    // leaving an army that may now be empty (split, single-general case)
    // OR still have passengers. We can't know without more state — leave
    // armyLeader[from] alone; subsequent transfer events from the same
    // army will re-confirm or update it via the recipient pattern.
    // If self-transfer (moving=recipient), recipient is now the leader
    // of the to-army (already set above).
  }
}

// Hoisted above the handlers on extraction (was declared between log-watch-reset
// and log-watch-start in main.js; `let` + deferred handler execution made the
// order irrelevant there too).
let _lastWatchedLogDir = null;

// True while a log watch is running with a known log dir — main.js's
// save-watch code re-anchors the watcher only in that case.
function isLogWatchActive() {
  return !!(logPollInterval && _lastWatchedLogDir);
}
// Re-anchor both log offsets to the current EOF of the watched files.
// Extracted from the (identical) inline stat/assign code at main.js's two
// external call sites (reparseLatestSave + save-watch-start).
function reanchorLogOffsetsToEof() {
  if (!_lastWatchedLogDir) return;
  const lp = path.join(_lastWatchedLogDir, "message_log.txt");
  if (fs.existsSync(lp)) logOffset = fs.statSync(lp).size;
  const ap = path.join(_lastWatchedLogDir, "campaign_ai_log.txt");
  if (fs.existsSync(ap)) logOffsetAI = fs.statSync(ap).size;
}

function registerLogWatchHandlers(ipcMain, { BrowserWindow, getLogPath }) {

// Reset live-log tracking without restarting the watcher: re-anchor to
// current EOF, drop passenger / flow / position state, tell the renderer
// to clear its live caches. User-triggered "fresh start" — for when
// they've just loaded a save mid-session and want to ignore log entries
// written by the previous game state.
ipcMain.handle("log-watch-reset", async () => {
  if (!logPollInterval) return { ok: false, reason: "log-watch not running" };
  const msgPath = getLogPath() ? path.dirname(getLogPath()) : null;
  // We rely on the existing poll's msgPath; that's captured inside the
  // closure of the interval callback (line ~3450). Easier: re-stat the
  // file using the path the watcher most recently saw.
  try {
    // Approximation: bump offset to the current size of message_log.txt.
    // Find the log dir from the running interval: we tracked it via the
    // outer closure variable. Read directly from disk using the env we
    // set at watch-start (stored in module-scope `_lastWatchedLogDir`).
    if (_lastWatchedLogDir) {
      const p = path.join(_lastWatchedLogDir, "message_log.txt");
      logOffset = fs.existsSync(p) ? fs.statSync(p).size : logOffset;
      const ap = path.join(_lastWatchedLogDir, "campaign_ai_log.txt");
      logOffsetAI = fs.existsSync(ap) ? fs.statSync(ap).size : logOffsetAI;
    }
    clearPassengers();
    logPollTurnIdx = 1;
    const winR = BrowserWindow.getAllWindows()[0];
    if (winR) winR.webContents.send("live-char-moves", { moves: [], deaths: [], reset: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("log-watch-start", async (_event, logDir) => {
  // Stop any existing watcher
  if (logPollInterval) { clearInterval(logPollInterval); logPollInterval = null; }

  const msgPath = path.join(logDir, "message_log.txt");
  const aiPath = path.join(logDir, "campaign_ai_log.txt");

  if (!fs.existsSync(msgPath)) return { error: "message_log.txt not found in " + logDir };
  _lastWatchedLogDir = logDir;

  // Start from current end of file (only watch new lines)
  try { logOffset = fs.statSync(msgPath).size; } catch { logOffset = 0; }
  try { logOffsetAI = fs.statSync(aiPath).size; } catch { logOffsetAI = 0; }

  // Reset turn counter for this fresh watch cycle.
  logPollTurnIdx = 1;
  // Clear passenger tracking from any prior watch cycle.
  clearPassengers();

  // Clear any prior live-position state in the renderer before backfilling.
  // Otherwise stale entries from a previous campaign would mix with the new
  // log's data.
  try {
    const winClear = BrowserWindow.getAllWindows()[0];
    if (winClear) winClear.webContents.send("live-char-moves", { moves: [], deaths: [], reset: true });
  } catch {}

  // Backfill: parse the whole existing log once for character-move events
  // so the renderer has a populated live-positions map right away (user
  // shouldn't have to wait for a new move to happen to see armies in their
  // correct spots).
  try {
    const win0 = BrowserWindow.getAllWindows()[0];
    if (fs.existsSync(msgPath) && win0) {
      const fullText = fs.readFileSync(msgPath, "utf8");
      const moves = [];
      const deaths = [];
      // Tag each event with the turn it happened in. Count "end round"
      // markers to delimit turns. The renderer uses `turn` to filter log
      // events when the user is viewing an older save (avoids showing
      // future positions).
      let backfillTurn = 1;
      for (const line of fullText.split(/\r?\n/)) {
        if (line.startsWith("=================")) {
          if (line.includes("end round")) backfillTurn++;
          continue;
        }
        const ev = parseLogLineV2(line);
        if (!ev) continue;
        if (ev.type === "character_move") {
          // Detect split: if this move's army_uuid differs from what we
          // had recorded, the character moved to a new army without
          // their passengers. Clears the passenger list so the fanout
          // below doesn't fire for ex-passengers.
          detectAndApplySplit(ev.charUuid, ev.armyUuid);
          moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn: backfillTurn });
          // Propagate to passengers: the leader is the one emitting
          // MOVING_NORMAL; lesser generals folded into this stack don't
          // emit their own move event, so synthesize one per passenger.
          const passengers = ev.charUuid ? armyPassengers.get(ev.charUuid) : null;
          if (passengers) {
            for (const p of passengers) {
              moves.push({ name: p.name, faction: p.faction || ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: p.charUuid, turn: backfillTurn });
            }
          }
        } else if (ev.type === "general_transfer") {
          // Empirically verified against save_rome10's message_log:
          //   `transferring general(Marcus:...) unit(...) from army(A) to named general(Aulus:...):army(B)`
          // After this, Aulus's uuid never appears in another event.
          // Marcus emits BESIEGE for the merged stack's move to Uria.
          // So in this transfer form: the MOVED general (X) is the
          // active mover that keeps emitting MOVING_NORMAL, and the
          // DESTINATION army's named general (Z) is the passive
          // passenger whose marker would otherwise freeze. Don't read
          // intent into Z (governor / faction leader / whatever) —
          // just trust the log: Z stops emitting after the transfer,
          // so we propagate X's moves to Z.
          setPassenger(ev.movedCharUuid, ev.toCommanderUuid, ev.toCommanderName, null);
          // Update the army-uuid tracking so the next MOVING_NORMAL for
          // the moved general doesn't trigger split-detection (the move
          // will use the destination army's uuid, which is the new
          // expected value after a merge). Without this, the merge
          // itself would look like a split — the very next move event's
          // armyUuid differs from the pre-merge tracking value.
          if (ev.movedCharUuid && ev.toArmyUuid) {
            armyUuidByCharUuid.set(ev.movedCharUuid, ev.toArmyUuid);
          }
          recordCharName(ev.movedCharUuid, ev.movedCharName);
          recordCharName(ev.toCommanderUuid, ev.toCommanderName);
          recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, ev.movedCharUuid);
        } else if (ev.type === "unit_transfer") {
          recordCharName(ev.toCommanderUuid, ev.toCommanderName);
          recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, null);
        } else if (ev.type === "fleeing") {
          moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, charUuid: null, turn: backfillTurn });
        } else if (ev.type === "flee_tile" || ev.type === "fleeing_to_settlement") {
          moves.push({ name: ev.name, faction: ev.faction || null, x: ev.x, y: ev.y, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn: backfillTurn });
        } else if (ev.type === "army_created") {
          moves.push({ name: ev.name, faction: null, x: ev.x, y: ev.y, charUuid: ev.charUuid, turn: backfillTurn });
        } else if (ev.type === "army_dead") {
          deaths.push({ name: ev.commanderName, faction: ev.faction, turn: backfillTurn });
        } else if ((ev.type === "char_death" || ev.type === "char_dying") && !ev.alive) {
          deaths.push({ name: ev.name, faction: ev.faction, turn: backfillTurn });
        } else if (ev.type === "character_deleted") {
          deaths.push({ charUuid: ev.charUuid, turn: backfillTurn });
        }
      }
      // Sync poll-side counter so subsequent delta reads continue from here.
      logPollTurnIdx = backfillTurn;
      if (moves.length > 0 || deaths.length > 0) {
        // Chunk moves; send deaths separately (smaller).
        const CHUNK = 1000;
        for (let i = 0; i < moves.length; i += CHUNK) {
          win0.webContents.send("live-char-moves", { moves: moves.slice(i, i + CHUNK) });
        }
        if (deaths.length > 0) win0.webContents.send("live-char-moves", { moves: [], deaths });
      }
      // Send the unit-flow snapshot after backfill so the renderer can
      // re-bucket save units in the field-army panel before the user
      // interacts. Snapshot is the cumulative {from, to, count} flow built
      // from every transfer event seen so far.
      const flow = unitFlowSnapshot();
      if (flow.length > 0) win0.webContents.send("live-char-moves", { moves: [], unitFlow: flow });
    }
  } catch (e) { console.warn("[log-watch] backfill failed:", e.message); }

  // Poll every 2 seconds for new data
  logPollInterval = setInterval(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Read new lines from message_log
    try {
      const stat = fs.statSync(msgPath);
      if (stat.size > logOffset) {
        const fd = fs.openSync(msgPath, "r");
        const buf = Buffer.alloc(stat.size - logOffset);
        fs.readSync(fd, buf, 0, buf.length, logOffset);
        fs.closeSync(fd);
        logOffset = stat.size;
        const text = buf.toString("utf8");
        if (text.trim()) {
          win.webContents.send("log-lines", { source: "message", text });
          // Also extract character-move + death events for live tracking.
          const moves = [];
          const deaths = [];
          for (const line of text.split(/\r?\n/)) {
            if (line.startsWith("=================")) {
              if (line.includes("end round")) logPollTurnIdx++;
              continue;
            }
            const ev = parseLogLineV2(line);
            if (!ev) continue;
            const turn = logPollTurnIdx;
            if (ev.type === "character_move") {
              detectAndApplySplit(ev.charUuid, ev.armyUuid);
              moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn });
              const passengers = ev.charUuid ? armyPassengers.get(ev.charUuid) : null;
              if (passengers) {
                for (const p of passengers) {
                  moves.push({ name: p.name, faction: p.faction || ev.faction, role: ev.role, x: ev.toX, y: ev.toY, armyUuid: ev.armyUuid, charUuid: p.charUuid, turn });
                }
              }
            } else if (ev.type === "general_transfer") {
              setPassenger(ev.movedCharUuid, ev.toCommanderUuid, ev.toCommanderName, null);
              if (ev.movedCharUuid && ev.toArmyUuid) {
                armyUuidByCharUuid.set(ev.movedCharUuid, ev.toArmyUuid);
              }
              recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, ev.movedCharUuid);
            } else if (ev.type === "unit_transfer") {
              recordUnitTransfer(ev.fromArmyUuid, ev.toArmyUuid, ev.toCommanderUuid, null);
            } else if (ev.type === "fleeing") {
              moves.push({ name: ev.name, faction: ev.faction, role: ev.role, x: ev.toX, y: ev.toY, charUuid: null, turn });
            } else if (ev.type === "flee_tile" || ev.type === "fleeing_to_settlement") {
              moves.push({ name: ev.name, faction: ev.faction || null, x: ev.x, y: ev.y, armyUuid: ev.armyUuid, charUuid: ev.charUuid, turn });
            } else if (ev.type === "army_created") {
              moves.push({ name: ev.name, faction: null, x: ev.x, y: ev.y, charUuid: ev.charUuid, turn });
            } else if (ev.type === "army_dead") {
              deaths.push({ name: ev.commanderName, faction: ev.faction, turn });
            } else if (ev.type === "char_death" || ev.type === "char_dying") {
              // Treat DYING events as "remove from map" regardless of
              // the death_type flag. DET_ALIVE means the character
              // survived (e.g. captured / exiled rather than killed),
              // but their army was destroyed and they no longer hold a
              // map position — exactly the case the user hit when
              // capturing Brundisium and seeing Titus's marker linger
              // (DET_ALIVE was being filtered out, so the marker stuck
              // until the next save snapshot dropped him).
              deaths.push({ name: ev.name, faction: ev.faction, charUuid: ev.charUuid, turn });
            } else if (ev.type === "character_deleted") {
              deaths.push({ charUuid: ev.charUuid, turn });
            }
          }
          // Always include the latest unit-flow snapshot alongside any
          // move/death batch — it's small and lets the renderer re-bucket
          // units on every live event.
          const flow = unitFlowSnapshot();
          if (moves.length > 0 || deaths.length > 0 || flow.length > 0) {
            win.webContents.send("live-char-moves", { moves, deaths, unitFlow: flow });
          }
        }
      } else if (stat.size < logOffset) {
        // File was truncated (new campaign started) — reset and notify
        logOffset = 0;
        win.webContents.send("log-lines", { source: "reset", text: "" });
        win.webContents.send("live-char-moves", { moves: [], reset: true });
      }
    } catch {}

    // Read new lines from campaign_ai_log
    try {
      if (fs.existsSync(aiPath)) {
        const stat = fs.statSync(aiPath);
        if (stat.size > logOffsetAI) {
          const fd = fs.openSync(aiPath, "r");
          const buf = Buffer.alloc(stat.size - logOffsetAI);
          fs.readSync(fd, buf, 0, buf.length, logOffsetAI);
          fs.closeSync(fd);
          logOffsetAI = stat.size;
          const text = buf.toString("utf8");
          if (text.trim()) win.webContents.send("log-lines", { source: "ai", text });
        } else if (stat.size < logOffsetAI) {
          logOffsetAI = 0;
        }
      }
    } catch {}
  }, 2000);

  return { ok: true, msgPath, aiPath };
});

ipcMain.handle("log-watch-stop", async () => {
  if (logPollInterval) { clearInterval(logPollInterval); logPollInterval = null; }
  return { ok: true };
});

// Allow reading the full log files for initial parse (backfill)
ipcMain.handle("log-read-full", async (_event, logDir) => {
  const msgPath = path.join(logDir, "message_log.txt");
  const aiPath = path.join(logDir, "campaign_ai_log.txt");
  let msg = null, ai = null;
  try { msg = fs.readFileSync(msgPath, "utf8"); } catch {}
  try { ai = fs.readFileSync(aiPath, "utf8"); } catch {}
  // Set offsets to end so watcher only gets new stuff
  try { logOffset = fs.statSync(msgPath).size; } catch {}
  try { logOffsetAI = fs.statSync(aiPath).size; } catch {}
  return { msg, ai };
});

}

module.exports = {
  registerLogWatchHandlers,
  clearPassengers,
  isLogWatchActive,
  reanchorLogOffsetsToEof,
};
