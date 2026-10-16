// src/panels/SettlementComparePane.js
//
// The Settlements tab of ☥ Bring In a Faction: a town on this map beside the
// same town in the main mod, and a tick per difference to copy across.
// (2026-10-16)
//
// Built for filling thin submod towns — RIS_Classic's Rome starts as a
// 400-pop town with two buildings, the main mod's as a 12,500-pop large city
// with fifteen. "Fill in what is missing" ticks every building chain the town
// lacks or has at a lower level, and the level and population when the main
// mod's are bigger; "Match the main mod" also takes the smaller values and
// removes chains only this town has. The text work is src/settlementCompare.js.
//
// The settlement level and the core_building are one ladder in RTW, so
// ticking either ticks the other.
//
// Props: modDataDir, campaign, factionDisplayNames, pushToast
import React from "react";

const GOLD = "#e8c873";
const WARN = "#ff9d7a";
const DIM = "#9ab";
const GOOD = "#8fd18f";

const nice = (s) => (s == null ? "—" : String(s).replace(/_/g, " "));
const label = (f, names) => (f === "slave" ? "rebels" : (names && names[f]) || nice(f));

// What "Fill in what is missing" ticks.
function fillChoice(cmp) {
  return {
    fields: new Set(cmp.fields.filter((f) => f.more).map((f) => f.key)),
    buildings: new Set(cmp.buildings.filter((b) => b.status === "missing" || b.status === "higher_there" || (b.there && b.duplicate)).map((b) => b.chain)),
    remove: new Set(),
  };
}
// What "Match the main mod" ticks: every difference, both ways.
function matchChoice(cmp) {
  return {
    fields: new Set(cmp.fields.filter((f) => f.there != null && f.here !== f.there).map((f) => f.key)),
    buildings: new Set(cmp.buildings.filter((b) => b.there && (b.here !== b.there || b.duplicate)).map((b) => b.chain)),
    remove: new Set(cmp.buildings.filter((b) => b.status === "only_here").map((b) => b.chain)),
  };
}

const STATUS = {
  missing: { text: "missing here", color: GOLD },
  higher_there: { text: "bigger in main", color: GOLD },
  lower_there: { text: "smaller in main", color: DIM },
  different: { text: "different", color: DIM },
  only_here: { text: "only here", color: DIM },
  duplicate: { text: "listed twice here", color: WARN },
  same: { text: "same", color: "#5d6873" },
};

