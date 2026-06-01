// Freeform-widget framework. Each "Movable" wraps a UI section and renders
// it at a stored {x, y, w, h} position expressed as fractions (0..1) of the
// viewport. In design mode (App.js [designMode] state) a header strip and
// four corner handles appear, letting the user drag or resize the widget.
//
// Storage: localStorage key `widget.<id>` → JSON {x,y,w,h}. Defaults are
// passed in by the caller (defaultPct) and seed the initial value the first
// time the widget renders.
//
// Why percent: stays proportional across window-resize and multi-monitor
// hops. Drag math converts pixel deltas back to percent on each frame.
//
// Why position:fixed: lets each widget escape its parent grid/flex flow and
// be placed anywhere on the viewport. Container components render Movables
// as fragments — the Movable itself owns its absolute placement.
//
// Snap-to-align: each Movable registers its live position in a
// module-scope Map. While dragging or resizing, the active widget consults
// the Map and snaps to within SNAP_FRAC of any other widget's edges or
// centerlines (left/right/center on x; top/bottom/center on y). Snap is
// silent — no visual guide line for now, just the magnetic feel.

import React, { useEffect, useRef, useState } from "react";

const MIN_FRAC = 0.02;        // 2% of viewport is the floor for w/h
const SNAP_FRAC = 0.0055;     // ≈ 6 px at 1080p — narrow snap pull-in
const GUIDE_FRAC = 0.014;     // ≈ 15 px at 1080p — wider band where the cyan
                              // guide line lights up before snap engages, so
                              // you can see alignment opportunities coming.
const GAP_FRAC = 0.0035;      // ≈ 6.7 px at 1080p — forced gap between adjacent
                              // widgets. Treated as an "aura" around each
                              // other widget for collision; pushes always
                              // leave at least this much air between rects.

// Module-scope registry of live widget positions. Mutated directly so updates
// from any Movable are immediately visible to the next drag-snap pass.
const widgetRegistry = new Map();

// Register a fixed (non-Movable) rect as a virtual widget so snap/guides/
// collision treat it like every other panel — e.g. the map canvas and the
// top toolbar are fixtures users want to align *to* but never drag. Callers
// own the lifecycle (call register on mount/resize, unregister on unmount).
export function registerFixedRect(id, rect) {
  widgetRegistry.set(id, rect);
  notifyWidgets();
}
export function unregisterFixedRect(id) {
  widgetRegistry.delete(id);
  notifyWidgets();
}

// Return a snapshot of the current widget registry as a plain object so
// callers can read widget positions without mutating the live Map.
export function getWidgetSnapshot() {
  const out = {};
  for (const [id, p] of widgetRegistry) out[id] = { ...p };
  return out;
}

// Pub/sub for widget-position changes — App.js uses this to re-run the
// map's canvasSize calculation whenever a Movable moves, so the map
// auto-shrinks to keep clear of any widget the user drags toward it.
const _widgetSubscribers = new Set();
export function subscribeWidgets(fn) {
  _widgetSubscribers.add(fn);
  return () => _widgetSubscribers.delete(fn);
}
function notifyWidgets() {
  for (const fn of _widgetSubscribers) {
    try { fn(); } catch {}
  }
}

// Debounced "current layout" dumper. Calls log-message IPC after the user
// finishes interacting (drag/resize end). Output is a single JSON line
// labelled `WIDGET-LAYOUT` so it's grep-friendly in provincia.log.
let _layoutLogTimer = null;
let _layoutHasBootLogged = false;
export function logCurrentLayout(reason = "change") {
  if (_layoutLogTimer) clearTimeout(_layoutLogTimer);
  _layoutLogTimer = setTimeout(() => {
    _layoutLogTimer = null;
    try {
      const snapshot = {};
      for (const [id, p] of widgetRegistry) {
        // 4 decimals = ~0.5 px precision at 1080p, enough to be useful
        // when pasting back into source code as new defaults.
        snapshot[id] = {
          x: +p.x.toFixed(4), y: +p.y.toFixed(4),
          w: +p.w.toFixed(4), h: +p.h.toFixed(4),
        };
      }
      const line = `WIDGET-LAYOUT (${reason}) ${JSON.stringify(snapshot)}`;
      const api = (typeof window !== "undefined") ? window.electronAPI : null;
      if (api && api.logMessage) api.logMessage("info", line);
      else console.log("[layout]", line);
    } catch (err) {
      try { console.warn("layout log failed", err); } catch {}
    }
  }, 250);
}

