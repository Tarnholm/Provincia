// Income Explainer panel (2026-07-17): line-itemed breakdown of a settlement's
// turn-1 income, from the "explain-settlement-income" IPC (src/
// incomeExplainHandlers.js → src/incomeModel.js). Four compact sections —
// Tax / Farming / Mining / Trade — each line shows the source building, its
// value and (dim, truncated) the EDB condition that gated it. Tax and trade
// are shown as honest "points" (%), NOT fake denarii: the engine's tax formula
// (capital vs non-capital, pop base, bracket) consumes these inputs downstream.
// Portals to document.body; backdrop click / × closes. Styling matches the
// RegionInfo widgets (dark panel, #cfc6b0 section headers, amber chips).
import React from "react";
import { createPortal } from "react-dom";

const pretty = (s) => String(s || "").replace(/_/g, " ");

function SectionHeader({ label, value, hint }) {
  return (
    <div title={hint} style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
      <span style={{ fontWeight: 700, fontSize: "0.75rem", color: "#cfc6b0" }}>{label}</span>
      {value != null && (
        <span style={{ fontSize: "0.72rem", color: "#7ed27e", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      )}
    </div>
  );
}

function ExplainLine({ chain, val, req, unit }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: "0.7rem", lineHeight: "1.35", minWidth: 0 }}>
      <span style={{ color: "#e8e2d4", whiteSpace: "nowrap" }}>{pretty(chain)}</span>
      <span style={{ color: "#7ed27e", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {val >= 0 ? "+" : ""}{val}{unit}
      </span>
      {req ? (
        <span title={req} style={{
          color: "#8a8478", fontSize: "0.62rem", minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{req}</span>
      ) : null}
    </div>
  );
}

function Formula({ children }) {
  return (
    <div style={{ color: "#8a8478", fontSize: "0.62rem", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
      {children}
    </div>
  );
}

export default function IncomeExplainer({ data, onClose }) {
  if (!data) return null;
  const body = data.error ? (
    <div style={{ color: "#e0a060", fontSize: "0.75rem", padding: "4px 0" }}>{data.error}</div>
  ) : (
    <>
      {/* ── Tax ── */}
      <div style={{ marginTop: 6 }}>
        <SectionHeader label="Tax" value={`+${data.tax.taxablePct}% taxable points`}
          hint={"EDB taxable-% inputs per building. The engine's tax formula (capital vs non-capital, population base, tax bracket) consumes these — shown as points, not denarii, because the full derivation is campaign-state dependent."} />
        {data.tax.lines.length === 0
          ? <div style={{ color: "#8a8478", fontSize: "0.65rem" }}>no taxable building lines</div>
          : data.tax.lines.map((l, i) => <ExplainLine key={i} chain={l.chain} val={l.val} req={l.req} unit="%" />)}
      </div>

      {/* ── Farming ── */}
      <div style={{ marginTop: 8 }}>
        <SectionHeader label="Farming" value={`~${data.farming.income.toLocaleString()} dn/turn`}
          hint={"Base farming income (no governor bonus, no wonders): 73.6 denarii per farm point on Hard (80 × 0.92 difficulty factor). Exact 11/11 on the validation corpus."} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(220,166,74,0.16)", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
            region fertility (farmN): {data.farming.farmN}
          </span>
          <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(220,166,74,0.16)", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
            farm buildings level: {data.farming.farmLevel}
          </span>
        </div>
        <Formula>= 73.6 × ({data.farming.farmN} + {data.farming.farmLevel})</Formula>
      </div>

      {/* ── Mining ── */}
      <div style={{ marginTop: 8 }}>
        <SectionHeader label="Mining" value={`+${data.mining.income.toLocaleString()} dn/turn`}
          hint={"Cracked mining formula, validated to the denarius on live saves: 5 × mine_resource(effective) × Σ(deposit qty × trade value). Base value — governor Mining bonuses excluded."} />
        {data.mining.mineSum > 0 || data.mining.income > 0 ? (
          <>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(220,166,74,0.16)", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
                mine_resource: {data.mining.mineSum}
              </span>
              <span style={{ padding: "1px 5px", borderRadius: 4, background: "rgba(220,166,74,0.16)", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
                Σ(qty × trade value): {data.mining.qtyVal}
              </span>
            </div>
            <Formula>= 5 × {data.mining.mineSum} × {data.mining.qtyVal}</Formula>
          </>
        ) : (
          <div style={{ color: "#8a8478", fontSize: "0.65rem" }}>no working mine{data.mining.qtyVal ? ` (deposits worth ${data.mining.qtyVal} await one)` : ""}</div>
        )}
      </div>

      {/* ── Trade ── */}
      <div style={{ marginTop: 8 }}>
        <SectionHeader label="Trade" value={`+${data.trade.tradePct}% trade points`}
          hint={"EDB trade-% inputs per building. Actual trade denarii come from the land/sea lane model (partners, distance, cargo) — shown as points, not denarii."} />
        {data.trade.lines.length === 0
          ? <div style={{ color: "#8a8478", fontSize: "0.65rem" }}>no trade building lines</div>
          : data.trade.lines.map((l, i) => <ExplainLine key={i} chain={l.chain} val={l.val} req={l.req} unit="%" />)}
      </div>

      {/* ── Resources ── */}
      {Array.isArray(data.resources) && data.resources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <SectionHeader label="Resources" hint="Region trade resources (descr_strat) with their EDB trade values — the raw material the trade and mining incomes draw on." />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
            {data.resources.map((r, i) => (
              <span key={r.name + i} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "1px 5px", borderRadius: 4,
                background: r.mineable ? "rgba(120,200,90,0.20)" : "rgba(220,166,74,0.16)",
                fontSize: "0.7rem", whiteSpace: "nowrap",
              }}>
                {pretty(r.name)}
                {r.tradeValue ? <span style={{ color: "#aaa" }}>{r.tradeValue}</span> : null}
                {r.mineable ? <span title="mineable" style={{ color: "#9fd89f" }}>⛏</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9990,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{
        background: "rgba(28,24,18,0.97)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 10,
        padding: "10px 14px 12px 14px",
        width: "min(440px, 92vw)",
        maxHeight: "76vh",
        overflow: "auto",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        color: "#f4f4f4",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fd8" }}>
            Income — {pretty(data.settlement || data.region)}
          </span>
          {!data.error && (
            <span style={{ color: "#8a8478", fontSize: "0.65rem" }}>({pretty(data.faction)})</span>
          )}
          <button onClick={onClose} title="Close"
            style={{
              marginLeft: "auto", padding: "0 6px", fontSize: "0.75rem", lineHeight: "1.4",
              background: "rgba(255,255,255,0.08)", color: "#ddd",
              border: "1px solid rgba(255,255,255,0.2)", borderRadius: 3, cursor: "pointer",
            }}>×</button>
        </div>
        {body}
      </div>
    </div>,
    document.body
  );
}
