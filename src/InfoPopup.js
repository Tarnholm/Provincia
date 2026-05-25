// src/InfoPopup.js
//
// Right-click popup showing the large RTW info tga for a unit or a
// building. Units have dedicated `unit_info/<faction>/<unit>_info.tga`
// panels (~320×512). Buildings reuse the `_constructed` banner (~361×163).
//
// Stats (soldier count, armour, attack, etc.) are TODO — this first pass
// just blows up the image so players can read what the game actually shows
// in-game without having to alt-tab.

"use strict";

import { Fragment, useEffect, useMemo, useState } from "react";
import TGA from "./tga.js";

// 0.9.418: Generic TGA-decoded icon cache for traits + ancillaries.
// Same pattern as portraitIcons.js but inline because the modal needs
// these only when open. Key includes the IPC method name so trait + anc
// caches don't collide.
const iconCache = new Map();
function loadIconUrl(ipcMethod, ...args) {
  const fn = window.electronAPI?.[ipcMethod];
  if (!fn) return Promise.resolve(null);
  const lastArg = args[args.length - 1];
  if (!lastArg) return Promise.resolve(null);
  const key = `${ipcMethod}|${args.join("|")}`;
  if (iconCache.has(key)) return Promise.resolve(iconCache.get(key));
  const p = fn(...args).then((res) => {
    if (!res || !res.ok || !res.buffer) { iconCache.set(key, null); return null; }
    try {
      const tga = new TGA(new Uint8Array(res.buffer));
      if (!tga.width || !tga.height || !tga.pixels) { iconCache.set(key, null); return null; }
      const canvas = document.createElement("canvas");
      canvas.width = tga.width; canvas.height = tga.height;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(tga.width, tga.height);
      img.data.set(new Uint8ClampedArray(tga.pixels));
      ctx.putImageData(img, 0, 0);
      return new Promise((resolve) => {
        canvas.toBlob((b) => {
          const url = b ? URL.createObjectURL(b) : null;
          iconCache.set(key, url);
          resolve(url);
        }, "image/png");
      });
    } catch {
      iconCache.set(key, null);
      return null;
    }
  }).catch(() => { iconCache.set(key, null); return null; });
  iconCache.set(key, p);
  return p;
}

const humanizeName = (s) => String(s || "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  .replace(/_/g, " ").replace(/\s+/g, " ").trim();

// Render a single trait row with effects + description. RTW Remastered
// doesn't ship per-trait icon files (they're baked into a UI atlas), so
// the icon slot is omitted unless a mod adds files under the legacy
// `data/ui/<culture>/vnvs/<level_name>.tga` path.
function TraitRow({ trait, modDataDir, culture, levelData }) {
  const lvlData = Array.isArray(levelData) ? levelData[trait.level - 1] || levelData[levelData.length - 1] : null;
  const levelName = lvlData?.levelName || trait.name;
  const [iconUrl, setIconUrl] = useState(null);
  useEffect(() => {
    if (!levelName) return;
    let alive = true;
    loadIconUrl("resolveTraitIcon", modDataDir, culture || "", levelName).then((u) => { if (alive) setIconUrl(u); });
    return () => { alive = false; };
  }, [modDataDir, culture, levelName]);
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: iconUrl ? "40px 1fr" : "1fr",
      columnGap: 10,
      rowGap: 2,
      alignItems: "start",
      padding: "6px 0",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      {iconUrl && (
        <div style={{
          width: 40, height: 40, borderRadius: 4,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(220,166,74,0.25)",
          overflow: "hidden",
        }}>
          <img src={iconUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
      )}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span style={{ color: "#eee", fontWeight: 600 }}>{humanizeName(levelName)}</span>
          <span style={{ color: "#dca64a", fontVariantNumeric: "tabular-nums", fontSize: "0.72rem" }}>
            level {trait.level}{lvlData?.threshold != null ? ` · thr ${lvlData.threshold}` : ""}
          </span>
        </div>
        {lvlData?.effectsDesc && (
          <div style={{ color: "#b8c8d8", fontSize: "0.72rem", marginTop: 1 }}>{lvlData.effectsDesc}</div>
        )}
        {Array.isArray(lvlData?.effects) && lvlData.effects.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {lvlData.effects.map((e, i) => {
              const sign = e.value > 0 ? "+" : "";
              const color = e.value > 0 ? "#7fdc8a" : e.value < 0 ? "#dc7f7f" : "#aaa";
              return (
                <span key={i} style={{
                  fontSize: "0.65rem", color,
                  background: "rgba(0,0,0,0.35)", padding: "1px 5px", borderRadius: 3,
                  border: `1px solid ${color}33`,
                }}>{sign}{e.value} {humanizeName(e.name)}</span>
              );
            })}
          </div>
        )}
        {lvlData?.desc && (
          <div style={{ color: "#bbb", fontSize: "0.7rem", marginTop: 2, fontStyle: "italic", lineHeight: 1.3 }}>
            {lvlData.desc}
          </div>
        )}
      </div>
    </div>
  );
}

