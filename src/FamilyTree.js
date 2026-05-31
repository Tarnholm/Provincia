// src/FamilyTree.js
//
// Family tree panel: sidebar list of male adult characters (generals) on the
// left, zoomable/pannable tree view on the right. Uses in-game portraits
// loaded from the mod / vanilla install via the resolvePortrait IPC.

import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { loadPortrait, getCachedPortrait } from "./portraitIcons";
import { playAnimation } from "./AnimationLayout";
import {
  lifespanFor,
  visibilityAt,
  timelineTicks,
  turnToYear,
  formatYear,
  DEFAULT_TURNS_PER_YEAR,
} from "./familyTimeline";

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
  // file directly, bypassing the hash.
  const charContext = useMemo(() => {
    if (slot !== "general" || !char.firstName) return null;
    const ctx = {
      name: char.firstName,
      lastName: char.lastName || "",
      faction: char.faction || "",
      age: char.age != null ? Number(char.age) : null,
      portraitIndex: char.portraitIndex != null ? Number(char.portraitIndex) : null,
    };
    if (coordToPortrait) {
      // Precise primary: coord bridge (one char per tile, disambiguates
      // same-name chars). Falls back to the persisted name-keyed statsCache
      // entry (0.9.525) — same source the unit cards use, so the two views
      // can't diverge, and it survives app restart without a recalibration.
      let hit = null;
      if (char.x != null && char.y != null) hit = coordToPortrait.get(`${char.x},${char.y}`);
      if (!hit || !hit.cards) {
        const fn = (char.firstName || "").toLowerCase();
        const ln = (char.lastName || "").replace(/_/g, " ").toLowerCase();
        const fac = (char.faction || "").toLowerCase();
        hit = coordToPortrait.get(`name:${fn}|${ln}|${fac}`)
          || coordToPortrait.get(`name:${fn}||${fac}`)
          || coordToPortrait.get(`name:${fn}||`)
          || hit;
      }
      if (hit && hit.cards) ctx.savePath = hit.cards;
    }
    return ctx;
  }, [slot, char.firstName, char.lastName, char.faction, char.age, char.portraitIndex, char.x, char.y, coordToPortrait]);
  const [url, setUrl] = useState(() => getCachedPortrait(culture, slot, charContext));

  useEffect(() => {
    // 0.9.523: removed the `if (!url)` guard. Calibrate finishes ~10s after
    // the family tree first mounts (parsing the save buffer takes a while);
    // when it finally populates v1PortraitsByCoord the Portrait component
    // re-renders with a real charContext.savePath, but the OLD guard meant
    // the useEffect saw `url != null` (hash-pool URL from first render) and
    // skipped the reload, freezing every portrait on the hash pick. Now
    // every charContext change triggers a reload; loadPortrait's cache
    // makes the no-op path cheap, and setUrl only fires on success so the
    // visible img doesn't flicker.
    let alive = true;
    loadPortrait(modDataDir, culture, slot, charContext).then(u => {
      if (typeof window !== "undefined" && charContext) {
        window.__familyTreePortraitLogged ||= new Set();
        const k = `${charContext.name}|${charContext.lastName || ""}|${charContext.faction || ""}|${charContext.savePath || "(hash)"}`;
        if (!window.__familyTreePortraitLogged.has(k)) {
          window.__familyTreePortraitLogged.add(k);
          console.log(`[family-tree] portrait ${u ? "OK" : "FAIL"} "${charContext.name}" faction="${charContext.faction}" savePath="${charContext.savePath || "(hash)"}"`);
        }
      }
      if (alive && u && u !== url) setUrl(u);
    });
    return () => { alive = false; };
  }, [culture, slot, modDataDir, charContext]);

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
      border: "1px solid " + (dead ? "var(--ft-portrait-frame-dead)" : "var(--ft-portrait-frame)"),
      overflow: "hidden",
      background: "var(--ft-portrait-empty)",
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
          color: dead ? "var(--ft-member-text-dead)" : "var(--ft-portrait-empty-text)",
          fontSize: Math.min(w, h) * 0.45,
          background: "var(--ft-portrait-empty)",
          filter: dead ? deadFilter : "none",
        }}>
          {slot === "wife" ? "♀" : slot === "daughter" ? "♀" : slot === "son" ? "♂" : "♂"}
        </div>
      )}
    </div>
  );
}

// ── MemberCard (the visual block per character in the tree) ─────────────

// 0.9.430: extracted to displayName.js so RegionInfo + InfoPopup +
// bodyguard tooltips share the same name formatter (AntigonosB →
// "Antigonos II", etc).
import { displayFirstName } from "./displayName.js";

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

