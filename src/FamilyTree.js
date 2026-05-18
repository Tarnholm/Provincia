// src/FamilyTree.js
//
// Family tree panel: sidebar list of male adult characters (generals) on the
// left, zoomable/pannable tree view on the right. Uses in-game portraits
// loaded from the mod / vanilla install via the resolvePortrait IPC.

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { loadPortrait, getCachedPortrait } from "./portraitIcons";

const PUBLIC_URL = (import.meta && import.meta.env && import.meta.env.BASE_URL) || "./";

function cultureFor(factionCultures, factionId) {
  if (!factionId) return null;
  const c = factionCultures && factionCultures[factionId.toLowerCase()];
  return c ? String(c).toLowerCase() : null;
}

// ── Portrait component ────────────────────────────────────────────────────
//
// Categories used to look up the portrait file:
//   - wife (adult female, married)
//   - daughter (girl, age < 18 or any unmarried female)
//   - son (boy, age < 18)
//   - general (adult male — uses generic culture general_portrait.tga;
//     unique-per-character portraits would need the portrait-index byte
//     cracked, which isn't done yet).
function categoryFor(char) {
  const isFemale = char.gender === "female";
  const ageNum = char.age != null ? Number(char.age) : null;
  const isChild = ageNum != null && ageNum < 18 && !(char.tags && (char.tags.includes("leader") || char.tags.includes("heir")));
  if (isFemale && isChild) return "daughter";
  if (isFemale) return "wife";
  if (isChild) return "son";
  return "general";
}

// Portrait. `shape="rect"` renders a tall rectangle (in-game card style);
// `shape="circle"` is the small sidebar thumbnail. `size` controls the
// width; height is derived (size for circle, size*1.25 for rect).
function Portrait({ char, culture, modDataDir, size = 56, shape = "rect", coordToPortrait }) {
  const slot = categoryFor(char);
  // Per-character context lets the IPC pick a unique portrait from the
  // young/old generals pool. Only used for the "general" slot — other
  // slots (wife/son/daughter) share a single static TGA.
  //
  // If a save is loaded and the char's (x,y) matches a save record's
  // (extX, extY), `savePath` is set — the IPC's fast-path loads that
  // file directly, bypassing the hash. This gives the EXACT in-game
  // portrait (engine-assigned + stored in the save).
  const charContext = useMemo(() => {
    if (slot !== "general" || !char.firstName) return null;
    const ctx = {
      name: char.firstName,
      lastName: char.lastName || "",
      faction: char.faction || "",
      age: char.age != null ? Number(char.age) : null,
      portraitIndex: char.portraitIndex != null ? Number(char.portraitIndex) : null,
    };
    if (coordToPortrait && char.x != null && char.y != null) {
      const k = `${char.x},${char.y}`;
      const hit = coordToPortrait.get(k);
      if (hit && hit.cards) ctx.savePath = hit.cards;
    }
    return ctx;
  }, [slot, char.firstName, char.lastName, char.faction, char.age, char.portraitIndex, char.x, char.y, coordToPortrait]);
  const [url, setUrl] = useState(() => getCachedPortrait(culture, slot, charContext));

  useEffect(() => {
    let alive = true;
    if (!url) {
      loadPortrait(modDataDir, culture, slot, charContext).then(u => {
        if (alive && u) setUrl(u);
      });
    }
    return () => { alive = false; };
  }, [culture, slot, modDataDir, url, charContext]);

  const dead = char.alive === false || char.isDead;
  const circle = shape === "circle";
  const w = size;
  const h = circle ? size : Math.round(size * 1.25);
  // Dead members: keep the same portrait but desaturate + darken — matches
  // RTW's in-game family tree where deceased members render as faded B&W.
  const deadFilter = "grayscale(1) brightness(0.55) contrast(0.95)";
  return (
    <div style={{
      width: w, height: h,
      borderRadius: circle ? w / 2 : 2,
      border: "1px solid " + (dead ? "#3a3328" : "#a8893a"),
      overflow: "hidden",
      background: "#3a2e1f",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)",
      flexShrink: 0,
    }}>
      {url ? (
        <img src={url} alt="" style={{
          width: "100%", height: "100%", objectFit: "cover",
          filter: dead ? deadFilter : "none",
        }} />
      ) : (
        <div style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: dead ? "#666" : "#bba874", fontSize: Math.min(w, h) * 0.45,
          background: dead ? "#1a1a1a" : "#2a2218",
          filter: dead ? deadFilter : "none",
        }}>
          {slot === "wife" ? "♀" : slot === "daughter" ? "♀" : slot === "son" ? "♂" : "♂"}
        </div>
      )}
    </div>
  );
}

