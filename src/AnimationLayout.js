import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/*
 * 0.9.475: Animation layout system. Every <button> + every element
 * tagged with `data-anim-id=<stable-id>` is animatable. In Layout mode
 * (designMode = ON), clicking an animatable element opens the
 * AnimationPicker popover instead of triggering the element's own
 * onClick — the user picks a named animation for each trigger slot.
 *
 * Trigger slots:
 *   - "click"   — buttons: plays the animation each time the button is clicked
 *   - "mount"   — containers: plays when the container first appears
 *   - "unmount" — containers: plays before the container is removed
 *
 * Identification model:
 *   - <button>s: hash of trimmed innerText + title + aria-label. Stable
 *     as long as the visible label doesn't drift.
 *   - non-button elements: must carry an explicit data-anim-id so the
 *     hash is stable across renders.
 *
 * localStorage shape (key "buttonAnimations"):
 *   {
 *     "btn:abc123":         { click: "pop" },
 *     "explicit:dev-pill":  { mount: "bouncein", unmount: "shake" },
 *   }
 *
 * Backward-compat: pre-0.9.475 entries stored as bare strings are
 * coerced to `{ click: <value> }` on first read.
 */

export const ANIMATION_LIBRARY = [
  { id: "none",       label: "None",         hint: "No animation." },
  { id: "pop",        label: "Pop",          hint: "macOS spring overshoot — quick scale snap." },
  { id: "bounce",     label: "Bounce",       hint: "Vertical bounce with diminishing hops." },
  { id: "wiggle",     label: "Wiggle",       hint: "Side-to-side rotation wobble." },
  { id: "shake",      label: "Shake",        hint: "Rapid horizontal jitter." },
  { id: "pulse",      label: "Pulse",        hint: "Single smooth scale-up & back." },
  { id: "tada",       label: "Tada",         hint: "Burst + sway, party announcement style." },
  { id: "jelly",      label: "Jelly",        hint: "Squish-stretch oscillation." },
  { id: "rubber",     label: "Rubber band",  hint: "Like jelly but slower & wider." },
  { id: "swing",      label: "Swing",        hint: "Hangs from top, swings side to side." },
  { id: "flip",       label: "Flip",         hint: "Full 360° flip around the Y axis." },
  { id: "rotate",     label: "Rotate",       hint: "Single full 360° spin." },
  { id: "heartbeat",  label: "Heartbeat",    hint: "Two pulses — like a heart." },
  { id: "glow",       label: "Glow flash",   hint: "Golden glow ring flash." },
  { id: "squish",     label: "Squish",       hint: "Quick vertical squish & return." },
  { id: "bouncein",   label: "Bounce in",    hint: "Pop in from small — good for mount/enter." },
  { id: "slidebump",  label: "Slide bump",   hint: "Horizontal nudge & settle." },
  { id: "flash",      label: "Flash",        hint: "Two quick opacity flashes." },
  { id: "wobble",     label: "Wobble",       hint: "Slow drift + rotate wobble." },
  { id: "pill-in",    label: "Pill in",      hint: "Quick fade + slide-up. Default mount for the dev pill — clean and fast." },
  { id: "pill-out",   label: "Pill out",     hint: "Quick fade + slide-down. Default unmount for the dev pill." },
  { id: "emerge",     label: "Emerge",       hint: "Grows from the right edge to full size — no overshoot." },
  { id: "retract",    label: "Retract",      hint: "Shrinks back into the right edge." },
  { id: "genie",      label: "Genie in",     hint: "macOS dock-genie: emerges from the right edge with foreshortened perspective." },
  { id: "geniehide",  label: "Genie out",    hint: "macOS dock-genie reverse: gets sucked into the right edge." },
  /* 0.9.481: Apple baseline. Subtle, restrained, "feels native".
     - `press`     — global default for any click that isn't user-overridden.
     - `sheet-in`  — bottom-anchored modal entrance (InfoPopup, pending-review).
     - `popover-in`— small floating popover entrance (volume slider, picker).
     - `toast-in`  — slide-in toast from edge.
     - `crossfade` — mount-trigger for tab-content panels. */
  { id: "press",      label: "Press",        hint: "SwiftUI-style press feedback — scale 1 → 0.96 → 1 in 140 ms. Used as the default click animation when no user override exists." },
  { id: "sheet-in",   label: "Sheet in",     hint: "Modal sheet entrance from below with a slight scale-up. iOS sheet feel — for InfoPopup and pending-review modal." },
  { id: "popover-in", label: "Popover in",   hint: "Quick scale-from-94% + fade. macOS popover entrance — for volume slider, animation picker." },
  { id: "toast-in",   label: "Toast in",     hint: "Slide in from the edge + fade. For non-blocking transient notifications." },
  { id: "crossfade",  label: "Cross fade",   hint: "Soft mount fade — for tab content panels swapping in." },
];

