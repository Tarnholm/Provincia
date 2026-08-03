// Dev-mode "Dev tools" help widget, extracted from App.js (2026-07-15). The
// collapsible bottom-left panel that lists the dev-mode map interactions.
// Static content; props are the open flag + its toggle. Rendered only when
// devMode is on (the caller keeps that gate). Behavior identical.
import React from "react";

export default function DevToolsHelp({ open, onToggle }) {
  return (
    <div style={{ position: "fixed", left: 10, bottom: 10, zIndex: 9990, font: "12px/1.45 system-ui, sans-serif", maxWidth: 320 }}>
      <button onClick={onToggle}
        style={{ background: "rgba(40,55,75,0.92)", color: "#9bf", border: "1px solid rgba(110,140,190,0.5)", borderRadius: open ? "6px 6px 0 0" : 6, padding: "4px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
        {open ? "▾" : "▸"} Dev tools
      </button>
      {open && (
        <div style={{ background: "rgba(26,29,35,0.96)", color: "#cdd6e0", border: "1px solid rgba(110,140,190,0.5)", borderTop: "none", borderRadius: "0 6px 6px 6px", padding: "8px 12px" }}>
          <div style={{ color: "#888", fontSize: "0.66rem", marginBottom: 5 }}>Starting (non-live) view, dev mode:</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
            <li><b>Drag</b> a general's army marker → move it (re-drag to adjust)</li>
            <li><b>Drag</b> a leaderless garrison marker → relocate it as a captain army</li>
            <li><b>Shift+click</b> any army/garrison → add/remove its units</li>
            <li><b>Right-click</b> a character → info + edit name / age / rank / traits / ancillaries</li>
            <li>Right-click a building card → edit; <b>+ Add building</b> to place chains</li>
            <li><b>Ctrl+Z</b> → undo the last staged edit</li>
            <li><b>Click the active Trade Lanes mode</b> → what-if: all roads + ports built; cycles port level 3→2→1→off (level = sea lanes per port)</li>
            <li><b>Double-click</b> the version label → watch + auto-install updates</li>
            <li>Edits stage in <b>Pending changes</b>; <b>Restore last backup</b> rolls back a Save</li>
          </ul>
        </div>
      )}
    </div>
  );
}
