// Unit Comparator panel — pick 2–6 EDU units and compare their stats side by
// side with best-in-row highlighting and derived cost-effectiveness ratios
// (upkeep per attack point, cost per effective HP, …). Presentational modal in
// the ArmySetupModal style: dark inline styles, portal overlay, caller owns
// visibility (mount when open, `onClose` to hide).
//
// Data flow: unit list + owning factions come from the caller's already-loaded
// `unitOwnership` map ({ unitName: [faction, …], __dictionary: {unitName: dict} },
// the get-unit-ownership IPC result held in App state). Per-unit stats are
// fetched lazily through the EXISTING `get-unit-stats` IPC
// (window.electronAPI.getUnitStats(modDataDir, unitName) — parses the unit's
// export_descr_unit.txt block, mod-last-wins, cached in the main process) and
// cached again in component state. All table math lives in ../unitCompare.js.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { deriveComparison } from "../unitCompare";

const MAX_UNITS = 6;

export default function UnitComparePanel({ modDataDir, unitOwnership, factionDisplayNames, onClose }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);          // unit type names, column order
  const [statsMap, setStatsMap] = useState({});          // unitName -> stats object | null (null = not found / failed)

  const dictMap = (unitOwnership && unitOwnership.__dictionary) || {};
  const facName = (f) => ((factionDisplayNames && factionDisplayNames[f]) || f || "").replace(/_/g, " ");

  // Full pickable unit list from unitOwnership (skip the __dictionary sidecar).
  const allUnits = useMemo(() => {
    if (!unitOwnership || typeof unitOwnership !== "object") return [];
    const out = [];
    for (const name of Object.keys(unitOwnership)) {
      if (name === "__dictionary") continue;
      const owners = unitOwnership[name];
      if (!Array.isArray(owners) || owners.length === 0) continue;
      out.push({ name, label: name.replace(/_/g, " "), dict: dictMap[name] || "", owners });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [unitOwnership]);

  // Filter by EDU type name OR dictionary display key (the two names modders search by).
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return allUnits;
    return allUnits.filter((u) =>
      u.label.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.dict.toLowerCase().includes(q));
  }, [allUnits, q]);
  const shown = filtered.slice(0, 80);

  const addUnit = async (name) => {
    if (selected.includes(name) || selected.length >= MAX_UNITS) return;
    setSelected((s) => (s.includes(name) || s.length >= MAX_UNITS ? s : [...s, name]));
    if (Object.prototype.hasOwnProperty.call(statsMap, name)) return; // component-state cache hit
    try {
      const st = await window.electronAPI?.getUnitStats?.(modDataDir, name);
      setStatsMap((m) => ({ ...m, [name]: st || null }));
    } catch {
      setStatsMap((m) => ({ ...m, [name]: null }));
    }
  };
  const removeUnit = (name) => setSelected((s) => s.filter((n) => n !== name));

  const loading = selected.filter((n) => !Object.prototype.hasOwnProperty.call(statsMap, n));
  const cmp = useMemo(
    () => deriveComparison(selected.map((u) => ({ unit: u, stats: statsMap[u] ?? null }))),
    [selected, statsMap]
  );

  const fmt = (v) => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(2));
  const cellStyle = (isBest) => ({
    padding: "2px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums",
    color: isBest ? "#b8d38f" : "#dde", fontWeight: isBest ? 700 : 400,
    background: isBest ? "rgba(143,180,110,0.18)" : "transparent",
    borderTop: "1px solid rgba(255,255,255,0.05)",
  });
  const labelCell = { padding: "2px 8px", color: "#9aa", textAlign: "left", borderTop: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };

  const renderRows = (rows) => rows.map((r) => (
    <tr key={r.key}>
      <td style={labelCell} title={r.better === "low" ? "Lower is better" : "Higher is better"}>
        {r.label} <span style={{ color: "#667", fontSize: "0.65rem" }}>{r.better === "low" ? "↓" : "↑"}</span>
      </td>
      {r.values.map((v, i) => <td key={i} style={cellStyle(r.best[i])}>{fmt(v)}</td>)}
    </tr>
  ));

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(940px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>⚔ Unit Comparator{selected.length ? ` — ${selected.length}/${MAX_UNITS} units` : ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {/* Picker: search + result list */}
        <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "0.72rem", color: "#8aa" }}>
              Pick up to {MAX_UNITS} units to compare EDU stats + cost-effectiveness. Search matches type or dictionary name.
            </span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search units…" autoFocus
              style={{ marginLeft: "auto", width: 220, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 8px", fontSize: "0.78rem" }} />
          </div>
          <div style={{ maxHeight: 160, overflow: "auto", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 4 }}>
            {allUnits.length === 0 && <div style={{ color: "#889", fontSize: "0.74rem", padding: 4 }}>Unit list not loaded yet (unitOwnership missing).</div>}
            {allUnits.length > 0 && shown.length === 0 && <div style={{ color: "#889", fontSize: "0.74rem", padding: 4 }}>No units match “{search}”.</div>}
            {shown.map((u) => {
              const on = selected.includes(u.name);
              const full = !on && selected.length >= MAX_UNITS;
              const ownersLbl = u.owners.slice(0, 3).map(facName).join(", ") + (u.owners.length > 3 ? ` +${u.owners.length - 3}` : "");
              return (
                <button key={u.name} onClick={() => (on ? removeUnit(u.name) : addUnit(u.name))} disabled={full}
                  title={on ? "Click to remove from comparison" : full ? `Max ${MAX_UNITS} units — remove one first` : `Add to comparison\nOwners: ${u.owners.map(facName).join(", ")}${u.dict ? `\nDictionary: ${u.dict}` : ""}`}
                  style={{ display: "flex", width: "100%", alignItems: "baseline", gap: 8, padding: "2px 8px", borderRadius: 5, cursor: full ? "default" : "pointer", textAlign: "left",
                    border: "none", background: on ? "rgba(232,200,115,0.14)" : "transparent", opacity: full ? 0.4 : 1 }}>
                  <span style={{ color: on ? "#f2e3b8" : "#dde", fontSize: "0.78rem", textTransform: "capitalize", whiteSpace: "nowrap" }}>{on ? "✓ " : ""}{u.label}</span>
                  <span style={{ color: "#778", fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "capitalize" }}>{ownersLbl}</span>
                </button>
              );
            })}
            {filtered.length > shown.length && <div style={{ color: "#667", fontSize: "0.68rem", padding: "2px 8px" }}>…{filtered.length - shown.length} more — refine the search.</div>}
          </div>
        </div>

        {/* Comparison table */}
        <div style={{ overflow: "auto", padding: "8px 16px" }}>
          {selected.length === 0 && <div style={{ color: "#889", fontSize: "0.8rem", padding: "12px 0" }}>Add units above to start comparing.</div>}
          {selected.length === 1 && <div style={{ color: "#889", fontSize: "0.74rem", padding: "4px 0" }}>Add a second unit to get best-in-row highlighting.</div>}
          {selected.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
              <thead>
                <tr style={{ color: "#8aa", textAlign: "right" }}>
                  <th style={{ padding: "0 8px", textAlign: "left", fontWeight: 400 }}>Stat</th>
                  {selected.map((name) => {
                    const st = statsMap[name];
                    const pending = !Object.prototype.hasOwnProperty.call(statsMap, name);
                    return (
                      <th key={name} style={{ padding: "0 8px", verticalAlign: "bottom" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                          <span style={{ color: "#e8c873", fontWeight: 700, textTransform: "capitalize", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>{name.replace(/_/g, " ")}</span>
                          <span style={{ color: "#778", fontSize: "0.64rem", fontWeight: 400 }}>
                            {pending ? "loading…" : st === null ? "⚠ not in EDU" : (st.category || "")}
                          </span>
                          <button onClick={() => removeUnit(name)} title="Remove column"
                            style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#9aa", borderRadius: 4, padding: "0 6px", cursor: "pointer", fontSize: "0.66rem" }}>✕</button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {renderRows(cmp.rows)}
                {cmp.ratios.length > 0 && (
                  <tr><td colSpan={1 + selected.length} style={{ padding: "8px 8px 2px", color: "#e8c873", fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                    Cost-effectiveness <span style={{ color: "#667", fontWeight: 400, fontSize: "0.68rem" }}>(green = best; ↓ lower wins, ↑ higher wins)</span>
                  </td></tr>
                )}
                {renderRows(cmp.ratios)}
              </tbody>
            </table>
          )}
          {loading.length > 0 && <div style={{ color: "#889", fontSize: "0.7rem", marginTop: 6 }}>Fetching stats for {loading.length} unit{loading.length > 1 ? "s" : ""}…</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
