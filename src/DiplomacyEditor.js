import React, { useEffect, useState, useMemo, useRef } from "react";

// Dev-mode diplomacy viewer/editor. Shows EVERY faction with the three
// descr_strat diplomacy values the engine uses, for the selected faction → them:
//   • core (core_attitudes)        — starting AI disposition (-10..1000)
//   • rel  (faction_relationships) — starting STATE: <199 ally / 200 neutral / >201 war
//   • agg  (faction_agression)     — post-turn-1 aggression (-200..700)
// All three are editable; edits stage and write to descr_strat on Save.

// core_attitudes labels — verbatim from the RIS descr_strat header (these are
// AI dispositions, not declared wars: 400 is "Hostile, not warring").
const CORE_LABEL = (v) =>
  v <= -10 ? "Forced ally" : v <= 0 ? "Allied" : v < 200 ? "Suspicious" :
  v === 200 ? "Neutral" : v < 600 ? "Hostile" : v < 850 ? "Warring" :
  v < 1000 ? "Total war" : "Crazy";
// faction_relationships = the actual starting STATE.
const REL_LABEL = (v) => v <= 199 ? "Ally" : v === 200 ? "Neutral" : "War";
// faction_agression — how aggressive they get after turn 1.
const AGG_LABEL = (v) => v < 0 ? "Friendly" : v < 200 ? "Calm" : v < 400 ? "Wary" : v < 600 ? "Aggressive" : "Hostile";
const COLOR = (v) => v <= 0 ? "#9ed09e" : v < 200 ? "#c8d0a0" : v === 200 ? "#bbc" : v < 600 ? "#e0c080" : "#e8a0a0";
const REL_COLOR = (v) => v <= 199 ? "#9ed09e" : v === 200 ? "#bbc" : "#e8a0a0";

