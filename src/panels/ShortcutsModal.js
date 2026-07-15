// Keyboard-shortcuts reference popover, extracted from App.js (2026-07-15).
// Static content; the only inputs are `devMode` (hides dev-only rows) and a
// close handler. Behavior identical to the inline block.
import React from "react";

const SHORTCUTS = [
  ["Ctrl+1 – 8", "Open map-mode group (1 Political … 7 Geography, 8 Overlays)"],
  ["Ctrl+`", "Switch campaign slot"],
  ["Ctrl+F", "Focus province search"],
  ["Ctrl+K", "Search everywhere"],
  [", / .", "Step through recent regions"],
  ["Ctrl+Shift+D", "Toggle dev mode"],
  ["Ctrl+Z", "Undo", true],
  ["Ctrl+Shift+Z / Ctrl+Y", "Redo", true],
  ["Escape", "Close open group, then deselect"],
  ["Arrow keys", "Pan map"],
  ["Scroll wheel", "Zoom in/out"],
  ["Double-click map", "Zoom in"],
  ["Shift+click faction", "Multi-select factions"],
  ["Double-click faction", "Zoom to territory"],
  ["Right-click campaign tab", "Import files into that slot", true],
  ["Right-click save", "Rename save"],
];

export default function ShortcutsModal({ devMode, onClose }) {
  return (
    <div style={{
      position: "fixed", bottom: 52, right: 12, zIndex: 10,
      background: "rgba(20,25,35,0.95)", backdropFilter: "blur(10px)",
      border: "1px solid #555", borderRadius: 10,
      padding: "12px 16px", minWidth: 260,
      color: "#dde", fontSize: "0.75rem",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      pointerEvents: "auto",
    }}>
      <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 8, color: "#e8a030" }}>Keyboard Shortcuts</div>
      {/* 3rd element = dev-only: hidden outside dev mode. The dev-mode
          TOGGLE itself is always shown so non-dev users can find it. */}
      {SHORTCUTS.filter(([, , dev]) => devMode || !dev).map(([key, desc]) => (
        <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 3 }}>
          <kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 5px", borderRadius: 3, fontSize: "0.68rem", color: "#8bf", whiteSpace: "nowrap" }}>{key}</kbd>
          <span style={{ color: "#aab" }}>{desc}</span>
        </div>
      ))}
      <button onClick={onClose} style={{
        marginTop: 6, padding: "3px 10px", borderRadius: 5, border: "1px solid #555",
        background: "rgba(60,60,60,0.7)", color: "#aaa", fontSize: "0.7rem", cursor: "pointer", width: "100%",
      }}>Close</button>
    </div>
  );
}