/* Approximate runtime (ms) per animation — used by useEnterExit so we
   know how long to keep the element mounted during exit. */
const ANIMATION_DURATIONS = {
  pop: 520, bounce: 700, wiggle: 600, shake: 500, pulse: 600, tada: 900,
  jelly: 700, rubber: 900, swing: 800, flip: 700, rotate: 700, heartbeat: 1100,
  glow: 800, squish: 400, bouncein: 650, slidebump: 500, flash: 700, wobble: 900,
  emerge: 280, retract: 280,
  "pill-in": 200, "pill-out": 180,
  genie: 520, geniehide: 460,
  /* 0.9.481: Apple baseline durations. Kept short — restraint is the point. */
  press: 140, "sheet-in": 280, "popover-in": 180, "toast-in": 220, crossfade: 240,
};

/* 0.9.481: Apple-baseline default click animation. Fires on every <button>
   click that doesn't already have a user-assigned `click` slot, unless the
   target carries `data-anim-no-press` (per-button opt-out). Subtle SwiftUI-
   style press feedback. */
export const DEFAULT_PRESS_ANIM = "press";

const STORAGE_KEY = "buttonAnimations";
const MIGRATION_FLAG = "buttonAnimations.migrationVersion";
const CURRENT_MIGRATION_VERSION = 1;

/* 0.9.480: one-time migration. 0.9.477 shipped "genie" / "geniehide" as
 * the dev-pill defaults, which got persisted into `buttonAnimations`
 * the first time the user toggled dev mode under that version. The
 * subsequent ship (0.9.478) changed the defaults to "emerge" / "retract",
 * but stored user-assignments win over defaults, so users coming from
 * 0.9.477 keep seeing the genie. This migration clears those specific
 * stored values (and ONLY those) so the new defaults take effect. Runs
 * once per machine; protected by MIGRATION_FLAG. */
(function migrate() {
  try {
    const flag = parseInt(localStorage.getItem(MIGRATION_FLAG) || "0", 10);
    if (flag >= CURRENT_MIGRATION_VERSION) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const m = JSON.parse(raw);
      const entry = m?.["explicit:dev-pill"];
      if (entry && typeof entry === "object") {
        let changed = false;
        if (entry.mount === "genie") { delete entry.mount; changed = true; }
        if (entry.unmount === "geniehide") { delete entry.unmount; changed = true; }
        if (Object.keys(entry).length === 0) delete m["explicit:dev-pill"];
        if (changed) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
          console.log("[anim-migration] cleared stale dev-pill genie defaults from 0.9.477");
        }
      }
    }
    localStorage.setItem(MIGRATION_FLAG, String(CURRENT_MIGRATION_VERSION));
  } catch (e) {
    console.warn("[anim-migration] failed:", e.message);
  }
})();

function loadAssignments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Backward-compat: coerce legacy `{hash: "pop"}` rows to
    // `{hash: { click: "pop" }}`.
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = { click: v };
      else if (v && typeof v === "object") out[k] = v;
    }
    return out;
  } catch { return {}; }
}

function saveAssignments(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
}

