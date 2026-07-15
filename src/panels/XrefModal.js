// Cross-reference modal, extracted from App.js (2026-07-15). Presentational:
// shows xref search results grouped by file and jumps to a hit in the Monaco
// editor. Props: the query string + its setter, the result object, a loading
// flag, and a close handler. No App state/refs touched. Behavior identical to
// the inline IIFE it replaced.
import React from "react";

export default function XrefModal({ xrefQuery, setXrefQuery, xrefResult, xrefLoading, onClose }) {
  const r = xrefResult;
  const totalFiles = r && r.byFile ? Object.keys(r.byFile).length : 0;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 10001, display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: "8vh",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1e1e1e", color: "#e6e6e6", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.10)",
        width: "min(780px, 92vw)", maxHeight: "82vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", flex: 1 }}>Cross-reference</h3>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
            color: "#ccc", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.78rem",
          }}>Close</button>
        </div>
        <input
          autoFocus
          value={xrefQuery}
          onChange={(e) => setXrefQuery(e.target.value)}
          placeholder="Type a token — chain name, level, trait, ancillary, region…"
          style={{
            margin: "10px 14px 4px", padding: "8px 12px", background: "#252525", color: "#eee",
            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, fontSize: "0.9rem", outline: "none",
          }}
        />
        <div style={{ padding: "4px 14px 8px", fontSize: "0.7rem", color: "#888" }}>
          {xrefLoading ? "Scanning…" : r ? (r.error ? <span style={{ color: "#f87171" }}>Error: {r.error}</span> : `${r.totalMatches} match${r.totalMatches === 1 ? "" : "es"} across ${totalFiles} file${totalFiles === 1 ? "" : "s"}`) : (xrefQuery.trim() ? "" : "Whole-word, case-sensitive. Searches every loaded config file. Click a result to jump to it in the Monaco editor.")}
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "0 14px 12px" }}>
          {r && r.byFile && Object.entries(r.byFile).map(([fname, hits]) => (
            <div key={fname} style={{ marginTop: 10 }}>
              <div style={{ fontSize: "0.74rem", color: "#7fd1b9", fontWeight: 600, marginBottom: 4 }}>
                {fname} <span style={{ color: "#777", fontWeight: 400 }}>· {hits.length}</span>
              </div>
              {hits.map((h, i) => (
                <div
                  key={i}
                  onClick={() => { window.electronAPI?.scriptsJumpTo?.(fname, h.text.slice(0, 60), h.line); }}
                  title={`Open ${fname}:${h.line} in editor`}
                  style={{
                    display: "flex", gap: 10, padding: "4px 8px", fontSize: "0.72rem",
                    cursor: "pointer", borderRadius: 3, fontFamily: "monospace",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ color: "#777", minWidth: 42, textAlign: "right", flexShrink: 0 }}>{h.line}</span>
                  <span style={{ color: "#ddd", whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}>{h.text}</span>
                </div>
              ))}
            </div>
          ))}
          {r && r.totalMatches === 0 && !xrefLoading && (
            <div style={{ padding: "12px 8px", color: "#888", fontStyle: "italic" }}>
              No matches for <code style={{ color: "#facc15" }}>{xrefQuery}</code> in any loaded file.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
