// Worker thread that runs the live-load save parse (parseSaveData) OFF the
// Electron main thread. On a live turn the save-watcher reparses the 30-45 MB
// save; that parse is ~1.6s of main-thread work (character extras, ownership,
// diplomacy, treasury…) which froze the window every turn. Running it here keeps
// the app responsive; the result (~1.3 MB, ~14ms to clone back) returns to the
// main thread, which assigns it to lastSaveData exactly as before.
//
// parseSaveData is a pure factory (makeParseSaveData) whose only inputs are the
// KNOWN_BUILDINGS set + three mod-state values (AI-by-faction / AI-personality
// order / faction order). The main thread passes CURRENT snapshots of those —
// they don't change during a parse — so the worker's output is identical to the
// main-thread parse.
//
// Communication:
//   in:  { savePath?, saveBuf?, knownBuildings:[...], modAiByFaction,
//          modAiPersonalityOrder, modFactionOrder }
//   out (streamed): { type: "progress", stage }            (0+ times)
//        (final):   { type: "done", ok: true, result, logs }
//                   { type: "done", ok: false, error, logs }
//
// `logs` carries parseSaveData's own [perf]/[diplomacy]/[player-faction]/…
// console diagnostics back so the main thread can replay them into provincia.log
// (a worker's console is not the main thread's log-capturing console).

"use strict";

const fs = require("fs");
const { parentPort } = require("worker_threads");
const { makeParseSaveData } = require("./parseSaveData.js");

parentPort.on("message", async (payload) => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { try { logs.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")); } catch { /* logging must never throw */ } };
  try {
    const { savePath, saveBuf, knownBuildings, modAiByFaction, modAiPersonalityOrder, modFactionOrder } = payload;
    const KNOWN_BUILDINGS = new Set(knownBuildings || []);
    const parseSaveData = makeParseSaveData({
      KNOWN_BUILDINGS,
      getModAiByFaction: () => modAiByFaction || {},
      getModAiPersonalityOrder: () => modAiPersonalityOrder || [],
      getModFactionOrder: () => modFactionOrder || [],
    });

    // Reuse the passed buffer when present (live-watch already read the file);
    // otherwise the parser reads savePath itself. postMessage delivers Buffers
    // as Uint8Array — wrap back into a real Buffer for the byte readers.
    let buf = null;
    if (saveBuf) buf = Buffer.isBuffer(saveBuf) ? saveBuf : Buffer.from(saveBuf.buffer, saveBuf.byteOffset, saveBuf.byteLength);
    else if (!savePath || !fs.existsSync(savePath)) throw new Error("no save path or buffer");

    // Forward parse-progress stages to the main thread so the load bar still moves.
    const onProgress = (p) => { try { parentPort.postMessage({ type: "progress", stage: p && p.stage }); } catch { /* */ } };

    const result = await parseSaveData(savePath, onProgress, buf);
    console.log = origLog;
    parentPort.postMessage({ type: "done", ok: true, result, logs });
  } catch (err) {
    console.log = origLog;
    parentPort.postMessage({ type: "done", ok: false, error: err && err.message ? err.message : String(err), logs });
  }
});
