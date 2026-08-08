import React, { useEffect, useRef } from "react";

// ScrollPulse: transient scroll-position indicator.
// The app deliberately hides every native scrollbar (App.css — no visible
// rails at rest, per the user). The cost was zero scroll feedback: nothing
// showed that a list scrolls or how far along it is. This restores the
// feedback without breaking the no-rails rule: a document-level capture-
// phase scroll listener paints a thin amber thumb along the scrolling
// element's edge WHILE it scrolls, fading out shortly after the last
// scroll event. No per-panel wiring — it works for every scrollable in
// the app, including menus, modals and anything added later.
const FADE_MS = 700;
const MIN_THUMB = 24;
const THUMB_W = 3;
const EDGE_PAD = 3;

export default function ScrollPulse() {
  const vRef = useRef(null);
  const hRef = useRef(null);
  const fadeTimer = useRef(null);

  useEffect(() => {
    const place = (el) => {
      const v = vRef.current, h = hRef.current;
      if (!v || !h) return;
      if (!(el instanceof Element) || el === document.documentElement || el === document.body) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return;
      const canV = el.scrollHeight > el.clientHeight + 1;
      const canH = el.scrollWidth > el.clientWidth + 1;
      if (canV) {
        const trackH = rect.height - EDGE_PAD * 2;
        const thumbH = Math.max(MIN_THUMB, trackH * (el.clientHeight / el.scrollHeight));
        const maxTop = el.scrollHeight - el.clientHeight;
        const frac = maxTop > 0 ? el.scrollTop / maxTop : 0;
        v.style.left = `${rect.right - THUMB_W - EDGE_PAD}px`;
        v.style.top = `${rect.top + EDGE_PAD + frac * (trackH - thumbH)}px`;
        v.style.height = `${thumbH}px`;
        v.style.opacity = "1";
      } else {
        v.style.opacity = "0";
      }
      if (canH) {
        const trackW = rect.width - EDGE_PAD * 2;
        const thumbW = Math.max(MIN_THUMB, trackW * (el.clientWidth / el.scrollWidth));
        const maxLeft = el.scrollWidth - el.clientWidth;
        const frac = maxLeft > 0 ? el.scrollLeft / maxLeft : 0;
        h.style.top = `${rect.bottom - THUMB_W - EDGE_PAD}px`;
        h.style.left = `${rect.left + EDGE_PAD + frac * (trackW - thumbW)}px`;
        h.style.width = `${thumbW}px`;
        h.style.opacity = "1";
      } else {
        h.style.opacity = "0";
      }
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => {
        if (vRef.current) vRef.current.style.opacity = "0";
        if (hRef.current) hRef.current.style.opacity = "0";
      }, FADE_MS);
    };
    let pending = null;
    const onScroll = (e) => {
      // rAF-throttle: coalesce event bursts to one layout read per frame.
      if (pending) return;
      const el = e.target;
      pending = requestAnimationFrame(() => { pending = null; place(el); });
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (pending) cancelAnimationFrame(pending);
      clearTimeout(fadeTimer.current);
    };
  }, []);

  const base = {
    position: "fixed",
    zIndex: 2000000,
    pointerEvents: "none",
    opacity: 0,
    transition: "opacity 220ms ease",
    borderRadius: 3,
    background: "linear-gradient(#dca64a, #b67e28)",
    boxShadow: "0 0 4px rgba(0,0,0,0.35)",
  };
  return (
    <>
      <div ref={vRef} style={{ ...base, width: THUMB_W }} aria-hidden="true" />
      <div ref={hRef} style={{ ...base, height: THUMB_W }} aria-hidden="true" />
    </>
  );
}