// ── MemberCard (the visual block per character in the tree) ─────────────

// descr_strat uses single trailing uppercase letters (B, C, D, ...) to
// disambiguate when multiple characters share a first name — "AntigonosB"
// is the engine's ID, but in-game the family tree shows "Antigonos II".
// Strip the suffix and convert to a roman numeral for display.
const ROMAN_FOR_SUFFIX = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
function displayFirstName(firstName) {
  if (!firstName) return "?";
  const m = /^(.+?[a-z])([A-Z])$/.exec(firstName);
  if (!m) return firstName;
  const numeral = ROMAN_FOR_SUFFIX[m[2].charCodeAt(0) - "A".charCodeAt(0)] || m[2];
  return m[1] + " " + numeral;
}

function tooltipFor(char) {
  const lines = [];
  const name = displayFirstName(char.firstName) + (char.lastName ? " " + char.lastName.replace(/_/g, " ") : "");
  lines.push(name);
  if (char.tags && char.tags.length) {
    const t = char.tags.filter(t => t === "leader" || t === "heir").join(", ");
    if (t) lines.push(t);
  }
  if (char.age != null) lines.push(`Age: ${char.age}`);
  if (char.role) lines.push(`Role: ${String(char.role).replace(/_/g, " ")}`);
  if (char.region) lines.push(`Region: ${char.region.replace(/_/g, " ")}`);
  if (char.alive === false || char.isDead) lines.push("Deceased");
  if (char.traits && char.traits.length) {
    lines.push("");
    lines.push("Traits:");
    for (const t of char.traits) {
      lines.push("  • " + String(t.name).replace(/_/g, " ") + (t.level > 1 ? ` (${t.level})` : ""));
    }
  }
  if (char.ancillaries && char.ancillaries.length) {
    lines.push("");
    lines.push("Ancillaries:");
    for (const a of char.ancillaries) lines.push("  • " + String(a).replace(/_/g, " "));
  }
  return lines.join("\n");
}

function MemberCard({ char: rawChar, culture, modDataDir, portraitSize = 64, compact = false, coordToPortrait }) {
  // When a save is loaded and the descr_strat (x, y) of this character
  // matches a save char's (extX, extY), overlay the save's current-turn
  // values — age and region — over the descr_strat T0 values. Lets the
  // family tree reflect later-turn ages without losing the descr_strat
  // family-relationship structure.
  const char = useMemo(() => {
    if (!coordToPortrait || rawChar.x == null || rawChar.y == null) return rawChar;
    const hit = coordToPortrait.get(`${rawChar.x},${rawChar.y}`);
    if (!hit) return rawChar;
    return {
      ...rawChar,
      age: hit.age != null ? hit.age : rawChar.age,
      region: hit.region || rawChar.region,
      saveOwnUuid: hit.ownUuid,
    };
  }, [rawChar, coordToPortrait]);
  const dead = char.alive === false || char.isDead;
  const isLeader = char.tags && char.tags.includes("leader");
  const fullName = displayFirstName(char.firstName) +
    (char.lastName ? " " + char.lastName.replace(/_/g, " ") : "");
  return (
    <div title={tooltipFor(char)} style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      padding: compact ? 4 : 6,
      margin: 4,
      minWidth: compact ? 92 : 116,
      background: dead ? "rgba(10,10,10,0.55)" : "rgba(245,238,220,0.78)",
      color: dead ? "#666" : "#221f1a",
      border: "1px solid " + (dead ? "#1a1a1a" : "rgba(90,69,48,0.45)"),
      borderRadius: 4,
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      fontSize: compact ? 10 : 11,
      textAlign: "center",
      cursor: "default",
    }}>
      <Portrait char={char} culture={culture} modDataDir={modDataDir} size={portraitSize} coordToPortrait={coordToPortrait} />
      <div style={{
        fontWeight: 700, marginTop: 3, lineHeight: 1.1,
        color: dead ? "#777" : (isLeader ? "#7a4a10" : "#221f1a"),
      }}>
        {isLeader && "👑 "}
        {char.tags && char.tags.includes("heir") && "★ "}
        {fullName}
      </div>
      <div style={{ color: dead ? "#666" : "#4a3a20", fontVariantNumeric: "tabular-nums" }}>
        age {char.age != null ? char.age : "—"}
        {dead && <span style={{ marginLeft: 4, fontStyle: "italic" }}>†</span>}
      </div>
      {char.region && (
        <div style={{ color: dead ? "#555" : "#5a4a30", fontSize: 9, fontStyle: "italic" }}>
          {char.region.replace(/_/g, " ")}
        </div>
      )}
    </div>
  );
}

