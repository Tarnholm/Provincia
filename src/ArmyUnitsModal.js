import React, { useState, useMemo } from "react";

// Edit the unit list of a starting army/garrison (add + remove). Opened by
// Shift-clicking an army marker in dev mode. `army` = { faction, locator, units,
// label }; `roster` = the faction's full unit-name list (from EDU ownership).
// Bodyguard units (name contains general/bodyguard) are kept non-removable so a
// general never loses their guard. On Apply we stage the full new list, written
// to the army's descr_strat block on Save.
const isBodyguard = (name) => /general'?s?\s+bodyguard|\bgeneral\b/i.test(String(name || ""));

export default function ArmyUnitsModal({ army, roster, onStage, onClose }) {
  const [units, setUnits] = useState(() =>
    (army.units || []).map((u) => (typeof u === "string"
      ? { name: u, exp: 0, armour: 0, weapon: 0 }
      : { name: u.name, exp: u.exp || 0, armour: u.armour || 0, weapon: u.weapon || 0 })));
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = (roster || []).slice().sort();
    return (s ? all.filter((u) => u.toLowerCase().includes(s)) : all).slice(0, 200);
  }, [q, roster]);

  const remove = (i) => setUnits((p) => p.filter((_, j) => j !== i));
  const add = (name) => setUnits((p) => [...p, { name, exp: 0, armour: 0, weapon: 0 }]);

  const overlay = { position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", font: "13px/1.4 system-ui, sans-serif" };
  const card = { width: "min(640px,94vw)", maxHeight: "84vh", display: "flex", flexDirection: "column", background: "#22252b", color: "#e5e7eb", borderRadius: 10, border: "1px solid #3a3f48", boxShadow: "0 16px 48px rgba(0,0,0,.6)", overflow: "hidden" };
  const inp = { background: "#1a1d23", color: "#eee", border: "1px solid #3a3f48", borderRadius: 4, padding: "5px 8px", fontSize: "0.82rem", width: "100%", boxSizing: "border-box" };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #34343c", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: "1rem" }}>Edit army units</span>
          <span style={{ color: "#9ab", fontSize: "0.8rem" }}>{army.label}{army.faction ? ` · ${String(army.faction).replace(/_/g, " ")}` : ""}</span>
          <span style={{ marginLeft: "auto", color: "#888", fontSize: "0.72rem" }}>{units.length} unit{units.length === 1 ? "" : "s"}</span>
        </div>
        <div style={{ display: "flex", gap: 0, flex: 1, minHeight: 0 }}>
          {/* Current units */}
          <div style={{ flex: 1, padding: "10px 12px", overflowY: "auto", borderRight: "1px solid #34343c" }}>
            <div style={{ color: "#9bf", fontSize: "0.7rem", fontWeight: 700, marginBottom: 6 }}>In this army</div>
            {units.length === 0 && <div style={{ color: "#888", fontStyle: "italic" }}>No units</div>}
            {units.map((u, i) => {
              const bg = isBodyguard(u.name);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderBottom: "1px solid #2c2f36" }}>
                  <span style={{ flex: 1, color: bg ? "#9ab" : "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {String(u.name).replace(/_/g, " ")}{bg ? " (bodyguard)" : ""}
                  </span>
                  {!bg && (
                    <button onClick={() => remove(i)} title="Remove unit"
                      style={{ background: "rgba(220,127,127,0.15)", color: "#dc7f7f", border: "1px solid rgba(220,127,127,0.4)", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem", padding: "1px 7px" }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Roster picker */}
          <div style={{ flex: 1, padding: "10px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ color: "#9bf", fontSize: "0.7rem", fontWeight: 700, marginBottom: 6 }}>Add from faction roster</div>
            <input autoFocus placeholder="search units…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
            <div style={{ flex: 1, overflowY: "auto" }}>
              {(roster || []).length === 0 && <div style={{ color: "#888", fontStyle: "italic" }}>No roster (faction units unavailable)</div>}
              {filtered.map((name) => (
                <div key={name} onClick={() => add(name)} title="Add to army"
                  style={{ padding: "3px 4px", cursor: "pointer", color: "#cde", borderBottom: "1px solid #2c2f36", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  + {name.replace(/_/g, " ")}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid #34343c", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "6px 14px", background: "transparent", color: "#aaa", border: "1px solid #555", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => { onStage(army.faction, army.locator, units, army.label); onClose(); }}
            style={{ padding: "6px 16px", background: "#fbbf24", color: "#1a1a1a", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