/* djb2-ish 32-bit hash, stable across runs. */
export function hashString(s) {
  let h = 5381;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Stable animation hash for a DOM element. Returns null if not animatable. */
export function getAnimationId(el) {
  if (!el) return null;
  const explicit = el.getAttribute && el.getAttribute("data-anim-id");
  if (explicit) return `explicit:${explicit}`;
  if (el.tagName !== "BUTTON") return null;
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const title = el.getAttribute("title") || "";
  const aria = el.getAttribute("aria-label") || "";
  const cls = el.className || "";
  return `btn:${hashString(text + "|" + title + "|" + aria + "|" + cls)}`;
}

/** True if hash refers to an explicit container (mount/unmount slots) vs a button (click slot). */
function isContainerHash(hash) {
  return typeof hash === "string" && hash.startsWith("explicit:");
}

function findAnimatable(el) {
  // 0.9.476: TWO-PASS walk. The bypass check has to scan the ENTIRE
  // ancestor chain before we accept the nearest button — otherwise a
  // button rendered inside a data-anim-bypass container (e.g. picker
  // tiles, modals) gets returned on the first iteration before we ever
  // look at its parent's bypass attribute.
  let cursor = el;
  while (cursor && cursor !== document.body) {
    if (cursor.getAttribute && cursor.getAttribute("data-anim-bypass") != null) return null;
    cursor = cursor.parentElement;
  }
  cursor = el;
  while (cursor && cursor !== document.body) {
    if (cursor.tagName === "BUTTON") return cursor;
    if (cursor.getAttribute && cursor.getAttribute("data-anim-id")) return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

/** Fire the animation on an element. Uses `data-anim-fire` rather than
 *  className so React's reconciler doesn't wipe it on the next re-render
 *  (React owns `class` but leaves unknown data-attrs alone).
 *
 *  options.keepFinalState: when true, do NOT remove `data-anim-fire` on
 *  `animationend`. Used for unmount animations — combined with CSS
 *  `animation-fill-mode: forwards`, this keeps the final keyframe styles
 *  on the element from animation end until React actually unmounts it.
 *  Without this flag, removing the data attribute makes the CSS selector
 *  unmatch, the keyframe styles drop, and the element flashes back to
 *  its un-animated state for the frame before unmount. */
export function playAnimation(el, animId, options) {
  if (!el || !animId || animId === "none") {
    console.log(`[anim-play] skip (el=${!!el}, animId=${animId || "null"})`);
    return;
  }
  const entry = ANIMATION_LIBRARY.find((a) => a.id === animId);
  if (!entry || entry.id === "none") {
    console.warn(`[anim-play] unknown animId="${animId}" — library miss`);
    return;
  }
  const keepFinalState = !!(options && options.keepFinalState);
  // Clear any in-flight attribute so the keyframes restart cleanly.
  el.removeAttribute("data-anim-fire");
  // eslint-disable-next-line no-unused-expressions
  void el.offsetWidth; // force reflow
  el.setAttribute("data-anim-fire", entry.id);
  const tag = el.getAttribute("data-anim-id") || el.tagName.toLowerCase();
  console.log(`[anim-play] fired animId="${entry.id}" on <${tag}>${keepFinalState ? " (keepFinalState)" : ""}`);
  const cleanup = () => {
    if (!keepFinalState && el.getAttribute("data-anim-fire") === entry.id) {
      el.removeAttribute("data-anim-fire");
    }
    el.removeEventListener("animationend", cleanup);
    el.removeEventListener("animationcancel", cleanup);
  };
  el.addEventListener("animationend", cleanup);
  el.addEventListener("animationcancel", cleanup);
}

/** Standalone reader for a hash's assignment in a given trigger slot. */
export function readAssignment(hash, trigger) {
  if (!hash) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const entry = map?.[hash];
    if (!entry) return null;
    if (typeof entry === "string") return trigger === "click" ? entry : null;
    return entry[trigger] || null;
  } catch { return null; }
}

/* ============================================================ */
/*               <AnimationLayoutProvider>                       */
/* ============================================================ */

export function AnimationLayoutProvider({ designMode, children }) {
  const [assignments, setAssignments] = useState(loadAssignments);
  const [picker, setPicker] = useState(null);
  const designModeRef = useRef(designMode);
  useEffect(() => { designModeRef.current = designMode; }, [designMode]);

  const setAnimationFor = useCallback((hash, trigger, animId) => {
    setAssignments((prev) => {
      const next = { ...prev };
      const cur = { ...(next[hash] || {}) };
      const previous = cur[trigger] || "(none)";
      if (animId && animId !== "none") cur[trigger] = animId;
      else delete cur[trigger];
      if (Object.keys(cur).length === 0) delete next[hash];
      else next[hash] = cur;
      saveAssignments(next);
      console.log(`[anim-layout] set ${hash}.${trigger}: "${previous}" → "${animId || "none"}" (total assignments: ${Object.keys(next).length})`);
      return next;
    });
  }, []);

  useEffect(() => {
    if (designMode) document.body.classList.add("anim-design-mode");
    else document.body.classList.remove("anim-design-mode");
    console.log(`[anim-layout] design mode ${designMode ? "ON — clicks intercepted, picker active" : "OFF — assigned animations replay on click"}`);
    return () => { document.body.classList.remove("anim-design-mode"); };
  }, [designMode]);

  // Capture-phase click listener — runs before the target's onClick.
  // Design mode: open picker, swallow click.
  // Normal mode: for buttons, look up "click" slot & play animation.
  useEffect(() => {
    const onClickCapture = (e) => {
      const target = findAnimatable(e.target);
      if (!target) return;
      const hash = getAnimationId(target);
      if (!hash) return;
      if (designModeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const rect = target.getBoundingClientRect();
        target.classList.add("anim-edit-target");
        const slots = assignments[hash] || {};
        console.log(`[anim-layout] picker opened for ${hash} (current: mount=${slots.mount || "-"} unmount=${slots.unmount || "-"} click=${slots.click || "-"})`);
        setPicker({ el: target, rect, hash, slots });
        return;
      }
      // Only buttons get a click animation — containers use mount/unmount.
      if (target.tagName === "BUTTON") {
        const animId = assignments[hash]?.click;
        if (animId && animId !== "none") {
          console.log(`[anim-layout] click animation on ${hash} → "${animId}"`);
          playAnimation(target, animId);
        } else {
          // 0.9.481: Apple baseline — fire the default press animation
          // whenever no user-assigned click animation exists. Skip if the
          // button explicitly opted out via `data-anim-no-press` (e.g.
          // toggle/state buttons that have their own active-state styling).
          // The bypass walk above already filtered `data-anim-bypass` so
          // we only need to guard the per-button opt-out here.
          const optedOut = target.getAttribute && target.getAttribute("data-anim-no-press") != null;
          if (optedOut) {
            console.log(`[anim-default-press] skip ${hash} — data-anim-no-press opt-out`);
          } else {
            console.log(`[anim-default-press] fire "${DEFAULT_PRESS_ANIM}" on ${hash} (no user click assignment)`);
            playAnimation(target, DEFAULT_PRESS_ANIM);
          }
        }
      }
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [assignments]);

  const closePicker = useCallback(() => {
    setPicker((p) => {
      if (p?.el) p.el.classList.remove("anim-edit-target");
      return null;
    });
  }, []);

  const onPick = useCallback((trigger, animId) => {
    if (!picker) return;
    setAnimationFor(picker.hash, trigger, animId);
    if (animId && animId !== "none" && picker.el) {
      playAnimation(picker.el, animId);
    }
    setPicker((p) => p ? { ...p, slots: { ...(p.slots || {}), [trigger]: animId } } : p);
  }, [picker, setAnimationFor]);

  return (
    <>
      {children}
      {picker && (
        <AnimationPicker
          rect={picker.rect}
          slots={picker.slots}
          hash={picker.hash}
          targetEl={picker.el}
          onPick={onPick}
          onClose={closePicker}
        />
      )}
    </>
  );
}

/** Hook for elements with conditional mount/unmount. Returns a `shouldRender`
 *  flag and a `containerRef` to attach to the element. When `visible`
 *  flips true, the assigned "mount" animation plays. When `visible` flips
 *  false, the assigned "unmount" animation plays first; only after it
 *  completes does `shouldRender` go false, releasing the element from the
 *  tree. With no animation assigned, mount/unmount are immediate.
 *
 *  Usage:
 *    const pillRef = useRef(null);
 *    const { shouldRender } = useEnterExit(devMode, pillRef, "dev-pill");
 *    return shouldRender && (
 *      <div ref={pillRef} data-anim-id="dev-pill">...</div>
 *    );
 */
export function useEnterExit(visible, ref, explicitId, options) {
  const defaultMount = options?.defaultMount || null;
  const defaultUnmount = options?.defaultUnmount || null;
  const [shouldRender, setShouldRender] = useState(!!visible);
  const lastVisibleRef = useRef(!!visible);
  const pendingMountAnimRef = useRef(null);
  const timerRef = useRef(null);

  // Visibility transitions. ENTER: queue a mount-animation request and
  // flip shouldRender to true; the actual playAnimation call happens in
  // the separate useEffect below, once React has committed the mount
  // and the ref is populated. EXIT: play the unmount animation right
  // away (element is already in the DOM), then unmount after the
  // animation's known duration.
  useEffect(() => {
    const wasVisible = lastVisibleRef.current;
    const isVisible = !!visible;
    lastVisibleRef.current = isVisible;
    if (isVisible === wasVisible) return;

    const hash = `explicit:${explicitId}`;
    if (isVisible) {
      const userAssigned = readAssignment(hash, "mount");
      const animId = userAssigned || defaultMount;
      console.log(`[anim-enterexit] ${explicitId} → VISIBLE; assignment=${userAssigned || "(none)"} default=${defaultMount || "(none)"} → queued="${animId || "none"}"`);
      // Queue the mount animation. The shouldRender effect picks it up
      // after the element is actually in the DOM.
      pendingMountAnimRef.current = animId;
      setShouldRender(true);
    } else {
      const userAssigned = readAssignment(hash, "unmount");
      const animId = userAssigned || defaultUnmount;
      console.log(`[anim-enterexit] ${explicitId} → HIDDEN;  assignment=${userAssigned || "(none)"} default=${defaultUnmount || "(none)"} → playing="${animId || "none"}"`);
      if (!animId || animId === "none" || !ref.current) {
        setShouldRender(false);
        return;
      }
      // keepFinalState=true so the data-anim-fire attribute (and thus
      // the CSS animation-fill-mode: forwards final keyframe) stays
      // applied until React unmounts the element. Without this, the
      // attribute is removed at animationend, the CSS selector unmatches,
      // and the element flashes its un-animated state for one frame
      // before unmount.
      playAnimation(ref.current, animId, { keepFinalState: true });
      const dur = ANIMATION_DURATIONS[animId] || 600;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setShouldRender(false);
        timerRef.current = null;
        console.log(`[anim-enterexit] ${explicitId} → unmount complete (waited ${dur}ms)`);
      }, dur + 30);
    }
  }, [visible, ref, explicitId, defaultMount, defaultUnmount]);

  // Mount-animation firing. Runs after `shouldRender` flips true AND
  // React has committed the render, so `ref.current` is guaranteed to
  // be the mounted DOM node. Resolves the race that broke "emerge":
  // previously we scheduled playAnimation in a requestAnimationFrame
  // that often fired BEFORE the next React commit, hitting a null ref.
  useEffect(() => {
    if (!shouldRender) return;
    const animId = pendingMountAnimRef.current;
    if (!animId) return;
    pendingMountAnimRef.current = null;
    if (!ref.current) {
      console.warn(`[anim-enterexit] ${explicitId} mount-anim "${animId}" skipped — ref still null after shouldRender flipped true`);
      return;
    }
    if (animId !== "none") {
      console.log(`[anim-enterexit] ${explicitId} → firing queued mount anim "${animId}"`);
      playAnimation(ref.current, animId);
    }
  }, [shouldRender, ref, explicitId]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { shouldRender };
}

/* ============================================================ */
/*                     AnimationPicker UI                       */
/* ============================================================ */

function AnimationPicker({ rect, slots, hash, targetEl, onPick, onClose }) {
  const isContainer = isContainerHash(hash);
  const availableTriggers = isContainer
    ? ["mount", "unmount"]
    : ["click"];
  const [trigger, setTrigger] = useState(availableTriggers[0]);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickerW = 380, pickerH = 460;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = rect.top - pickerH - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - pickerW / 2;
  if (left < 8) left = 8;
  if (left + pickerW > vw - 8) left = vw - pickerW - 8;
  if (top + pickerH > vh - 8) top = Math.max(8, vh - pickerH - 8);

  const targetLabel = (() => {
    if (!targetEl) return "(no preview)";
    const t = (targetEl.textContent || "").trim().slice(0, 30);
    if (t) return `“${t}”`;
    if (targetEl.getAttribute("data-anim-id")) return targetEl.getAttribute("data-anim-id");
    return `<${targetEl.tagName.toLowerCase()}>`;
  })();

  const current = (slots && slots[trigger]) || "none";

  return createPortal(
    <div
      data-anim-bypass
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 20000,
        background: "rgba(0,0,0,0.25)",
        cursor: "default",
      }}
    >
      <div data-anim-bypass style={{
        position: "absolute",
        top, left,
        width: pickerW, maxHeight: pickerH,
        background: "rgba(22, 24, 30, 0.97)",
        border: "1px solid rgba(220, 166, 74, 0.45)",
        borderRadius: 10,
        boxShadow: "0 12px 36px rgba(0,0,0,0.65)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: "#eee",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ padding: "10px 12px 8px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#dca64a" }}>
            Edit animation
          </div>
          <div style={{ fontSize: "0.7rem", color: "#999", marginTop: 2 }}>
            Target: <span style={{ color: "#ccc" }}>{targetLabel}</span>
            <span style={{ marginLeft: 6, fontSize: "0.65rem", opacity: 0.55 }}>({hash})</span>
          </div>
          {availableTriggers.length > 1 && (
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              {availableTriggers.map((t) => {
                const active = trigger === t;
                const label = t === "mount" ? "Appearing"
                  : t === "unmount" ? "Disappearing"
                  : t.charAt(0).toUpperCase() + t.slice(1);
                const assigned = slots && slots[t] && slots[t] !== "none";
                return (
                  <button
                    key={t}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTrigger(t); }}
                    style={{
                      flex: 1, padding: "5px 8px", borderRadius: 6,
                      border: `1px solid ${active ? "#dca64a" : "rgba(255,255,255,0.12)"}`,
                      background: active ? "rgba(220,166,74,0.18)" : "rgba(255,255,255,0.04)",
                      color: active ? "#ffd98a" : "#bbb",
                      fontSize: "0.72rem", fontWeight: active ? 700 : 500, cursor: "pointer",
                    }}
                  >
                    {label}{assigned ? ` · ${slots[t]}` : ""}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{
          padding: 8, overflowY: "auto", flex: 1, minHeight: 0,
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
        }}>
          {ANIMATION_LIBRARY.map((a) => {
            const active = current === a.id;
            return (
              <button
                key={a.id}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(trigger, a.id); }}
                onMouseEnter={(e) => {
                  setHovered(a.id);
                  if (a.id !== "none") playAnimation(e.currentTarget, a.id);
                }}
                onMouseLeave={() => setHovered(null)}
                title={a.hint}
                style={{
                  padding: "10px 8px",
                  background: active ? "rgba(220,166,74,0.25)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${active ? "#dca64a" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 6,
                  color: active ? "#ffd98a" : "#ddd",
                  fontSize: "0.72rem",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 500,
                  textAlign: "center",
                  minHeight: 36,
                }}
              >{a.label}</button>
            );
          })}
        </div>
        <div style={{
          padding: "6px 10px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          fontSize: "0.65rem", color: "#888",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>
            {hovered
              ? ANIMATION_LIBRARY.find(a => a.id === hovered)?.hint
              : `Hover a tile to preview · click to assign${availableTriggers.length > 1 ? " · switch tab for the other phase" : ""}`}
          </span>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            style={{
              background: "transparent", border: "1px solid rgba(255,255,255,0.18)",
              color: "#aaa", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "0.7rem",
            }}
          >Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