// ── Tree node (recursive — husband+wife on one row, children below) ─────
//
// Children render in a flex row with a CSS-grid-like horizontal connector
// drawn via two pseudo-positioned dividers. The "first half" of the first
// child and the "second half" of the last child are masked off so the
// horizontal line stops exactly at the centers of the outer cards. This
// removes the brittle `calc(count * 130px)` math that drifted whenever
// the cards weren't exactly 130 px wide.

function FamilyNode({ family, allByHead, culture, modDataDir, depth = 0, coordToPortrait }) {
  const hasChildren = family.children && family.children.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <MemberCard char={family.husband} culture={culture} modDataDir={modDataDir} coordToPortrait={coordToPortrait} />
        {family.wife && (
          <>
            <div style={{ color: "#8a6429", fontSize: 22, margin: "0 6px" }} title="Married">⚭</div>
            <MemberCard char={family.wife} culture={culture} modDataDir={modDataDir} coordToPortrait={coordToPortrait} />
          </>
        )}
      </div>
      {hasChildren && (
        <>
          {/* Vertical line down from parent row */}
          <div style={{ width: 2, height: 18, background: "#8a6429" }} />
          {/* Children row */}
          <div style={{ position: "relative", display: "flex", flexDirection: "row", justifyContent: "center" }}>
            {/* Horizontal connector — only drawn when there's more than one
                child. Inset left/right by half a child slot so the line stops
                at the outer cards' centers. */}
            {family.children.length > 1 && (
              <div style={{
                position: "absolute",
                top: 0,
                left: "calc(50% / " + family.children.length + ")",
                right: "calc(50% / " + family.children.length + ")",
                height: 2,
                background: "#8a6429",
              }} />
            )}
            {family.children.map((c, i) => {
              const sub = allByHead && allByHead.get(c.firstName);
              const subFamily = sub ? {
                husband: c, wife: sub.spouse, children: sub.children || [],
              } : null;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {/* Short vertical stub connecting child to the horizontal line */}
                  <div style={{ width: 2, height: 12, background: "#8a6429" }} />
                  {subFamily ? (
                    <FamilyNode family={subFamily} allByHead={allByHead} culture={culture} modDataDir={modDataDir} depth={depth + 1} coordToPortrait={coordToPortrait} />
                  ) : (
                    <MemberCard char={c} culture={culture} modDataDir={modDataDir} portraitSize={48} compact coordToPortrait={coordToPortrait} />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Resolve a faction's tree (mod-data) into an array of root families ──

function buildRoots(familyData) {
  const byName = new Map();
  for (const c of familyData.members) byName.set(c.firstName, c);
  const childNames = new Set();
  for (const rel of (familyData.relatives || [])) {
    for (const c of (rel.children || [])) childNames.add(c.split(/\s+/)[0]);
  }
  const familyByHead = new Map();
  for (const rel of (familyData.relatives || [])) {
    const husbandFirst = rel.husband.split(/\s+/)[0];
    familyByHead.set(husbandFirst, {
      spouse: rel.wife ? (byName.get(rel.wife.split(/\s+/)[0]) || { firstName: rel.wife, gender: "female" }) : null,
      children: (rel.children || []).map(c => byName.get(c.split(/\s+/)[0]) || { firstName: c.split(/\s+/)[0] }),
    });
  }
  const roots = (familyData.relatives || [])
    .filter(rel => !childNames.has(rel.husband.split(/\s+/)[0]))
    .map(rel => ({
      husband: byName.get(rel.husband.split(/\s+/)[0]) || { firstName: rel.husband, age: null, alive: true },
      wife: rel.wife ? (byName.get(rel.wife.split(/\s+/)[0]) || { firstName: rel.wife, gender: "female" }) : null,
      children: (rel.children || []).map(c => byName.get(c.split(/\s+/)[0]) || { firstName: c.split(/\s+/)[0] }),
    }));
  return { roots, familyByHead };
}

// Find the tree that contains the given character (by firstName). Returns
// the root family containing them (anywhere in the descent chain).
function findRootContaining(roots, familyByHead, firstName) {
  if (!firstName) return roots[0];
  for (const r of roots) {
    if (containsName(r, familyByHead, firstName)) return r;
  }
  return roots[0];
}
function containsName(family, familyByHead, name) {
  if (!family) return false;
  if (family.husband && family.husband.firstName === name) return true;
  if (family.wife && family.wife.firstName === name) return true;
  for (const c of (family.children || [])) {
    if (c.firstName === name) return true;
    const sub = familyByHead.get(c.firstName);
    if (sub) {
      const subFamily = { husband: c, wife: sub.spouse, children: sub.children || [] };
      if (containsName(subFamily, familyByHead, name)) return true;
    }
  }
  return false;
}

// ── Zoom+pan wrapper ────────────────────────────────────────────────────
// `fitKey` — change this string when the children layout changes (faction
// switch, etc) and the viewport will re-fit the tree to the available area.

function ZoomPanViewport({ children, fitKey }) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const dragging = useRef(null);
  const wrapRef = useRef(null);
  const contentRef = useRef(null);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setTransform(t => {
      const newScale = Math.max(0.2, Math.min(2.5, t.scale * (1 + delta)));
      return { ...t, scale: newScale };
    });
  }, []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragging.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  }, [transform]);
  const onMouseMove = useCallback((e) => {
    const d = dragging.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setTransform(t => ({ scale: t.scale, x: d.origX + dx, y: d.origY + dy }));
  }, []);
  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  // Measure the tree's natural size and compute a transform that fits it
  // into the wrapper, with a small margin. Centers horizontally; pins to
  // the top vertically (trees grow downward from the patriarch).
  const fitToView = useCallback(() => {
    const wrap = wrapRef.current;
    const content = contentRef.current;
    if (!wrap || !content) return;
    // Read natural size — temporarily strip the scale by reading
    // scrollWidth/scrollHeight which ignore the CSS transform.
    const cw = content.scrollWidth;
    const ch = content.scrollHeight;
    const ww = wrap.clientWidth;
    const wh = wrap.clientHeight;
    if (cw === 0 || ch === 0) return;
    const MARGIN = 0.92;
    const scale = Math.min(MARGIN * ww / cw, MARGIN * wh / ch, 1);
    const x = Math.round((ww - cw * scale) / 2);
    const y = Math.round((wh - ch * scale) / 2);
    setTransform({ scale, x, y: Math.max(8, y) });
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [onMouseUp]);

  // Auto-fit on mount AND whenever fitKey (faction/general) changes. The
  // double-rAF makes sure layout has settled before we measure.
  useEffect(() => {
    let raf1, raf2;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(fitToView);
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [fitKey, fitToView]);

  return (
    <div
      ref={wrapRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      style={{
        position: "relative", width: "100%", height: "100%",
        overflow: "hidden",
        cursor: dragging.current ? "grabbing" : "grab",
        userSelect: "none",
      }}>
      <div
        ref={contentRef}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
          width: "fit-content",
          padding: 24,
        }}>
        {children}
      </div>
      <div style={{
        position: "absolute", bottom: 8, right: 12, display: "flex", gap: 4,
        background: "rgba(232,222,198,0.9)", padding: "4px 8px",
        border: "1px solid rgba(90,69,48,0.5)", borderRadius: 4,
        fontSize: 11, color: "#3a2a08",
      }}>
        <button onClick={() => setTransform(t => ({ ...t, scale: Math.max(0.2, t.scale * 0.85) }))} style={zoomBtnStyle}>−</button>
        <span style={{ minWidth: 42, textAlign: "center", lineHeight: "22px" }}>
          {Math.round(transform.scale * 100)}%
        </span>
        <button onClick={() => setTransform(t => ({ ...t, scale: Math.min(2.5, t.scale * 1.15) }))} style={zoomBtnStyle}>+</button>
        <button onClick={fitToView} style={zoomBtnStyle} title="Fit to view">⌂</button>
      </div>
    </div>
  );
}

// ── Sidebar list of male adult generals ─────────────────────────────────

function GeneralsList({ generals, selectedName, onSelect, culture, modDataDir, coordToPortrait }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {generals.map((g) => {
        const isSel = g.firstName === selectedName;
        const dead = g.alive === false;
        return (
          <button
            key={g.firstName + (g.lastName || "")}
            onClick={() => onSelect(g.firstName)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 8px",
              background: isSel ? "rgba(168,134,92,0.5)" : "rgba(245,238,220,0.55)",
              color: "#221f1a",
              border: "1px solid " + (isSel ? "#7a4a10" : "rgba(90,69,48,0.35)"),
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              transition: "background 0.12s",
            }}>
            <Portrait char={g} culture={culture} modDataDir={modDataDir} size={32} shape="circle" coordToPortrait={coordToPortrait} />
            <div style={{ flex: 1, lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, color: isSel ? "#3a2208" : "#221f1a" }}>
                {g.tags && g.tags.includes("leader") && "👑 "}
                {g.tags && g.tags.includes("heir") && "★ "}
                {displayFirstName(g.firstName)}
              </div>
              <div style={{ color: "#4a3a20", fontSize: 10 }}>
                age {g.age != null ? g.age : "—"}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function FamilyTree({ characterExtras, familyTreeMaps, modFamiliesByFaction, factionDisplayNames, factionCultures, modDataDir, defaultFaction, playerFaction, onClose }) {
  // Coord→portrait-path lookup built from characterExtras when a save is
  // loaded. Lets a descr_strat-derived tree member (which has x, y from
  // its `character` line) match the save's resolved portrait path AND
  // current-turn data (age, region, alive/dead).
  const coordToSave = useMemo(() => {
    const m = new Map();
    if (!characterExtras) return m;
    for (const c of characterExtras) {
      if (c.extX == null || c.extY == null) continue;
      m.set(`${c.extX},${c.extY}`, {
        cards: c.portraitCardsPath || null,
        fulls: c.portraitFullPath || null,
        age: c.age != null ? c.age : null,
        region: c.region || null,
        ownUuid: c.ownUuid,
      });
    }
    return m;
  }, [characterExtras]);
  // Legacy alias — Portrait component still uses coordToPortrait.
  const coordToPortrait = coordToSave;
  const [selectedFaction, setSelectedFaction] = useState(null);
  const [selectedGeneral, setSelectedGeneral] = useState(null);

  const hasMod = modFamiliesByFaction && Object.keys(modFamiliesByFaction).length > 0;

  const modFactions = useMemo(() => {
    if (!modFamiliesByFaction) return [];
    const pf = playerFaction ? String(playerFaction).toLowerCase() : null;
    return Object.entries(modFamiliesByFaction)
      .map(([id, data]) => ({ id, data }))
      .filter(({ data }) => data.members && data.members.length > 0)
      // RIS's `dummies` is a placeholder faction with -50000 denari that
      // bankrupts and is destroyed after end-turn 1 — drop it from the
      // dropdown unless the player is actually playing as it.
      .filter(({ id }) => id !== "dummies" || pf === "dummies")
      .sort((a, b) => {
        const aRel = (a.data.relatives || []).length;
        const bRel = (b.data.relatives || []).length;
        if (aRel !== bRel) return bRel - aRel;
        return b.data.members.length - a.data.members.length;
      });
  }, [modFamiliesByFaction, playerFaction]);

  // Initial faction: caller-provided (clicked-province owner) if it actually
  // has data; otherwise the faction with the most relatives.
  useEffect(() => {
    if (selectedFaction) return;
    if (modFactions.length === 0) return;
    const def = defaultFaction && String(defaultFaction).toLowerCase();
    if (def && modFactions.some(f => f.id === def)) {
      setSelectedFaction(def);
    } else {
      setSelectedFaction(modFactions[0].id);
    }
  }, [modFactions, selectedFaction, defaultFaction]);

  const factionData = selectedFaction && modFamiliesByFaction ? modFamiliesByFaction[selectedFaction] : null;
  const culture = cultureFor(factionCultures, selectedFaction);

  // Build tree structure + list of of-age male characters for the sidebar.
  // Include both named characters (`character` lines, isCharacter=true) AND
  // family-only members (`character_record` lines) — for some factions /
  // mods the "generals" we care about only exist as character_record rows
  // until the engine promotes them.
  const { roots, familyByHead, generals } = useMemo(() => {
    if (!factionData) return { roots: [], familyByHead: new Map(), generals: [] };
    const { roots: r, familyByHead: f } = buildRoots(factionData);
    const seenNames = new Set();
    const gens = factionData.members
      .filter(c => c.gender !== "female" && c.age != null && c.age >= 16 && c.alive !== false)
      .filter(c => { if (seenNames.has(c.firstName)) return false; seenNames.add(c.firstName); return true; })
      .sort((a, b) => {
        // Leader first, heir second, then by age descending
        const al = a.tags && a.tags.includes("leader") ? 0 : a.tags && a.tags.includes("heir") ? 1 : 2;
        const bl = b.tags && b.tags.includes("leader") ? 0 : b.tags && b.tags.includes("heir") ? 1 : 2;
        if (al !== bl) return al - bl;
        return (b.age || 0) - (a.age || 0);
      });
    return { roots: r, familyByHead: f, generals: gens };
  }, [factionData]);

  // Auto-select leader when faction changes
  useEffect(() => {
    if (factionData) {
      const leader = generals.find(g => g.tags && g.tags.includes("leader")) || generals[0];
      setSelectedGeneral(leader ? leader.firstName : null);
    }
  }, [factionData, generals]);

  const visibleRoot = useMemo(() => {
    if (!roots.length) return null;
    return findRootContaining(roots, familyByHead, selectedGeneral);
  }, [roots, familyByHead, selectedGeneral]);

  if (!hasMod && (!characterExtras || characterExtras.length === 0)) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <Header onClose={onClose} title="Family Tree" />
          <p style={{ padding: 20, color: "#221f1a" }}>No character data loaded yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={cardStyle}>
        <Header
          onClose={onClose}
          title="Family Tree"
          right={
            hasMod && modFactions.length > 0 && (
              <select
                value={selectedFaction || ""}
                onChange={e => setSelectedFaction(e.target.value)}
                style={selectStyle}>
                {modFactions.map(f => {
                  const display = (factionDisplayNames && factionDisplayNames[f.id]) || f.id.replace(/_/g, " ");
                  return (
                    <option key={f.id} value={f.id}>
                      {display}  ({f.data.members.length} members)
                    </option>
                  );
                })}
              </select>
            )
          }
        />
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Sidebar: generals */}
          <div style={{
            width: 220, flexShrink: 0,
            borderRight: "1px solid rgba(90,69,48,0.55)",
            background: "rgba(58,42,8,0.12)",
            overflowY: "auto",
            padding: 10,
          }}>
            <div style={{
              fontSize: 11, letterSpacing: "0.06em",
              color: "#3a2a08", marginBottom: 6, fontWeight: 700,
              textTransform: "uppercase",
            }}>
              Generals ({generals.length})
            </div>
            <GeneralsList
              generals={generals}
              selectedName={selectedGeneral}
              onSelect={setSelectedGeneral}
              culture={culture}
              modDataDir={modDataDir}
              coordToPortrait={coordToPortrait}
            />
          </div>
          {/* Right: zoom/pan tree */}
          <div style={{ flex: 1, minWidth: 0, position: "relative", background: "rgba(58,42,8,0.05)" }}>
            {visibleRoot ? (
              <ZoomPanViewport fitKey={`${selectedFaction}|${selectedGeneral}`}>
                <FamilyNode family={visibleRoot} allByHead={familyByHead} culture={culture} modDataDir={modDataDir} coordToPortrait={coordToPortrait} />
              </ZoomPanViewport>
            ) : (
              <div style={{ padding: 20, color: "#3a2a08" }}>
                {factionData ? "No families with relatives defined for this faction." : "Select a faction to view its family tree."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ title, right, onClose }) {
  return (
    <div style={headerStyle}>
      <h2 style={titleStyle}>{title}</h2>
      <div style={{ flex: 1 }} />
      {right}
      <button onClick={onClose} style={closeBtnStyle} title="Close">×</button>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────
// Solid marble window above the main app — NOT see-through. The card has its
// own opaque marble background (same texture the body canvas uses), with a
// dark gold border to look like a window frame.

const overlayStyle = {
  position: "fixed", inset: 0, zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(0,0,0,0.65)",
};

const cardStyle = {
  position: "relative",
  width: "min(1200px, 94vw)", height: "min(820px, 92vh)",
  display: "flex", flexDirection: "column",
  padding: 0,
  overflow: "hidden",
  borderRadius: 12,
  boxShadow: "0 8px 40px rgba(0,0,0,0.55)",
  // Solid marble background with the same 12 % black overlay App.js applies
  // to the body marble canvas — keeps the modal's hue consistent with the
  // main window's marble. CSS background-image loads reliably without the
  // canvas-timing race that the prior <MarbleBackdrop> hit.
  backgroundColor: "#c4b896",
  backgroundImage:
    `linear-gradient(rgba(0,0,0,0.12), rgba(0,0,0,0.12)), url(${PUBLIC_URL}menu_marble_frame.png)`,
  backgroundRepeat: "no-repeat, repeat",
  color: "#221f1a",
};

const headerStyle = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "10px 16px",
  borderBottom: "1px solid rgba(90,69,48,0.4)",
};

const titleStyle = {
  margin: 0, fontSize: 17, fontWeight: 700,
  color: "#221f1a",
  letterSpacing: "0.02em",
};

const selectStyle = {
  padding: "4px 10px", fontSize: 12,
  background: "rgba(255,255,235,0.85)", color: "#221f1a",
  border: "1px solid rgba(90,69,48,0.55)", borderRadius: 4,
  fontWeight: 600,
};

const closeBtnStyle = {
  padding: "0 10px", fontSize: 22, lineHeight: 1,
  background: "rgba(168,134,92,0.18)", color: "#221f1a",
  border: "1px solid rgba(90,69,48,0.5)", borderRadius: 4,
  cursor: "pointer", fontWeight: 700,
};

const zoomBtnStyle = {
  background: "rgba(168,134,92,0.25)",
  color: "#3a2a08",
  border: "1px solid rgba(90,69,48,0.4)",
  borderRadius: 3,
  padding: "2px 8px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
};
