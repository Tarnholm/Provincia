// Report Export panel — build + preview + save the shareable single-file HTML
// report (src/reportExport.js). Presentational modal in the ArmySetupModal
// style: dark inline styles, createPortal overlay, caller owns wiring.
//
// Props:
//   collect  () => data      — App-provided collector returning the
//                              buildHtmlReport data object (see the DATA
//                              CONTRACT in ../reportExport.js). Called once
//                              when the panel opens; heavy work (e.g. canvas
//                              toDataURL for the map snapshot) happens there.
//   onClose  () => void
//
// The panel lets the user edit the report title + notes, toggle which of the
// collected sections to include, preview in the default browser context via a
// Blob URL + window.open (no extra BrowserWindow needed), and export through
// window.electronAPI.exportHtmlReport(html, suggestedName) → the
// "export-html-report" IPC (src/reportExportHandlers.js).
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { buildHtmlReport } from "../reportExport.js";

const SECTION_DEFS = [
  { key: "map", label: "Map snapshot", has: (d) => typeof d.mapPngDataUrl === "string" && d.mapPngDataUrl.startsWith("data:image/") },
  { key: "factions", label: "Faction economy", has: (d) => Array.isArray(d.factionRows) && d.factionRows.length > 0 },
  { key: "settlements", label: "Settlement highlights", has: (d) => Array.isArray(d.settlementRows) && d.settlementRows.length > 0 },
  { key: "victory", label: "Victory progress", has: (d) => Array.isArray(d.victoryRows) && d.victoryRows.length > 0 },
];

export default function ReportExportPanel({ collect, onClose }) {
  // Collect once on open. A throwing collector must not blank the panel —
  // surface the error inline instead.
  const [data] = useState(() => {
    try { return (typeof collect === "function" && collect()) || {}; }
    catch (e) { return { __collectError: e?.message || String(e) }; }
  });
  const [title, setTitle] = useState(data.meta?.title || "Provincia analysis report");
  const [notes, setNotes] = useState(typeof data.notes === "string" ? data.notes : "");
  const [include, setInclude] = useState(() => {
    const inc = {}; for (const s of SECTION_DEFS) inc[s.key] = s.has(data); return inc;
  });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const present = SECTION_DEFS.filter((s) => s.has(data));

  const assemble = () => {
    const d = {
      ...data,
      meta: { ...(data.meta || {}), title: title.trim() || "Provincia report" },
      notes: notes.trim() || undefined,
    };
    delete d.__collectError;
    if (!include.map) delete d.mapPngDataUrl;
    if (!include.factions) delete d.factionRows;
    if (!include.settlements) delete d.settlementRows;
    if (!include.victory) delete d.victoryRows;
    return buildHtmlReport(d);
  };

  const suggestedName = () => {
    const slug = (title.trim() || "provincia-report").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "provincia-report";
    return slug + "-" + new Date().toISOString().slice(0, 10) + ".html";
  };

  const preview = async () => {
    // window.open(blobURL) is DENIED by the app's window-open policy, so the
    // old preview silently never opened (fixed 2026-07-24). Preview now goes
    // through main: temp file + system browser via shell.openPath.
    try {
      setStatus("Opening preview…");
      const r = await window.electronAPI?.previewHtmlReport?.(assemble());
      if (!r) setStatus("Preview IPC unavailable — previewHtmlReport missing from the preload bridge.");
      else if (r.ok) setStatus("Preview opened in your browser.");
      else setStatus("Preview failed: " + (r.error || "unknown error"));
    } catch (e) { setStatus("Preview failed: " + (e?.message || String(e))); }
  };

  const doExport = async () => {
    if (busy) return;
    setBusy(true); setStatus("");
    try {
      const r = await window.electronAPI?.exportHtmlReport?.(assemble(), suggestedName());
      if (!r) setStatus("Export IPC unavailable — exportHtmlReport missing from the preload bridge.");
      else if (r.ok) setStatus("Saved: " + r.path);
      else if (r.canceled) setStatus("");
      else setStatus("Export failed: " + (r.error || "unknown error"));
    } catch (e) { setStatus("Export failed: " + (e?.message || String(e))); }
    finally { setBusy(false); }
  };

  const inputStyle = {
    background: "rgba(0,0,0,0.35)", color: "#f4f4f4", border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 5, padding: "5px 8px", fontSize: "0.85rem", width: "100%",
  };
  const btnStyle = (primary) => ({
    background: primary ? "rgba(143,180,110,0.25)" : "rgba(60,60,60,0.7)",
    color: primary ? "#b8d38f" : "#e8c873",
    border: "1px solid " + (primary ? "#7a9a5a" : "#a08a4a"),
    borderRadius: 5, padding: "4px 14px", cursor: busy ? "default" : "pointer",
    fontSize: "0.8rem", opacity: busy ? 0.6 : 1,
  });

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(560px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>⇪ Export HTML report</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "10px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {data.__collectError && (
            <div style={{ color: "#e08a7a", fontSize: "0.8rem" }}>Could not collect session data: {data.__collectError}</div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", color: "#8aa" }}>
            Report title
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </label>

          <div style={{ fontSize: "0.74rem", color: "#8aa" }}>
            Sections
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {present.length === 0 && (
                <span style={{ color: "#9a938a", fontSize: "0.78rem" }}>No table/map data collected — the report will contain the title and notes only.</span>
              )}
              {present.map((s) => (
                <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8e4de", fontSize: "0.82rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!include[s.key]} onChange={(e) => setInclude((prev) => ({ ...prev, [s.key]: e.target.checked }))} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", color: "#8aa" }}>
            Notes (free text, included as its own section when non-empty)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
              placeholder="Findings, caveats, asks for the mod team…"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
          </label>

          {status && (
            <div style={{ fontSize: "0.78rem", color: status.startsWith("Saved:") ? "#9ed6ad" : "#e0b87a", wordBreak: "break-all" }}>{status}</div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px 4px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={preview} disabled={busy} style={btnStyle(false)} title="Open the report in a browser window without saving it.">Preview</button>
          <button onClick={doExport} disabled={busy} style={btnStyle(true)} title="Save the report as a single self-contained .html file — shareable in chat/GitLab, opens in any browser.">Export…</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
