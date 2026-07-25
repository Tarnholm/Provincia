// AI Movement Lab (🧭⚔, 2026-07-24) — analyze RTW:R campaign logs for AI
// pathing pathologies, to tune the mod's AI. Pick any message_log.txt (the
// live log dir, an archived one, or a log downloaded from the RIS Discord
// telemetry channel) and get per-army findings: stuck armies, ping-pong
// pathing loops, multi-turn orders that never arrive, and flee loops — each
// with the army's name, faction, turn span, and the region it happened in
// (click to highlight it on the map, double-click to jump).
// Analysis is main-process (src/aiMovementAnalyzer.js, validated against the
// real 97-turn calibration log); this panel only renders the result.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

const KIND_META = {
  // message_log (movement traces)
  stuck: { color: "#e87a6a", label: "Stuck", desc: "moves every turn but gets nowhere" },
  oscillation: { color: "#e8c873", label: "Ping-pong", desc: "bounces between two tiles" },
  never_arrives: { color: "#cf8f6a", label: "Never arrives", desc: "multi-turn order never completes" },
  flee_loop: { color: "#c9a0dc", label: "Flee loop", desc: "flees repeatedly within a few turns" },
  // campaign_ai_log (the AI's own decisions)
  stuck_mission: { color: "#e87a6a", label: "Stuck mission", desc: "same move order re-issued turn after turn — the army never arrives" },
  assign_churn: { color: "#e8c873", label: "Thrashed army", desc: "controller assigns/releases this army over and over" },
  campaign_stall: { color: "#cf8f6a", label: "Stalled campaign", desc: "gathering for a target but never reaches required strength" },
  aborted_hotspot: { color: "#c9a0dc", label: "Abort hotspot", desc: "campaign for this region aborted many turns for insufficient strength" },
  garrison_stripped: { color: "#c9924a", label: "Garrison stripped", desc: "the AI keeps pulling defenders out of this town — how AI factions lose their own cities" },
  war_spam: { color: "#d05858", label: "War spam", desc: "authorised attacks against many factions at once — aggression far beyond what it can execute" },
  rich_but_stalled: { color: "#8fd18f", label: "Rich but stalled", desc: "the engine's own finance report says it had money — income is NOT this faction's problem" },
  abandoned: { color: "#d88fb0", label: "Abandoned army", desc: "the AI commanded it, then went silent — attach a save to tell an ORPHANED live army from a character who simply died" },
  // scripting_log (the engine's own errors in the mod's data files)
  script_error: { color: "#f0787a", label: "Data-file error", desc: "the engine could not parse something in a mod file — it names the file, line and column, so nothing has to be inferred" },
  script_runtime_error: { color: "#e0a35a", label: "Broken condition", desc: "a script condition referenced something that does not exist, so the branch behind it never runs" },
};