// Editable number cell with a LOCAL draft string so the user can freely clear,
// type partial values, and enter negatives. A fully-controlled `value={number}`
// with an immediate parseInt (the old code) snapped an emptied field back to 0
// and fought every keystroke. Here the field shows the raw draft; valid numbers
// stage live (so labels/colours update), and blur/Enter commits (empty → 0).
// External value changes (e.g. the reverse toggle) sync in only while unfocused.
function NumberCell({ value, onCommit, style, title }) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const focusedRef = useRef(false);
  useEffect(() => { if (!focusedRef.current) setDraft(String(value ?? 0)); }, [value]);
  const commit = (raw) => {
    const n = (raw === "" || raw === "-") ? 0 : parseInt(raw, 10);
    const final = Number.isFinite(n) ? n : 0;
    setDraft(String(final));
    if (final !== value) onCommit(final);
  };
  return (
    <input type="number" className="no-spin" style={style} title={title} value={draft}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => {
        const s = e.target.value;
        setDraft(s);
        if (s !== "" && s !== "-") { const n = parseInt(s, 10); if (Number.isFinite(n)) onCommit(n); }
      }}
      onBlur={() => { focusedRef.current = false; commit(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") { commit(draft); e.currentTarget.blur(); } }}
    />
  );
}

export default function DiplomacyEditor({ ownerFactionId, factionLabel, factionDisplayNames, onClose, onStageEdit, pendingDiplo, regions, regionCentroids, victoryConditions }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [bidi, setBidi] = useState(false);
  // When on, the 33/33/33 split sets aggr to the same value as core. Off lets
  // them diverge (core = starting state, aggr = the trend it drifts toward).
  const [linkAgg, setLinkAgg] = useState(true);
  // When on, the split also sets Rel (the actual starting STATE): the closest
  // (warring) third starts at war, the rest stay neutral. Opt-in.
  const [linkRel, setLinkRel] = useState(false);
  // Flip the whole view to "how every other faction sees ME" (other → me).
  // Edits in this mode stage the reverse direction.
  const [reverse, setReverse] = useState(false);

  useEffect(() => {
    let alive = true;
    console.log(`[diplo-edit-ui] open — faction="${ownerFactionId}"`);
    window.electronAPI.getCoreAttitudes().then((r) => {
      if (!alive) return;
      if (!r || !r.ok) { setErr((r && r.error) || "failed to read diplomacy"); return; }
      // Guard a malformed-but-ok response so `r.factions.length` can't throw
      // "reading 'factions'" / "reading 'length'" from this async handler.
      if (!Array.isArray(r.factions)) { console.warn("[diplo-edit-ui] ok but no factions array"); setErr("diplomacy data incomplete (no factions)"); return; }
      console.log(`[diplo-edit-ui] loaded ${r.factions.length} factions; file=${r.file}`);
      setData(r);
    }).catch((e) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [ownerFactionId]);

  // Ctrl/⌘+B toggles bidirectional mid-edit (works even with a number field
  // focused); Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); setBidi((v) => !v); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fid = String(ownerFactionId || "").toLowerCase();
  const lab = (id) => (factionLabel ? factionLabel(id) : null) || (factionDisplayNames && factionDisplayNames[id]) || String(id).replace(/_/g, " ");
  const isGenericRebels = (f) => f === "slave" || f === "slaves" || f === "rebels";
  const isSubRebel = (f) => /_rebels(_?\d+)?$/.test(f);
  // A staged edit is stored as a wrapper object { kind, from, to, value, label };
  // unwrap to the numeric value (older shapes may store the raw number directly).
  const stagedDir = (kind, from, to) => {
    const e = pendingDiplo && pendingDiplo.get(`${kind}|${from}|${to}`);
    if (e == null) return null;
    return typeof e === "object" ? e.value : e;
  };
  // Effective value for a directed pair: staged edit wins, else the loaded
  // descr_strat value, else the default.
  const valOf = (from, to, kind, dflt) => {
    const s = stagedDir(kind, from, to);
    if (s != null) return s;
    const e = ((data && data.byFaction && data.byFaction[from]) || {})[to] || {};
    return e[kind] != null ? e[kind] : dflt;
  };

  // Build a row for faction f, honouring the reverse-perspective toggle. In
  // forward view the row is (me → f); in reverse it's (f → me). `oppCore` is the
  // other direction's core value, used to flag one-sided relationships.
  const makeRow = (f) => {
    const from = reverse ? f : fid, to = reverse ? fid : f;
    const dflt = isGenericRebels(f) ? 600 : 200;
    const core = valOf(from, to, "core", dflt);
    const rel = valOf(from, to, "rel", dflt);
    const agg = valOf(from, to, "agg", 200);
    const oppCore = valOf(to, from, "core", dflt);
    return {
      id: f, name: lab(f), core, rel, agg, oppCore,
      asym: Math.abs(core - oppCore) >= 200,
      edited: stagedDir("core", from, to) != null || stagedDir("rel", from, to) != null || stagedDir("agg", from, to) != null,
      sortBy: core,
    };
  };

  const rows = useMemo(() => {
    if (!data || !Array.isArray(data.factions)) return [];
    return data.factions
      .filter((f) => f !== fid && !isSubRebel(f) && f !== "dummies")
      .map(makeRow)
      .sort((a, b) => (a.sortBy - b.sortBy) || a.name.localeCompare(b.name));
  }, [data, fid, pendingDiplo, reverse]); // eslint-disable-line

  // Factions that own the regions in THIS faction's victory conditions, ordered
  // by how close their nearest such region is to our borders (min centroid
  // distance from any region we currently own). Lets the player triage diplomacy
  // by proximity. Excludes ourselves and rebels (no meaningful diplomacy there).
  const vcTargets = useMemo(() => {
    if (!regions || !regionCentroids || !victoryConditions) return [];
    const my = victoryConditions[fid];
    if (!my || !my.hold_regions || !my.hold_regions.length) return [];
    const cityKey = {}, regionKey = {}, myPts = [];
    for (const [k, r] of Object.entries(regions)) {
      if (r.city) cityKey[String(r.city).toLowerCase()] = k;
      if (r.region) regionKey[String(r.region).toLowerCase()] = k;
      if (String(r.faction || "").toLowerCase() === fid) { const c = regionCentroids[k]; if (c) myPts.push(c); }
    }
    const dmin = (c) => (myPts.length ? Math.min(...myPts.map((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2)) : 0);
    const byOwner = new Map();
    for (const nm of my.hold_regions) {
      const key = cityKey[String(nm).toLowerCase()] || regionKey[String(nm).toLowerCase()];
      if (!key) continue;
      const r = regions[key];
      const owner = String(r.faction || "").toLowerCase();
      if (!owner || owner === fid || isGenericRebels(owner) || isSubRebel(owner)) continue;
      const c = regionCentroids[key];
      const d = c ? dmin(c) : Infinity;
      let e = byOwner.get(owner);
      if (!e) { e = { id: owner, regions: [], dist: Infinity }; byOwner.set(owner, e); }
      e.regions.push({ region: r.region, city: r.city, dist: d });
      if (d < e.dist) e.dist = d;
    }
    return [...byOwner.values()]
      .map((e) => { e.regions.sort((a, b) => a.dist - b.dist); e.name = lab(e.id); return e; })
      .sort((a, b) => a.dist - b.dist);
  }, [regions, regionCentroids, victoryConditions, fid]); // eslint-disable-line

  // Distance-tier presets. Split divides vcTargets into thirds: closest →
  // Warring, middle → Hostile, farthest → Neutral. Sets core (always), aggr (if
  // linked) and rel (if linked). Not forced — every value stays editable after.
  const TIERS = {
    war: { bg: "rgba(200,70,70,0.16)", bar: "#d05858", label: "Warring", value: 600, rel: 1000 },
    hostile: { bg: "rgba(210,165,70,0.14)", bar: "#d6a93c", label: "Hostile", value: 400, rel: 200 },
    neutral: { bg: "rgba(90,170,100,0.13)", bar: "#5aaa64", label: "Neutral", value: 200, rel: 200 },
  };
  const tierOf = (i, n) => { const t = Math.ceil(n / 3); return i < t ? "war" : i < 2 * t ? "hostile" : "neutral"; };
  const applySplit = () => {
    const n = vcTargets.length;
    vcTargets.forEach((t, i) => {
      const tier = TIERS[tierOf(i, n)];
      onStageEdit("core", fid, t.id, tier.value, t.name);
      if (linkAgg) onStageEdit("agg", fid, t.id, tier.value, t.name);
      if (linkRel) onStageEdit("rel", fid, t.id, tier.rel, t.name);
    });
  };
  // Flat preset: every VC-target owner → Neutral core_attitudes (200) + Warring
  // faction_agression (600), one-way (you → target). Relationship (the actual
  // war/ally STATE) is deliberately left untouched — that's a per-faction modder
  // decision, not derivable from victory conditions.
  const applyFlat = () => {
    vcTargets.forEach((t) => {
      onStageEdit("core", fid, t.id, 200, t.name);
      onStageEdit("agg", fid, t.id, 600, t.name);
    });
  };

  const filtered = q.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.id.includes(q.toLowerCase()))
    : rows;

  // Apply an edit, honouring perspective (reverse) and the bidirectional toggle.
  const applyEdit = (kind, f, value, fName) => {
    const from = reverse ? f : fid, to = reverse ? fid : f;
    onStageEdit(kind, from, to, value, reverse ? lab(fid) : fName);
    if (bidi) onStageEdit(kind, to, from, value, reverse ? fName : lab(fid));
  };
  const inp = { width: 52, background: "#1b1e25", color: "#ddd", border: "1px solid #3a3f4a", borderRadius: 4, padding: "2px 4px", fontSize: "0.7rem", fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const cell = (kind, r, val, labeller, colorFn) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4, width: 132 }}>
      <NumberCell value={val} style={{ ...inp, color: colorFn(val) }} title={`${labeller(val)} (${kind})`}
        onCommit={(n) => applyEdit(kind, r.id, n, r.name)} />
      <span style={{ fontSize: "0.58rem", color: colorFn(val), width: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labeller(val)}</span>
    </div>
  );
  // Faction name + edited marker + one-sided (asymmetry) hint.
  const nameSpan = (r, extra) => (
    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.edited ? "#fd8" : "#ddd", fontSize: "0.72rem" }}>
      {r.name}{r.edited ? " *" : ""}
      {extra}
      {r.asym && (
        <span title={`One-sided: the ${reverse ? "forward" : "reverse"} direction is ${CORE_LABEL(r.oppCore)} (${r.oppCore})`}
          style={{ marginLeft: 6, fontSize: "0.55rem", color: "#d6a93c", cursor: "help" }}>⇄ {CORE_LABEL(r.oppCore)}</span>
      )}
    </span>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#15171c", border: "1px solid #3a3f4a", borderRadius: 8, padding: 14, width: "min(760px, 95vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", color: "#ddd", boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div className="panel-heading" style={{ fontWeight: 700, fontSize: "1rem", color: "#fd8" }}>
            Diplomacy — {reverse ? <>others → {lab(fid)} <span style={{ fontSize: "0.62rem", color: "#d6a93c", fontWeight: 600 }}>(how they see you)</span></> : <>{lab(fid)} → others</>}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1rem", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ color: "#8a93a8", fontSize: "0.6rem", marginBottom: 6, lineHeight: 1.45 }}>
          The three descr_strat diplomacy values the engine uses. Edits write to descr_strat on Save.<br />
          <b style={{ color: "#bcd6f0" }}>Core</b> = AI disposition (−10 ally · 200 neutral · 400 hostile · 600 warring · 850 total war). <b style={{ color: "#bcd6f0" }}>Rel</b> = actual STARTING STATE (≤199 ally · 200 neutral · ≥201 war). <b style={{ color: "#bcd6f0" }}>Aggr</b> = post-turn-1 aggression (−200 friendly … 700 hostile). <span style={{ color: "#d6a93c" }}>⇄ marks one-sided pairs.</span>
        </div>
        {err && <div style={{ background: "#3a1c1c", border: "1px solid #6a3030", color: "#e8a0a0", padding: 8, borderRadius: 4 }}>{err}</div>}
        {!data && !err && <div style={{ color: "#888" }}>Loading diplomacy…</div>}
        {data && vcTargets.length > 0 && (
          <div style={{ marginBottom: 8, border: "1px solid #2c3340", borderRadius: 6, background: "#12141a", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: "0.72rem", color: "#fd8" }}>
                ⚔ Victory targets by proximity <span style={{ color: "#8a93a8", fontWeight: 400 }}>({vcTargets.length})</span>
              </div>
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: "0.6rem", cursor: "pointer", color: linkAgg ? "#bcd6f0" : "#8a93a8" }}
                title="When on, the split sets Aggr to the same value as Core. Aggr is the trend a relationship drifts toward, so you may want it separate.">
                <input type="checkbox" checked={linkAgg} onChange={(e) => setLinkAgg(e.target.checked)} />
                {linkAgg ? "⚭ Aggr" : "⚯ Aggr"}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.6rem", cursor: "pointer", color: linkRel ? "#bcd6f0" : "#8a93a8" }}
                title="When on, the split also sets Rel (the actual starting state): the closest (warring) third starts AT WAR, the rest stay neutral.">
                <input type="checkbox" checked={linkRel} onChange={(e) => setLinkRel(e.target.checked)} />
                {linkRel ? "⚭ Rel" : "⚯ Rel"}
              </label>
              <button onClick={applyFlat} disabled={reverse}
                title={reverse ? "Switch back to the forward view to apply (it sets YOUR stance)." : "Every victory-target owner → Neutral attitude (200) + Warring aggression (600), one-way. Leaves the war/ally relationship state alone for you to set. Nothing is locked — tweak any value afterward."}
                style={{ padding: "2px 8px", fontSize: "0.64rem", fontWeight: 700, background: reverse ? "rgba(80,80,80,0.3)" : "rgba(200,120,90,0.18)", color: reverse ? "#777" : "#e0b89c", border: "1px solid " + (reverse ? "#444" : "rgba(200,120,90,0.6)"), borderRadius: 4, cursor: reverse ? "default" : "pointer" }}>
                All Warring (600)
              </button>
              <button onClick={applySplit} disabled={reverse}
                title={reverse ? "Switch back to the forward view to apply the split (it sets YOUR stance)." : "Closest third → Warring (600), middle → Hostile (400), farthest → Neutral (200). Includes Aggr/Rel per the toggles. Nothing is locked — tweak any value afterward."}
                style={{ padding: "2px 8px", fontSize: "0.64rem", fontWeight: 700, background: reverse ? "rgba(80,80,80,0.3)" : "rgba(92,140,200,0.18)", color: reverse ? "#777" : "#bcd6f0", border: "1px solid " + (reverse ? "#444" : "rgba(92,140,200,0.6)"), borderRadius: 4, cursor: reverse ? "default" : "pointer" }}>
                Split 33 / 33 / 33
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, padding: "3px 8px", fontSize: "0.56rem" }}>
              <span style={{ color: TIERS.war.bar }}>■ closest → Warring 600</span>
              <span style={{ color: TIERS.hostile.bar }}>■ mid → Hostile 400</span>
              <span style={{ color: TIERS.neutral.bar }}>■ far → Neutral 200</span>
              <span style={{ marginLeft: "auto", color: "#677" }}>nearest-first; colours preview the split</span>
            </div>
            <div style={{ maxHeight: "26vh", overflowY: "auto" }}>
              {vcTargets.map((t, i) => {
                const tier = TIERS[tierOf(i, vcTargets.length)];
                const r = makeRow(t.id);
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px 2px 5px", borderLeft: `3px solid ${tier.bar}`, background: tier.bg, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {nameSpan(r, <span style={{ color: "#7a8392", fontSize: "0.56rem", marginLeft: 5 }}>{t.regions[0]?.city}{t.regions.length > 1 ? ` +${t.regions.length - 1}` : ""}</span>)}
                    {cell("core", r, r.core, CORE_LABEL, COLOR)}
                    {cell("rel", r, r.rel, REL_LABEL, REL_COLOR)}
                    {cell("agg", r, r.agg, AGG_LABEL, COLOR)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {data && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.68rem", cursor: "pointer", color: bidi ? "#bcd6f0" : "#9aa", fontWeight: bidi ? 700 : 400 }}>
                <input type="checkbox" checked={bidi} onChange={(e) => setBidi(e.target.checked)} />
                ⇄ Bidirectional <span style={{ color: "#677", fontWeight: 400 }}>(also set the reverse · Ctrl+B)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.68rem", cursor: "pointer", color: reverse ? "#d6a93c" : "#9aa", fontWeight: reverse ? 700 : 400 }}>
                <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
                🔄 How others see {lab(fid)}
              </label>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${rows.length} factions…`}
              style={{ marginBottom: 6, padding: "4px 8px", background: "#1b1e25", color: "#ddd", border: "1px solid #3a3f4a", borderRadius: 4, fontSize: "0.74rem" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 3px", fontSize: "0.58rem", color: "#8a93a8", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
              <span style={{ flex: 1 }}>{reverse ? `Faction → ${lab(fid)}` : "Faction"}</span>
              <span style={{ width: 132 }}>Core (attitude)</span>
              <span style={{ width: 132 }}>Rel (state)</span>
              <span style={{ width: 132 }}>Aggr</span>
            </div>
            <div style={{ overflowY: "auto", flex: 1, fontSize: "0.72rem" }}>
              {filtered.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {nameSpan(r)}
                  {cell("core", r, r.core, CORE_LABEL, COLOR)}
                  {cell("rel", r, r.rel, REL_LABEL, REL_COLOR)}
                  {cell("agg", r, r.agg, AGG_LABEL, COLOR)}
                </div>
              ))}
              {filtered.length === 0 && <div style={{ color: "#888", padding: 8 }}>No factions match “{q}”.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
