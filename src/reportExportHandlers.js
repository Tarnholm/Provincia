// reportExportHandlers.js — main-process IPC for the shareable HTML report
// export (CJS, follows the registerXHandlers(ipcMain, deps) module pattern).
//
//   registerReportExportHandlers(ipcMain, { dialog })
//
// One channel:
//   "export-html-report" (html, suggestedName)
//     → Save-As dialog (.html filter), writes the renderer-built HTML verbatim
//       as UTF-8. Replies { ok: true, path } | { canceled: true } | { error }.
//       Always replies — no silent-drop path (see the 0.9.1096 hang lesson).
//
// The HTML is produced entirely in the renderer (src/reportExport.js); this
// module only puts it on disk at a user-picked path, so no path containment
// is needed — the destination comes from the OS dialog, not from the renderer.
const fs = require("fs");

function registerReportExportHandlers(ipcMain, deps) {
  const { dialog } = deps;

  ipcMain.handle("export-html-report", async (_event, html, suggestedName) => {
    try {
      if (typeof html !== "string" || !html.trim()) return { error: "empty report HTML" };
      // Keep the suggested name a plain basename ending in .html — the dialog
      // treats it as a default filename, not a path.
      let name = String(suggestedName || "provincia-report.html").split(/[\\/]/).pop();
      if (!/\.html?$/i.test(name)) name += ".html";
      const result = await dialog.showSaveDialog({
        title: "Export HTML report",
        defaultPath: name,
        filters: [{ name: "HTML Report", extensions: ["html"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      fs.writeFileSync(result.filePath, html, "utf8");
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  });

  // "preview-html-report" (html) → write to a temp file and open it in the
  // system browser. The renderer's old preview used window.open(blobURL),
  // which the app's setWindowOpenHandler always DENIES — Preview never worked
  // in the packaged app (user report 2026-07-24). shell.openPath on a real
  // temp file is the reliable route and matches the button's promise
  // ("open in a browser without saving"). The temp file is rewritten on each
  // preview and left for the OS temp cleaner.
  ipcMain.handle("preview-html-report", async (_event, html) => {
    try {
      if (typeof html !== "string" || !html.trim()) return { error: "empty report HTML" };
      const os = require("os");
      const path = require("path");
      const { shell } = require("electron");
      const p = path.join(os.tmpdir(), "provincia-report-preview.html");
      fs.writeFileSync(p, html, "utf8");
      const err = await shell.openPath(p);
      if (err) return { error: err };
      return { ok: true, path: p };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  });
}

module.exports = { registerReportExportHandlers };
