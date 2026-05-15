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

import React, { useEffect, useRef, useState } from "react";

const MIN_FRAC = 0.02; // 2% of viewport is the floor for w/h

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
  return [pos, setPos];
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
      const nx = Math.max(0, Math.min(1 - startPos.w, startPos.x + dx));
      const ny = Math.max(0, Math.min(1 - startPos.h, startPos.y + dy));
      setPos({ ...startPos, x: nx, y: ny });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
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
      if (corner.includes("e")) {
        np.w = Math.max(MIN_FRAC, Math.min(1 - startPos.x, startPos.w + dx));
      }
      if (corner.includes("s")) {
        np.h = Math.max(MIN_FRAC, Math.min(1 - startPos.y, startPos.h + dy));
      }
      if (corner.includes("w")) {
        const newW = Math.max(MIN_FRAC, startPos.w - dx);
        const newX = Math.max(0, startPos.x + dx);
        if (newX + newW <= 1) { np.x = newX; np.w = newW; }
      }
      if (corner.includes("n")) {
        const newH = Math.max(MIN_FRAC, startPos.h - dy);
        const newY = Math.max(0, startPos.y + dy);
        if (newY + newH <= 1) { np.y = newY; np.h = newH; }
      }
      setPos(np);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
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
          {/* Drag header — short strip at top of widget, click-and-drag */}
          <div
            onMouseDown={startDrag}
            title={title ? `Drag to move "${title}"` : `Drag to move`}
            style={{
              position: "absolute",
              left: 0, top: 0, right: 0,
              height: 12,
              background: "repeating-linear-gradient(45deg, rgba(220,166,74,0.85), rgba(220,166,74,0.85) 4px, rgba(0,0,0,0.55) 4px, rgba(0,0,0,0.55) 8px)",
              cursor: "move",
              zIndex: 100,
            }}
          />
          {/* Widget id label centered in the header */}
          <div style={{
            position: "absolute",
            left: 0, top: 0, right: 0,
            height: 12, pointerEvents: "none",
            fontSize: "0.62rem", lineHeight: "12px",
            color: "#221", fontWeight: 700,
            textAlign: "center",
            zIndex: 101,
            textShadow: "0 0 2px rgba(255,220,160,0.8)",
          }}>{title || id}</div>
          {/* Edge resize handles (4) — thinner than corners but full edge */}
          <div onMouseDown={startResize("e")} style={edgeStyle("e")} />
          <div onMouseDown={startResize("w")} style={edgeStyle("w")} />
          <div onMouseDown={startResize("s")} style={edgeStyle("s")} />
          {/* Corner resize handles (4) */}
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
    width: 12, height: 12,
    background: "#dca64a",
    border: "1px solid #221",
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
  if (edge === "e") return { ...base, top: 12, bottom: 12, right: 0, width: 6, cursor: "ew-resize" };
  if (edge === "w") return { ...base, top: 12, bottom: 12, left: 0, width: 6, cursor: "ew-resize" };
  if (edge === "s") return { ...base, left: 12, right: 12, bottom: 0, height: 6, cursor: "ns-resize" };
  return base;
}
