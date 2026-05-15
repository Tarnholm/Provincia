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
const SNAP_FRAC = 0.0055;     // ≈ 6 px at 1080p — about 1 mm; tight enough not to fight you

// Module-scope registry of live widget positions. Mutated directly so updates
// from any Movable are immediately visible to the next drag-snap pass.
const widgetRegistry = new Map();

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
    maybeLogBootLayout();
    return () => { widgetRegistry.delete(id); };
  }, [id, pos]);
  return [pos, setPos];
}

// Compute snapped pos by checking edges/centers against every other widget
// in the registry. `lock` controls which dimensions are allowed to change
// (drag locks size; resize locks the opposite edge).
function snapAlign(myId, np, lock = {}) {
  const targetsX = [];   // values we want our x-edges to match
  const targetsY = [];
  for (const [oid, o] of widgetRegistry) {
    if (oid === myId) continue;
    targetsX.push(o.x, o.x + o.w, o.x + o.w / 2);
    targetsY.push(o.y, o.y + o.h, o.y + o.h / 2);
  }
  const myLeft = np.x;
  const myRight = np.x + np.w;
  const myCenterX = np.x + np.w / 2;
  const myTop = np.y;
  const myBottom = np.y + np.h;
  const myCenterY = np.y + np.h / 2;

  let dx = 0;
  let dxAbs = SNAP_FRAC;
  for (const t of targetsX) {
    for (const me of [myLeft, myRight, myCenterX]) {
      const diff = t - me;
      if (Math.abs(diff) < dxAbs) { dx = diff; dxAbs = Math.abs(diff); }
    }
  }
  let dy = 0;
  let dyAbs = SNAP_FRAC;
  for (const t of targetsY) {
    for (const me of [myTop, myBottom, myCenterY]) {
      const diff = t - me;
      if (Math.abs(diff) < dyAbs) { dy = diff; dyAbs = Math.abs(diff); }
    }
  }

  const out = { ...np };
  // Apply x adjustment. If lock.x is "right" we resized the east edge so
  // adjust width; if lock.x is "left" we resized west so adjust both x and
  // width inversely; otherwise (drag) shift x.
  if (lock.x === "right") out.w = Math.max(MIN_FRAC, np.w + dx);
  else if (lock.x === "left") { out.x = np.x + dx; out.w = Math.max(MIN_FRAC, np.w - dx); }
  else out.x = np.x + dx;
  if (lock.y === "bottom") out.h = Math.max(MIN_FRAC, np.h + dy);
  else if (lock.y === "top") { out.y = np.y + dy; out.h = Math.max(MIN_FRAC, np.h - dy); }
  else out.y = np.y + dy;
  return out;
}

export function Movable({
  id,
  defaultPct,
  designMode,
  children,
  style,
  title,
  zIndex = 2,
}) {
  const [pos, setPos] = useWidgetPos(id, defaultPct);
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

  const left = Math.round(pos.x * vp.w);
  const top = Math.round(pos.y * vp.h);
  const width = Math.max(40, Math.round(pos.w * vp.w));
  const height = Math.max(40, Math.round(pos.h * vp.h));

  const startDrag = (e) => {
    if (!designMode) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...pos };
    function onMove(ev) {
      const dx = (ev.clientX - startX) / vp.w;
      const dy = (ev.clientY - startY) / vp.h;
      let np = {
        x: Math.max(0, Math.min(1 - startPos.w, startPos.x + dx)),
        y: Math.max(0, Math.min(1 - startPos.h, startPos.y + dy)),
        w: startPos.w, h: startPos.h,
      };
      np = snapAlign(id, np);
      setPos(np);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      logCurrentLayout("drag");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (corner) => (e) => {
    if (!designMode) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...pos };
    function onMove(ev) {
      const dx = (ev.clientX - startX) / vp.w;
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
      setPos(snapAlign(id, np, lock));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
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
        ...(style || {}),
      }}
      data-widget={id}
    >
      {children}
      {designMode && (
        <>
          {/* Thin drag bar at the top — 6 px tall, semi-transparent so the
              widget content beneath is still visible. Click anywhere on
              the bar to drag the widget. */}
          <div
            onMouseDown={startDrag}
            title={title ? `Drag "${title}"` : `Drag`}
            style={{
              position: "absolute",
              left: 0, top: 0, right: 0,
              height: 6,
              background: "rgba(220,166,74,0.55)",
              cursor: "move",
              zIndex: 100,
            }}
          />
          {/* Widget title label tucked into the top-right corner so it
              identifies the widget without covering the panel header. */}
          {title && (
            <div style={{
              position: "absolute",
              top: 7, right: 14,
              pointerEvents: "none",
              fontSize: "0.6rem", lineHeight: 1,
              color: "rgba(220,166,74,0.9)",
              fontWeight: 700,
              textShadow: "0 0 4px rgba(0,0,0,0.85)",
              zIndex: 101,
            }}>{title}</div>
          )}
          {/* Edge resize handles — invisible hit zones with cursor only */}
          <div onMouseDown={startResize("e")} style={edgeStyle("e")} />
          <div onMouseDown={startResize("w")} style={edgeStyle("w")} />
          <div onMouseDown={startResize("s")} style={edgeStyle("s")} />
          {/* Compact 8×8 corner handles in subtle gold — small enough to
              not obscure content but visible enough to grab. */}
          {["nw","ne","sw","se"].map((c) => (
            <div key={c} onMouseDown={startResize(c)} title={`Resize ${c.toUpperCase()}`} style={cornerStyle(c)} />
          ))}
        </>
      )}
    </div>
  );
}

function cornerStyle(c) {
  const base = {
    position: "absolute",
    width: 8, height: 8,
    background: "rgba(220,166,74,0.85)",
    border: "1px solid rgba(34,34,17,0.7)",
    cursor: `${c}-resize`,
    zIndex: 102,
  };
  if (c.includes("n")) base.top = 0; else base.bottom = 0;
  if (c.includes("w")) base.left = 0; else base.right = 0;
  return base;
}

function edgeStyle(edge) {
  const base = {
    position: "absolute",
    background: "transparent",
    zIndex: 99,
  };
  if (edge === "e") return { ...base, top: 8, bottom: 8, right: 0, width: 5, cursor: "ew-resize" };
  if (edge === "w") return { ...base, top: 8, bottom: 8, left: 0, width: 5, cursor: "ew-resize" };
  if (edge === "s") return { ...base, left: 8, right: 8, bottom: 0, height: 5, cursor: "ns-resize" };
  return base;
}