export default function SettlementComparePane({ modDataDir, campaign, factionDisplayNames, pushToast }) {
  const api = typeof window !== "undefined" ? window.electronAPI : null;
  const [list, setList] = React.useState(null);     // { target, source, towns } | { error }
  const [query, setQuery] = React.useState("");
  const [onlyThin, setOnlyThin] = React.useState(true);
  const [region, setRegion] = React.useState(null);
  const [cmp, setCmp] = React.useState(null);       // settlement-compare result
  const [pick, setPick] = React.useState(null);     // { fields, buildings, remove } of Sets
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState(null);

  const loadList = React.useCallback(() => {
    if (!api || !api.settlementCompareList) { setList({ error: "this build cannot compare settlements" }); return () => { }; }
    let dead = false;
    api.settlementCompareList(modDataDir, campaign)
      .then((r) => { if (!dead) setList(r || { error: "no answer" }); })
      .catch((e) => { if (!dead) setList({ error: e && e.message ? e.message : String(e) }); });
    return () => { dead = true; };
  }, [api, modDataDir, campaign]);
  React.useEffect(() => loadList(), [loadList]);

  const loadOne = React.useCallback((rg, keepPick) => {
    if (!rg || !api || !api.settlementCompare) return () => { };
    let dead = false;
    if (!keepPick) { setCmp(null); setPick(null); }
    setPreview(null);
    api.settlementCompare(modDataDir, rg, (list && list.target && list.target.campaign) || campaign)
      .then((r) => { if (dead) return; setCmp(r || { error: "no answer" }); if (r && !r.error) setPick(fillChoice(r)); })
      .catch((e) => { if (!dead) setCmp({ error: e && e.message ? e.message : String(e) }); });
    return () => { dead = true; };
  }, [api, modDataDir, campaign, list]);
  React.useEffect(() => loadOne(region), [region]); // eslint-disable-line react-hooks/exhaustive-deps

  // level and core_building travel together when both differ
  const toggle = (kind, key) => setPick((p) => {
    const next = { fields: new Set(p.fields), buildings: new Set(p.buildings), remove: new Set(p.remove) };
    const flip = (set, k, on) => { if (on) set.add(k); else set.delete(k); };
    const on = !next[kind].has(key);
    flip(next[kind], key, on);
    const lvl = cmp.fields.find((f) => f.key === "level"), core = cmp.buildings.find((b) => b.chain === "core_building");
    const lvlDiffers = lvl && lvl.there != null && lvl.here !== lvl.there, coreDiffers = core && core.there && core.here !== core.there;
    if (lvlDiffers && coreDiffers) {
      if (kind === "fields" && key === "level") flip(next.buildings, "core_building", on);
      if (kind === "buildings" && key === "core_building") flip(next.fields, "level", on);
    }
    setPreview(null);
    return next;
  });

  const count = pick ? pick.fields.size + pick.buildings.size + pick.remove.size : 0;
  const choice = pick ? { fields: [...pick.fields], buildings: [...pick.buildings], remove: [...pick.remove] } : null;

  const run = async (dryRun) => {
    if (!api || !api.settlementCompareApply || !cmp || !choice) return;
    setBusy(true);
    try {
      const r = await api.settlementCompareApply(modDataDir, cmp.region, { ...choice, dryRun }, cmp.targetCampaign || campaign);
      if (r && r.error) { pushToast && pushToast(`Could not copy into ${cmp.city}: ${r.error}`, "error", 9000); return; }
      if (dryRun) { setPreview(r); return; }
      pushToast && pushToast(r.unchanged ? `${cmp.city} already matches.` :
        `${cmp.city}: ${r.changes.length} change(s) from ${cmp.sourceCampaign}. ` + (r.exported ? `Exported to ${r.path}.` : "A timestamped backup was saved beside descr_strat. Click 🔄 Reload so the map catches up."), "info", 9000);
      loadList();
      loadOne(cmp.region);
    } catch (e) { pushToast && pushToast(`Could not copy into ${cmp && cmp.city}: ${e && e.message}`, "error", 9000); }
    finally { setBusy(false); }
  };

  if (!list) return <div style={{ padding: "28px 12px", textAlign: "center", color: DIM, fontSize: "0.85rem", flex: 1 }}>Reading both campaigns…</div>;
  if (list.error) return <div style={{ padding: "20px 16px", color: WARN, fontSize: "0.82rem", flex: 1 }}>⚠ {list.error}</div>;

  const gap = (t) => (t.missing || 0) + (t.higher || 0) + (t.fieldsMore ? t.fieldsMore.length : 0);
  const q = query.trim().toLowerCase();
  const towns = list.towns
    .filter((t) => !q || t.city.toLowerCase().includes(q) || t.region.toLowerCase().includes(q))
    .filter((t) => !onlyThin || !t.sourceRegion || gap(t) > 0 || t.region === region)
    .sort((a, b) => (!!b.sourceRegion - !!a.sourceRegion) || (gap(b) - gap(a)) || a.city.localeCompare(b.city));
  const unmatched = list.towns.filter((t) => !t.sourceRegion).length;

  // the settlement level this town will have once the ticked rows are copied
  // (EDB settlement_min names levels: town, large_town, city, …)
  const levelAfter = (() => {
    if (!cmp || !pick || !cmp.levels) return -1;
    const lvl = cmp.fields.find((f) => f.key === "level");
    if (!lvl) return -1;
    return cmp.levels.indexOf(pick.fields.has("level") ? lvl.there : lvl.here);
  })();
  const warningsFor = (b) => {
    const c = cmp.checks[b.chain];
    if (!c || !b.there) return [];
    const out = [];
    if (c.settlementMin && levelAfter >= 0) {
      const need = cmp.levels.indexOf(c.settlementMin);
      if (need > levelAfter) out.push(`needs at least a ${nice(c.settlementMin)} — this town would be a ${nice(cmp.levels[levelAfter])}`);
    }
    if (c.requires && c.requires.kind === "resource") out.push(`the EDB builds it only with hidden resource ${nice(c.requires.what)}, which ${cmp.region} lacks on this map`);
    if (c.requires && c.requires.kind === "faction") out.push(`the EDB does not let ${label(cmp.owner, factionDisplayNames)} build this level`);
    if (c.slotTakenBy) out.push(`shares its slot with ${nice(c.slotTakenBy)}, which this town has — the game allows one`);
    return out;
  };

  const box = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 7 };
  const chk = (on) => ({ display: "inline-block", width: 13, height: 13, borderRadius: 3, verticalAlign: "-2px", border: "1px solid " + (on ? GOOD : "rgba(255,255,255,0.3)"), background: on ? "rgba(143,209,143,0.55)" : "transparent", flex: "0 0 13px" });
  const btn = { background: "transparent", color: GOLD, border: "1px solid rgba(232,200,115,0.45)", borderRadius: 6, padding: "3px 10px", fontSize: "0.76rem", cursor: "pointer" };
  const cell = { padding: "3px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column" }}>
      <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
        {/* towns */}
        <div style={{ width: 300, borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search towns…" aria-label="Search towns"
            style={{ margin: "10px 12px 4px", background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem" }} />
          <label style={{ margin: "0 12px 6px", fontSize: "0.72rem", color: DIM, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={onlyThin} onChange={(e) => setOnlyThin(e.target.checked)} aria-label="Only towns with something to fill" />
            only towns with something to fill
          </label>
          <div style={{ overflowY: "auto", padding: "0 8px 10px" }}>
            {!towns.length && <div style={{ padding: 14, color: DIM, fontSize: "0.8rem" }}>No town matches.</div>}
            {towns.map((t) => (
              <div key={t.region} data-compare-town={t.region} onClick={() => t.sourceRegion && setRegion(t.region)}
                style={{ padding: "5px 8px", margin: "2px 0", borderRadius: 6, cursor: t.sourceRegion ? "pointer" : "default", opacity: t.sourceRegion ? 1 : 0.5, background: region === t.region ? "rgba(232,200,115,0.16)" : "transparent", border: "1px solid " + (region === t.region ? "rgba(232,200,115,0.45)" : "transparent") }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontSize: "0.83rem", color: "#e6e6e6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nice(t.city)}</span>
                  {t.sourceRegion && gap(t) > 0 && <span style={{ fontSize: "0.7rem", color: GOLD, whiteSpace: "nowrap" }}>+{gap(t)}</span>}
                </div>
                <div style={{ fontSize: "0.7rem", color: DIM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.sourceRegion
                    ? `${nice(t.level)} ${t.population ?? "?"} · ${t.buildings}b   ←   ${nice(t.sourceLevel)} ${t.sourcePopulation ?? "?"} · ${t.sourceBuildings}b`
                    : `not in ${list.source.campaign}`}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "6px 12px", fontSize: "0.7rem", color: DIM, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {list.towns.length - unmatched} of {list.towns.length} towns found in {list.source.campaign}, by region or settlement name
          </div>
        </div>

        {/* one town */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", minWidth: 0 }}>
          {!region && <div style={{ padding: "40px 12px", textAlign: "center", color: DIM, fontSize: "0.85rem" }}>Pick a town on the left.<br /><span style={{ fontSize: "0.76rem" }}>It is shown beside the same town in {list.source.campaign}; tick what to copy over.</span></div>}
          {region && !cmp && <div style={{ padding: "30px 12px", textAlign: "center", color: DIM, fontSize: "0.84rem" }}>Comparing…</div>}
          {cmp && cmp.error && <div style={{ padding: "16px 4px", color: WARN, fontSize: "0.82rem" }}>⚠ {cmp.error}</div>}
          {cmp && !cmp.error && pick && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: "1rem", color: GOLD }}>{nice(cmp.city)}</span>
                <span style={{ fontSize: "0.74rem", color: DIM }}>
                  {cmp.region} on {cmp.targetCampaign} ({label(cmp.owner, factionDisplayNames)})  ↔  {cmp.sourceRegion}{cmp.sourceCity !== cmp.city ? ` (${nice(cmp.sourceCity)})` : ""} on {cmp.sourceCampaign} ({label(cmp.sourceOwner, factionDisplayNames)})
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <button style={btn} onClick={() => { setPick(fillChoice(cmp)); setPreview(null); }} title="Every chain this town lacks or has smaller, and a bigger level / population">Fill in what is missing</button>
                <button style={btn} onClick={() => { setPick(matchChoice(cmp)); setPreview(null); }} title="Every difference, both ways — this town ends up as the main mod has it">Match the main mod</button>
                <button style={{ ...btn, color: DIM, borderColor: "rgba(255,255,255,0.2)" }} onClick={() => { setPick({ fields: new Set(), buildings: new Set(), remove: new Set() }); setPreview(null); }}>Clear</button>
              </div>

              <table style={{ ...box, width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", tableLayout: "fixed", marginBottom: 10 }}>
                <colgroup><col style={{ width: 26 }} /><col style={{ width: "28%" }} /><col /><col /></colgroup>
                <thead><tr style={{ color: DIM, fontSize: "0.72rem", textAlign: "left" }}><th /><th style={cell}>Settlement</th><th style={cell}>{cmp.targetCampaign}</th><th style={cell}>{cmp.sourceCampaign}</th></tr></thead>
                <tbody>
                  {cmp.fields.map((f) => {
                    const differs = f.there != null && f.here !== f.there, on = pick.fields.has(f.key);
                    return (
                      <tr key={f.key} data-field={f.key} onClick={differs ? () => toggle("fields", f.key) : undefined} style={{ cursor: differs ? "pointer" : "default", background: on ? "rgba(143,209,143,0.08)" : "transparent", color: differs ? "#e6e6e6" : "#6d7883" }}>
                        <td style={{ padding: "3px 0 3px 8px" }}>{differs && <span style={chk(on)} />}</td>
                        <td style={cell}>{nice(f.key)}</td>
                        <td style={cell}>{nice(f.here)}</td>
                        <td style={{ ...cell, color: differs ? (f.more ? GOLD : DIM) : undefined }}>{nice(f.there)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <table style={{ ...box, width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", tableLayout: "fixed" }}>
                <colgroup><col style={{ width: 26 }} /><col style={{ width: "28%" }} /><col /><col /><col style={{ width: 110 }} /></colgroup>
                <thead><tr style={{ color: DIM, fontSize: "0.72rem", textAlign: "left" }}><th /><th style={cell}>Building</th><th style={cell}>{cmp.targetCampaign}</th><th style={cell}>{cmp.sourceCampaign}</th><th style={cell} /></tr></thead>
                <tbody>
                  {cmp.buildings.map((b) => {
                    const st = STATUS[b.status] || STATUS.different;
                    const isRemove = b.status === "only_here";
                    const can = b.status !== "same";
                    const on = isRemove ? pick.remove.has(b.chain) : pick.buildings.has(b.chain);
                    const warns = on && !isRemove ? warningsFor(b) : [];
                    return (
                      <React.Fragment key={b.chain}>
                        <tr data-building={b.chain} onClick={can ? () => toggle(isRemove ? "remove" : "buildings", b.chain) : undefined}
                          style={{ cursor: can ? "pointer" : "default", background: on ? (isRemove ? "rgba(255,157,122,0.08)" : "rgba(143,209,143,0.08)") : "transparent", color: can ? "#e6e6e6" : "#6d7883" }}>
                          <td style={{ padding: "3px 0 3px 8px" }}>{can && <span style={isRemove && on ? { ...chk(true), borderColor: WARN, background: "rgba(255,157,122,0.55)" } : chk(on)} />}</td>
                          <td style={cell} title={b.chain}>{nice(b.chain)}</td>
                          <td style={{ ...cell, textDecoration: isRemove && on ? "line-through" : "none" }}>{nice(b.here)}</td>
                          <td style={{ ...cell, color: can && !isRemove ? st.color : undefined }}>{nice(b.there)}</td>
                          <td style={{ ...cell, color: isRemove && on ? WARN : st.color, fontSize: "0.7rem" }}>{isRemove && on ? "remove" : b.duplicate && b.status !== "duplicate" ? st.text + ", listed twice" : st.text}</td>
                        </tr>
                        {warns.map((w, i) => (
                          <tr key={i}><td /><td colSpan={4} style={{ padding: "0 8px 3px", color: WARN, fontSize: "0.7rem", whiteSpace: "normal" }}>⚠ {w}</td></tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: "0.71rem", color: DIM, marginTop: 6, lineHeight: 1.5 }}>
                Buildings keep their place in the town; a new one is added after the last, as the main mod writes it. Commented-out (;GOVPO) buildings are left alone. Ticking the level ticks the core building too.
              </div>

              {preview && (
                <div style={{ ...box, marginTop: 10, padding: "8px 12px", fontSize: "0.78rem" }}>
                  <div style={{ color: GOLD, marginBottom: 3 }}>What will change in {nice(cmp.city)}</div>
                  {preview.unchanged ? <div>Nothing — it already matches.</div> : preview.changes.map((c, i) => <div key={i}>{nice(c)}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ fontSize: "0.74rem", color: DIM, flex: 1 }}>
          {cmp && !cmp.error && pick ? `${count} change(s) ticked for ${nice(cmp.city)}` : "Writes this campaign's descr_strat; a timestamped backup is saved beside it first."}
        </span>
        <button onClick={() => run(true)} disabled={!cmp || cmp.error || busy || !count}
          style={{ ...btn, padding: "4px 14px", fontSize: "0.8rem", opacity: cmp && !cmp.error && !busy && count ? 1 : 0.5, cursor: cmp && count && !busy ? "pointer" : "default" }}>Preview</button>
        <button onClick={() => run(false)} disabled={!cmp || cmp.error || busy || !count}
          style={{ background: "rgba(143,180,110,0.25)", color: "#b8d38f", border: "1px solid #7a9a5a", borderRadius: 6, padding: "4px 16px", fontSize: "0.8rem", opacity: cmp && !cmp.error && !busy && count ? 1 : 0.5, cursor: cmp && count && !busy ? "pointer" : "default" }}>
          {busy ? "Writing…" : "Copy into this town"}
        </button>
      </div>
    </div>
  );
}
