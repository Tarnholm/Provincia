import React, { useEffect, useRef, useState } from "react";

/**
 * Real volume control replacing the old binary mute. Click the speaker
 * icon to pop open a vertical slider (drag the knob up/down). The speaker
 * glyph adapts: full at high volume, low at mid, single curve at low, X
 * at zero (functionally muted). Persists `audioVolume` (0..1) in
 * localStorage so user preference carries across sessions.
 */
export default function VolumeControl({ volume, onChange, buttonStyle }) {
  const base = buttonStyle || {};
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  const muted = v <= 0.001;
  const pct = Math.round(v * 100);
  const title = muted ? "Volume: muted (click to adjust)" : `Volume: ${pct}% (click to adjust)`;

  // Speaker glyph picks a different SVG path based on level so the icon
  // reflects loudness at a glance.
  const Glyph = () => {
    if (muted) {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 12 10.73 4.27 3zM12 4l-2.09 2.09L12 8.18V4z" />
        </svg>
      );
    }
    if (v < 0.34) {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
          <path d="M3 9v6h4l5 5V4L7 9H3z" />
        </svg>
      );
    }
    if (v < 0.67) {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
      );
    }
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      </svg>
    );
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="dev-btn"
        onClick={() => setOpen(p => !p)}
        onWheel={(e) => {
          e.preventDefault();
          const step = e.deltaY > 0 ? -0.05 : 0.05;
          const next = Math.max(0, Math.min(1, v + step));
          onChange(next);
        }}
        title={title}
        aria-label={title}
        style={{
          ...base,
          background: muted ? "rgba(90,50,50,0.85)" : "rgba(60,60,60,0.85)",
          color: muted ? "#d88" : "#ccc",
          border: `1px solid ${muted ? "#844" : "#555"}`,
          minWidth: 40,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        <Glyph />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: 8,
            background: "rgba(20,22,26,0.96)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "12px 10px 8px 10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            zIndex: 10005,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontSize: "0.7rem", color: "#bbb", fontVariantNumeric: "tabular-nums", minWidth: 28, textAlign: "center" }}>
            {muted ? "off" : `${pct}%`}
          </div>
          {/* Vertical slider — `appearance: slider-vertical` is the
              legacy Chromium way; modern Chromium also supports
              `writing-mode: vertical-lr` + `direction: rtl` to flip the
              axis (up = louder). Use both for maximum compatibility. */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={v}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            aria-label="Volume"
            style={{
              writingMode: "vertical-lr",
              WebkitAppearance: "slider-vertical",
              appearance: "slider-vertical",
              direction: "rtl",
              width: 28,
              height: 110,
              accentColor: "#dca64a",
              cursor: "pointer",
            }}
          />
          <button
            onClick={() => onChange(v > 0 ? 0 : 0.7)}
            title={muted ? "Unmute (restore to 70%)" : "Mute"}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              color: muted ? "#d88" : "#ccc",
              fontSize: "0.68rem",
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      )}
    </div>
  );
}