export default function AiMovementPanel({
  defaultLogDir,        // live log dir if known (auto-analyze offer)
  modDataDir,
  factionDisplayNames,
  regions,              // rgbKey → { region, ... } for map highlight
  onHighlightRegion,    // (regionName, jump) => void
  onClose,
}) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [kindFilter, setKindFilter] = useState(() => new Set(Object.keys(KIND_META)));
  const [factionFilter, setFactionFilter] = useState("");
  // Remember the attached save across sessions — re-running after a mod tweak
  // is the normal workflow, and re-picking a 45MB file every time is friction.
  const [savePath, setSavePath] = useState(() => {
    try { return localStorage.getItem("aiLabSavePath") || null; } catch { return null; }
  });
  React.useEffect(() => {
    try { if (savePath) localStorage.setItem("aiLabSavePath", savePath); else localStorage.removeItem("aiLabSavePath"); } catch { /* ignore */ }
  }, [savePath]);
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [sortBy, setSortBy] = useState("severity");
  const [tab, setTab] = useState("findings"); // "findings" | "leads" | "factions" | "hotspots" | "diff"
  const [baselines, setBaselines] = useState(null);   // saved runs to compare against
  const [diff, setDiff] = useState(null);             // before/after comparison
  const [baseBusy, setBaseBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // live phase note while analysing
  const [lastLog, setLastLog] = useState(() => {
    try { return localStorage.getItem("aiLabLastLog") || null; } catch { return null; }
  });

  const run = async (logPath) => {
    setBusy(true); setError(null); setProgress(null);
    try {
      const r = await window.electronAPI.analyzeAiMovement(logPath || null, modDataDir || null, savePath || null);
      if (r && r.canceled) { setBusy(false); return; }
      if (!r || r.error) setError((r && r.error) || "analysis failed");
      else {
        setResult(r);
        if (r.logPath) { setLastLog(r.logPath); try { localStorage.setItem("aiLabLastLog", r.logPath); } catch { /* ignore */ } }
      }
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    setBusy(false); setProgress(null);
  };

  const pickSave = async () => {
    try {
      const r = await window.electronAPI?.pickAiSaveFile?.();
      if (r && r.path) setSavePath(r.path);
    } catch { /* cancelled */ }
  };

  // A run takes ~15s on a 346MB log + 45MB save; the worker posts phase notes
  // so the button isn't just "Analyzing…" for a quarter of a minute.
  React.useEffect(() => {
    const off = window.electronAPI?.onAiMovementProgress?.((p2) => setProgress(p2));
    return () => { if (typeof off === "function") off(); };
  }, []);

  const refreshBaselines = async () => {
    try { const r = await window.electronAPI?.listAiBaselines?.(); if (r && r.baselines) setBaselines(r.baselines); }
    catch { /* listing is best-effort */ }
  };
  const saveBaseline = async () => {
    if (!result) return;
    const label = window.prompt("Name this baseline (e.g. \"before mic_2 settlement_min change\")", "baseline");
    if (!label) return;
    setBaseBusy(true);
    try {
      const r = await window.electronAPI?.saveAiBaseline?.(result, label);
      if (r && r.error) setError(r.error); else await refreshBaselines();
    } catch (e) { setError(e?.message || String(e)); }
    setBaseBusy(false);
  };
  const exportReport = async () => {
    if (!result) return;
    setBaseBusy(true);
    try {
      const stem = (result.logPath || "ai-report").split(/[\/]/).pop().replace(/\.[^.]+$/, "");
      const r = await window.electronAPI?.exportAiReport?.(result, "ai-report-" + stem);
      if (r && r.error) setError(r.error);
      else if (r && r.ok) setError(null);
    } catch (e) { setError(e?.message || String(e)); }
    setBaseBusy(false);
  };
  const compareTo = async (file) => {
    if (!result) return;
    setBaseBusy(true);
    try {
      const r = await window.electronAPI?.compareAiBaseline?.(file, result);
      if (r && r.error) setError(r.error);
      else if (r && r.diff) { setDiff(r.diff); setTab("diff"); }
    } catch (e) { setError(e?.message || String(e)); }
    setBaseBusy(false);
  };

  const flabel = (id) => (factionDisplayNames && factionDisplayNames[id]) || String(id || "?").replace(/_/g, " ");
  const visible = useMemo(() => {
    if (!result) return [];
    const fq = factionFilter.trim().toLowerCase();
    const rows = (result.findings || []).filter((f) =>
      kindFilter.has(f.kind) &&
      (!onlyConfirmed || /NEVER arrived/.test(f.verdict || "") || f.impossible) &&
      (!fq || String(f.faction).toLowerCase().includes(fq) || flabel(f.faction).toLowerCase().includes(fq) || String(f.name).toLowerCase().includes(fq)));
    // Sorting is a copy — mutating result.findings would reorder the array the
    // export and the digest read from, and the analyser's own order is
    // meaningful (severity first).
    const by = {
      // default: whatever the analyser decided, which is severity-ordered
      severity: null,
      duration: (a, b) => (b.turns || 0) - (a.turns || 0),
      terrain: (a, b) => ((b.terrain && b.terrain.difficulty) || -1) - ((a.terrain && a.terrain.difficulty) || -1),
      faction: (a, b) => String(a.faction).localeCompare(String(b.faction)) || String(a.name).localeCompare(String(b.name)),
      turn: (a, b) => (a.fromTurn == null ? Infinity : a.fromTurn) - (b.fromTurn == null ? Infinity : b.fromTurn),
    }[sortBy];
    return by ? [...rows].sort(by) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, kindFilter, factionFilter, onlyConfirmed, sortBy, factionDisplayNames]);

  // WHERE the trouble is, as opposed to whose it is. The same handful of places
  // absorb a disproportionate share of failed orders, and a place that several
  // DIFFERENT factions keep failing at is a map problem rather than a faction
  // problem — so that count is the thing worth ranking on.
  const hotspotRows = useMemo(() => {
    if (!result) return [];
    const out = new Map();
    for (const f of (result.findings || [])) {
      if (!f.region) continue;
      let e = out.get(f.region);
      if (!e) out.set(f.region, e = {
        region: f.region, total: 0, factions: new Set(), kinds: {},
        noLandRoute: 0, impossible: 0, terrain: null,
      });
      e.total++;
      e.kinds[f.kind] = (e.kinds[f.kind] || 0) + 1;
      if (f.faction && f.faction !== "?" && f.faction !== "—") e.factions.add(f.faction);
      if (f.noLandRoute) e.noLandRoute++;
      if (f.impossible) e.impossible++;
      if (f.terrain && !e.terrain) e.terrain = f.terrain;
    }
    return [...out.values()]
      .map((e) => ({ ...e, factionCount: e.factions.size, factionList: [...e.factions] }))
      .sort((a, b) => b.factionCount - a.factionCount || b.total - a.total)
      .slice(0, 60);
  }, [result]);

  React.useEffect(() => { if (result) refreshBaselines(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [result]);

  const jump = (regionName, dbl) => {
    if (!regionName || !onHighlightRegion) return;
    onHighlightRegion(regionName, dbl);
  };

  // Who is actually in trouble — 5,592 findings collapse to a few dozen rows.
  const factionRows = useMemo(() => {
    if (!result) return [];
    const out = {};
    for (const f of (result.findings || [])) {
      const k = String(f.faction || "?").toLowerCase();
      if (k === "?") continue;
      const e = out[k] = out[k] || { faction: k, total: 0, impossible: 0, neverArrived: 0, orphaned: 0, kinds: {} };
      e.total++;
      e.kinds[f.kind] = (e.kinds[f.kind] || 0) + 1;
      if (f.impossible) e.impossible++;
      if (/NEVER arrived/.test(f.verdict || "")) e.neverArrived++;
      if (f.orphaned) e.orphaned++;
    }
    return Object.values(out).sort((a, b) => b.total - a.total);
  }, [result]);

  const facRows = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.factionStats || {})
      .filter(([, s]) => s.moves > 0)
      .sort((a, b) => b[1].wander - a[1].wander)
      .slice(0, 12);
  }, [result]);

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(860px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#8fc9d8" }}>⚔ AI Movement Lab</span>
          {result && (
            <span style={{ fontSize: "0.72rem", color: "#888" }}>
              {result.logKind === "campaign_ai"
                ? `AI decision log · ${result.totalTurns} turn blocks (${result.firstYear} → ${result.lastYear}) · ${(result.lines || 0).toLocaleString()} lines · ${result.findings.length} findings · ${result.ms}ms`
                : result.logKind === "scripting"
                  ? `scripting log · ${(result.lines || 0).toLocaleString()} lines · ${result.findings.length} engine error${result.findings.length === 1 ? "" : "s"} · ${result.ms}ms`
                  : `movement log · ${result.totalTurns} turns · ${result.moveLines.toLocaleString()} moves · ${result.armies} armies · ${result.findings.length} findings · ${result.ms}ms`}
            </span>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => run(null)} disabled={busy}
            style={{ padding: "4px 12px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(220,166,74,0.4)", background: "rgba(220,166,74,0.18)", color: "#dca64a", fontWeight: 600, fontSize: "0.78rem" }}>
            {busy ? "Analyzing…" : "Open log file…"}
          </button>
          {lastLog && (
            <button onClick={() => run(lastLog)} disabled={busy}
              title={"Re-analyse " + lastLog}
              style={{ padding: "4px 12px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(143,201,216,0.35)", background: "rgba(143,201,216,0.12)", color: "#8fc9d8", fontSize: "0.78rem" }}>
              ↻ Re-run last log
            </button>
          )}
          {defaultLogDir && (
            <button onClick={() => run(defaultLogDir)} disabled={busy}
              title={defaultLogDir}
              style={{ padding: "4px 12px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#cfe3ea", fontSize: "0.78rem" }}>
              Analyze current game log
            </button>
          )}
          {/* The scripting log lives in the same folder but answers a different
              question — "are the mod's data files valid?" — and needs no save,
              so it gets its own one-click entry rather than hiding behind the
              file picker. */}
          {defaultLogDir && (
            <button onClick={() => run(defaultLogDir.replace(/[\\/]?$/, "/") + "scripting_log.txt")} disabled={busy}
              title={"Read scripting_log.txt — the engine's own errors in the mod's data files (file, line and column). No save needed."}
              style={{ padding: "4px 12px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(240,120,122,0.35)", background: "rgba(240,120,122,0.12)", color: "#f0a0a2", fontSize: "0.78rem" }}>
              ⚠ Check mod files
            </button>
          )}
          {busy && progress ? (
            <span style={{ fontSize: "0.72rem", color: "#8fc9d8" }}>
              <span style={{ opacity: 0.7 }}>{progress.phase}:</span> {progress.detail}
            </span>
          ) : (
            <span style={{ fontSize: "0.68rem", color: "#888" }}>
              Takes message_log.txt (movement traces), campaign_ai_log.txt (AI decisions, any size — 300MB telemetry streams fine),
              or scripting_log.txt (the engine's own errors in the mod's data files — no save needed).
            </span>
          )}
          <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <button onClick={pickSave} disabled={busy}
              style={{ padding: "3px 10px", borderRadius: 6, cursor: busy ? "default" : "pointer", border: "1px solid rgba(143,201,216,0.4)", background: savePath ? "rgba(143,201,216,0.18)" : "transparent", color: "#8fc9d8", fontSize: "0.74rem" }}>
              {savePath ? "✓ Save attached" : "Cross-reference a save… (optional)"}
            </button>
            {savePath && (
              <>
                <span title={savePath} style={{ fontSize: "0.68rem", color: "#9a8f7a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                  {savePath.split(/[\/]/).pop()}
                </span>
                <span onClick={() => setSavePath(null)} title="Detach" style={{ color: "#e87a6a", cursor: "pointer", fontSize: "0.74rem" }}>✕</span>
              </>
            )}
            <span style={{ fontSize: "0.66rem", color: "#777" }}>
              A save turns findings into verdicts — did the army ever arrive, was the campaign even affordable? (adds ~12s)
            </span>
          </div>
        </div>

        {error && <div style={{ padding: "8px 16px", color: "#e87a6a", fontSize: "0.78rem" }}>{error}</div>}

        {!result && !error && (
          <div style={{ padding: "26px 20px", color: "#aaa", fontSize: "0.82rem", lineHeight: 1.6 }}>
            Analyzes a campaign log for AI pathing problems:
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {Object.entries(KIND_META).map(([k, m]) => (
                <li key={k}><span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span> — {m.desc}</li>
              ))}
            </ul>
          </div>
        )}

        {result && result.usable === false && (
          <div style={{ padding: "18px 20px" }}>
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(232,122,106,0.10)", border: "1px solid rgba(232,122,106,0.35)" }}>
              <div style={{ fontWeight: 700, color: "#e87a6a", marginBottom: 4 }}>Nothing to analyse in this log</div>
              <div style={{ fontSize: "0.8rem", color: "#ddd", lineHeight: 1.55 }}>{result.emptyReason}</div>
              <div style={{ fontSize: "0.72rem", color: "#9a8f7a", marginTop: 6 }}>
                {(result.logPath || "").split(/[\/]/).pop()}
                {result.logBytes ? ` · ${(result.logBytes / 1048576).toFixed(1)} MB` : ""}
              </div>
            </div>
            <div style={{ fontSize: "0.76rem", color: "#aaa", marginTop: 10, lineHeight: 1.6 }}>
              This is <b>not</b> a clean bill of health for the AI — it simply means this file carries no
              movement or decision data. The AI-side analysis lives in <code style={{ color: "#8fc9d8" }}>campaign_ai_log.txt</code>,
              which is usually the far larger file in the same folder.
            </div>
          </div>
        )}
        {result && result.usable !== false && (
          <>
          {/* FIXED header — the summary, tabs and filters stay put; only the
              list below scrolls (user 2026-07-25). flexShrink:0 keeps it from
              being squeezed by the scroller's flex:1. */}
          <div style={{ padding: "8px 16px 6px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {result.saveError && (
              <div style={{ marginBottom: 6, fontSize: "0.74rem", color: "#e87a6a" }}>Save cross-reference failed: {result.saveError}</div>
            )}
            {result.save && (
              <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 6, background: "rgba(143,201,216,0.10)", border: "1px solid rgba(143,201,216,0.28)", fontSize: "0.75rem", lineHeight: 1.5 }}>
                <b style={{ color: "#8fc9d8" }}>Cross-referenced with turn {result.save.turn}</b>
                {" — "}
                <b style={{ color: "#e87a6a" }}>{result.save.confirmedNeverArrived}</b> orders confirmed never to have arrived,{" "}
                <b style={{ color: "#e87a6a" }}>{result.save.impossibleCampaigns}</b> campaigns the faction could never afford,{" "}
                <b style={{ color: "#e87a6a" }}>{result.save.orphanedArmies}</b> armies orphaned while still alive.
                <div style={{ color: "#9a8f7a", fontSize: "0.7rem" }}>
                  World at that turn: {result.save.navalWorld} ships total · {result.save.sieges} active sieges · {result.save.factionsWithUnits} factions still fielding troops.
                </div>
                {/* Land reachability — the strongest claim the Lab makes, so it
                    reports both the number of proven-impossible orders AND
                    whether the model survived being falsified. A count with no
                    confidence attached would be worth less. */}
                {result.reachability && (
                  <div style={{ color: "#9a8f7a", fontSize: "0.7rem", marginTop: 2 }}>
                    Land routes: {result.reachability.components.toLocaleString()} separate land masses on this map
                    {result.reachability.mainlandRegions ? ` (the largest holds ${result.reachability.mainlandRegions.toLocaleString()} regions)` : ""}
                    {" — "}
                    <b style={{ color: result.reachability.verdicts ? "#e87a6a" : "#8fd18f" }}>{result.reachability.verdicts}</b>
                    {" orders proven to have no walkable route at all."}
                    {result.reachability.excludedFactions > 0 ? (
                      <span style={{ color: "#e8c873" }}>
                        {" "}{result.reachability.excludedFactions} faction(s) excluded — the save contradicts the terrain model there, so no verdict was issued for them.
                      </span>
                    ) : (
                      <span title="Checked by looking for units standing where a navy-less faction could neither have walked nor sailed. Zero such cases means the model held everywhere it could be tested.">
                        {" "}Model checked against every faction's unit positions: no contradictions.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* CAMPAIGN OUTCOME — the only number here that says whether any of
                the AI's effort produced anything. Above the scale banner, because
                this is the observation and that is its explanation. */}
            {result.expansion && result.expansion.comparable && (
              <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 6, background: result.expansion.rebelDelta >= 0 ? "rgba(232,122,106,0.12)" : "rgba(143,209,143,0.10)", border: `1px solid ${result.expansion.rebelDelta >= 0 ? "rgba(232,122,106,0.38)" : "rgba(143,209,143,0.3)"}`, fontSize: "0.75rem", lineHeight: 1.5 }}>
                <b style={{ color: result.expansion.rebelDelta >= 0 ? "#e87a6a" : "#8fd18f" }}>
                  {result.expansion.rebelDelta >= 0 ? "Conquest is not working" : "Conquest is making progress"}
                </b>
                {" — the independent peoples went from "}
                <b>{result.expansion.rebelBefore}</b>{" settlements to "}
                <b>{result.expansion.rebelAfter}</b>
                {result.expansion.rebelDelta !== 0 ? ` (${result.expansion.rebelDelta > 0 ? "+" : ""}${result.expansion.rebelDelta})` : ""}
                {", while the "}{result.expansion.factions}{" real factions "}
                {result.expansion.netNonRebel >= 0 ? "gained " : "lost "}
                <b>{Math.abs(result.expansion.netNonRebel)}</b>{" between them and "}
                <b style={{ color: "#e87a6a" }}>{result.expansion.wipedOut}</b>{" were wiped out."}
                <div style={{ color: "#9a8f7a", fontSize: "0.7rem", marginTop: 2 }}>
                  {result.expansion.grew} gained ground · {result.expansion.shrank} lost · {result.expansion.unchanged} unchanged.
                  {result.expansion.topGainers.length ? ` Biggest gainers: ${result.expansion.topGainers.slice(0, 4).map((r) => `${flabel(r.faction)} ${r.before}→${r.after}`).join(", ")}.` : ""}
                  {" Start ownership from descr_strat.txt against the save"}
                  {result.expansion.divergence ? ` (${result.expansion.divergence} settlements apart — founded or razed mid-campaign)` : ""}.
                </div>
              </div>
            )}
            {/* The strength-scale mismatch. Placed above everything else because
                it reframes the rest: if almost no faction could field the median
                requirement, then "this faction is poor" is a symptom of the map's
                shape rather than of that faction. */}
            {result.strengthScale && result.strengthScale.ratio >= 4 && (
              <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 6, background: "rgba(232,122,106,0.10)", border: "1px solid rgba(232,122,106,0.35)", fontSize: "0.75rem", lineHeight: 1.5 }}>
                <b style={{ color: "#e87a6a" }}>The requirements do not fit this map</b>
                {" — across "}{result.strengthScale.askTargets.toLocaleString()}{" targets the AI's median offensive requirement is "}
                <b>{result.strengthScale.askMedian.toLocaleString()}</b>{" men, while the median faction fields "}
                <b>{result.strengthScale.menMedian.toLocaleString()}</b>{". That is "}
                <b style={{ color: "#e87a6a" }}>{result.strengthScale.ratio}×</b>{", and only "}
                <b>{result.strengthScale.factionsAbleToMeetMedianAsk}</b>{" of "}{result.strengthScale.factions}
                {" factions could field it at all."}
                <div style={{ color: "#9a8f7a", fontSize: "0.7rem", marginTop: 2 }}>
                  This sits upstream of every per-faction lead: it is why campaigns gather forever and never launch.
                  Ask p75 {result.strengthScale.askP75.toLocaleString()} · p95 {result.strengthScale.askP95.toLocaleString()} ·
                  {" "}{result.strengthScale.totalMen.toLocaleString()} men on the whole map.
                  Defensive postures are excluded from the ask — those read as frontier totals rather than one stack.
                </div>
              </div>
            )}
            {result.agents && (
              <div style={{ marginBottom: 6, fontSize: "0.72rem", color: result.agents.zeroTurnPct > 0.5 ? "#e8c873" : "#9a8f7a" }}>
                Espionage: {result.agents.spies.toLocaleString()} spy and {result.agents.assassins.toLocaleString()} assassin assignments across {result.agents.reports.toLocaleString()} faction-turns
                {result.agents.zeroTurnPct > 0.5 ? ` — but ${Math.round(result.agents.zeroTurnPct * 100)}% of those turns assigned none at all` : ""}.
              </div>
            )}
            {result.modLeads && result.modLeads.length > 0 && (
              <div style={{ display: "flex", gap: 2, marginBottom: 6, padding: 2, background: "rgba(0,0,0,0.25)", borderRadius: 5 }}>
                {[["findings", `Findings (${result.findings.length})`], ["leads", `Mod-file leads (${result.modLeads.length})`], ["factions", `By faction (${factionRows.length})`], ...(hotspotRows.length ? [["hotspots", `Hotspots (${hotspotRows.length})`]] : []), ...(diff ? [["diff", "Before / after"]] : [])].map(([k, lab]) => (
                  <div key={k} onClick={() => setTab(k)}
                    style={{ flex: 1, padding: "3px 8px", fontSize: "0.74rem", textAlign: "center", cursor: "pointer", borderRadius: 4, userSelect: "none",
                      background: tab === k ? "rgba(255,255,255,0.14)" : "transparent", color: tab === k ? "#fff" : "#bbb", fontWeight: tab === k ? 600 : 400 }}>
                    {lab}
                  </div>
                ))}
              </div>
            )}
            {/* before/after harness: snapshot a run, then compare a later run to
                it to prove whether a mod change actually reduced the problems */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <button onClick={saveBaseline} disabled={baseBusy}
                title="Store this run's summary so a later run can be compared against it"
                style={{ padding: "2px 9px", borderRadius: 5, cursor: baseBusy ? "default" : "pointer", border: "1px solid rgba(143,209,143,0.4)", background: "rgba(143,209,143,0.14)", color: "#8fd18f", fontSize: "0.72rem" }}>
                ⭑ Save as baseline
              </button>
              {baselines && baselines.length > 0 && (
                <>
                  <span style={{ fontSize: "0.7rem", color: "#888" }}>compare with:</span>
                  <select
                    onChange={(e) => { if (e.target.value) compareTo(e.target.value); }}
                    defaultValue=""
                    disabled={baseBusy}
                    style={{ maxWidth: 260, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#ddd", fontSize: "0.72rem" }}>
                    <option value="">choose a baseline…</option>
                    {baselines.map((b) => (
                      <option key={b.file} value={b.file}>
                        {(b.label || b.name)} — {b.findings} findings, {b.turns} turns{b.savedAt ? ` (${b.savedAt.slice(0, 10)})` : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button onClick={exportReport} disabled={baseBusy}
                title="Write a Markdown review document (leads grouped by file) plus CSVs of every finding and lead"
                style={{ marginLeft: "auto", padding: "2px 9px", borderRadius: 5, cursor: baseBusy ? "default" : "pointer", border: "1px solid rgba(159,184,216,0.4)", background: "rgba(159,184,216,0.14)", color: "#9fb8d8", fontSize: "0.72rem" }}>
                ⤓ Export report
              </button>
              {baseBusy && <span style={{ fontSize: "0.7rem", color: "#8fc9d8" }}>working…</span>}
            </div>
            {/* filters live in the fixed header too, so they're always reachable */}
            {tab === "findings" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {Object.entries(KIND_META).map(([k, m]) => {
                const on = kindFilter.has(k);
                const n = (result.findingCounts && result.findingCounts[k]) || 0;
                return (
                  <button key={k}
                    onClick={() => setKindFilter((prev) => { const s2 = new Set(prev); if (s2.has(k)) s2.delete(k); else s2.add(k); return s2; })}
                    title={m.desc}
                    style={{ padding: "2px 10px", borderRadius: 10, cursor: "pointer", fontSize: "0.72rem", border: `1px solid ${m.color}`, background: on ? m.color + "33" : "transparent", color: on ? "#eee" : "#777" }}>
                    {m.label} {n}
                  </button>
                );
              })}
              {result.cannotFlee > 0 && (
                <span title="Beaten armies with NOWHERE to retreat (context-free engine line, not attributable to a specific army)"
                  style={{ fontSize: "0.72rem", color: "#e87a6a" }}>· {result.cannotFlee}× cannot-find-flee-tile</span>
              )}
              {result.save && (
                <label title="Show only findings the save proves went wrong" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: onlyConfirmed ? "#e87a6a" : "#888", cursor: "pointer" }}>
                  <input type="checkbox" checked={onlyConfirmed} onChange={() => setOnlyConfirmed((v) => !v)} />
                  proven only
                </label>
              )}
              {/* Sorting matters at this scale: 6,000+ findings are unreadable
                  in one order. "Worst first" is the analyser's own severity
                  ranking and stays the default. */}
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: "#9a8f7a" }}>
                sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                  title="How to order the findings list"
                  style={{ padding: "2px 5px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#ddd", fontSize: "0.72rem" }}>
                  <option value="severity">worst first</option>
                  <option value="duration">longest-running</option>
                  <option value="terrain">hardest ground</option>
                  <option value="turn">earliest turn</option>
                  <option value="faction">faction A–Z</option>
                </select>
              </label>
              <input value={factionFilter} onChange={(e) => setFactionFilter(e.target.value)} placeholder="Filter faction / army…"
                style={{ width: 170, padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#f0f0f0", fontSize: "0.74rem", outline: "none" }} />
            </div>
            )}
          </div>

          {/* SCROLLER — just the results */}
          <div style={{ overflowY: "auto", padding: "8px 16px", flex: 1, minHeight: 0 }}>
            {/* HOTSPOTS — where the trouble is, rather than whose it is. Ranked by
                how many DIFFERENT factions fail at the same place, because that
                is what separates a map problem from one faction's bad turn. */}
            {tab === "hotspots" && (
              <div>
                <div style={{ fontSize: "0.7rem", color: "#888", marginBottom: 6 }}>
                  Places that absorb failed orders, ranked by how many <b>different</b> factions fail there —
                  several factions failing at one spot points at the map, not at any one of them.
                  Click a row to highlight the region, double-click to jump to it.
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: "0.7rem", color: "#9a8f7a", padding: "0 4px 2px", fontWeight: 700 }}>
                  <span style={{ width: 168 }}>Region</span>
                  <span style={{ width: 64, textAlign: "right" }} title="How many distinct factions have a failed order here">Factions</span>
                  <span style={{ width: 62, textAlign: "right" }}>Findings</span>
                  <span style={{ width: 74, textAlign: "right" }} title="Orders proven to have no walkable route to here">No route</span>
                  <span style={{ width: 58, textAlign: "right" }} title="Ground difficulty 0-100 from map_ground_types.tga">Ground</span>
                  <span style={{ flex: 1 }}>Problem mix</span>
                </div>
                {hotspotRows.map((h) => (
                  <div key={h.region}
                    onClick={() => jump(h.region, false)}
                    onDoubleClick={() => jump(h.region, true)}
                    title={h.factionList.length ? `Failing here: ${h.factionList.slice(0, 12).map(flabel).join(", ")}${h.factionList.length > 12 ? ` +${h.factionList.length - 12} more` : ""}` : "No faction named in the log for these"}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.74rem", padding: "2px 4px", borderRadius: 4, cursor: "pointer" }}>
                    <span style={{ width: 168, color: "#eee", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.region.replace(/_/g, " ")}
                    </span>
                    <span style={{ width: 64, textAlign: "right", color: h.factionCount >= 3 ? "#e8a06a" : "#cfc6b0", fontWeight: h.factionCount >= 3 ? 700 : 400 }}>{h.factionCount}</span>
                    <span style={{ width: 62, textAlign: "right", color: "#cfc6b0" }}>{h.total}</span>
                    <span style={{ width: 74, textAlign: "right", color: h.noLandRoute ? "#e87a6a" : "#666" }}>{h.noLandRoute || "—"}</span>
                    <span style={{ width: 58, textAlign: "right", color: !h.terrain ? "#666" : h.terrain.difficulty >= 60 ? "#e8a06a" : h.terrain.difficulty >= 35 ? "#e8c873" : "#8fa89a" }}>
                      {h.terrain ? h.terrain.difficulty : "—"}
                    </span>
                    <span style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {Object.entries(h.kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => (
                        <span key={k} title={(KIND_META[k] && KIND_META[k].desc) || k}
                          style={{ fontSize: "0.66rem", padding: "0 5px", borderRadius: 7, border: `1px solid ${(KIND_META[k] && KIND_META[k].color) || "#666"}55`, color: (KIND_META[k] && KIND_META[k].color) || "#999" }}>
                          {(KIND_META[k] && KIND_META[k].label) || k} {n}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
                {!hotspotRows.length && (
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>No finding in this log names a region, so there is nothing to rank by place.</div>
                )}
              </div>
            )}
            {tab === "factions" && (
              <div>
                <div style={{ fontSize: "0.7rem", color: "#888", marginBottom: 6 }}>
                  Worst-affected factions first. Click one to filter the findings list to it.
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: "0.7rem", color: "#9a8f7a", padding: "0 4px 2px", fontWeight: 700 }}>
                  <span style={{ width: 170 }}>Faction</span>
                  <span style={{ width: 60, textAlign: "right" }}>Findings</span>
                  <span style={{ width: 84, textAlign: "right" }}>Unafford.</span>
                  <span style={{ width: 84, textAlign: "right" }}>Never arr.</span>
                  <span style={{ width: 70, textAlign: "right" }}>Orphaned</span>
                  <span style={{ flex: 1 }}>Problem mix</span>
                </div>
                {factionRows.map((r) => (
                  <div key={r.faction}
                    onClick={() => { setFactionFilter(r.faction); setTab("findings"); }}
                    title={`Show ${r.faction}'s findings`}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.74rem", padding: "2px 4px", borderRadius: 4, cursor: "pointer" }}>
                    <span style={{ width: 170, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flabel(r.faction)}</span>
                    <span style={{ width: 60, textAlign: "right", color: "#ddd", fontVariantNumeric: "tabular-nums" }}>{r.total}</span>
                    <span style={{ width: 84, textAlign: "right", color: r.impossible ? "#e87a6a" : "#666", fontVariantNumeric: "tabular-nums" }}>{r.impossible || ""}</span>
                    <span style={{ width: 84, textAlign: "right", color: r.neverArrived ? "#e87a6a" : "#666", fontVariantNumeric: "tabular-nums" }}>{r.neverArrived || ""}</span>
                    <span style={{ width: 70, textAlign: "right", color: r.orphaned ? "#d88fb0" : "#666", fontVariantNumeric: "tabular-nums" }}>{r.orphaned || ""}</span>
                    <span style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {Object.entries(r.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                        <span key={k} title={(KIND_META[k] && KIND_META[k].desc) || k}
                          style={{ fontSize: "0.66rem", padding: "0 5px", borderRadius: 7, border: `1px solid ${(KIND_META[k] && KIND_META[k].color) || "#666"}55`, color: (KIND_META[k] && KIND_META[k].color) || "#999" }}>
                          {(KIND_META[k] && KIND_META[k].label) || k} {n}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {tab === "diff" && diff && (() => {
              const VERDICT = {
                improved: { color: "#8fd18f", text: "IMPROVED" },
                regressed: { color: "#e87a6a", text: "REGRESSED" },
                unchanged: { color: "#e8c873", text: "UNCHANGED" },
                inconclusive: { color: "#9a8f7a", text: "INCONCLUSIVE" },
              }[diff.verdict] || { color: "#9a8f7a", text: String(diff.verdict).toUpperCase() };
              // improvement = FEWER problems, so a negative delta is good
              const good = (d) => d < 0 ? "#8fd18f" : d > 0 ? "#e87a6a" : "#9a8f7a";
              const sign = (d) => (d > 0 ? "+" : "") + d;
              const row = (label, m) => (
                <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "0.74rem", padding: "1px 0" }}>
                  <span style={{ width: 150, color: "#ddd", flexShrink: 0 }}>{label}</span>
                  <span style={{ color: "#9a8f7a", width: 96, flexShrink: 0 }}>{m.before} → {m.after}</span>
                  <span style={{ color: good(m.delta), width: 60, flexShrink: 0, fontWeight: 600 }}>{sign(m.delta)}</span>
                  <span style={{ color: "#888" }}>
                    {m.beforePerTurn}/turn → {m.afterPerTurn}/turn
                    {m.ratePct != null ? ` (${m.ratePct > 0 ? "+" : ""}${m.ratePct}% rate)` : ""}
                  </span>
                </div>
              );
              return (
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                    <b style={{ color: VERDICT.color, fontSize: "0.95rem" }}>{VERDICT.text}</b>
                    <span style={{ fontSize: "0.76rem", color: "#ddd" }}>
                      {diff.labels.before} → {diff.labels.after}
                      {diff.ratePct != null ? ` · ${diff.ratePct > 0 ? "+" : ""}${diff.ratePct}% findings per turn` : ""}
                    </span>
                  </div>
                  {diff.caveat && (
                    <div style={{ marginBottom: 8, padding: "6px 9px", borderRadius: 6, background: "rgba(232,200,115,0.10)", border: "1px solid rgba(232,200,115,0.35)", fontSize: "0.74rem", color: "#e8c873" }}>
                      ⚠ {diff.caveat}
                    </div>
                  )}
                  <div style={{ fontSize: "0.72rem", color: "#888", marginBottom: 4 }}>
                    Fewer problems is better, so <span style={{ color: "#8fd18f" }}>green/negative</span> means the change helped.
                    Rates are per turn, so a longer or shorter campaign can’t fake a result.
                  </div>
                  {row("All findings", diff.totals.findings)}
                  <div style={{ fontSize: "0.72rem", color: "#cfc6b0", fontWeight: 700, margin: "8px 0 2px" }}>By problem type</div>
                  {Object.entries(diff.byKind).map(([k, m]) => row((KIND_META[k] && KIND_META[k].label) || k, m))}
                  {diff.save && (
                    <>
                      <div style={{ fontSize: "0.72rem", color: "#cfc6b0", fontWeight: 700, margin: "8px 0 2px" }}>
                        Save-verified (turn {diff.save.turnBefore} → {diff.save.turnAfter})
                      </div>
                      {row("Never arrived", diff.save.neverArrived)}
                      {row("Unaffordable campaigns", diff.save.impossible)}
                      {row("Orphaned armies", diff.save.orphaned)}
                    </>
                  )}
                  {diff.factionRows.length > 0 && (
                    <>
                      <div style={{ fontSize: "0.72rem", color: "#cfc6b0", fontWeight: 700, margin: "8px 0 2px" }}>
                        Biggest movers by faction ({diff.factionRows.length} changed)
                      </div>
                      {diff.factionRows.slice(0, 20).map((f) => (
                        <div key={f.faction} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "0.74rem" }}>
                          <span style={{ width: 150, color: "#ddd", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flabel(f.faction)}</span>
                          <span style={{ color: "#9a8f7a", width: 96, flexShrink: 0 }}>{f.beforeTotal} → {f.afterTotal}</span>
                          <span style={{ color: good(f.total), width: 60, flexShrink: 0, fontWeight: 600 }}>{sign(f.total)}</span>
                          <span style={{ color: "#888" }}>
                            {f.impossible !== 0 ? `${sign(f.impossible)} unaffordable ` : ""}
                            {f.orphaned !== 0 ? `${sign(f.orphaned)} orphaned ` : ""}
                            {f.neverArrived !== 0 ? `${sign(f.neverArrived)} never-arrived` : ""}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                  {Object.keys(diff.leads.byFile).length > 0 && (
                    <>
                      <div style={{ fontSize: "0.72rem", color: "#cfc6b0", fontWeight: 700, margin: "8px 0 2px" }}>
                        Mod-file leads {diff.leads.before} → {diff.leads.after} ({sign(diff.leads.delta)})
                      </div>
                      {Object.entries(diff.leads.byFile).map(([f, m]) => (
                        <div key={f} style={{ display: "flex", gap: 8, fontSize: "0.72rem" }}>
                          <code style={{ color: "#8fc9d8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</code>
                          <span style={{ color: "#9a8f7a" }}>{m.before} → {m.after}</span>
                          <span style={{ color: good(m.delta), fontWeight: 600 }}>{sign(m.delta)}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}
            {tab === "leads" && result.modLeads && (
              <div>
                <div style={{ fontSize: "0.7rem", color: "#888", marginBottom: 6 }}>
                  Each lead names the file and the key to edit, with the log/save evidence behind it.
                </div>
                {result.modLeads.map((l, i) => (
                  <div key={i} style={{ marginBottom: 7, padding: "6px 9px", borderRadius: 6, borderLeft: `3px solid ${l.severity >= 3 ? "#e87a6a" : l.severity === 2 ? "#e8c873" : "#8fc9d8"}`, background: "rgba(255,255,255,0.03)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <b style={{ color: "#eee" }}>{flabel(l.faction)}</b>
                      <code style={{ fontSize: "0.7rem", color: "#8fc9d8" }}>{l.file}</code>
                      <span style={{ fontSize: "0.7rem", color: "#9a8f7a" }}>{l.key}</span>
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "#e8c873", marginTop: 2 }}>{l.issue}</div>
                    <div style={{ fontSize: "0.74rem", color: "#8fd18f" }}>→ {l.suggestion}</div>
                    <div style={{ fontSize: "0.68rem", color: "#888", marginTop: 1 }}>{l.evidence}</div>
                  </div>
                ))}
              </div>
            )}
            {tab === "findings" && (<>
            {/* findings table */}
            {visible.length === 0 && (
              <div style={{ color: (result.findings || []).length ? "#e8c873" : "#8fd18f", fontSize: "0.8rem", padding: "8px 2px" }}>
                {(result.findings || []).length
                  ? "No findings match the current filters — widen them to see the rest."
                  : result.logKind === "scripting"
                    ? "No data-file errors — the engine parsed every mod file it loaded."
                    : "No problems found — the AI moved cleanly in this log."}
              </div>
            )}
            {visible.map((f, i) => {
              const m = KIND_META[f.kind] || { color: "#999", label: f.kind };
              return (
                <div key={i}>
                  <div
                  onClick={() => jump(f.region, false)}
                  onDoubleClick={() => jump(f.region, true)}
                  title={f.region ? "Click: highlight region · double-click: jump" : "No region resolved for this tile"}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 4px", borderRadius: 4, cursor: f.region ? "pointer" : "default", fontSize: "0.76rem", borderLeft: `3px solid ${m.color}`, marginBottom: 2 }}>
                  <span style={{ color: m.color, fontWeight: 700, width: 96, flexShrink: 0 }}>{m.label}</span>
                  <span style={{ color: "#eee", fontWeight: 600 }}>{f.name}</span>
                  {/* scripting-log findings belong to no faction — printing a
                      placeholder there is the same noise as the old (null,null) */}
                  {f.faction && f.faction !== "—" && f.faction !== "?" && (
                    <span style={{ color: "#9a8f7a" }}>{flabel(f.faction)}</span>
                  )}
                  {f.fromTurn != null && f.toTurn != null && (
                    <span style={{ color: "#8fc9d8", flexShrink: 0 }}>
                      {f.fromTurn === f.toTurn ? `t${f.fromTurn}` : `t${f.fromTurn}–${f.toTurn}`}
                    </span>
                  )}
                  <span style={{ color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.detail}</span>
                  {/* Terrain of the target, when map_ground_types resolved it.
                      This is the whole point of reading that file, so it belongs
                      on the row rather than only inside a lead. Coloured by how
                      hard the ground is, against the map's own median. */}
                  {f.terrain && (
                    <span
                      title={`Target ground: ${f.terrain.impassablePct}% impassable, ${f.terrain.roughPct}% rough — difficulty ${f.terrain.difficulty}/100 (mostly ${f.terrain.dominant}). From map_ground_types.tga.`}
                      style={{
                        flexShrink: 0, fontSize: "0.66rem", padding: "0 5px", borderRadius: 7,
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: f.terrain.difficulty >= 60 ? "#e8a06a" : f.terrain.difficulty >= 35 ? "#e8c873" : "#8fa89a",
                      }}>
                      ⛰ {f.terrain.difficulty}
                    </span>
                  )}
                  <span style={{ color: "#cfc6b0", flexShrink: 0 }}>
                    {f.region
                      ? f.region.replace(/_/g, " ")
                      : (f.x != null && f.y != null ? `(${f.x},${f.y})` : "")}
                  </span>
                  </div>
                  {(f.verdict || f.reqVsHave) && (() => {
                    // A verdict is only GOOD news when it confirms the AI coped.
                    // Scripting-log verdicts ("BLOCK DISCARDED …") are the
                    // opposite, so severity decides the colour — otherwise a
                    // parse failure rendered as a green ✓.
                    const bad = f.impossible || f.noLandRoute || /NEVER arrived/.test(f.verdict || "") ||
                      f.kind === "script_error" || f.kind === "script_runtime_error";
                    // a proven-impossible route is the strongest bad news here
                    const icon = (f.impossible || f.noLandRoute) ? "⛔ " : bad ? "✕ " : "✓ ";
                    return (
                    <div style={{ margin: "0 0 3px 102px", fontSize: "0.7rem", color: bad ? "#e87a6a" : "#8fd18f" }}>
                      {icon}
                      {f.reqVsHave || f.verdict}
                      {f.factionSettlements != null && f.kind === "campaign_stall" ? ` · holds ${f.factionSettlements} settlement(s)` : ""}
                    </div>
                    );
                  })()}
                  </div>
              );
            })}

            </>)}
            {/* faction wander table */}
            {facRows.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#cfc6b0", marginBottom: 3 }}>
                  Faction wander index (1 = walks in circles, 0 = beelines):
                </div>
                {facRows.map(([f, s]) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.74rem", marginBottom: 1 }}>
                    <span style={{ width: 150, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flabel(f)}</span>
                    <div style={{ flex: 1, height: 7, borderRadius: 3, background: "rgba(255,255,255,0.07)" }}>
                      <div style={{ height: 7, borderRadius: 3, width: `${Math.round(s.wander * 100)}%`, background: s.wander > 0.5 ? "#e87a6a" : s.wander > 0.3 ? "#e8c873" : "#8fd18f" }} />
                    </div>
                    <span style={{ color: "#9a8f7a", width: 100, textAlign: "right" }}>{s.wander.toFixed(2)} · {s.moves} mv</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
