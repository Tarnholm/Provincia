import React from "react";

/**
 * Speaker icon button (Windows Sound Manager style). Clicking toggles
 * the startup sound's mute state — muting silences but doesn't pause
 * the underlying audio; unmuting picks up at the current playhead.
 */
export default function MuteButton({ muted, onToggle, buttonStyle }) {
  const base = buttonStyle || {};
  return (
    <button
      onClick={onToggle}
      title={muted ? "Unmute startup sound" : "Mute startup sound"}
      aria-label={muted ? "Unmute" : "Mute"}
      style={{
        ...base,
        background: muted ? "rgba(90,50,50,0.85)" : "rgba(60,60,60,0.85)",
        color: muted ? "#d88" : "#ccc",
        border: `1px solid ${muted ? "#844" : "#555"}`,
        minWidth: 40, padding: "4px 10px",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      {muted ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 12 10.73 4.27 3zM12 4l-2.09 2.09L12 8.18V4z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
      )}
    </button>
  );
}
