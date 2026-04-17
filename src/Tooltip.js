import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip renders its label via a React portal into document.body, so parent
 * containers with overflow:hidden or will-change transforms (e.g. CustomScrollArea)
 * can't clip it. Position is computed from the trigger's bounding rect and flips
 * above the trigger when the viewport would otherwise cut the tooltip off.
 */
function Tooltip({ label, children }) {
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState(null);
  const [flipUp, setFlipUp] = useState(false);
  const triggerRef = useRef(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    setFlipUp(spaceBelow < 44);
    setRect(r);
  }, []);

  const onEnter = useCallback(() => {
    updatePos();
    setShow(true);
  }, [updatePos]);

  const onLeave = useCallback(() => setShow(false), []);

  // Recompute on scroll/resize while visible so the tooltip tracks the trigger.
  useEffect(() => {
    if (!show) return;
    const onMove = () => updatePos();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [show, updatePos]);

  const portalNode = show && rect ? createPortal(
    <div
      className="tooltip"
      style={{
        position: "fixed",
        top: flipUp ? rect.top - 8 : rect.bottom + 8,
        left: rect.left + rect.width / 2,
        transform: flipUp ? "translate(-50%, -100%)" : "translateX(-50%)",
        padding: "6px 12px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        zIndex: 10000,
        pointerEvents: "none",
      }}
      role="tooltip"
    >
      {label}
    </div>,
    document.body
  ) : null;

  return (
    <div
      ref={triggerRef}
      style={{ display: "inline-block", position: "relative" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      {children}
      {portalNode}
    </div>
  );
}

export default Tooltip;
