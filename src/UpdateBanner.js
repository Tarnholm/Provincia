import React from "react";

/**
 * Sits at the top of the viewport when electron-updater has finished
 * downloading a new version. Two actions: apply now (quit & install),
 * or defer.
 */
export default function UpdateBanner({ version, onRestart, onDismiss }) {
  return (
    <div style={{
      position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)",
      zIndex: 10000, padding: "10px 16px", borderRadius: 8,
      background: "rgba(20,40,30,0.95)", border: "1px solid #4a8a5a",
      color: "#d6f2e0", fontSize: "0.85rem",
      boxShadow: "0 2px 14px rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span>Provincia {version} is ready to install.</span>
      <button onClick={onRestart} style={{
        padding: "4px 12px", borderRadius: 4, border: "1px solid #7acb90",
        background: "#4a8a5a", color: "#fff", fontWeight: 600, cursor: "pointer",
      }}>Restart &amp; install</button>
      <button onClick={onDismiss} style={{
        padding: "4px 10px", borderRadius: 4, border: "1px solid #555",
        background: "transparent", color: "#aaa", cursor: "pointer",
      }}>Later</button>
    </div>
  );
}