// On first import, log the initial layout once after the registry has time
// to populate from useWidgetPos mounts. Subsequent calls update the
// snapshot. Using a microtask + tiny debounce avoids logging an empty
// registry on the very first render.
function maybeLogBootLayout() {
  if (_layoutHasBootLogged) return;
  _layoutHasBootLogged = true;
  setTimeout(() => logCurrentLayout("boot"), 1500);
}

export function loadWidgetPos(id, fallback) {
  try {
    const raw = localStorage.getItem(`widget.${id}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

export function saveWidgetPos(id, pos) {
  try { localStorage.setItem(`widget.${id}`, JSON.stringify(pos)); } catch {}
}

// One-time layout migration. Bump LAYOUT_VERSION whenever the canonical
// grid changes. Migration overwrites widget.* AND the map-sizing splitter
// keys so the map ends up narrow enough that the left-half widgets aren't
// hidden behind it. Existing users get the new grid on next launch.
// 0.9.656: REVERTED from 15. v0.9.655 bumped to 15 to push the new
// bottom.selected (x=0, w=0.572 = map-aligned) to existing users. That
// migration overwrote EVERY widget's position with CANONICAL_V4, not just
// bottom.selected — so users with hand-tuned layouts saw "the header for
// selected provinces etc got moved." Keep 14 to stop further forced
// migrations; the new bottom.selected default still applies for users
// whose saved position is missing, but customised layouts are left alone.
const LAYOUT_VERSION = 21;
// Canonical v5: snapped to the user's hand-tuned 2026-05-16 layout +
// uniform vertical/horizontal pixel-spacing (~13 px both directions on a
// 1920×1080 viewport). Includes all bottom-strip widgets and the seven
// region.* widgets, plus the larger `region.characters` and `region.recruit`
// shorter (h=0.329) to leave room for `region.characters` between info
// and buildings.
const CANONICAL_V4 = {
  // Uniform 9-PIXEL gaps everywhere at 1920×1080. Horizontal fraction
  // ≈ 9/1920 = 0.0047; vertical fraction ≈ 9/1080 = 0.0083. Bottom
  // strip widgets sit 9 px below the map's bottom edge.
  // 0.9.551 (LAYOUT_VERSION 12): diplomacy widget grew (now holds NAMED live
  // war/ally lists + treasury + wealth sparkline), so region.characters and
  // region.buildings moved DOWN; region.buildings shrunk to just fit the fixed
  // 5×4 = 20 building grid, freeing the reclaimed vertical space for diplomacy.
  "region.info":        { x: 0.5720, y: 0.0083, w: 0.2090, h: 0.2600 },
  "region.recruit":     { x: 0.7857, y: 0.0083, w: 0.2090, h: 0.3287 },
  "region.diplomacy":   { x: 0.5720, y: 0.2770, w: 0.2090, h: 0.1900 },
  "region.characters":  { x: 0.5720, y: 0.4760, w: 0.2090, h: 0.1900 },
  "region.unitQueue":   { x: 0.7857, y: 0.3453, w: 0.1021, h: 0.1550 },
  "region.queue":       { x: 0.8925, y: 0.3453, w: 0.1022, h: 0.1550 },
  "region.buildings":   { x: 0.5720, y: 0.6750, w: 0.2090, h: 0.3140 },
  "region.garrison":    { x: 0.7857, y: 0.5086, w: 0.2090, h: 0.1650 },
  "region.fieldArmies": { x: 0.7857, y: 0.6800, w: 0.2090, h: 0.3150 },
  // Bottom-strip widgets — 9 px below the map's bottom edge (map
  // y=0.0083 + h=0.6843 = 0.6926; strip y = 0.6926 + 9/1080 = 0.7009).
  // 0.9.791: flush to the map edges. search/factions x=0 → left edge meets the
  // map's left edge; selected x+w=0.572 (the colBox design span) → right edge
  // meets the map's right edge. (colBox maps design-x [0,0.572] onto the map's
  // actual pixel width, so these line up with the map on both sides.)
  "bottom.search":      { x: 0, y: 0.7009, w: 0.2076, h: 0.0200 },
  "bottom.factions":    { x: 0, y: 0.7300, w: 0.2076, h: 0.2650 },
  "bottom.selected":    { x: 0.2170, y: 0.7009, w: 0.3550, h: 0.2941 },
};
// Splitter overrides that put the map at the width the canonical widget
// grid assumes. rightColPct=0.428 leaves x∈(0.566, 1) for widgets.
const CANONICAL_V4_SPLITTERS = {
  "layout.rightColPct": "0.428",
  "layout.bottomStripPct": "0",
  "layout.factionColPct": "0",
  "layout.riInfoColPct": "0",
  "layout.riTopRowPct": "0",
  "layout.riBuildRowPct": "0",
};
// 0.9.656: one-shot un-migration for users hit by the v15 migration that
// over-aggressively reset every widget when only bottom.selected's
// canonical had changed. Detect the specific v15-shipped bottom.selected
// position ({x:0, w:0.572}) and restore the v14 canonical for it.
// Doesn't touch any other widget, so any customisations the user RE-
// applied after the bad migration are preserved.
try {
  const bs = localStorage.getItem("widget.bottom.selected");
  if (bs) {
    const p = JSON.parse(bs);
    if (p && p.x === 0 && Math.abs((p.w || 0) - 0.572) < 0.001) {
      localStorage.setItem("widget.bottom.selected", JSON.stringify({ x: 0.2170, y: 0.7009, w: 0.3496, h: 0.2941 }));
    }
  }
} catch {}
try {
  const stored = parseInt(localStorage.getItem("widget.layoutVersion") || "0", 10);
  if (stored < LAYOUT_VERSION) {
    // Drop widgets that no longer exist — `bottom.recent` was merged into
    // `bottom.selected` in 0.9.361. Leaving its localStorage entry around
    // makes the snap/collision registry see a phantom rect at the old
    // recent position.
    try { localStorage.removeItem("widget.bottom.recent"); } catch {}
    for (const [id, pos] of Object.entries(CANONICAL_V4)) {
      localStorage.setItem(`widget.${id}`, JSON.stringify(pos));
    }
    for (const [key, val] of Object.entries(CANONICAL_V4_SPLITTERS)) {
      localStorage.setItem(key, val);
    }
    localStorage.setItem("widget.layoutVersion", String(LAYOUT_VERSION));
  }
} catch {}

// Clear all widget overrides — wired into the ↺ Reset button.
export function resetAllWidgets() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("widget.")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// External registry of Movable setters keyed by id. Lets undoLayout reach
// into every Movable instance and apply a snapshot without each widget
// having to subscribe to a context.
const widgetSetters = new Map();

// Hook: returns [pos, setPos] backed by localStorage. pos is always a
// {x,y,w,h} object in viewport fractions.
export function useWidgetPos(id, defaultPct) {
  const [pos, setPos] = useState(() => loadWidgetPos(id, defaultPct));
  useEffect(() => { saveWidgetPos(id, pos); }, [id, pos]);
  // Keep the module-scope registry in sync so snap-to-align can see this
  // widget's live position. Cleanup on unmount removes the entry. Also
  // schedule a one-shot boot-layout log the first time any widget mounts
  // — gives the renderer ~1.5 s to populate the registry before dumping.
  useEffect(() => {
    widgetRegistry.set(id, pos);
    widgetSetters.set(id, setPos);
    maybeLogBootLayout();
    notifyWidgets();
    return () => {
      widgetRegistry.delete(id);
      widgetSetters.delete(id);
      notifyWidgets();
    };
  }, [id, pos]);
  return [pos, setPos];
}

// ── Undo history ────────────────────────────────────────────────────────
// Snapshot of every widget's pos pushed onto a stack on each drag/resize
// start. Undo pops the latest and applies it through each Movable's setter
// (no reload needed). 30-entry limit keeps memory bounded.

const UNDO_LIMIT = 30;
const _undoStack = [];
const _undoSubscribers = new Set();

function snapshotAll() {
  const out = {};
  for (const [id, p] of widgetRegistry) out[id] = { ...p };
  return out;
}

export function pushUndoSnapshot() {
  _undoStack.push(snapshotAll());
  if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
  notifyUndo();
}

export function undoLayout() {
  if (_undoStack.length === 0) return false;
  const snapshot = _undoStack.pop();
  for (const [id, pos] of Object.entries(snapshot)) {
    const setter = widgetSetters.get(id);
    if (setter) setter(pos);
  }
  notifyUndo();
  logCurrentLayout("undo");
  return true;
}

export function canUndo() { return _undoStack.length > 0; }
export function undoCount() { return _undoStack.length; }

export function subscribeUndo(fn) {
  _undoSubscribers.add(fn);
  return () => _undoSubscribers.delete(fn);
}

function notifyUndo() {
  for (const fn of _undoSubscribers) {
    try { fn(_undoStack.length); } catch {}
  }
}

// ── Guide line state ────────────────────────────────────────────────────
// Active drag broadcasts a list of guides (vertical/horizontal lines where
// the moving widget's edges/centers align with another widget's). The
// GuideOverlay component subscribes and renders them.

const _guideSubscribers = new Set();
let _currentGuides = [];

export function subscribeGuides(fn) {
  _guideSubscribers.add(fn);
  return () => _guideSubscribers.delete(fn);
}
function setGuides(guides) {
  _currentGuides = guides;
  for (const fn of _guideSubscribers) {
    try { fn(guides); } catch {}
  }
}
function clearGuides() { setGuides([]); }

// ── Snap + collision ───────────────────────────────────────────────────
// `nosnap` (e.g. Shift held) disables snap entirely. Returns { pos, guides }.

function snapAlign(myId, np, lock = {}, nosnap = false) {
  const guides = [];
  let out = { ...np };

  if (!nosnap) {
    const targetsX = [];
    const targetsY = [];
    for (const [oid, o] of widgetRegistry) {
      if (oid === myId) continue;
      targetsX.push(o.x, o.x + o.w, o.x + o.w / 2);
      targetsY.push(o.y, o.y + o.h, o.y + o.h / 2);
    }
    const myLeft = np.x, myRight = np.x + np.w, myCenterX = np.x + np.w / 2;
    const myTop = np.y, myBottom = np.y + np.h, myCenterY = np.y + np.h / 2;
    const myXs = [myLeft, myRight, myCenterX];
    const myYs = [myTop, myBottom, myCenterY];

    // Find the SINGLE nearest snap target on each axis (for snap pull-in),
    // AND any other targets within GUIDE_FRAC to emit guide lines for them
    // too. This way you can see both a horizontal AND a vertical guide
    // simultaneously, and even multiple lines on the same axis if several
    // edges happen to align.
    let dx = 0, dxAbs = SNAP_FRAC;
    const guideXFracs = new Set();
    for (const t of targetsX) {
      for (const me of myXs) {
        const diff = t - me;
        const a = Math.abs(diff);
        if (a < dxAbs) { dx = diff; dxAbs = a; }
        if (a < GUIDE_FRAC) guideXFracs.add(+t.toFixed(5));
      }
    }
    let dy = 0, dyAbs = SNAP_FRAC;
    const guideYFracs = new Set();
    for (const t of targetsY) {
      for (const me of myYs) {
        const diff = t - me;
        const a = Math.abs(diff);
        if (a < dyAbs) { dy = diff; dyAbs = a; }
        if (a < GUIDE_FRAC) guideYFracs.add(+t.toFixed(5));
      }
    }

    if (lock.x === "right") out.w = Math.max(MIN_FRAC, np.w + dx);
    else if (lock.x === "left") { out.x = np.x + dx; out.w = Math.max(MIN_FRAC, np.w - dx); }
    else out.x = np.x + dx;
    if (lock.y === "bottom") out.h = Math.max(MIN_FRAC, np.h + dy);
    else if (lock.y === "top") { out.y = np.y + dy; out.h = Math.max(MIN_FRAC, np.h - dy); }
    else out.y = np.y + dy;

    for (const f of guideXFracs) guides.push({ axis: "x", frac: f });
    for (const f of guideYFracs) guides.push({ axis: "y", frac: f });
  }

  // Collision avoidance: inflate each other widget's rect by GAP_FRAC on
  // every side so the moving rect is pushed/clamped to leave a forced gap
  // between adjacent panels (same feel as the existing MAP_PADDING /
  // PANELS_GAP between the map and the top bar). For resize ops the
  // moving edge can't push through, so we shrink instead.
  for (const [oid, o] of widgetRegistry) {
    if (oid === myId) continue;
    const ox1 = o.x - GAP_FRAC, ox2 = o.x + o.w + GAP_FRAC;
    const oy1 = o.y - GAP_FRAC, oy2 = o.y + o.h + GAP_FRAC;
    let x1 = out.x, x2 = out.x + out.w, y1 = out.y, y2 = out.y + out.h;
    const overlapX = Math.min(x2, ox2) - Math.max(x1, ox1);
    const overlapY = Math.min(y2, oy2) - Math.max(y1, oy1);
    if (overlapX > 0.0005 && overlapY > 0.0005) {
      const pushAlongX = overlapX < overlapY;
      if (pushAlongX) {
        if (lock.x === "right") {
          out.w = Math.max(MIN_FRAC, ox1 - out.x);
        } else if (lock.x === "left") {
          const newX = ox2;
          out.w = Math.max(MIN_FRAC, x2 - newX);
          out.x = x2 - out.w;
        } else {
          if (x1 + (x2 - x1) / 2 < ox1 + (ox2 - ox1) / 2) {
            out.x = Math.max(0, ox1 - out.w);
          } else {
            out.x = Math.min(1 - out.w, ox2);
          }
        }
      } else {
        if (lock.y === "bottom") {
          out.h = Math.max(MIN_FRAC, oy1 - out.y);
        } else if (lock.y === "top") {
          const newY = oy2;
          out.h = Math.max(MIN_FRAC, y2 - newY);
          out.y = y2 - out.h;
        } else {
          if (y1 + (y2 - y1) / 2 < oy1 + (oy2 - oy1) / 2) {
            out.y = Math.max(0, oy1 - out.h);
          } else {
            out.y = Math.min(1 - out.h, oy2);
          }
        }
      }
    }
  }
  // Final viewport clamp — keep at least GAP_FRAC from each window edge so
  // widgets share the same air-gap with the screen border that they keep
  // with each other and with the map.
  out.x = Math.max(GAP_FRAC, Math.min(1 - out.w - GAP_FRAC, out.x));
  out.y = Math.max(GAP_FRAC, Math.min(1 - out.h - GAP_FRAC, out.y));
  return { pos: out, guides };
}

// Design right-column geometry (matches CANONICAL_V4: region widgets start at
// x=0.572 and span to the right edge). `colBox` re-maps this design range into
// the actual right column [colBox.left, colBox.left+colBox.width] so the widgets
// always meet the map's right edge — closes the gap when the map is
// height-constrained on wide/4K screens. On screens where the map fills its
// column this is essentially identity (colBox.width ≈ RIGHT_COL_SPAN·vw).
const RIGHT_COL_X0 = 0.572;
const RIGHT_COL_SPAN = 0.428;

// 0.9.789: temporary numbered overlay so the user can reference each panel by
// number ("make UI5 wider") while we iterate on the layout. Each Movable shows
// a small red "UIn" badge in its top-left corner. Map of id → { n, name } is the
// shared legend. (The map canvas is UI14, labelled separately in App.js.)
export const UI_LABELS = {
  "bottom.search":      { n: 1,  name: "Search" },
  "bottom.factions":    { n: 2,  name: "Factions" },
  "bottom.pinned":      { n: 3,  name: "Pinned regions" },
  "bottom.selected":    { n: 4,  name: "Selected provinces" },
  "region.info":        { n: 5,  name: "Settlement info" },
  "region.diplomacy":   { n: 6,  name: "Diplomacy & treasury" },
  "region.characters":  { n: 7,  name: "Characters" },
  "region.recruit":     { n: 8,  name: "Recruitable" },
  "region.unitQueue":   { n: 9,  name: "Unit queue" },
  "region.queue":       { n: 10, name: "Build queue" },
  "region.garrison":    { n: 11, name: "Garrison" },
  "region.fieldArmies": { n: 12, name: "Field armies" },
  "region.buildings":   { n: 13, name: "Buildings" },
};

export function Movable({
  id,
  defaultPct,
  designMode,
  children,
  style,
  title,
  zIndex = 2,
  colBox = null,
  posOverride = null,
}) {
  const [pos, setPos] = useWidgetPos(id, defaultPct);
  // `isDragging` toggles position transitions off during active drag/
  // resize (mouse-follow needs to be instant) and back on for snap-into-
  // place, undo, and migration applies — those get a smooth ease so the
  // layout feels responsive instead of teleporting.
  const [isDragging, setIsDragging] = useState(false);
  // Track viewport size so drag math + render position stay in sync when
  // the window is resized (multi-monitor, fullscreen, etc.).
  const [vp, setVp] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1920,
    h: typeof window !== "undefined" ? window.innerHeight : 1080,
  }));
  useEffect(() => {
    const handler = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // posOverride temporarily expands a widget for render only (e.g. the Characters
  // panel grows over Diplomacy while Add-General is open) without touching the
  // persisted/draggable position.
  const ePos = posOverride ? { ...pos, ...posOverride } : pos;
  // A `box` re-maps a widget's design x/width into an actual pixel column so it
  // tracks the map: the right column (default x0/span) for region widgets, or
  // the bottom-left map column for the search/factions/selected strip (which
  // pass x0:0, span:0.572). Without x0/span it uses the right-column defaults.
  const boxX0 = colBox && colBox.x0 != null ? colBox.x0 : RIGHT_COL_X0;
  const boxSpan = colBox && colBox.span != null ? colBox.span : RIGHT_COL_SPAN;
  let left, width;
  if (colBox) {
    const relX = (ePos.x - boxX0) / boxSpan;
    left = Math.round(colBox.left + relX * colBox.width);
    width = Math.max(40, Math.round((ePos.w / boxSpan) * colBox.width));
  } else {
    left = Math.round(ePos.x * vp.w);
    width = Math.max(40, Math.round(ePos.w * vp.w));
  }
  // Vertical analog of the horizontal colBox remap. When colBox carries
  // {top, vHeight, y0, vSpan}, the widget's design-y range [y0, y0+vSpan] is
  // remapped into the actual pixel column [top, top+vHeight]. The bottom strip
  // (search/factions/selected) passes top = map's ACTUAL bottom edge, so the
  // panels follow the map down/up as its width/aspect changes instead of
  // sitting at a fixed fraction — this closes the dead band under a ½-width map.
  let top, height;
  if (colBox && colBox.top != null && colBox.vSpan != null) {
    // Anchor the strip's top to colBox.top (the map's actual bottom) but use the
    // NATURAL viewport scale for vertical offsets + heights — so inter-widget
    // gaps match the rest of the app instead of being proportionally compressed
    // when the map is tall (the old scaling shrank the search↔factions gap).
    // Clamp height so a widget never runs past the viewport bottom; the big
    // panels (factions/selected) scroll internally to absorb the difference.
    const boxY0 = colBox.y0 != null ? colBox.y0 : 0;
    top = Math.round(colBox.top + (ePos.y - boxY0) * vp.h);
    // Floor of 14px (not 40) so the thin search bar keeps its real small height
    // — the 40px minimum was forcing the search to 40px and overlapping Factions.
    height = Math.max(14, Math.round(ePos.h * vp.h));
    const maxBottom = vp.h - 6;
    if (top + height > maxBottom) height = Math.max(14, maxBottom - top);
  } else {
    top = Math.round(ePos.y * vp.h);
    height = Math.max(40, Math.round(ePos.h * vp.h));
  }

  const startDrag = (e) => {
    if (!designMode) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    setIsDragging(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...pos };
    function onMove(ev) {
      const dx = colBox ? ((ev.clientX - startX) / colBox.width) * boxSpan : (ev.clientX - startX) / vp.w;
      const dy = (ev.clientY - startY) / vp.h;
      let np = {
        x: Math.max(0, Math.min(1 - startPos.w, startPos.x + dx)),
        y: Math.max(0, Math.min(1 - startPos.h, startPos.y + dy)),
        w: startPos.w, h: startPos.h,
      };
      const result = snapAlign(id, np, {}, ev.shiftKey);
      setGuides(result.guides);
      setPos(result.pos);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearGuides();
      setIsDragging(false);
      logCurrentLayout("drag");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (corner) => (e) => {
    if (!designMode) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    setIsDragging(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...pos };
    function onMove(ev) {
      const dx = colBox ? ((ev.clientX - startX) / colBox.width) * boxSpan : (ev.clientX - startX) / vp.w;
      const dy = (ev.clientY - startY) / vp.h;
      const np = { ...startPos };
      const lock = {};
      if (corner.includes("e")) {
        np.w = Math.max(MIN_FRAC, Math.min(1 - startPos.x, startPos.w + dx));
        lock.x = "right";
      }
      if (corner.includes("s")) {
        np.h = Math.max(MIN_FRAC, Math.min(1 - startPos.y, startPos.h + dy));
        lock.y = "bottom";
      }
      if (corner.includes("w")) {
        const newW = Math.max(MIN_FRAC, startPos.w - dx);
        const newX = Math.max(0, startPos.x + dx);
        if (newX + newW <= 1) { np.x = newX; np.w = newW; }
        lock.x = "left";
      }
      if (corner.includes("n")) {
        const newH = Math.max(MIN_FRAC, startPos.h - dy);
        const newY = Math.max(0, startPos.y + dy);
        if (newY + newH <= 1) { np.y = newY; np.h = newH; }
        lock.y = "top";
      }
      const result = snapAlign(id, np, lock, ev.shiftKey);
      setGuides(result.guides);
      setPos(result.pos);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearGuides();
      setIsDragging(false);
      logCurrentLayout("resize");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width,
        height,
        boxSizing: "border-box",
        zIndex,
        // Smooth transition for snap/undo/migration position changes,
        // disabled during active drag so mouse-follow stays instant.
        // Spring-y curve gives the iOS / macOS settle-into-place feel.
        transition: isDragging
          ? "none"
          : "left 240ms cubic-bezier(0.16, 1, 0.3, 1), top 240ms cubic-bezier(0.16, 1, 0.3, 1), width 240ms cubic-bezier(0.16, 1, 0.3, 1), height 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        ...(style || {}),
      }}
      data-widget={id}
    >
      {children}
      {UI_LABELS[id] && (
        <div
          title={UI_LABELS[id].name}
          style={{
            position: "absolute", top: 2, left: 2, zIndex: 9999,
            background: "rgba(214,40,40,0.92)", color: "#fff",
            font: "700 11px system-ui, sans-serif", lineHeight: 1,
            padding: "2px 5px", borderRadius: 5, pointerEvents: "none",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.6)", whiteSpace: "nowrap",
          }}
        >UI{UI_LABELS[id].n}</div>
      )}
      {designMode && (
        <>
          {/* Invisible interaction overlay — covers the whole widget. No
              visible chrome (no yellow header, no corner squares). Cursor
              changes to indicate drag vs resize based on where the mouse
              sits inside the widget; mousedown picks the right handler.
              The widget content underneath is fully visible while you
              move things around. */}
          <div
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const lx = e.clientX - rect.left;
              const ly = e.clientY - rect.top;
              const EDGE = 10;
              const onL = lx <= EDGE, onR = lx >= rect.width - EDGE;
              const onT = ly <= EDGE, onB = ly >= rect.height - EDGE;
              let corner = "";
              if (onT) corner += "n";
              if (onB) corner += "s";
              if (onL) corner += "w";
              if (onR) corner += "e";
              if (corner) startResize(corner)(e);
              else startDrag(e);
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const lx = e.clientX - rect.left;
              const ly = e.clientY - rect.top;
              const EDGE = 10;
              const onL = lx <= EDGE, onR = lx >= rect.width - EDGE;
              const onT = ly <= EDGE, onB = ly >= rect.height - EDGE;
              let cur = "move";
              if (onT && onL) cur = "nw-resize";
              else if (onT && onR) cur = "ne-resize";
              else if (onB && onL) cur = "sw-resize";
              else if (onB && onR) cur = "se-resize";
              else if (onT || onB) cur = "ns-resize";
              else if (onL || onR) cur = "ew-resize";
              if (e.currentTarget.style.cursor !== cur) e.currentTarget.style.cursor = cur;
            }}
            title={title ? `${title} — drag to move, drag edges to resize` : "Drag to move, edges to resize"}
            style={{
              position: "absolute",
              inset: 0,
              background: "transparent",
              cursor: "move",
              zIndex: 100,
            }}
          />
          {/* Tiny widget-id chip — top-right corner, transparent, just so
              you can identify widgets when they overlap during design.
              Pointer-events: none so it doesn't intercept drags. */}
          {title && (
            <div style={{
              position: "absolute",
              top: 2, right: 4,
              pointerEvents: "none",
              fontSize: "0.55rem", lineHeight: 1,
              color: "rgba(220,166,74,0.7)",
              fontWeight: 700,
              textShadow: "0 0 3px rgba(0,0,0,0.85)",
              zIndex: 101,
            }}>{title}</div>
          )}
          {/* Center crosshair — small subtle + at the geometric center of
              each widget, visible whenever design mode is on. Lets you eye
              up alignment to another widget's center before you start
              dragging (and confirms when snap puts you on it). */}
          <div style={{
            position: "absolute",
            left: "50%", top: "50%",
            width: 14, height: 14,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 101,
          }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 2, background: "rgba(80,200,255,0.85)", borderRadius: 1 }} />
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 6, width: 2, background: "rgba(80,200,255,0.85)", borderRadius: 1 }} />
          </div>
        </>
      )}
    </div>
  );
}

// Renders the snap-alignment guide lines that flash up during an active
// drag/resize. Subscribes to setGuides via the module-level pub/sub. Render
// this ONCE near the root of the app (e.g. inside App's main wrapper) so
// it sits above every Movable.
export function GuideOverlay() {
  const [guides, setLocal] = useState([]);
  useEffect(() => subscribeGuides(setLocal), []);
  if (!guides || guides.length === 0) return null;
  return (
    <>
      {guides.map((g, i) => g.axis === "x" ? (
        <div key={`gx-${i}`} style={{
          position: "fixed",
          left: `calc(${g.frac * 100}% - 0.5px)`,
          top: 0, bottom: 0,
          width: 1,
          background: "rgba(80,200,255,0.85)",
          boxShadow: "0 0 4px rgba(80,200,255,0.6)",
          pointerEvents: "none",
          zIndex: 10001,
        }} />
      ) : (
        <div key={`gy-${i}`} style={{
          position: "fixed",
          top: `calc(${g.frac * 100}% - 0.5px)`,
          left: 0, right: 0,
          height: 1,
          background: "rgba(80,200,255,0.85)",
          boxShadow: "0 0 4px rgba(80,200,255,0.6)",
          pointerEvents: "none",
          zIndex: 10001,
        }} />
      ))}
    </>
  );
}
