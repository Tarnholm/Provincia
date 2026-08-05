// 👥 Starting Populations editor (2026-08-06, mod-team request): an editable
// table of every settlement's descr_strat starting population, with the city-
// level ladder from descr_cultures beside it — view, adjust, apply. Writes are
// surgical population-line rewrites (src/stratPopulations.js) with a rolling
// .provincia-bak backup; a submod slot edits the submod's own descr_strat.
// Presentational + self-contained state; styling matches ArmySetupModal's dark
// inline-style aesthetic (no external CSS).
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const fmt = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n).toLocaleString() : "—");
const levelLabel = (lv) => String(lv || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function StratPopulationsModal({ modDataDir, factionDisplayNames, pushToast, onClose }) {
  const [data, setData] = useState(null);     // { path, rows, tiers } | { error }
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [edits, setEdits] = useState({});     // region → string (input value)
  const [search, setSearch] = useState("");
  const [facFilter, setFacFilter] = useState("");
  const [sort, setSort] = useState(null);     // { key: 'settlement'|'level'|'pop', dir: 1|-1 } | null = file order
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [pct, setPct] = useState("");

  const load = async () => {
    if (!modDataDir) { setData({ error: "No mod loaded." }); return; }
    setBusy(true);
    try { setData((await window.electronAPI.getStratPopulations(modDataDir)) || { error: "no result" }); }
    catch (e) { setData({ error: e?.message || String(e) }); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [modDataDir]);

  const rows = (data && data.rows) || [];
  const tiers = data && data.tiers;
  const tierOrder = (tiers && tiers.tierOrder) || [];
  const minPop = (tiers && tiers.minPop) || 1;
  // implied level = highest tier whose upgrade threshold ≤ pop
  const impliedLevel = (pop) => {
    if (!tiers || !tiers.upgradeAt || !isFinite(pop)) return null;
    let lv = tierOrder[0] || null;
    for (const t of tierOrder) { if (pop >= tiers.upgradeAt[t]) lv = t; }
    return lv;
  };
  const facName = (f) => ((factionDisplayNames && factionDisplayNames[f]) || f).replace(/_/g, " ");
  const factions = useMemo(() => [...new Set(rows.map((r) => r.faction))], [rows]);
  const effPop = (r) => {
    const v = edits[r.region];
    if (v === undefined || v === "") return r.pop;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : r.pop;
  };
  const isDirty = (r) => effPop(r) !== r.pop;

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let out = rows.filter((r) =>
      (!facFilter || r.faction === facFilter) &&
      (!q || r.settlement.toLowerCase().includes(q) || r.region.toLowerCase().includes(q) || r.faction.toLowerCase().includes(q) || facName(r.faction).toLowerCase().includes(q)));
    if (mismatchOnly) out = out.filter((r) => { const il = impliedLevel(effPop(r)); return il && il !== r.level; });
    if (sort) {
      const dir = sort.dir;
      const key = sort.key;
      out = out.slice().sort((a, b) => {
        if (key === "pop") return (effPop(a) - effPop(b)) * dir;
        if (key === "level") return (tierOrder.indexOf(a.level) - tierOrder.indexOf(b.level)) * dir;
        if (key === "faction") return facName(a.faction).localeCompare(facName(b.faction)) * dir;
        return a.settlement.localeCompare(b.settlement) * dir;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, facFilter, sort, mismatchOnly, edits, factionDisplayNames]);

  const changes = useMemo(() => {
    const c = {};
    for (const r of rows) {
      const v = edits[r.region];
      if (v === undefined || v === "") continue;
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1 && n !== r.pop) c[r.region] = n;
    }
    return c;
  }, [rows, edits]);
  const nChanged = Object.keys(changes).length;
  const totFile = filtered.reduce((a, r) => a + (r.pop || 0), 0);
  const totNew = filtered.reduce((a, r) => a + effPop(r), 0);

  const apply = async () => {
    if (!nChanged || applying) return;
    setApplying(true);
    try {
      const r = await window.electronAPI.applyStratPopulations(modDataDir, changes);
      if (r && r.ok) {
        pushToast(`✔ ${r.applied.length} population${r.applied.length === 1 ? "" : "s"} written to descr_strat (backup: .provincia-bak). Click 🔄 Reload so analyses see the new values.`, "info", 7000);
        setEdits({});
        await load();
      } else {
        pushToast(`⚠ Population write failed: ${(r && r.error) || "unknown error"}`, "error", 8000);
      }
    } catch (e) { pushToast(`⚠ Population write failed: ${e?.message || e}`, "error", 8000); }
    finally { setApplying(false); }
  };

  const applyPct = () => {
    const p = parseFloat(pct);
    if (!Number.isFinite(p) || p === 0) return;
    const next = { ...edits };
    for (const r of filtered) next[r.region] = String(Math.max(minPop, Math.round(r.pop * (1 + p / 100))));
    setEdits(next);
  };

  const th = (label, key, title) => (
    <th style={{ padding: "2px 6px", cursor: key ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }} title={title}
      onClick={key ? () => setSort((s) => (s && s.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 })) : undefined}>
      {label}{sort && sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(880px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#e8c873" }}>👥 Starting Populations — descr_strat{rows.length ? ` (${rows.length.toLocaleString()} settlements)` : ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search settlement / region / faction…"
              style={{ width: 220, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 8px", fontSize: "0.78rem" }} />
            <select value={facFilter} onChange={(e) => setFacFilter(e.target.value)}
              style={{ background: "rgba(40,36,30,1)", color: "#dcc", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 6px", fontSize: "0.76rem", maxWidth: 200 }}>
              <option value="">All factions ({factions.length})</option>
              {factions.map((f) => <option key={f} value={f}>{facName(f)}</option>)}
            </select>
            <label style={{ fontSize: "0.72rem", color: "#9ab", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
              title="Show only settlements whose population sits in a DIFFERENT level band than the level declared in descr_strat (per the descr_cultures thresholds).">
              <input type="checkbox" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} /> level≠pop only
            </label>
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <input value={pct} onChange={(e) => setPct(e.target.value)} placeholder="±%" type="number"
                title="Bulk adjust: set every FILTERED row's new population to file value × (1 + %/100), floored at the culture minimum."
                style={{ width: 56, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 6px", fontSize: "0.76rem" }} />
              <button onClick={applyPct} disabled={!filtered.length}
                style={{ background: "rgba(60,60,60,0.7)", color: "#9fd3ff", border: "1px solid #5a82a0", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>
                % → filtered
              </button>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: "0.7rem", color: "#8aa" }}>
            {tiers && tiers.upgradeAt && (
              <span title={`City-level thresholds from descr_cultures ("settlement upgrade levels"). A settlement's population decides which band it sits in.${tiers.uniformAcrossCultures ? " All cultures in this mod share this ladder." : " ⚠ This mod's cultures have DIFFERENT ladders — the first culture's is shown."}`}>
                🏛 {tierOrder.map((t) => `${levelLabel(t)} ${fmt(tiers.upgradeAt[t])}`).join(" · ")}{tiers.uniformAcrossCultures ? "" : " ⚠ per-culture ladders differ"}
              </span>
            )}
            <span>min pop {fmt(minPop)}</span>
            {data && data.path && <span style={{ color: "#667" }} title={data.path}>{String(data.path).split(/[\\/]/).slice(-2).join("/")}</span>}
          </div>
        </div>
        <div style={{ overflow: "auto", padding: "4px 16px", flex: 1 }}>
          {busy && <div style={{ color: "#9aa", fontStyle: "italic", padding: 8 }}>Reading descr_strat…</div>}
          {data && data.error && <div style={{ color: "#e89060", padding: 8 }}>{data.error}</div>}
          {!busy && data && !data.error && rows.length === 0 && <div style={{ color: "#9aa", fontStyle: "italic", padding: 8 }}>No settlements found in descr_strat.</div>}
          {!busy && rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
              <thead><tr style={{ color: "#8aa", textAlign: "left" }}>
                {th("Faction", "faction")}
                {th("Settlement", "settlement")}
                {th("Level (file)", "level", "The settlement level declared in descr_strat.")}
                {th("Population", "pop", "Starting population — edit the box to stage a change.")}
                <th style={{ padding: "2px 6px" }} title="The level band the (edited) population falls in, per the descr_cultures thresholds. Orange = differs from the declared level.">→ band @ pop</th>
                <th style={{ padding: "2px 6px" }}>Δ</th>
              </tr></thead>
              <tbody>
                {filtered.map((r) => {
                  const pop = effPop(r);
                  const il = impliedLevel(pop);
                  const mismatch = il && il !== r.level;
                  const dirty = isDirty(r);
                  const belowMin = pop < minPop;
                  return (
                    <tr key={r.region} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: dirty ? "rgba(232,200,115,0.06)" : "transparent" }}>
                      <td style={{ padding: "1px 6px", color: "#9ab", textTransform: "capitalize", whiteSpace: "nowrap" }}>{facName(r.faction)}</td>
                      <td style={{ padding: "1px 6px", color: "#dde" }} title={`region ${r.region}`}>{r.settlement.replace(/_/g, " ")}{r.capital ? " ★" : ""}</td>
                      <td style={{ color: "#9aa", whiteSpace: "nowrap" }}>{levelLabel(r.level)}</td>
                      <td>
                        <input type="number" min={1} step={100}
                          value={edits[r.region] !== undefined ? edits[r.region] : r.pop}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [r.region]: e.target.value }))}
                          style={{ width: 76, background: "rgba(0,0,0,0.4)", color: belowMin ? "#e8806a" : dirty ? "#f2e3b8" : "#ccc", borderRadius: 4, padding: "1px 5px", fontSize: "0.76rem", border: belowMin ? "1px solid #c05a4a" : dirty ? "1px solid #a08a4a" : "1px solid rgba(255,255,255,0.15)" }}
                          title={belowMin ? `Below the culture minimum population (${fmt(minPop)}).` : dirty ? `File value: ${fmt(r.pop)}` : undefined} />
                      </td>
                      <td style={{ color: mismatch ? "#e8b85a" : "#7a8", whiteSpace: "nowrap" }}
                        title={mismatch ? `Population ${fmt(pop)} sits in the ${levelLabel(il)} band, but descr_strat declares ${levelLabel(r.level)} — adjust the pop or expect the level to differ in-game.` : undefined}>
                        {il ? levelLabel(il) : "—"}{mismatch ? " ⚠" : ""}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {dirty
                          ? <span style={{ color: pop >= r.pop ? "#7fd17f" : "#e8806a" }}>{pop >= r.pop ? "+" : ""}{fmt(pop - r.pop)}
                              <button onClick={() => setEdits((prev) => { const n = { ...prev }; delete n[r.region]; return n; })}
                                title="Revert this settlement to the file value." style={{ background: "none", border: "none", color: "#889", cursor: "pointer", fontSize: "0.72rem", marginLeft: 3 }}>↺</button>
                            </span>
                          : <span style={{ color: "#556" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.74rem", color: "#8aa" }}>
            {filtered.length.toLocaleString()} shown · pop {fmt(totFile)}{totNew !== totFile ? <span style={{ color: totNew > totFile ? "#7fd17f" : "#e8806a" }}> → {fmt(totNew)} ({totNew > totFile ? "+" : ""}{fmt(totNew - totFile)})</span> : ""}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {nChanged > 0 && (
              <button onClick={() => setEdits({})} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#9aa", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
                revert all
              </button>
            )}
            <button onClick={apply} disabled={!nChanged || applying}
              title={nChanged ? `Write ${nChanged} changed population${nChanged === 1 ? "" : "s"} into descr_strat. A rolling backup (.provincia-bak) is written first; only the population lines change.` : "Edit a population box to stage changes."}
              style={{ background: nChanged ? "rgba(143,180,110,0.25)" : "rgba(60,60,60,0.5)", color: nChanged ? "#b8d38f" : "#778", border: "1px solid " + (nChanged ? "#7a9a5a" : "rgba(255,255,255,0.15)"), borderRadius: 5, padding: "3px 12px", cursor: nChanged ? "pointer" : "default", fontSize: "0.78rem", fontWeight: 600 }}>
              {applying ? "Writing…" : `✍ Apply ${nChanged || ""}${nChanged ? ` change${nChanged === 1 ? "" : "s"}` : ""}`}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