function MemberCard({ char: rawChar, culture, modDataDir, portraitSize = 64, compact = false, coordToPortrait, onSelectCharacter, onShowInfo, scrubAnim, fadeOut }) {
  const cardRef = useRef(null);
  // scrubAnim: "pop" | "bouncein" | "retract" | "wiggle" | null. Fired
  // once on mount / when the prop changes so the timeline-scrubber's
  // birth/death events get a visible animation.
  useEffect(() => {
    if (!scrubAnim || !cardRef.current) return;
    try { playAnimation(cardRef.current, scrubAnim); }
    catch (e) { /* anim id might not exist in some builds; non-fatal */ }
  }, [scrubAnim]);
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
      // 0.9.416: merge save-derived traits + ancillaries onto the
      // descr_strat-derived char so the right-click info panel shows
      // current-turn values (epithets gained mid-campaign, etc) instead
      // of frozen T0 values. Falls back to whatever rawChar already
      // carried if the save didn't bridge a v1 char on this tile.
      traits: hit.traits || rawChar.traits,
      ancillaries: hit.ancillaries || rawChar.ancillaries,
      clanHead: hit.clanHead || rawChar.clanHead,
      primaryUuid: hit.primaryUuid || rawChar.primaryUuid,
      command: hit.command != null ? hit.command : rawChar.command,
      influence: hit.influence != null ? hit.influence : rawChar.influence,
      management: hit.management != null ? hit.management : rawChar.management,
      loyalty: hit.loyalty != null ? hit.loyalty : rawChar.loyalty,
    };
  }, [rawChar, coordToPortrait]);
  const dead = char.alive === false || char.isDead;
  const isLeader = char.tags && char.tags.includes("leader");
  const fullName = displayFirstName(char.firstName) +
    (char.lastName ? " " + char.lastName.replace(/_/g, " ") : "");
  const interactive = onSelectCharacter || onShowInfo;
  return (
    <div
      ref={cardRef}
      data-anim-id={`fam-card-${char.firstName || "?"}-${char.lastName || ""}`}
      title={interactive ? tooltipFor(char) + "\n\n(left-click: center tree, right-click: info)" : tooltipFor(char)}
      onClick={interactive && onSelectCharacter ? () => onSelectCharacter(famKey(char)) : undefined}
      onContextMenu={onShowInfo ? (e) => { e.preventDefault(); onShowInfo({ type: "character", character: char, label: fullName }); } : undefined}
      style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      padding: compact ? 4 : 6,
      margin: 4,
      minWidth: compact ? 92 : 116,
      background: char._pending ? "rgba(92,200,120,0.10)" : dead ? "var(--ft-member-bg-dead)" : "var(--ft-member-bg)",
      color: dead ? "var(--ft-member-text-dead)" : "var(--ft-text)",
      border: char._pending ? "1px dashed #5ec878" : "1px solid var(--ft-member-border)",
      borderRadius: 4,
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      fontSize: compact ? 10 : 11,
      textAlign: "center",
      cursor: interactive ? "pointer" : "default",
      opacity: fadeOut ? 0.15 : 1,
      transition: "opacity 600ms ease-out",
    }}>
      <Portrait char={char} culture={culture} modDataDir={modDataDir} size={portraitSize} coordToPortrait={coordToPortrait} />
      <div style={{
        fontWeight: 700, marginTop: 3, lineHeight: 1.1,
        color: dead ? "var(--ft-member-text-dead)" : (isLeader ? "var(--ft-leader-name)" : "var(--ft-text)"),
      }}>
        {isLeader && "👑 "}
        {char.tags && char.tags.includes("heir") && "★ "}
        {fullName}
      </div>
      {char._pending && <div style={{ color: "#5ec878", fontSize: 9, fontWeight: 700 }}>⏳ pending — Save to apply</div>}
      <div style={{ color: dead ? "var(--ft-member-text-dead)" : "var(--ft-text-muted)", fontVariantNumeric: "tabular-nums" }}>
        age {char.age != null ? char.age : "—"}
        {dead && <span style={{ marginLeft: 4, fontStyle: "italic" }}>†</span>}
      </div>
      {char.region && (
        <div style={{ color: dead ? "var(--ft-member-text-dead)" : "var(--ft-text-faint)", fontSize: 9, fontStyle: "italic" }}>
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

// Per-character scrub verdict. `scrubFilter(char)` returns:
//   { visible: bool, bornThisTurn: bool, diedThisTurn: bool } | null
// null/undefined => no filter, treat as visible.
function scrubVerdict(scrubFilter, char) {
  if (!scrubFilter) return { visible: true, bornThisTurn: false, diedThisTurn: false };
  const v = scrubFilter(char);
  return v || { visible: true, bornThisTurn: false, diedThisTurn: false };
}

function scrubAnimFor(verdict) {
  if (!verdict) return null;
  // Calm, settled motion (was "bouncein"/"wiggle"). The old spring-overshoot
  // entrance and side-to-side rotation wobble made cards visibly "bounce" on
  // every live-save snapshot (and on each scrub step). A birth now does a soft
  // crossfade (240ms, no overshoot, 3px settle); a death does NOTHING here
  // because the card already fades via the `fadeOut` opacity transition — the
  // extra rotation wobble was pure jitter. Result: cards settle, not oscillate.
  if (verdict.bornThisTurn) return "crossfade";
  return null;
}

function FamilyNode({ family, allByHead, culture, modDataDir, depth = 0, coordToPortrait, onSelectCharacter, onShowInfo, scrubFilter }) {
  const husbandV = scrubVerdict(scrubFilter, family.husband);
  const wifeV = family.wife ? scrubVerdict(scrubFilter, family.wife) : null;

  // Parent row: hide entirely if neither spouse is visible AND this is
  // NOT the death frame (so we still flash the wiggle on the turn they
  // die, then the next-turn re-render drops them).
  const showHusband = husbandV.visible || husbandV.diedThisTurn;
  const showWife = !!(family.wife && (wifeV.visible || wifeV.diedThisTurn));

  // If neither spouse renders, still render the subtree (children that
  // ARE visible) — they need somewhere to anchor. Use a sentinel "ghost"
  // empty row of height 0 so connectors align.
  const visibleChildren = (family.children || []).map((c) => {
    const v = scrubVerdict(scrubFilter, c);
    return { c, v };
  }).filter(({ v }) => v.visible || v.bornThisTurn || v.diedThisTurn);

  const hasChildren = visibleChildren.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {showHusband && (
          <MemberCard
            key={family.husband.firstName + "|" + (family.husband.lastName || "")}
            char={family.husband}
            culture={culture}
            modDataDir={modDataDir}
            coordToPortrait={coordToPortrait}
            onSelectCharacter={onSelectCharacter}
            onShowInfo={onShowInfo}
            scrubAnim={scrubAnimFor(husbandV)}
            fadeOut={husbandV.diedThisTurn && !husbandV.visible}
          />
        )}
        {showWife && (
          <>
            {showHusband && <div style={{ color: "var(--ft-connector)", fontSize: 22, margin: "0 6px" }} title="Married">⚭</div>}
            <MemberCard
              key={family.wife.firstName + "|" + (family.wife.lastName || "")}
              char={family.wife}
              culture={culture}
              modDataDir={modDataDir}
              coordToPortrait={coordToPortrait}
              onSelectCharacter={onSelectCharacter}
              onShowInfo={onShowInfo}
              scrubAnim={scrubAnimFor(wifeV)}
              fadeOut={wifeV && wifeV.diedThisTurn && !wifeV.visible}
            />
          </>
        )}
      </div>
      {hasChildren && (
        <>
          {/* Vertical line down from parent row */}
          <div style={{ width: 2, height: 18, background: "var(--ft-connector)" }} />
          {/* Children row */}
          <div style={{ position: "relative", display: "flex", flexDirection: "row", justifyContent: "center" }}>
            {/* Horizontal connector — only drawn when there's more than one
                child. Inset left/right by half a child slot so the line stops
                at the outer cards' centers. */}
            {visibleChildren.length > 1 && (
              <div style={{
                position: "absolute",
                top: 0,
                left: "calc(50% / " + visibleChildren.length + ")",
                right: "calc(50% / " + visibleChildren.length + ")",
                height: 2,
                background: "var(--ft-connector)",
              }} />
            )}
            {visibleChildren.map(({ c, v }, i) => {
              const sub = allByHead && allByHead.get(famKey(c));
              const subFamily = sub ? {
                husband: c, wife: sub.spouse, children: sub.children || [],
              } : null;
              return (
                <div key={c.firstName + "|" + (c.lastName || "") + "|" + i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {/* Short vertical stub connecting child to the horizontal line */}
                  <div style={{ width: 2, height: 12, background: "var(--ft-connector)" }} />
                  {subFamily ? (
                    <FamilyNode family={subFamily} allByHead={allByHead} culture={culture} modDataDir={modDataDir} depth={depth + 1} coordToPortrait={coordToPortrait} onSelectCharacter={onSelectCharacter} onShowInfo={onShowInfo} scrubFilter={scrubFilter} />
                  ) : (
                    <MemberCard
                      char={c}
                      culture={culture}
                      modDataDir={modDataDir}
                      portraitSize={48}
                      compact
                      coordToPortrait={coordToPortrait}
                      onSelectCharacter={onSelectCharacter}
                      onShowInfo={onShowInfo}
                      scrubAnim={scrubAnimFor(v)}
                      fadeOut={v.diedThisTurn && !v.visible}
                    />
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
//
// 0.9.770: identity is now a FULL-name key, not the bare first name. Roman
// families re-use praenomina (Gaius, Lucius, Quintus...), so first-name keys
// collided distinct people: byName.get("Gaius") returned whichever Gaius was
// stored last, and familyByHead.get("Gaius") merged unrelated households —
// collapsing the visible tree and dropping family heads. The `relative`
// blocks already reference characters by full name ("Quintus Ogulnius_Gallus"),
// so a full-name key resolves them unambiguously. See
// findings-family-tree-2026-05-31.md.

// Normalize a "First Surname" string (or a member object) to a stable key.
// Surnames may carry underscores (Ogulnius_Gallus) — collapse to spaces so the
// `character`/`character_record`/`relative` spellings all hash the same.
export function famKey(nameOrChar) {
  if (!nameOrChar) return "";
  if (typeof nameOrChar === "object") {
    const fn = nameOrChar.firstName || "";
    const ln = (nameOrChar.lastName || "").replace(/_/g, " ").trim();
    return ln ? `${fn} ${ln}` : fn;
  }
  return String(nameOrChar).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function buildRoots(familyData) {
  const byName = new Map();      // full-name key -> member object
  const byFirst = new Map();     // bare first name -> member (fallback only)
  for (const c of familyData.members) {
    byName.set(famKey(c), c);
    if (!byFirst.has(c.firstName)) byFirst.set(c.firstName, c);
  }
  // Resolve a relative-line name (full "First Surname") to a member object,
  // preferring the exact full-name match, then a bare first-name fallback for
  // sparse mods that only spell the praenomen, else a synthetic stub.
  const resolve = (nm, extra) => {
    const key = famKey(nm);
    const hit = byName.get(key) || byFirst.get(key.split(/\s+/)[0]);
    if (hit) return hit;
    const parts = key.split(/\s+/);
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null, ...extra };
  };
  const childKeys = new Set();
  for (const rel of (familyData.relatives || [])) {
    for (const c of (rel.children || [])) childKeys.add(famKey(c));
  }
  const familyByHead = new Map(); // husband full-name key -> { spouse, children }
  for (const rel of (familyData.relatives || [])) {
    familyByHead.set(famKey(rel.husband), {
      spouse: rel.wife ? resolve(rel.wife, { gender: "female" }) : null,
      children: (rel.children || []).map(c => resolve(c, {})),
    });
  }
  const roots = (familyData.relatives || [])
    .filter(rel => !childKeys.has(famKey(rel.husband)))
    .map(rel => ({
      husband: resolve(rel.husband, { age: null, alive: true }),
      wife: rel.wife ? resolve(rel.wife, { gender: "female" }) : null,
      children: (rel.children || []).map(c => resolve(c, {})),
    }));
  return { roots, familyByHead };
}

// Find the tree that contains the given character (by full-name key). Returns
// the root family containing them (anywhere in the descent chain).
function findRootContaining(roots, familyByHead, key) {
  if (!key) return roots[0];
  for (const r of roots) {
    if (containsName(r, familyByHead, key)) return r;
  }
  return roots[0];
}
function containsName(family, familyByHead, key) {
  if (!family) return false;
  if (family.husband && famKey(family.husband) === key) return true;
  if (family.wife && famKey(family.wife) === key) return true;
  for (const c of (family.children || [])) {
    if (famKey(c) === key) return true;
    const sub = familyByHead.get(famKey(c));
    if (sub) {
      const subFamily = { husband: c, wife: sub.spouse, children: sub.children || [] };
      if (containsName(subFamily, familyByHead, key)) return true;
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
        background: "var(--ft-input-bg)", padding: "4px 8px",
        border: "1px solid var(--ft-border)", borderRadius: 4,
        fontSize: 11, color: "var(--ft-text)",
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
        const isSel = famKey(g) === selectedName;
        const dead = g.alive === false;
        return (
          <button
            key={g.firstName + (g.lastName || "")}
            onClick={() => onSelect(famKey(g))}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "4px 8px",
              background: isSel ? "var(--ft-btn-bg-active, rgba(168,134,92,0.5))" : "var(--ft-member-bg)",
              color: "var(--ft-text)",
              border: "1px solid " + (isSel ? "var(--ft-leader-name)" : "var(--ft-member-border)"),
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              transition: "background 0.12s",
            }}>
            <Portrait char={g} culture={culture} modDataDir={modDataDir} size={32} shape="circle" coordToPortrait={coordToPortrait} />
            <div style={{ flex: 1, lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, color: isSel ? "var(--ft-leader-name)" : "var(--ft-text)" }}>
                {g.tags && g.tags.includes("leader") && "👑 "}
                {g.tags && g.tags.includes("heir") && "★ "}
                {displayFirstName(g.firstName)}
              </div>
              <div style={{ color: "var(--ft-text-muted)", fontSize: 10 }}>
                age {g.age != null ? g.age : "—"}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Timeline scrubber (history scrubber for the family tree) ────────────
//
// Slider [0, currentTurn] with play/pause. Persists position in
// localStorage as `familyTreeScrubTurn`. Renders thin red/green tick
// marks for years where any character in `allChars` died / was born.
// Tooltip shows "Year ... · N alive".

const PLAY_INTERVAL_MS = 333; // ~3 turns/sec

function TimelineScrubber({ currentTurn, currentYear, allChars, scrubTurn, setScrubTurn, playing, setPlaying, aliveCount }) {
  const trackRef = useRef(null);
  const userDraggingRef = useRef(false);

  const { births, deaths } = useMemo(() => timelineTicks(allChars, { currentTurn, currentYear }), [allChars, currentTurn, currentYear]);

  // Play loop — advance scrubTurn at ~3/sec, loop back to 0 at end.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setScrubTurn((t) => {
        if (t >= currentTurn) {
          console.log(`[fam-scrub] reached end at turn ${currentTurn}`);
          return 0;
        }
        return t + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, currentTurn, setScrubTurn]);

  const year = turnToYear(scrubTurn, { currentTurn, currentYear });
  const yearStr = formatYear(year);
  const pct = currentTurn > 0 ? (scrubTurn / currentTurn) * 100 : 100;

  const tooltipText = `Year ${yearStr} · ${aliveCount} alive`;

  const stopProp = (e) => e.stopPropagation();

  return (
    <div
      onClick={stopProp}
      onMouseDown={stopProp}
      onMouseMove={stopProp}
      onWheel={stopProp}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 8px",
        background: "var(--ft-input-bg)",
        border: "1px solid var(--ft-border)",
        borderRadius: 4,
        minWidth: 280,
      }}
      title={tooltipText}
    >
      <button
        onClick={() => {
          if (!playing) {
            console.log("[fam-scrub] play start");
            // If we're at the end, restart from 0 on play.
            if (scrubTurn >= currentTurn) setScrubTurn(0);
            setPlaying(true);
          } else {
            console.log("[fam-scrub] play stop");
            setPlaying(false);
          }
        }}
        style={{
          background: "var(--ft-btn-bg)",
          color: "var(--ft-text)",
          border: "1px solid var(--ft-border)",
          borderRadius: 3,
          padding: "1px 8px",
          fontSize: 14,
          lineHeight: 1,
          cursor: "pointer",
          fontWeight: 700,
        }}
        title={playing ? "Pause" : "Play timeline"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div ref={trackRef} style={{ position: "relative", flex: 1, height: 22 }}>
        {/* Tick markers overlay (red = death, green = birth). Behind the
            slider thumb but on top of the track. */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 6, bottom: 6, pointerEvents: "none" }}>
          {currentTurn > 0 && births.map((t) => (
            <div key={`b-${t}`} style={{
              position: "absolute",
              left: `${(t / currentTurn) * 100}%`,
              top: 0, bottom: 0,
              width: 1,
              background: "rgba(80, 200, 120, 0.85)",
            }} />
          ))}
          {currentTurn > 0 && deaths.map((t) => (
            <div key={`d-${t}`} style={{
              position: "absolute",
              left: `${(t / currentTurn) * 100}%`,
              top: 0, bottom: 0,
              width: 1,
              background: "rgba(220, 90, 90, 0.85)",
            }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(1, currentTurn)}
          step={1}
          value={Math.min(scrubTurn, Math.max(1, currentTurn))}
          onMouseDown={() => { userDraggingRef.current = true; if (playing) { console.log("[fam-scrub] play stop"); setPlaying(false); } }}
          onMouseUp={() => { userDraggingRef.current = false; }}
          onChange={(e) => setScrubTurn(Number(e.target.value))}
          style={{
            position: "relative",
            width: "100%",
            margin: 0,
            background: "transparent",
          }}
          title={tooltipText}
        />
      </div>
      <div style={{
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        color: "var(--ft-text-muted)",
        whiteSpace: "nowrap",
        minWidth: 90,
        textAlign: "right",
      }} title={tooltipText}>
        T{scrubTurn} · {yearStr}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function FamilyTree({ characterExtras, v1PortraitsByCoord, statsCache, familyTreeMaps, modFamiliesByFaction, pendingGenerals, factionDisplayNames, factionCultures, modDataDir, defaultFaction, playerFaction, currentTurn, currentYear, onShowInfo, onClose }) {
  // 0.9.513: coord→portrait map now prefers v1-derived portraits over the
  // cracker's. The cracker's extX/extY (+288/+292 of the extended record)
  // gives scrambled coords — every named character's family-tree portrait
  // was being assigned to the WRONG character's coord. v1 reads portrait
  // strings inside the character record so the (tile, portrait) pairing is
  // structurally tight. v1PortraitsByCoord wins; the cracker fields stay
  // for age/region/uuid/traits lookups (which DO come from the cracker's
  // record correctly).
  const coordToSave = useMemo(() => {
    const m = new Map();
    // 0.9.523: v1's coord-portrait map is the source of truth — its tileX/
    // tileY come from the live save records directly. Build it FIRST so
    // any later merge from characterExtras can only enrich (never replace)
    // these correct portrait paths. Previously the cracker's extX/extY-
    // keyed entries went in first; per [354-byte coord/state record table]
    // memo those coords are scrambled, and any happenstance overlap with a
    // real v1 coord would corrupt the portrait at that tile.
    if (v1PortraitsByCoord) {
      for (const [key, v] of Object.entries(v1PortraitsByCoord)) {
        m.set(key, {
          cards: v.cards || null,
          fulls: v.fulls || null,
        });
      }
    }
    // Now merge cracker-attached fields (age, region, traits, stats) onto
    // matching v1 coords. If c.extX/c.extY happens to land on a real v1
    // coord that's almost certainly coincidence (scrambled coords have
    // sparse collisions with the real coord space) so this enrichment is
    // best-effort. Cracker entries whose coord doesn't match any v1 tile
    // are dropped — their coord key is wrong, and storing them only risks
    // corruption when the family tree looks up a descr_strat (x,y).
    if (characterExtras) {
      for (const c of characterExtras) {
        if (c.extX == null || c.extY == null) continue;
        const key = `${c.extX},${c.extY}`;
        const existing = m.get(key);
        if (!existing) continue; // no v1 portrait at this tile — skip
        // 0.9.416: per-character traits / ancillaries bridged via the same
        // coord match. Lets the right-click character info panel show
        // actual save-state traits / stats / epithets gained mid-campaign.
        existing.age = c.age != null ? c.age : existing.age;
        existing.region = c.region || existing.region;
        existing.ownUuid = c.ownUuid;
        existing.traits = Array.isArray(c.traits) ? c.traits : existing.traits;
        existing.ancillaries = Array.isArray(c.ancillaries) ? c.ancillaries : existing.ancillaries;
        existing.firstName = c.firstName || existing.firstName;
        existing.lastName = c.lastName || existing.lastName;
        existing.clanHead = c.clanHead || existing.clanHead;
        existing.primaryUuid = c.primaryUuid || existing.primaryUuid;
        existing.command = typeof c.command === "number" ? c.command : existing.command;
        existing.influence = typeof c.influence === "number" ? c.influence : existing.influence;
        existing.management = typeof c.management === "number" ? c.management : existing.management;
        existing.loyalty = typeof c.loyalty === "number" ? c.loyalty : existing.loyalty;
      }
    }
    // 0.9.525: fold the persisted statsCache into the SAME map under
    // `name:<fn>|<ln>|<fac>` keys (and stripped fallbacks). This is what
    // links the family tree to the unit cards: bodyguard-swap resolves a
    // char's portrait from statsCache[nameKey].portrait, and now the family
    // tree resolves the identical entry by the identical key. Because
    // statsCache is persisted to localStorage and rehydrated on startup,
    // the family tree gets correct portraits on launch with NO recalibration
    // — and can never disagree with the bodyguard card for the same char.
    // Coord keys (x,y) stay the precise primary lookup; name keys are the
    // persisted fallback used when the coord bridge has no hit (e.g. before
    // calibrate runs in the current session, or for chars off the map).
    if (statsCache) {
      for (const [k, v] of Object.entries(statsCache)) {
        if (!v || !v.portrait) continue;
        // statsCache keys are already `fn|ln|fac` / `fn||fac` / `fn||` —
        // reuse them verbatim under a `name:` namespace.
        m.set(`name:${k}`, { cards: v.portrait, fulls: v.portrait });
      }
    }
    return m;
  }, [characterExtras, v1PortraitsByCoord, statsCache]);
  // Legacy alias — Portrait component still uses coordToPortrait.
  const coordToPortrait = coordToSave;
  // 0.9.449: surface coord-bridge size + collision stats so we can debug
  // family-tree portrait coverage. If many chars share the same (x,y),
  // they collapse to the LAST one's portrait — symptom: family tree shows
  // the same face for many chars in the player's faction.
  useEffect(() => {
    if (!characterExtras) return;
    if (typeof window === "undefined") return;
    if (window.__familyTreeCoordLogged) return;
    window.__familyTreeCoordLogged = true;
    let withCoords = 0;
    let withPortrait = 0;
    const tileCounts = new Map();
    for (const c of characterExtras) {
      if (c.extX != null && c.extY != null) {
        withCoords++;
        const k = `${c.extX},${c.extY}`;
        tileCounts.set(k, (tileCounts.get(k) || 0) + 1);
      }
      if (c.portraitCardsPath) withPortrait++;
    }
    const collisions = [];
    for (const [k, n] of tileCounts) if (n > 1) collisions.push(`${k}=${n}`);
    console.log(`[family-tree] coord-bridge: ${characterExtras.length} extras, ${withCoords} with (x,y), ${withPortrait} with portraitCardsPath, map.size=${coordToSave.size}. Collisions (tile shared by >1 char): ${collisions.slice(0, 10).join(" ") || "(none)"}${collisions.length > 10 ? ` +${collisions.length - 10} more` : ""}`);
  }, [characterExtras, coordToSave]);
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
      // 0.9.770: dedup by FULL name. First-name dedup collapsed distinct
      // generals sharing a Roman praenomen (two Gaii, three Lucii...) into
      // one sidebar row — a second way the Julii list lost members.
      .filter(c => { const k = famKey(c); if (seenNames.has(k)) return false; seenNames.add(k); return true; })
      .sort((a, b) => {
        // Leader first, heir second, then by age descending
        const al = a.tags && a.tags.includes("leader") ? 0 : a.tags && a.tags.includes("heir") ? 1 : 2;
        const bl = b.tags && b.tags.includes("leader") ? 0 : b.tags && b.tags.includes("heir") ? 1 : 2;
        if (al !== bl) return al - bl;
        return (b.age || 0) - (a.age || 0);
      });
    // Merge staged (not-yet-saved) generals for this faction as pending root
    // families so the user sees additions before Save. Marked _pending.
    if (pendingGenerals && pendingGenerals.size > 0 && selectedFaction) {
      for (const [, e] of pendingGenerals) {
        if (String(e.faction).toLowerCase() !== String(selectedFaction).toLowerCase()) continue;
        const sel = e.selection || {};
        const nameParts = String(e.displayName || (sel.general && sel.general.firstDisplay) || "?").trim().split(/\s+/);
        const fn = (sel.general && sel.general.firstDisplay) || nameParts[0];
        const ln = nameParts.length > 1 ? nameParts.slice(1).join("_") : null;
        const husband = { firstName: fn, lastName: ln, age: sel.general ? sel.general.age : e.age, alive: true, gender: "male", _pending: true, x: sel.x, y: sel.y };
        const wife = sel.wife ? { firstName: sel.wife.firstDisplay, age: sel.wife.age, gender: "female", alive: !sel.wife.dead, _pending: true } : null;
        const children = (sel.children || []).map((k) => ({ firstName: k.firstDisplay, age: k.age, gender: k.gender === "daughter" ? "female" : "male", lastName: k.gender === "son" ? ln : null, alive: true, _pending: true }));
        r.push({ husband, wife, children, _pending: true });
        gens.unshift(husband);
      }
    }
    // Diagnostic: which source fed the tree + the member/root/general counts,
    // so provincia.log shows whether the praenomen-clobber regression is gone.
    if (typeof console !== "undefined") {
      const males = factionData.members.filter(c => c.gender !== "female").length;
      const adults = factionData.members.filter(c => c.gender !== "female" && c.age != null && c.age >= 16 && c.alive !== false).length;
      console.log(`[family-tree] source=modFamiliesByFaction[${selectedFaction}] members=${factionData.members.length} (males=${males}, adultMales>=16=${adults}) relatives=${(factionData.relatives || []).length} rootFamilies=${r.length} generals(sidebar)=${gens.length}`);
    }
    return { roots: r, familyByHead: f, generals: gens };
  }, [factionData, pendingGenerals, selectedFaction]);

  // Auto-select leader when faction changes
  useEffect(() => {
    if (factionData) {
      const leader = generals.find(g => g.tags && g.tags.includes("leader")) || generals[0];
      setSelectedGeneral(leader ? famKey(leader) : null);
    }
  }, [factionData, generals]);

  const visibleRoot = useMemo(() => {
    if (!roots.length) return null;
    return findRootContaining(roots, familyByHead, selectedGeneral);
  }, [roots, familyByHead, selectedGeneral]);

  // ── Timeline scrubber state ────────────────────────────────────────
  //
  // The slider range is [0, currentTurn]. Default = currentTurn (i.e.
  // "show present-day" — preserves existing behavior). Persists in
  // localStorage so the user's last scrub position is restored on
  // reopen WITHIN the same session.
  const effectiveCurrentTurn = typeof currentTurn === "number" && currentTurn > 0 ? currentTurn : 0;
  const haveTimeline = effectiveCurrentTurn > 0;
  const [scrubTurn, setScrubTurnRaw] = useState(() => {
    if (!haveTimeline) return 0;
    try {
      const v = window.localStorage.getItem("familyTreeScrubTurn");
      if (v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= effectiveCurrentTurn) return n;
      }
    } catch (e) { /* localStorage unavailable */ }
    return effectiveCurrentTurn;
  });
  const [playing, setPlaying] = useState(false);
  const setScrubTurn = useCallback((updater) => {
    setScrubTurnRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { window.localStorage.setItem("familyTreeScrubTurn", String(next)); } catch (e) {}
      return next;
    });
  }, []);

  // Clamp persisted value if currentTurn changes (mid-session save reload).
  useEffect(() => {
    if (!haveTimeline) return;
    setScrubTurnRaw((t) => Math.min(t, effectiveCurrentTurn));
  }, [effectiveCurrentTurn, haveTimeline]);

  // All characters in the currently-visible faction tree (flat). Used
  // for tick-mark computation AND for the alive-count tooltip.
  const allCharsForFaction = useMemo(() => {
    if (!factionData || !factionData.members) return [];
    return factionData.members;
  }, [factionData]);

  // Bridge save's per-(x,y) age onto each descr_strat character so the
  // scrubFilter can compute birthTurn correctly even when descr_strat
  // only carries a T0 age. MemberCard already does this for display,
  // but we need it BEFORE the visibility decision.
  const ageBridge = useCallback((char) => {
    if (!coordToPortrait || char.x == null || char.y == null) return char;
    const hit = coordToPortrait.get(`${char.x},${char.y}`);
    if (!hit) return char;
    return {
      ...char,
      age: hit.age != null ? hit.age : char.age,
    };
  }, [coordToPortrait]);

  const scrubOpts = useMemo(() => ({
    currentTurn: effectiveCurrentTurn,
    currentYear,
    turnsPerYear: DEFAULT_TURNS_PER_YEAR,
  }), [effectiveCurrentTurn, currentYear]);

  const scrubFilter = useCallback((char) => {
    if (!haveTimeline) return { visible: true, bornThisTurn: false, diedThisTurn: false };
    const bridged = ageBridge(char);
    return visibilityAt(bridged, scrubTurn, scrubOpts);
  }, [haveTimeline, ageBridge, scrubTurn, scrubOpts]);

  // Count of alive chars at the current scrubTurn (for tooltip). Logged
  // per scrub change so users can debug what each turn shows.
  const aliveCount = useMemo(() => {
    if (!haveTimeline || !allCharsForFaction.length) return 0;
    let alive = 0;
    let newlyBorn = 0;
    let newlyDead = 0;
    for (const c of allCharsForFaction) {
      const v = visibilityAt(ageBridge(c), scrubTurn, scrubOpts);
      if (v.visible) alive++;
      if (v.bornThisTurn) newlyBorn++;
      if (v.diedThisTurn) newlyDead++;
    }
    console.log(`[fam-scrub] turn ${scrubTurn}: ${alive} alive, ${newlyDead} just died, ${newlyBorn} just born`);
    return alive;
  }, [haveTimeline, allCharsForFaction, ageBridge, scrubTurn, scrubOpts]);

  if (!hasMod && (!characterExtras || characterExtras.length === 0)) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <Header onClose={onClose} title="Family Tree" />
          <p style={{ padding: 20, color: "var(--ft-text)" }}>No character data loaded yet.</p>
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
            <>
              {haveTimeline && (
                <TimelineScrubber
                  currentTurn={effectiveCurrentTurn}
                  currentYear={currentYear}
                  allChars={allCharsForFaction}
                  scrubTurn={scrubTurn}
                  setScrubTurn={setScrubTurn}
                  playing={playing}
                  setPlaying={setPlaying}
                  aliveCount={aliveCount}
                />
              )}
              {hasMod && modFactions.length > 0 && (
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
              )}
            </>
          }
        />
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Sidebar: generals */}
          <div style={{
            width: 220, flexShrink: 0,
            borderRight: "1px solid var(--ft-border)",
            background: "var(--ft-sidebar-bg)",
            overflowY: "auto",
            padding: 10,
          }}>
            <div style={{
              fontSize: 11, letterSpacing: "0.06em",
              color: "var(--ft-text-muted)", marginBottom: 6, fontWeight: 700,
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
          <div style={{ flex: 1, minWidth: 0, position: "relative", background: "var(--ft-tree-bg)" }}>
            {visibleRoot ? (
              <ZoomPanViewport fitKey={`${selectedFaction}|${selectedGeneral}`}>
                <FamilyNode family={visibleRoot} allByHead={familyByHead} culture={culture} modDataDir={modDataDir} coordToPortrait={coordToPortrait} onSelectCharacter={setSelectedGeneral} onShowInfo={onShowInfo} scrubFilter={haveTimeline ? scrubFilter : null} />
              </ZoomPanViewport>
            ) : (
              <div style={{ padding: 20, color: "var(--ft-text-muted)" }}>
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

// All colors here read from CSS variables defined in App.css under
// `:root` (light) and `body.dark-mode` (dark). The modal is a fixed
// overlay, not a `.panel`, so it isn't covered by the panel CSS rules
// or the inline-color contrast-fix mutation observer — CSS vars let
// the same inline styles theme themselves when dark-mode toggles.
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
  backgroundColor: "var(--ft-card-bg)",
  backgroundImage:
    `linear-gradient(var(--ft-card-overlay), var(--ft-card-overlay)), url(${PUBLIC_URL}menu_marble_frame.png)`,
  backgroundRepeat: "no-repeat, repeat",
  color: "var(--ft-text)",
};

const headerStyle = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "10px 16px",
  borderBottom: "1px solid var(--ft-border-soft)",
};

const titleStyle = {
  margin: 0, fontSize: 17, fontWeight: 700,
  color: "var(--ft-text)",
  letterSpacing: "0.02em",
};

const selectStyle = {
  padding: "4px 10px", fontSize: 12,
  background: "var(--ft-input-bg)", color: "var(--ft-text)",
  border: "1px solid var(--ft-border)", borderRadius: 4,
  fontWeight: 600,
};

const closeBtnStyle = {
  padding: "0 10px", fontSize: 22, lineHeight: 1,
  background: "var(--ft-btn-bg)", color: "var(--ft-text)",
  border: "1px solid var(--ft-border)", borderRadius: 4,
  cursor: "pointer", fontWeight: 700,
};

const zoomBtnStyle = {
  background: "var(--ft-zoom-btn-bg)",
  color: "var(--ft-zoom-btn-text)",
  border: "1px solid var(--ft-zoom-btn-border)",
  borderRadius: 3,
  padding: "2px 8px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
};