// 0.9.434: dev-mode trait editor. Wraps the traits block with controls
// to add / remove / level-up traits, persisting to descr_strat via the
// `update-character-traits` IPC. Non-dev users see the regular read-only
// view (TraitRow per item).
function TraitsSection({ traits: initialTraits, allTraits, character, modDataDir, traitData, devMode, onStageTraits }) {
  // Local copy so edits feel snappy. Sync to backend on each change.
  const [traits, setTraits] = useState(initialTraits);
  const [savingMsg, setSavingMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  useEffect(() => { setTraits(initialTraits); }, [initialTraits]);

  // 0.9.467: trait edits stage to the App.js pending registry; the
  // descr_strat IPC fires only when the user clicks Apply in the review
  // modal. Local state still updates so the UI reflects the change.
  const save = (newTraits, descriptionFragment) => {
    setTraits(newTraits);
    if (!devMode) return;
    if (typeof onStageTraits !== "function") return;
    onStageTraits(
      character.firstName || "",
      character.faction || "",
      newTraits.map((t) => ({ name: t.name, level: t.level })),
      descriptionFragment,
    );
    setSavingMsg("Staged — review in toolbar");
    setTimeout(() => setSavingMsg(null), 2000);
  };
  const onLevelDelta = (idx, delta) => {
    const next = traits.slice();
    const cur = next[idx];
    const lvls = traitData?.levels?.[cur.name];
    const maxLvl = Array.isArray(lvls) ? lvls.length : 10;
    const nl = Math.max(1, Math.min(maxLvl, cur.level + delta));
    if (nl === cur.level) return;
    next[idx] = { ...cur, level: nl };
    save(next, `${character.firstName}: ${cur.name} level ${cur.level} → ${nl}`);
  };
  const onRemove = (idx) => {
    const cur = traits[idx];
    save(traits.filter((_, i) => i !== idx), `${character.firstName}: remove trait ${cur?.name || ""}`);
  };
  const onAdd = (name) => {
    if (traits.some((t) => t.name === name)) return;
    save([...traits, { name, level: 1 }], `${character.firstName}: add trait ${name} (level 1)`);
    setShowAdd(false);
    setAddQuery("");
  };

  const traitOptions = useMemo(() => {
    if (!showAdd) return [];
    const all = traitData?.levels ? Object.keys(traitData.levels) : [];
    const q = addQuery.toLowerCase();
    const owned = new Set(traits.map((t) => t.name));
    // 0.9.437: filter by engine constraints so the picker only offers
    // traits the engine would actually accept on this character:
    //   - Characters: each trait declares which agent-types may carry
    //     it (family / admiral / spy / assassin / diplomat / all). The
    //     character's descr_strat subtype maps to one of these.
    //   - ExcludeCultures: traits forbidden on the character's culture.
    //   - Hidden: filtered out unless devMode (devs see everything).
    const charactersMap = traitData?.characters || {};
    const excludeMap = traitData?.excludeCultures || {};
    const hiddenMap = traitData?.hidden || {};
    // Derive the character's agent type from descr_strat's 2nd field.
    // "named character" / "general" / "family" → "family" (also matches
    // "all"). Spies / diplomats / assassins / admirals stay as-is.
    const sub = String(character?.charSubType || "named character").toLowerCase();
    const agentType = (() => {
      if (sub.includes("admiral")) return "admiral";
      if (sub.includes("spy")) return "spy";
      if (sub.includes("assassin")) return "assassin";
      if (sub.includes("diplomat")) return "diplomat";
      // family / general / named character / leader / heir all qualify
      // as family-type for traits engine.
      return "family";
    })();
    const charCulture = String(character?.culture || "").toLowerCase();
    const matchesAgent = (chains) => {
      if (!Array.isArray(chains) || chains.length === 0) return true; // unspecified = all
      return chains.includes(agentType) || chains.includes("all");
    };
    const matchesCulture = (excludes) => {
      if (!Array.isArray(excludes) || excludes.length === 0) return true;
      if (!charCulture) return true;
      return !excludes.includes(charCulture);
    };
    // Cap at 250 visible — RIS has ~3900 traits, the prior 60-cap hid 98%
    // of options. 250 with search-on-type covers any realistic browsing.
    return all
      .filter((n) => !owned.has(n))
      .filter((n) => devMode || !hiddenMap[n])
      .filter((n) => matchesAgent(charactersMap[n]))
      .filter((n) => matchesCulture(excludeMap[n]))
      .filter((n) => q === "" || n.toLowerCase().includes(q))
      .sort()
      .slice(0, 250);
  }, [showAdd, addQuery, traitData, traits, character, devMode]);

  return (
    <div style={{
      marginTop: 4, padding: "8px 10px",
      background: "rgba(0,0,0,0.3)", borderRadius: 6,
      fontSize: "0.78rem", color: "#ddd",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ color: "#9ab" }}>Traits ({traits.length}){devMode ? " — dev edit" : ""}</span>
        {savingMsg && <span style={{ color: "#dca64a", fontSize: "0.66rem" }}>{savingMsg}</span>}
      </div>
      {traits.map((t, i) => {
        // 0.9.435: only show the level buttons that actually move the
        // trait — + when below max, − when above 1. Single-level traits
        // get neither button. Avoids dead-click UI noise.
        const lvls = traitData?.levels?.[t.name];
        const maxLvl = Array.isArray(lvls) && lvls.length > 0 ? lvls.length : 10;
        const canUp = t.level < maxLvl;
        const canDown = t.level > 1;
        return (
          <div key={i} style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TraitRow trait={t} modDataDir={modDataDir} culture={character.culture || character.faction || null} levelData={traitData?.levels?.[t.name] || null} />
            </div>
            {devMode && (
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "2px 0" }}>
                {canUp && <button onClick={() => onLevelDelta(i, +1)} title={`Level up (max ${maxLvl})`} style={editBtnStyle}>+</button>}
                {canDown && <button onClick={() => onLevelDelta(i, -1)} title="Level down" style={editBtnStyle}>−</button>}
                <button onClick={() => onRemove(i)} title="Remove trait" style={{ ...editBtnStyle, color: "#dc7f7f" }}>×</button>
              </div>
            )}
          </div>
        );
      })}
      {devMode && (
        <div style={{ marginTop: 6 }}>
          {!showAdd ? (
            <button onClick={() => setShowAdd(true)} style={{ ...editBtnStyle, padding: "2px 8px", color: "#7fdc8a" }}>+ Add trait</button>
          ) : (
            <div>
              <input
                autoFocus
                placeholder="search trait name…"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(0,0,0,0.4)", color: "#eee",
                  border: "1px solid rgba(220,166,74,0.3)", borderRadius: 3,
                  padding: "3px 6px", fontSize: "0.72rem",
                }} />
              <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {traitOptions.map((n) => (
                  <button key={n} onClick={() => onAdd(n)} style={{
                    textAlign: "left", padding: "2px 5px",
                    background: "rgba(255,255,255,0.05)", color: "#eee",
                    border: "1px solid transparent", borderRadius: 2,
                    fontSize: "0.7rem", cursor: "pointer",
                  }}>{n}</button>
                ))}
                {traitOptions.length === 0 && <span style={{ color: "#888", fontSize: "0.7rem" }}>(no matches)</span>}
              </div>
              <button onClick={() => { setShowAdd(false); setAddQuery(""); }} style={{ ...editBtnStyle, marginTop: 4 }}>cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const editBtnStyle = {
  background: "rgba(220,166,74,0.18)",
  color: "#eee",
  border: "1px solid rgba(220,166,74,0.4)",
  borderRadius: 3,
  padding: "1px 6px",
  fontSize: "0.7rem",
  cursor: "pointer",
  fontWeight: 700,
  lineHeight: 1,
};

// 0.9.420: Ancillary row with icon, effects, and description. Three
// upgrades over 0.9.418:
//   1. The IPC needs the IMAGE filename (e.g. "philosopher2"), not the
//      ancillary's internal name (e.g. "poet"). The mapping lives in
//      export_descr_ancillaries.txt as `Image philosopher2.tga` on each
//      Ancillary block. Read via `ancillaryData[name].image`.
//   2. Effects (`Effect Influence 1` etc.) are now rendered as colored
//      badges, same shape as TraitRow.
//   3. Description text from export_vnvs.txt rendered below.
//
// Ancillary inputs come in two shapes depending on source:
//   - descr_strat (FamilyTree path): raw string, e.g. "poet"
//   - save v1 parser (live RegionInfo path): { id, name }
function AncillaryRow({ ancillary, modDataDir, ancillaryData }) {
  const name = typeof ancillary === "string"
    ? ancillary
    : (ancillary?.name || (ancillary?.id != null ? `#${ancillary.id}` : ""));
  const data = ancillaryData?.[name] || null;
  // Image filename — fall back to the ancillary's own name if the descr file
  // didn't list an Image (rare).
  const imageName = data?.image || name;
  const [iconUrl, setIconUrl] = useState(null);
  useEffect(() => {
    if (!imageName) return;
    let alive = true;
    loadIconUrl("resolveAncillaryIcon", modDataDir, imageName).then((u) => { if (alive) setIconUrl(u); });
    return () => { alive = false; };
  }, [modDataDir, imageName]);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "40px 1fr",
      columnGap: 10, rowGap: 2, alignItems: "start",
      padding: "6px 0",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 4,
        background: "rgba(0,0,0,0.4)",
        border: "1px solid rgba(220,166,74,0.25)",
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {iconUrl
          ? <img src={iconUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          : <span style={{ color: "#666", fontSize: "0.55rem" }}>?</span>}
      </div>
      <div>
        <div style={{ color: "#eee", fontWeight: 600 }}>{humanizeName(name)}</div>
        {data?.effectsDesc && (
          <div style={{ color: "#b8c8d8", fontSize: "0.72rem", marginTop: 1 }}>{data.effectsDesc}</div>
        )}
        {Array.isArray(data?.effects) && data.effects.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {data.effects.map((e, i) => {
              const sign = e.value > 0 ? "+" : "";
              const color = e.value > 0 ? "#7fdc8a" : e.value < 0 ? "#dc7f7f" : "#aaa";
              return (
                <span key={i} style={{
                  fontSize: "0.65rem", color,
                  background: "rgba(0,0,0,0.35)", padding: "1px 5px", borderRadius: 3,
                  border: `1px solid ${color}33`,
                }}>{sign}{e.value} {humanizeName(e.name)}</span>
              );
            })}
          </div>
        )}
        {data?.desc && (
          <div style={{ color: "#bbb", fontSize: "0.7rem", marginTop: 2, fontStyle: "italic", lineHeight: 1.3 }}>
            {data.desc}
          </div>
        )}
      </div>
    </div>
  );
}

// 0.9.437: dev-mode ancillary editor. Mirrors TraitsSection — adds × per
// row to remove an ancillary, plus an `+ Add ancillary` picker that lists
// every ancillary in the mod's `export_descr_ancillaries.txt` (minus the
// ones the character already has) filtered by character culture
// (ExcludeCultures). Persists to descr_strat via updateCharacterAncillaries.
function AncillariesSection({ ancillaries: initialAncillaries, character, modDataDir, ancillaryData, devMode, onStageAncillaries }) {
  const [ancillaries, setAncillaries] = useState(initialAncillaries);
  const [savingMsg, setSavingMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  useEffect(() => { setAncillaries(initialAncillaries); }, [initialAncillaries]);

  const ancName = (a) => typeof a === "string" ? a : (a?.name || (a?.id != null ? `#${a.id}` : ""));

  // 0.9.467: ancillary edits stage to the App.js pending registry.
  const save = (newList, descriptionFragment) => {
    setAncillaries(newList);
    if (!devMode) return;
    if (typeof onStageAncillaries !== "function") return;
    onStageAncillaries(
      character.firstName || "",
      character.faction || "",
      newList.map(ancName).filter(Boolean),
      descriptionFragment,
    );
    setSavingMsg("Staged — review in toolbar");
    setTimeout(() => setSavingMsg(null), 2000);
  };

  const onRemove = (idx) => {
    const cur = ancillaries[idx];
    save(ancillaries.filter((_, i) => i !== idx), `${character.firstName}: remove ancillary ${ancName(cur) || ""}`);
  };
  const onAdd = (name) => {
    const owned = new Set(ancillaries.map(ancName));
    if (owned.has(name)) return;
    save([...ancillaries, name], `${character.firstName}: add ancillary ${name}`);
    setShowAdd(false);
    setAddQuery("");
  };

  const ancillaryOptions = useMemo(() => {
    if (!showAdd) return [];
    const all = ancillaryData ? Object.keys(ancillaryData) : [];
    const q = addQuery.toLowerCase();
    const owned = new Set(ancillaries.map(ancName));
    const charCulture = String(character?.culture || "").toLowerCase();
    const matchesCulture = (excludes) => {
      if (!Array.isArray(excludes) || excludes.length === 0) return true;
      if (!charCulture) return true;
      return !excludes.includes(charCulture);
    };
    return all
      .filter((n) => !owned.has(n))
      .filter((n) => matchesCulture(ancillaryData[n]?.excludeCultures))
      .filter((n) => q === "" || n.toLowerCase().includes(q))
      .sort()
      .slice(0, 250);
  }, [showAdd, addQuery, ancillaryData, ancillaries, character]);

  return (
    <div style={{
      marginTop: 8, padding: "8px 10px",
      background: "rgba(0,0,0,0.3)", borderRadius: 6,
      fontSize: "0.78rem", color: "#ddd",
    }}
    title="Ancillaries (retinue items / followers). Decoded 2026-05-10 via save-cracker session 6: inline in the character record between the trait block and portrait paths.">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ color: "#9ab" }}>Ancillaries ({ancillaries.length}){devMode ? " — dev edit" : ""}</span>
        {savingMsg && <span style={{ color: "#dca64a", fontSize: "0.66rem" }}>{savingMsg}</span>}
      </div>
      {ancillaries.map((a, i) => (
        <div key={i} style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <AncillaryRow ancillary={a} modDataDir={modDataDir} ancillaryData={ancillaryData} />
          </div>
          {devMode && (
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "2px 0" }}>
              <button onClick={() => onRemove(i)} title="Remove ancillary" style={{ ...editBtnStyle, color: "#dc7f7f" }}>×</button>
            </div>
          )}
        </div>
      ))}
      {devMode && (
        <div style={{ marginTop: 6 }}>
          {!showAdd ? (
            <button onClick={() => setShowAdd(true)} style={{ ...editBtnStyle, padding: "2px 8px", color: "#7fdc8a" }}>+ Add ancillary</button>
          ) : (
            <div>
              <input
                autoFocus
                placeholder="search ancillary name…"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(0,0,0,0.4)", color: "#eee",
                  border: "1px solid rgba(220,166,74,0.3)", borderRadius: 3,
                  padding: "3px 6px", fontSize: "0.72rem",
                }} />
              <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                {ancillaryOptions.map((n) => (
                  <button key={n} onClick={() => onAdd(n)} style={{
                    textAlign: "left", padding: "2px 5px",
                    background: "rgba(255,255,255,0.05)", color: "#eee",
                    border: "1px solid transparent", borderRadius: 2,
                    fontSize: "0.7rem", cursor: "pointer",
                  }}>{n}</button>
                ))}
                {ancillaryOptions.length === 0 && <span style={{ color: "#888", fontSize: "0.7rem" }}>(no matches)</span>}
              </div>
              <button onClick={() => { setShowAdd(false); setAddQuery(""); }} style={{ ...editBtnStyle, marginTop: 4 }}>cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Trim and prettify a `requires` clause for display in capability rows.
// We strip `is_player`, `not is_player`, and the noisy `factions { ... }`
// lists down to a short faction summary so the line stays readable.
function shortRequires(req) {
  if (!req) return null;
  let r = String(req)
    .replace(/\bis_player\b/g, "")
    .replace(/\band\s+and\b/g, "and")
    .replace(/^\s*and\s+/i, "")
    .replace(/\s+and\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Fold `factions { x, y, } -> [x, y]
  r = r.replace(/factions\s*\{\s*([^}]*)\}/g, (_, list) => {
    const xs = list.split(",").map((s) => s.trim()).filter(Boolean);
    return `[${xs.join(", ")}]`;
  });
  return r || null;
}

// Humanize a single capability line from EDB into something a player /
// modder can scan at a glance. Falls back to the raw line (lowercase
// underscores → spaces, capitalized) when no rule matches.
function humanizeCapability(raw) {
  if (!raw) return "";
  const line = String(raw).trim();
  // <stat>_bonus bonus N [requires ...]
  let m = line.match(/^([a-z_]+_bonus)\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?$/);
  if (m) {
    const stat = m[1].replace(/_bonus$/, "").replace(/_/g, " ");
    const n = parseInt(m[2], 10);
    const sign = n >= 0 ? "+" : "";
    const req = shortRequires(m[3]);
    return `${sign}${n} ${stat}${req ? ` (${req})` : ""}`;
  }
  // population_growth_bonus 2 (no `bonus` keyword)
  m = line.match(/^([a-z_]+)\s+(-?\d+)$/);
  if (m) {
    const known = ["wall_level", "tower_level", "gate_strength", "gate_defences",
      "farming_level", "road_level", "port_level", "construction_modifier"];
    if (known.includes(m[1])) {
      const stat = m[1].replace(/_/g, " ");
      const n = parseInt(m[2], 10);
      const cap = stat.charAt(0).toUpperCase() + stat.slice(1);
      return `${cap}: ${n}`;
    }
  }
  // recruits_morale_bonus N
  m = line.match(/^recruits?_(morale|exp|experience)_bonus\s+(?:bonus\s+)?(-?\d+)/);
  if (m) {
    const tag = m[1].startsWith("morale") ? "morale" : "experience";
    return `+${m[2]} recruit ${tag}`;
  }
  // mine_resource <res> <multi>
  m = line.match(/^mine_resource\s+(\S+)\s+(\S+)/);
  if (m) return `Mines ${m[1]} (×${m[2]})`;
  // hidden_resource ... or other rare lines — keep but tidy.
  return line.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function pixelsToBlobUrl({ width, height, pixels }) {
  const rowMajor = new Uint8ClampedArray(pixels);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  img.data.set(rowMajor);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), "image/png");
  });
}

// ── RTW-style unit info popup ────────────────────────────────────────────────
// The in-game unit window has a big illustration left, a header with the unit
// name + soldier-count + cost, a column of capability bullets, two paragraphs
// of description, and a 2-column stats grid with horizontal bars. We replicate
// that layout against EDU data (via `get-unit-stats`) + the localized text
// (via `get-unit-description`). Per-stat caps below were picked from
// max-stat sweeps across vanilla + RIS EDU; tune as needed.

// Per-stat normalization caps. 0..1 maps to red→amber→green via STAT_BAR_COLOR.
// Picked to keep elite RTW units in the green band without saturating bars.
const STAT_CAPS = {
  morale: 22,        // RTW elite phalanx ≈ 17-19, RIS goes up to ~22
  totalDefence: 50,  // armour+skill+shield max ~ 12+11+10+ buffs
  meleeAttack: 25,   // hastati ~7, top elites ~20+
  armour: 14,        // vanilla cap is 11; modded armours go to ~14
  altAttack: 18,     // charge bonus; cavalry can hit ~12-14
  defenceSkill: 14,  // 0..~12 in vanilla
  ammo: 30,          // archers ~30, slings ~15
  shield: 10,        // 0..10 max in EDU
  missileRange: 200, // arrows ~170, scorpions ~220
  charge: 18,        // duplicate of altAttack for the bar; in-game shows both
};

function STAT_BAR_COLOR(pct) {
  if (pct < 0.34) return "#c44";
  if (pct < 0.67) return "#dca64a";
  return "#4a9";
}

// Local SVG icons — equivalents of RegionInfo's ChevronStack / SwordIcon /
// ShieldIcon. We can't import the originals without modifying RegionInfo.js
// (which is off-limits per the task), so inline duplicates here.
const TIER_BRONZE = "#8a4f1f";
const TIER_SILVER = "#bcbfc2";
const TIER_GOLD = "#f5cd3a";
function tierColor(level /* 1..3 */) {
  if (level >= 3) return TIER_GOLD;
  if (level >= 2) return TIER_SILVER;
  return TIER_BRONZE;
}
const MiniShieldIcon = ({ color, size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M8 1 L14 3 L14 8 Q14 13 8 15 Q2 13 2 8 L2 3 Z" fill={color} />
  </svg>
);
const MiniSwordIcon = ({ color, size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M2 2 L2.6 3.6 L10.4 11.4 L11.4 10.4 L3.6 2.6 Z" fill={color} />
    <path d="M8.5 12.5 L12.5 8.5 L13.5 9.5 L9.5 13.5 Z" fill={color} />
    <path d="M11 13 L13 11 L14 12 L12 14 Z" fill={color} />
  </svg>
);

function StatBar({ label, value, max }) {
  // Render a label, right-aligned value, and a horizontal bar underneath.
  // value === null/undefined → render the row as "—" with an empty bar so
  // the 2-column grid stays aligned across all units.
  const v = (typeof value === "number" && isFinite(value)) ? value : null;
  const pct = (v != null && max > 0) ? Math.max(0, Math.min(1, v / max)) : 0;
  const fill = v != null && v > 0 ? STAT_BAR_COLOR(pct) : "rgba(255,255,255,0.18)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 36px", columnGap: 6, alignItems: "center" }}>
      <div style={{ color: "#cbb88c", fontSize: "0.7rem", letterSpacing: "0.02em" }}>{label}</div>
      <div style={{
        height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3,
        border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden",
      }}>
        <div style={{
          width: `${pct * 100}%`, height: "100%",
          background: fill,
          transition: "width 200ms var(--ease-mac-out, ease-out)",
        }} />
      </div>
      <div style={{
        textAlign: "right",
        color: v != null ? "#eee" : "#666",
        fontVariantNumeric: "tabular-nums",
        fontSize: "0.74rem", fontWeight: 600,
      }}>{v != null ? v : "—"}</div>
    </div>
  );
}

// Humanize EDU `attributes` + `formation` + missile flags into a bullet list
// matching the in-game capability column. Conservative — only matches tokens
// we know how to phrase; unknown tokens are humanized by underscore→space.
const ATTR_HUMAN = {
  sea_faring: "Can travel on sea",
  hide_forest: "Can hide in forest",
  hide_improved_forest: "Can hide in any forest",
  hide_long_grass: "Can hide in long grass",
  hide_anywhere: "Can hide anywhere",
  can_sap: "Can sap walls",
  can_swim: "Can swim across rivers",
  cantabrian_circle: "Can adopt Cantabrian circle",
  command: "Inspires nearby troops",
  mercenary_unit: "Mercenary unit",
  is_peasant: "Peasant — low cost, low quality",
  no_custom: "Not available in custom battles",
  general_unit: "General's bodyguard",
  legionary_name: "Has individual legion name",
  free_upkeep_unit: "Costs no upkeep in own settlement",
  power_charge: "Bonus damage on charge",
  hardy: "Hardy — recovers from fatigue quickly",
  very_hardy: "Very hardy — minimal fatigue",
  frighten_foot: "Frightens nearby infantry",
  frighten_mounted: "Frightens nearby cavalry",
  no_friendly_fire: "Will not friendly-fire allies",
  start_not_skirmishing: "Does not skirmish by default",
  gunpowder_unit: "Gunpowder unit",
  warcry: "Can warcry",
  screeching_women: "Screeching women bonus",
  druid: "Druid — morale bonus to allies",
};
const FORMATION_HUMAN = {
  phalanx: "Can form phalanx",
  schiltrom: "Can form schiltrom",
  shield_wall: "Can form shield wall",
  testudo: "Can form testudo",
  wedge: "Can form wedge",
  square: "Can form square",
  horde: "Can form horde",
};
function buildCapabilities(stats) {
  if (!stats) return [];
  const out = [];
  // attributes is a comma- or space-separated list of tokens after the
  // `attributes` keyword in EDU.
  const attrs = String(stats.attributes || "")
    .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const a of attrs) {
    if (ATTR_HUMAN[a]) out.push(ATTR_HUMAN[a]);
    else if (a.startsWith("can_form_")) {
      const key = a.replace("can_form_", "");
      out.push(FORMATION_HUMAN[key] || `Can form ${key.replace(/_/g, " ")}`);
    }
  }
  // formation phalanx, square, wedge, schiltrom, shield_wall, testudo
  const forms = String(stats.formation || "")
    .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const f of forms) {
    if (FORMATION_HUMAN[f] && !out.includes(FORMATION_HUMAN[f])) out.push(FORMATION_HUMAN[f]);
  }
  // Missile callouts derived from stat_pri
  if (stats.priMissile && stats.priMissile !== "no") {
    out.push(`Missile weapon: ${stats.priMissile.replace(/_/g, " ")}`);
  }
  // Morale heuristic — matches RTW's "Excellent morale" etc. wording.
  if (typeof stats.morale === "number") {
    if (stats.morale >= 18) out.push("Excellent morale");
    else if (stats.morale >= 13) out.push("Good morale");
    else if (stats.morale <= 4) out.push("Poor morale");
  }
  // Discipline — `impetuous` / `disciplined` / `berserker` are common.
  if (stats.discipline) {
    const d = String(stats.discipline).toLowerCase();
    if (d === "disciplined") out.push("Disciplined — will not break easily");
    else if (d === "impetuous") out.push("Impetuous — may charge without orders");
    else if (d === "berserker") out.push("Berserker — fights to the death");
    else if (d !== "normal" && d !== "low") out.push(`Discipline: ${d}`);
  }
  // De-dupe while preserving order.
  return Array.from(new Set(out));
}

function UnitInfoBody({ title, factionLabel, unitStats, description, imgUrl, imgStatus }) {
  const stats = unitStats || {};
  const capabilities = buildCapabilities(stats);
  // Total Defence = armour + defenceSkill + shield. The in-game UI shows
  // this as one number even though EDU stores three slots.
  const totalDefence = (stats.armour ?? 0) + (stats.defenseSkill ?? 0) + (stats.shield ?? 0);
  const subtitleCategory = (() => {
    const c = stats.classType || stats.category || "";
    return c ? c.replace(/_/g, " ") : "";
  })();
  // Soldier count + cost row.
  const soldierCount = stats.soldierCount ?? null;
  const cost = stats.recruitCost ?? null;
  const upkeep = stats.upkeep ?? null;
  // Log once per unit so the field-resolution path is debuggable.
  useEffect(() => {
    if (!stats || !stats.name) return;
    console.log(`[unit-info] render '${stats.name}' soldiers=${soldierCount} cost=${cost} `
      + `morale=${stats.morale} defTotal=${totalDefence} caps=${capabilities.length}`);
  }, [stats?.name]);
  const desc = description || {};
  const longText = desc.long || desc.short || null;
  // Detect a leading quote-style block (RTW's _descr_short is usually a
  // poetic one-liner). If both fields are present we render short first.
  const quote = (desc.short && desc.short !== desc.long) ? desc.short : null;

  return (
    <Fragment>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 12, marginBottom: 6, paddingBottom: 6,
        borderBottom: "1px solid rgba(220,166,74,0.25)",
      }}>
        <div>
          <div style={{
            fontSize: "1.15rem", fontWeight: 800, letterSpacing: "0.02em",
            textTransform: "uppercase", color: "#f1e2bf",
          }}>{title}</div>
          {(factionLabel || subtitleCategory) && (
            <div style={{ fontSize: "0.72rem", color: "#bba", textTransform: "capitalize" }}>
              {[subtitleCategory, factionLabel].filter(Boolean).join(" — ")}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {soldierCount != null && (
            <div style={{
              padding: "3px 8px", borderRadius: 4,
              background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.08)",
              fontSize: "0.72rem", color: "#dca64a", fontVariantNumeric: "tabular-nums",
            }} title="Maximum soldiers per unit (EDU `soldier <type>, <count>, ...`)">
              {soldierCount} men
            </div>
          )}
          {cost != null && (
            <div style={{
              padding: "3px 8px", borderRadius: 4,
              background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.08)",
              fontSize: "0.72rem", color: "#e1c989", fontVariantNumeric: "tabular-nums",
            }} title={upkeep != null ? `Recruit cost · upkeep ${upkeep}/turn` : "Recruit cost"}>
              {cost} d{upkeep != null ? ` · ${upkeep}/t` : ""}
            </div>
          )}
          {/* Tier glyphs — show the unit's BASE armour upgrade level (the
              max permitted by `armour_ug_levels`), since the popup payload
              doesn't carry per-instance upgrades. Shown as a single shield
              + sword icon at bronze so the layout matches the in-game info
              window even without live data. */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }} title="Upgrade slot indicators (decorative — live upgrades shown on unit cards)">
            <MiniShieldIcon color={tierColor(1)} />
            <MiniSwordIcon color={tierColor(1)} />
          </div>
        </div>
      </div>

      {/* Body: image left, capabilities right */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 12 }}>
        <div style={{
          minHeight: 240,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.35)", borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          {imgStatus === "loading" && <span style={{ color: "#aaa", fontStyle: "italic" }}>Loading…</span>}
          {imgStatus === "missing" && <span style={{ color: "#aaa", fontStyle: "italic" }}>No image available</span>}
          {imgStatus === "ready" && imgUrl && (
            <img src={imgUrl} alt={title} style={{ width: "100%", height: "auto", maxHeight: "60vh", display: "block", objectFit: "contain" }} />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {capabilities.length > 0 ? (
            <div>
              <div style={{ color: "#dca64a", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Capabilities
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, color: "#dde2e8", fontSize: "0.76rem", lineHeight: 1.45 }}>
                {capabilities.map((c, i) => (
                  <li key={i} style={{ marginBottom: 1 }}>{c}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div style={{ color: "#888", fontSize: "0.72rem", fontStyle: "italic" }}>
              No special capabilities listed.
            </div>
          )}
          {/* Stat grid */}
          <div>
            <div style={{ color: "#dca64a", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Stats
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12, rowGap: 5 }}>
              <StatBar label="Morale"        value={stats.morale}        max={STAT_CAPS.morale} />
              <StatBar label="Total Defence" value={totalDefence || null} max={STAT_CAPS.totalDefence} />
              <StatBar label="Melee Attack"  value={stats.priAttack}     max={STAT_CAPS.meleeAttack} />
              <StatBar label="Armour"        value={stats.armour}        max={STAT_CAPS.armour} />
              <StatBar label="Alt. Attack"   value={stats.secAttack ?? null} max={STAT_CAPS.altAttack} />
              <StatBar label="Defence Skill" value={stats.defenseSkill}  max={STAT_CAPS.defenceSkill} />
              <StatBar label="Ammo"          value={stats.priAmmo || null} max={STAT_CAPS.ammo} />
              <StatBar label="Shield"        value={stats.shield}        max={STAT_CAPS.shield} />
              <StatBar label="Missile Range" value={stats.priRange || null} max={STAT_CAPS.missileRange} />
              <StatBar label="Charge"        value={stats.priCharge}     max={STAT_CAPS.charge} />
            </div>
          </div>
        </div>
      </div>

      {/* Description block — quote first, historical background second */}
      {(quote || longText) && (
        <div style={{
          marginTop: 10, padding: "8px 10px",
          background: "rgba(0,0,0,0.3)", borderRadius: 6,
          fontSize: "0.78rem", color: "#dde2e8",
          lineHeight: 1.45, maxHeight: "26vh", overflowY: "auto",
        }}>
          {quote && (
            <div style={{
              fontStyle: "italic", color: "#cbb88c",
              borderLeft: "2px solid rgba(220,166,74,0.5)", paddingLeft: 8,
              marginBottom: 6,
            }}>{quote}</div>
          )}
          {longText && longText !== quote && (
            <div style={{ whiteSpace: "pre-wrap" }}>{longText}</div>
          )}
        </div>
      )}
    </Fragment>
  );
}

export default function InfoPopup({ payload, modDataDir, factionDisplayNames, onClose, devMode, traitData, onStageTraits, onStageAncillaries, pendingTraits, pendingAncils, pendingCharFields, onStageCharFields }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [status, setStatus] = useState("loading");
  const [unitStats, setUnitStats] = useState(null);
  const [buildingStats, setBuildingStats] = useState(null); // { cost, construction, settlementMin, capabilities[] }
  const [description, setDescription] = useState(null); // { displayName, short, long }

  // Fetch unit stats from EDU when payload is a unit.
  useEffect(() => {
    setUnitStats(null);
    if (!payload || payload.type !== "unit") return;
    const api = window.electronAPI;
    if (!api?.getUnitStats) { console.log(`[unit-info] no getUnitStats IPC`); return; }
    let cancelled = false;
    console.log(`[unit-info] fetch stats unit='${payload.name}' faction='${payload.faction}'`);
    api.getUnitStats(modDataDir || null, payload.name).then((s) => {
      if (cancelled) return;
      if (!s) console.log(`[unit-info] EDU fallback empty for '${payload.name}'`);
      else console.log(`[unit-info] EDU hit '${payload.name}' fields=`
        + `${["soldierCount","priAttack","secAttack","priCharge","armour","defenseSkill","shield","morale","priAmmo","priRange","recruitCost"]
            .filter((k) => s[k] != null).join(",")}`);
      setUnitStats(s || null);
    }).catch((e) => { console.log(`[unit-info] stats fetch error: ${e?.message || e}`); });
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  // Fetch building stats (cost, construction turns, capability lines)
  // when the payload is a building.
  useEffect(() => {
    setBuildingStats(null);
    if (!payload || payload.type !== "building") return;
    const api = window.electronAPI;
    if (!api?.getBuildingStats) return;
    let cancelled = false;
    api.getBuildingStats(modDataDir || null, payload.name, payload.chainName || null).then((s) => {
      if (!cancelled) setBuildingStats(s || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  // Fetch the long-form description (text/export_units.txt or
  // text/export_buildings.txt). For units we need the EDU `dictionary`
  // key — the IPC resolves that internally. For buildings we pass the
  // level name (preferred) and chain name (fallback).
  useEffect(() => {
    setDescription(null);
    if (!payload) return;
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;
    if (payload.type === "unit" && api.getUnitDescription) {
      api.getUnitDescription(modDataDir || null, payload.name).then((d) => {
        if (!cancelled) setDescription(d || null);
      }).catch(() => {});
    } else if (payload.type === "building" && api.getBuildingDescription) {
      api.getBuildingDescription(modDataDir || null, payload.name, payload.chainName || null, payload.culture || null).then((d) => {
        if (!cancelled) setDescription(d || null);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  useEffect(() => {
    if (!payload) return;
    setImgUrl(null);
    setStatus("loading");
    let cancelled = false;
    const api = window.electronAPI;
    const run = async () => {
      try {
        let res = null;
        if (payload.type === "unit" && api?.resolveUnitInfo) {
          res = await api.resolveUnitInfo(modDataDir || null, payload.faction, payload.name);
          if (!res && api?.resolveUnitCard) {
            // Fallback to the small card if the unit has no info variant.
            res = await api.resolveUnitCard(modDataDir || null, payload.faction, payload.name);
          }
        } else if (payload.type === "building") {
          console.log("[info-popup] building payload:", JSON.stringify(payload));
          // Buildings: prefer the wide `_constructed` banner — matches the
          // game's info panel. Fall back to the normal icon resolver.
          if (api?.resolveBuildingBanner) {
            res = await api.resolveBuildingBanner(modDataDir || null, payload.culture, payload.name, payload.chainName || null);
            console.log("[info-popup] banner result path:", res?.path || "(null)");
          }
          if (!res && api?.resolveBuildingIcon) {
            res = await api.resolveBuildingIcon(modDataDir || null, payload.culture, payload.name, payload.chainName || null);
            console.log("[info-popup] icon fallback path:", res?.path || "(null)");
          }
        } else if (payload.type === "faction") {
          // Faction icon TGA. First try the mod-icons dir (sharp version
          // when the mod ships its own icons), then fall back to the
          // bundled public/faction_icons/.
          let bin = null;
          if (payload.modIconsDir && api?.readFactionIcon) {
            try {
              const tgaPath = String(payload.modIconsDir).replace(/\\/g, "/") + "/" + payload.factionId + ".tga";
              bin = await api.readFactionIcon(tgaPath);
            } catch {}
          }
          if (!bin) {
            // Bundled icon — fetch from the renderer's static path.
            const url = (import.meta.env.BASE_URL || "./") + "faction_icons/" + payload.factionId + ".tga";
            const r = await fetch(url);
            if (r.ok) bin = await r.arrayBuffer();
          }
          if (bin) res = { buffer: bin };
        }
        if (!res || !res.buffer) { if (!cancelled) setStatus("missing"); return; }
        const tga = new TGA(new Uint8Array(res.buffer));
        if (!tga.width || !tga.height || !tga.pixels) { if (!cancelled) setStatus("missing"); return; }
        const url = await pixelsToBlobUrl({ width: tga.width, height: tga.height, pixels: tga.pixels });
        if (!cancelled) { setImgUrl(url); setStatus("ready"); }
      } catch (e) {
        if (!cancelled) setStatus("missing");
      }
    };
    run();
    return () => { cancelled = true; };
  }, [payload, modDataDir]);

  useEffect(() => {
    if (!payload) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payload, onClose]);

  if (!payload) return null;

  const title = payload.label || (payload.name || "").replace(/_/g, " ");
  const factionLabel = payload.faction
    ? (factionDisplayNames?.[payload.faction] || payload.faction.replace(/_/g, " "))
    : "";
  const subtitle = payload.type === "unit"
    ? `Unit${factionLabel ? ` — ${factionLabel}` : ""}`
    : payload.type === "faction"
    ? `Faction · internal id: ${payload.factionId || ""}`
    : payload.type === "character"
    ? (() => {
        const c = payload.character || {};
        const role = c.isLeader ? "Faction Leader" : c.isHeir ? "Faction Heir" : c.gender === "female" ? "Princess" : "General";
        // Prefer fine-grained age (4-turns/year precision) when available,
        // falling back to the rounded integer years.
        let ageStr = "";
        if (c.ageFineQuarter && typeof c.ageFineQuarter.years === "number") {
          const q = c.ageFineQuarter.quarter;
          const frac = q > 0 ? `.${q * 25}` : "";
          ageStr = ` · age ${c.ageFineQuarter.years}${frac}`;
        } else if (c.age != null) {
          ageStr = ` · age ${c.age}`;
        }
        return `${role}${ageStr}${c.isDead ? " · deceased" : ""}`;
      })()
    : `${payload.chainName ? payload.chainName.replace(/_/g, " ") + " · " : ""}${payload.culture || ""}`;

  const isUnit = payload.type === "unit";
  return (
    <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: isUnit ? "rgba(22,24,30,0.97)" : "rgba(30,24,18,0.96)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: 16,
        maxWidth: isUnit ? "min(94vw, 780px)" : "min(90vw, 560px)",
        maxHeight: "90vh",
        overflow: "auto",
        color: "#f6f6f6",
        boxShadow: "0 10px 40px rgba(0,0,0,0.7)",
      }}>
        {!isUnit && (
          <div style={{ fontSize: "1.05rem", fontWeight: 700, textTransform: "capitalize" }}>{title}</div>
        )}
        {!isUnit && subtitle && <div style={{ fontSize: "0.72rem", color: "#bba", marginBottom: 8, textTransform: "capitalize" }}>{subtitle}</div>}
        {payload.type !== "character" && !isUnit && (
          <div style={{
            minHeight: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.3)", borderRadius: 6,
          }}>
            {status === "loading" && <span style={{ color: "#aaa", fontStyle: "italic" }}>Loading…</span>}
            {status === "missing" && <span style={{ color: "#aaa", fontStyle: "italic" }}>No image available</span>}
            {status === "ready" && imgUrl && (
              <img src={imgUrl} alt={title} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block" }} />
            )}
          </div>
        )}
        {isUnit && (
          <UnitInfoBody
            title={title}
            factionLabel={factionLabel}
            unitStats={unitStats}
            description={description}
            imgUrl={imgUrl}
            imgStatus={status}
          />
        )}
        {payload.type === "character" && (() => {
          const c = payload.character || {};
          // 0.9.433: filter hidden traits in non-dev mode. The mod's
          // export_descr_character_traits.txt flags certain traits with
          // `Hidden` and the engine doesn't render them in the in-game
          // info panel; the renderer should match that behaviour unless
          // devMode is on (then we show everything for cracker work).
          const allTraits = Array.isArray(c.traits) ? c.traits : [];
          const hiddenMap = traitData?.hidden || {};
          // 0.9.472: pending registries override the parsed/save state so
          // staged trait/ancillary edits show immediately, and reverts in
          // the unified pending modal snap the UI back without a reload.
          // Key format matches App.js onStageTraits/onStageAncillaries:
          // `${firstName.toLowerCase()}|${faction.toLowerCase()}`.
          const pendKey = `${(c.firstName || c.name || "").toLowerCase()}|${(c.faction || "").toLowerCase()}`;
          const pendTraitsList = pendingTraits && pendingTraits.get ? pendingTraits.get(pendKey) : null;
          const pendAncilsList = pendingAncils && pendingAncils.get ? pendingAncils.get(pendKey) : null;
          const effectiveAllTraits = Array.isArray(pendTraitsList) ? pendTraitsList : allTraits;
          const traits = devMode ? effectiveAllTraits : effectiveAllTraits.filter((t) => !hiddenMap[t.name]);
          const ancillaries = Array.isArray(pendAncilsList)
            ? pendAncilsList
            : (Array.isArray(c.ancillaries) ? c.ancillaries : []);
          // Humanize internal trait id → human-readable phrase. The id is
          // CamelCase (RomanConquerorMessapians) or snake_case (Good_Commander).
          // We split CamelCase boundaries, replace underscores with spaces,
          // collapse double-spaces, and trim.
          const humanize = (s) => String(s || "")
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const clanHead = c.clanHead || null;
          const resolvedChildren = Array.isArray(c._resolvedChildren) ? c._resolvedChildren : [];
          // 0.9.420: character stats. The four u32 fields at character
          // record +102..+126 (LAYOUT_A) decode to command / influence /
          // management / loyalty. Verified 2026-05-19 against Antigonos II
          // Gonatas in RIS Macedon T0 (Command 7, Influence 6, Management 5).
          const hasStats = c.command != null || c.influence != null
            || c.management != null || c.loyalty != null;
          if (!devMode && traits.length === 0 && ancillaries.length === 0 && !clanHead && resolvedChildren.length === 0 && !hasStats) {
            return (
              <div style={{
                marginTop: 4, padding: "12px 10px",
                background: "rgba(0,0,0,0.3)", borderRadius: 6,
                color: "#aaa", fontStyle: "italic", fontSize: "0.78rem",
              }}>No traits, ancillaries, or family link.</div>
            );
          }
          return (
            <Fragment>
              {devMode && onStageCharFields && (c.firstName || c.name) && (() => {
                // Dev-mode identity editor for starting (descr_strat) generals.
                // Stages age + leader/heir rank edits; written to the character
                // line on Save. Pending values override the parsed ones live.
                const pend = pendingCharFields && pendingCharFields.get ? pendingCharFields.get(pendKey) : null;
                const baseAge = c.ageFineQuarter?.years ?? c.age ?? null;
                const curAge = pend && pend.age != null ? pend.age : baseAge;
                const baseTag = c.leader ? "leader" : c.heir ? "heir" : (c.tag === "leader" || c.tag === "heir" ? c.tag : "");
                const curTag = pend && pend.tag != null ? pend.tag : baseTag;
                const fn = c.firstName || c.name;
                const label = payload.label || fn;
                const lbl = { color: "#888", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.04em" };
                const inp = { background: "#1a1d23", color: "#eee", border: "1px solid #3a3f48", borderRadius: 4, padding: "3px 6px", fontSize: "0.8rem" };
                return (
                  <div style={{ marginTop: 4, padding: "8px 10px", background: "rgba(40,55,75,0.35)", border: "1px solid rgba(110,140,190,0.4)", borderRadius: 6 }}>
                    <div style={{ color: "#9bf", marginBottom: 6, fontSize: "0.72rem", fontWeight: 700 }}>Edit starting general</div>
                    <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={lbl}>First name</span>
                        <input type="text" defaultValue={(pend && pend.newFirst) || fn || ""} style={{ ...inp, width: 110 }}
                          title="Renames this general's first name (surname kept). Applied on Save; if the name isn't in names.txt it's added."
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== fn) onStageCharFields(fn, c.faction, { newFirst: v }, label);
                          }} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={lbl}>Age</span>
                        <input type="number" min={1} max={110} defaultValue={curAge ?? ""} style={{ ...inp, width: 64 }}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (Number.isFinite(v) && v > 0 && v < 120 && v !== baseAge) onStageCharFields(fn, c.faction, { age: v }, label);
                          }} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={lbl}>Rank</span>
                        <select value={curTag} style={{ ...inp }}
                          onChange={(e) => onStageCharFields(fn, c.faction, { tag: e.target.value }, label)}>
                          <option value="">General</option>
                          <option value="heir">Heir</option>
                          <option value="leader">Faction Leader</option>
                        </select>
                      </div>
                      {pend && (pend.age != null || pend.tag != null || pend.newFirst != null) && (
                        <span style={{ color: "#9bf", fontSize: "0.66rem", alignSelf: "center" }}>staged · applies on Save</span>
                      )}
                    </div>
                    <div style={{ color: "#778", fontSize: "0.6rem", marginTop: 6 }}>Leader/heir uniqueness is up to you — only one of each per faction.</div>
                  </div>
                );
              })()}
              {hasStats && (() => {
                // 0.9.428: hide stat columns the loaded mod doesn't use.
                // RIS dropped Loyalty entirely — no trait references it.
                // `traitData.usesStat` gates each column; if usesStat is
                // missing (older app or no mod loaded), show all four.
                const u = traitData?.usesStat || { command: true, influence: true, management: true, loyalty: true };
                const cols = [
                  u.command  !== false ? { label: "Command",    value: c.command,    color: "#e0a96c" } : null,
                  u.influence !== false ? { label: "Influence",  value: c.influence,  color: "#c896d8" } : null,
                  u.management !== false ? { label: "Management", value: c.management, color: "#8ec494" } : null,
                  u.loyalty   !== false ? { label: "Loyalty",    value: c.loyalty,    color: "#c8a85a" } : null,
                ].filter(Boolean);
                if (cols.length === 0) return null;
                return (
                  <div style={{
                    marginTop: 4, padding: "8px 10px",
                    background: "rgba(0,0,0,0.3)", borderRadius: 6,
                    fontSize: "0.78rem", color: "#ddd",
                  }}>
                    <div style={{ color: "#9ab", marginBottom: 4 }}>Stats</div>
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, columnGap: 12, rowGap: 2 }}>
                      {cols.map((s, i) => (
                        <div key={i} style={{ textAlign: "center" }}>
                          <div style={{ color: s.color, fontWeight: 700, fontSize: "1.05rem", lineHeight: 1 }}>
                            {s.value != null ? s.value : "?"}
                          </div>
                          <div style={{ color: "#888", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>
                            {s.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {resolvedChildren.length > 0 && (
                <div style={{
                  marginTop: 4, padding: "6px 10px",
                  background: "rgba(0,0,0,0.3)", borderRadius: 6,
                  fontSize: "0.78rem", color: "#ddd",
                }}
                title={`Children's primary uuids stored as a 4-slot array at character record +54..+66 (LAYOUT_A) / +50..+62 (LAYOUT_B). Decoded 2026-05-11 via save-cracker session 13 (218/218 parent-child hits verified in Rome T1). Slot order is by birth; dead children preserve their slot, so unresolved uuids are dropped from this list.`}>
                  <span style={{ color: "#9ab" }}>Children:</span>{" "}
                  <span style={{ color: "#eee", textTransform: "capitalize" }}>{resolvedChildren.join(", ")}</span>
                </div>
              )}
              {clanHead && (
                <div style={{
                  marginTop: 4, padding: "6px 10px",
                  background: "rgba(0,0,0,0.3)", borderRadius: 6,
                  fontSize: "0.78rem", color: "#ddd",
                }}
                title="Clan-head / cognomen link (u32 name-index at character record +18). Decoded 2026-05-11 via save-cracker session 8. Roman characters bound to a gens / patron clan get this set when adopted, married in, or sworn to. Most chars have a 0xffffffff sentinel here.">
                  <span style={{ color: "#9ab" }}>Clan / family head:</span>{" "}
                  <span style={{ color: "#eee", textTransform: "capitalize" }}>{humanize(clanHead.name)}</span>
                  {typeof clanHead.relType === "number" && clanHead.relType > 0 && (
                    <span style={{ color: "#888", fontSize: "0.72rem", marginLeft: 6 }}>· rel-type {clanHead.relType}</span>
                  )}
                </div>
              )}
              {(traits.length > 0 || devMode) && (
                <TraitsSection
                  traits={traits}
                  allTraits={effectiveAllTraits}
                  character={c}
                  modDataDir={modDataDir}
                  traitData={traitData}
                  devMode={devMode}
                  onStageTraits={onStageTraits}
                />
              )}
              {(ancillaries.length > 0 || devMode) && (
                <AncillariesSection
                  ancillaries={ancillaries}
                  character={c}
                  modDataDir={modDataDir}
                  ancillaryData={traitData?.ancillaries || null}
                  devMode={devMode}
                  onStageAncillaries={onStageAncillaries}
                />
              )}
            </Fragment>
          );
        })()}
        {!isUnit && description && (description.short || description.long) && (
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            background: "rgba(0,0,0,0.3)",
            borderRadius: 6,
            fontSize: "0.78rem",
            color: "#ddd",
            lineHeight: 1.4,
            maxHeight: "32vh",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}>
            {description.long || description.short}
          </div>
        )}
        {payload.type === "building" && buildingStats && (() => {
          const rows = [];
          if (buildingStats.cost != null) rows.push(["Cost", `${buildingStats.cost} denarii`]);
          if (buildingStats.construction != null) rows.push(["Construction", `${buildingStats.construction} turn${buildingStats.construction === 1 ? "" : "s"}`]);
          if (buildingStats.settlementMin) rows.push(["Settlement min", buildingStats.settlementMin.replace(/_/g, " ")]);
          if (buildingStats.tierIndex != null && buildingStats.tierIndex >= 0 && buildingStats.tierMax) {
            rows.push(["Tier", `${buildingStats.tierIndex + 1} / ${buildingStats.tierMax}`]);
          }
          const hasCaps = buildingStats.capabilities && buildingStats.capabilities.length > 0;
          const hasRecruits = buildingStats.recruits && buildingStats.recruits.length > 0;
          const hasLadder = buildingStats.chainLadder && buildingStats.chainLadder.length > 1;
          if (rows.length === 0 && !hasCaps && !hasRecruits && !hasLadder) return null;
          return (
            <div style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "rgba(0,0,0,0.3)",
              borderRadius: 6,
              fontSize: "0.78rem",
              color: "#ddd",
            }}>
              {rows.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 3, marginBottom: 8 }}>
                  {rows.map(([label, value], i) => (
                    <Fragment key={i}>
                      <span style={{ color: "#9ab" }}>{label}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", textTransform: "capitalize" }}>{value}</span>
                    </Fragment>
                  ))}
                </div>
              )}
              {hasLadder && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: "#9ab", marginBottom: 4 }}>Chain ladder</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", fontSize: "0.72rem" }}>
                    {buildingStats.chainLadder.map((lvl, i) => (
                      <Fragment key={lvl}>
                        <span style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: i === buildingStats.tierIndex ? "rgba(220,166,74,0.35)" : "rgba(255,255,255,0.06)",
                          color: i === buildingStats.tierIndex ? "#ffd98a" : "#bbb",
                          fontWeight: i === buildingStats.tierIndex ? 700 : 400,
                          textTransform: "capitalize",
                        }}>{lvl.replace(/_/g, " ")}</span>
                        {i < buildingStats.chainLadder.length - 1 && (
                          <span style={{ color: "#666" }}>›</span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
              {hasRecruits && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: "#9ab", marginBottom: 4 }}>Adds at this level</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: "0.72rem" }}>
                    {buildingStats.recruits.map((r, i) => (
                      <span key={i} style={{
                        padding: "2px 6px",
                        background: "rgba(255,255,255,0.06)",
                        borderRadius: 4,
                        textTransform: "capitalize",
                      }}>{r.unit.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                </div>
              )}
              {hasCaps && (
                <>
                  <div style={{ color: "#9ab", marginBottom: 4 }}>Effects</div>
                  <div style={{ fontSize: "0.74rem", lineHeight: 1.5, color: "#cfd6dd", maxHeight: "28vh", overflowY: "auto" }}>
                    {buildingStats.capabilities.map((c, i) => {
                      // Capabilities are { raw, resolved } objects after
                      // 0.9.194 — `resolved` is the human string from
                      // text/expanded_bi.txt for dummy-capability keys; the
                      // humanizer is the fallback for fixed engine
                      // capabilities (happiness_bonus, wall_level, etc.).
                      const raw = typeof c === "string" ? c : c.raw;
                      const resolved = typeof c === "string" ? null : c.resolved;
                      return (
                        <div key={i}
                          title={resolved ? raw : undefined}
                          style={{ marginBottom: 2, color: resolved ? "#d8e0e8" : "#cfd6dd" }}>
                          {resolved || humanizeCapability(raw)}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {devMode && (() => {
          // Show-in-source buttons — open the right line in EDB/EDU.
          // Tries VS Code's vscode://file/<path>:<line> URL first; falls back
          // to the OS default editor. The right-click already passes the
          // chain name (for buildings) and unit type (for units).
          const api = window.electronAPI;
          if (!api) return null;
          const isBuilding = payload.type === "building";
          if (!isUnit && !isBuilding) return null;
          const openIn = async (kind) => {
            try {
              let loc;
              if (kind === "edu") loc = await api.findEduType(modDataDir || null, payload.name);
              else loc = await api.findEdbChain(modDataDir || null, payload.chainName || payload.name);
              if (!loc) return;
              await api.openSourceFile(loc.path, loc.line);
            } catch {}
          };
          const btnStyle = {
            padding: "4px 10px", fontSize: "0.74rem",
            borderRadius: 6, border: "1px solid #555",
            background: "rgba(255,255,255,0.06)", color: "#dca64a",
            cursor: "pointer", fontWeight: 600,
          };
          return (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {isUnit && api.findEduType && (
                <button style={btnStyle} onClick={() => openIn("edu")}
                  title="Open export_descr_unit.txt at this unit's `type` line">
                  📄 Show in EDU
                </button>
              )}
              {isBuilding && api.findEdbChain && (
                <button style={btnStyle} onClick={() => openIn("edb")}
                  title="Open export_descr_buildings.txt at this chain's `building` line">
                  📄 Show in EDB
                </button>
              )}
              <span style={{ fontSize: "0.65rem", color: "#888", alignSelf: "center" }}>
                opens in Notepad++ (with line jump) if installed; otherwise Notepad
              </span>
            </div>
          );
        })()}
        <div style={{ marginTop: 10, fontSize: "0.7rem", color: "#888" }}>
          Right-click or press Esc to close
        </div>
      </div>
    </div>
  );
}
