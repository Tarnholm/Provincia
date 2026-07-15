// Add-Region modal, extracted from App.js (2026-07-15). Pure presentational
// form: the caller owns the form state and the submit/reroll handlers (they
// touch heavy App state — regions, brush, toasts), this only renders the
// dialog and wires inputs to setForm. Behavior identical to the inline IIFE
// it replaced.
import React from "react";

export default function AddRegionModal({ form, setForm, factionOptions, onReroll, onSubmit, onClose }) {
  const inputStyle = {
    padding: "4px 8px", borderRadius: 4,
    background: "rgba(0,0,0,0.35)", color: "#eee",
    border: "1px solid rgba(255,255,255,0.15)",
    fontSize: "0.8rem", outline: "none", minWidth: 0,
  };
  const [r, g, b] = (form.rgb || "0,0,0").split(",").map(Number);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10005,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "rgba(22,24,28,0.98)", border: "1px solid #555",
        borderRadius: 10, padding: 16, width: 360, color: "#eee",
        boxShadow: "0 6px 30px rgba(0,0,0,0.6)",
      }}>
        <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 8, color: "#dca64a" }}>
          Add new region
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "8px 8px", fontSize: "0.8rem" }}>
          <label style={{ alignSelf: "center" }}>Name:</label>
          <input type="text" autoFocus value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Garamantia_Borealis"
            style={inputStyle} />
          <label style={{ alignSelf: "center" }}>City:</label>
          <input type="text" value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            placeholder="(optional — defaults to region name)"
            style={inputStyle} />
          <label style={{ alignSelf: "center" }}>Faction:</label>
          <select value={form.faction}
            onChange={(e) => setForm({ ...form, faction: e.target.value })}
            style={inputStyle}>
            <option value="">(default — slave / rebels)</option>
            {(factionOptions || []).map(f => (
              <option key={f} value={f}>{f.replace(/_/g, " ")}</option>
            ))}
          </select>
          <label style={{ alignSelf: "center" }}>Tags:</label>
          <input type="text" value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="comma-separated, e.g. desert,Farm2"
            style={inputStyle} />
          <label style={{ alignSelf: "center" }}>RGB:</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 4, background: `rgb(${r},${g},${b})`, border: "1px solid #555" }} />
            <input type="text" value={form.rgb}
              onChange={(e) => setForm({ ...form, rgb: e.target.value })}
              style={{ ...inputStyle, width: 110, fontFamily: "monospace" }} />
            <button onClick={onReroll}
              title="Pick another random unused RGB"
              style={{
                padding: "3px 8px", borderRadius: 4, fontSize: "0.7rem",
                background: "rgba(255,255,255,0.08)", color: "#ccd",
                border: "1px solid #555", cursor: "pointer",
              }}>↻</button>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{
              padding: "5px 12px", borderRadius: 5,
              background: "rgba(255,255,255,0.08)", color: "#ccd",
              border: "1px solid #555", cursor: "pointer", fontSize: "0.78rem",
            }}>Cancel</button>
          <button onClick={onSubmit}
            style={{
              padding: "5px 12px", borderRadius: 5,
              background: "#dca64a", color: "#222",
              border: "1px solid #855", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem",
            }}>Add region</button>
        </div>
        <div style={{ marginTop: 8, fontSize: "0.7rem", color: "#aaa", lineHeight: 1.4 }}>
          The new region is added in-memory immediately and selected as the paint brush.
          Hit <strong>Save</strong> in the Map Paint panel to persist both the TGA and updated regions JSON.
        </div>
      </div>
    </div>
  );
}
