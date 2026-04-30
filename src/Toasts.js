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
            display: "flex", alignItems: "flex-start", gap: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            {t.message}
            <div style={{ fontSize: "0.7rem", opacity: 0.6, marginTop: 4 }}>click to dismiss</div>
          </div>
          {t.count > 1 && (
            <span style={{
              flexShrink: 0, padding: "2px 8px", borderRadius: 999,
              background: "rgba(220,166,74,0.25)", border: "1px solid rgba(220,166,74,0.55)",
              color: "#dca64a", fontWeight: 700, fontSize: "0.75rem",
              alignSelf: "center",
            }} title={`Repeated ${t.count} times`}>×{t.count}</span>
          )}
        </div>
      ))}
    </div>
  );
}
