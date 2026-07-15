// Revert-to-autosave modal, extracted from App.js (2026-07-15). Lists the
// retained in-app edit autosaves newest-first; picking one rolls the app back.
// Props thread the autosave list, the cap, and the App handlers it calls
// (revert, close both modals, toast). No App state/refs touched directly.
// Behavior identical to the inline block it replaced.
import React from "react";

export default function RevertAutosaveModal({
  autosaves, autosaveMax, onRevert, onClose, onClosePendingReview, pushToast,
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 11001, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1a1a", color: "#eee", borderRadius: 10, padding: "16px 18px", maxWidth: "62vw", maxHeight: "82vh", display: "flex", flexDirection: "column", gap: 10, border: "1px solid rgba(150,120,200,0.4)", boxShadow: "0 12px 48px rgba(0,0,0,0.7)", minWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", color: "#b69adb" }}>Revert to autosave</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1rem", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: "0.75rem", color: "#aaa", lineHeight: 1.4 }}>
          Provincia keeps your last {autosaveMax} edits (retained after you Save/Export, and across restarts). Each row is one edit — pick it to roll the whole app (map data <i>and</i> staged edits) back to <b>just before that edit</b>, undoing it and anything after. The revert itself can be undone. Newest first.
        </div>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "4px 4px", fontSize: "0.8rem" }}>
          {autosaves.length === 0 ? (
            <div style={{ color: "#888", fontStyle: "italic", padding: "8px 10px" }}>No autosaves yet — make an edit (in dev mode) and they'll appear here.</div>
          ) : (
            [...autosaves].map((s, i) => ({ s, i })).reverse().map(({ s, i }) => {
              const when = new Date(s.ts);
              const ago = (() => { const d = Date.now() - s.ts; const m = Math.floor(d / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; return Math.floor(h / 24) + "d ago"; })();
              const isLatest = i === autosaves.length - 1;
              return (
                <button key={s.ts + "_" + i} onClick={() => {
                  if (!confirm(`Revert Provincia to this autosave?\n\n"${s.label || "Edit"}"\n${when.toLocaleString()}\n\nThis rolls the map data AND your staged edits back to that point. (You can undo it.)`)) return;
                  onRevert(i);
                  onClose();
                  onClosePendingReview();
                  pushToast(`Reverted to autosave: ${s.label || "edit"} (${ago})`, "info", 5000);
                }} style={{ display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: 8, padding: "6px 10px", background: isLatest ? "rgba(150,120,200,0.10)" : "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "#ddd", cursor: "pointer" }}>
                  <span style={{ flexShrink: 0, color: "#888", fontSize: "0.68rem", width: "4.6em" }}>{ago}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.kind && <span style={{ color: "#888", fontSize: "0.68rem" }}>[{s.kind}] </span>}
                    {s.label || "Edit"}{isLatest && <span style={{ color: "#b69adb", fontSize: "0.66rem" }}> · latest</span>}
                  </span>
                  <span style={{ flexShrink: 0, color: "#777", fontSize: "0.66rem" }}>{when.toLocaleTimeString()}</span>
                </button>
              );
            })
          )}
        </div>
        <div style={{ fontSize: "0.68rem", color: "#777" }}>Autosaves older than the last {autosaveMax} edits are dropped automatically.</div>
      </div>
    </div>
  );
}
