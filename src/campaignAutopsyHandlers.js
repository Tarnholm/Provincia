// Campaign Autopsy IPC handler. registerCampaignAutopsyHandlers(ipcMain, deps)
// wires "analyze-campaign" — the post-mortem view over a folder of saves: each
// faction's settlement/treasury/army trajectory plus a collapse/growth verdict.
//
// CONTRACT — analyze-campaign(modDataDir, saveDirOrTimeline):
//   The second argument is polymorphic so the renderer can pick the cheap path:
//
//   • A PRE-SCANNED timeline (the app's `campaignTimeline` state, i.e. the
//     scan-saves-timeline result) — an object { campaigns:[{turns:[...]}], ... },
//     OR a bare array of timeline rows. Nothing is re-cracked; the rows are
//     analyzed directly. This is the PRIMARY path — the panel already holds a
//     scanned timeline and just forwards it, so an autopsy is instant.
//
//   • A saves-FOLDER path (string). We mirror scan-saves-timeline: discover the
//     unique .sav files (collectUniqueSaves) and crack each in a timelineRowWorker
//     thread (off the main thread, ~cores× parallel), then analyze the rows. On
//     any worker-infra failure we fall back to a synchronous main-thread crack
//     (slower, never a regression) — same convention as the other handlers.
//
// Either way the return is analyzeCampaign()'s { factions, turns, winner } or
// { error }.  deps: { _writeLog } (optional logger, same shape main.js passes
// the other register* modules).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");
const { analyzeCampaign } = require("./campaignAutopsy.js");

const TIMELINE_WORKER_PATH = path.join(__dirname, "timelineRowWorker.js");

// Pull the flat list of timeline rows out of whatever the renderer forwarded:
// a bare rows array, a single campaign, or the full scan result (all campaigns).
// Every save has exactly one player faction, so concatenating all campaigns'
// rows yields each save once — and every row carries _ownerByCity for ALL
// factions, which is what the autopsy needs.
function rowsFromTimeline(tl) {
  if (Array.isArray(tl)) return tl.filter(Boolean);
  if (tl && Array.isArray(tl.campaigns)) {
    const rows = [];
    for (const c of tl.campaigns) if (c && Array.isArray(c.turns)) rows.push(...c.turns);
    return rows;
  }
  if (tl && Array.isArray(tl.turns)) return tl.turns.filter(Boolean);
  if (tl && Array.isArray(tl.rows)) return tl.rows.filter(Boolean);
  return null;
}

function registerCampaignAutopsyHandlers(ipcMain, deps = {}) {
  const _writeLog = typeof deps._writeLog === "function" ? deps._writeLog : () => {};

  // Crack a folder of saves into timeline rows, fanned across worker threads.
  // Mirrors saveAnalysisHandlers' crackRowsInParallel; rejects with { infra:true }
  // on worker-infra failure so the caller can fall back to a synchronous crack.
  const crackRowsInParallel = (files, mod) => new Promise((resolve, reject) => {
    const cap = Math.max(1, Math.min(files.length, ((os.cpus() && os.cpus().length) || 4) - 1));
    const rows = [];
    const errors = [];
    let idx = 0;
    let active = 0;
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; e.infra = true; reject(e); } };
    const pump = () => {
      if (settled) return;
      if (idx >= files.length && active === 0) { settled = true; resolve({ rows, errors }); return; }
      while (active < cap && idx < files.length) {
        const savePath = files[idx++];
        active++;
        let worker;
        try { worker = new Worker(TIMELINE_WORKER_PATH); }
        catch (e) { fail(e); return; }
        worker.once("message", (msg) => {
          worker.terminate();
          active--;
          if (msg && msg.ok && msg.row) rows.push(msg.row);
          else errors.push({ file: (msg && msg.file) || path.basename(savePath), error: (msg && msg.error) || "worker returned no row" });
          pump();
        });
        worker.once("error", (err) => { worker.terminate(); active--; fail(err); });
        worker.postMessage({ savePath, mod, factionOverride: null });
      }
    };
    pump();
  });

  // Synchronous fallback — crack every save on the main thread (blocks; only used
  // when the worker infrastructure itself failed to start).
  const crackRowsSync = (files, mod) => {
    const { crackSave } = require("./saveCracker.js");
    const { extractRow } = require("../scripts/campaign-timeline.js");
    const rows = [];
    const errors = [];
    for (const f of files) {
      try { rows.push(extractRow(crackSave(fs.readFileSync(f), mod), f, null)); }
      catch (e) { errors.push({ file: path.basename(f), error: e && e.message ? e.message : String(e) }); }
    }
    return { rows, errors };
  };

  ipcMain.handle("analyze-campaign", async (_event, modDataDir, saveDirOrTimeline) => {
    try {
      // ── Path A: a pre-scanned timeline (array or scan result) — analyze directly.
      const preRows = rowsFromTimeline(saveDirOrTimeline);
      if (preRows) {
        if (preRows.length === 0) return { error: "The timeline has no saves to analyze — scan a saves folder first." };
        const t0 = Date.now();
        const result = analyzeCampaign(preRows);
        _writeLog(`[analyze-campaign] analyzed ${preRows.length} pre-scanned row(s) in ${Date.now() - t0}ms — ${result.factions.length} factions, winner ${result.winner || "—"}`);
        return result;
      }

      // ── Path B: a saves-folder path (string) — scan then analyze.
      if (typeof saveDirOrTimeline !== "string" || !saveDirOrTimeline) {
        return { error: "analyze-campaign needs a scanned timeline or a saves-folder path." };
      }
      if (!modDataDir) return { error: "No mod data directory — load a mod first." };
      const dir = saveDirOrTimeline;
      if (!fs.existsSync(dir)) return { error: "Folder not found: " + dir };

      const { collectUniqueSaves } = require("../scripts/campaign-timeline.js");
      const files = collectUniqueSaves([dir]);
      if (files.length === 0) return { error: "No .sav files found in: " + dir };

      const t0 = Date.now();
      let rows;
      let errors;
      try {
        ({ rows, errors } = await crackRowsInParallel(files, modDataDir));
      } catch (werr) {
        if (!werr || !werr.infra) throw werr;
        _writeLog(`[analyze-campaign] worker infra failed (${werr.message || werr}) — cracking on main thread`);
        ({ rows, errors } = crackRowsSync(files, modDataDir));
      }
      if (rows.length === 0) {
        return { error: `Cracked 0 of ${files.length} save(s)` + (errors.length ? `: ${errors[0].file} — ${errors[0].error}` : ".") };
      }
      const result = analyzeCampaign(rows);
      result.scanned = files.length;
      result.errors = errors;
      _writeLog(`[analyze-campaign] scanned ${files.length} save(s), cracked ${rows.length}, in ${Date.now() - t0}ms — ${result.factions.length} factions, winner ${result.winner || "—"}${errors.length ? `, ${errors.length} crack error(s)` : ""}`);
      return result;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      _writeLog("[analyze-campaign] FAILED: " + msg);
      return { error: msg };
    }
  });
}

module.exports = { registerCampaignAutopsyHandlers, rowsFromTimeline };
