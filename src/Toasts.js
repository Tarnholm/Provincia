import React from "react";

/**
 * Non-blocking error / info toasts stacked in the top-right corner. Each has
 * its own dismiss timer handled in App.js; clicking dismisses immediately.
 */
export default function Toasts({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", top: 12, right: 12, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 6, maxWidth: 380,
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          style={{
            padding: "10px 14px", borderRadius: 6,
            border: `1px solid ${t.kind === "error" ? "#c44" : "#888"}`,
            background: "rgba(30,20,20,0.95)", color: "#f2e6e6",
            fontSize: "0.85rem", cursor: "pointer",
            boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
          }}
        >
          {t.message}
          <div style={{ fontSize: "0.7rem", opacity: 0.6, marginTop: 4 }}>click to dismiss</div>
        </div>
      ))}
    </div>
  );
}
