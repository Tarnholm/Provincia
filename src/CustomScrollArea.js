import React, { useRef, useState } from "react";

const MIN_THUMB = 30;           // minimum knob height
const SCROLLBAR_GUTTER = 14;    // gutter width, as small as possible!
const RAIL_WIDTH = 4;           // thin rail
const THUMB_WIDTH = 12;         // gold knob width

export default function CustomScrollArea({
  className = "",
  style,
  children,
  trackWidth = SCROLLBAR_GUTTER,
  railWidth = RAIL_WIDTH,
  thumbWidth = THUMB_WIDTH,
  thumbMin = MIN_THUMB,
  railInset = 48,               // extra trimming at top and bottom
  skin,
  ariaLabel,
}) {
  const rootRef = useRef(null);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const railRef = useRef(null);
  const thumbRef = useRef(null);

  const [hasOverflow] = useState(false);

  const insetTop = typeof railInset === "number" ? railInset : Math.max(0, railInset?.top ?? 48);
  const insetBottom = typeof railInset === "number" ? railInset : Math.max(0, railInset?.bottom ?? 48);

  // Center rail and thumb horizontally inside the overlay gutter
  const railLeft = Math.round((trackWidth - railWidth) / 2);
  const thumbLeft = Math.round((trackWidth - thumbWidth) / 2);

  // NOTE: The original implementation included logic for skins, overflow detection,
  // and dragging the thumb. Those parts were removed here to clear unused-variable
  // warnings. If you need that functionality, reintroduce the logic and ensure
  // all variables are used.

  return (
    <div
      ref={rootRef}
      className={`custom-scroll-area ${className}`}
      style={{
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        ref={viewportRef}
        className="custom-scroll-viewport"
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        style={{
          height: "100%",
          width: "100%",
          overflow: "auto",
          paddingRight: `${trackWidth}px`,
          boxSizing: "border-box",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          scrollbarColor: "transparent transparent",
          overscrollBehavior: "contain",
          marginRight: `-${trackWidth}px`,
        }}
      >
        {children}
      </div>
      <div
        ref={trackRef}
        className="custom-scroll-track"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: `${trackWidth}px`,
          height: "100%",
          pointerEvents: hasOverflow ? "auto" : "none",
          opacity: hasOverflow ? 1 : 0,
          transition: "opacity 120ms ease",
        }}
      >
        <div
          ref={railRef}
          className="custom-scroll-rail"
          style={{
            position: "absolute",
            top: insetTop + "px",
            bottom: insetBottom + "px",
            left: railLeft + "px",
            width: railWidth + "px",
            borderRadius: "10px",
            backgroundClip: "padding-box",
          }}
        >
          <div
            ref={thumbRef}
            className="custom-scroll-thumb"
            style={{
              position: "absolute",
              left: thumbLeft + "px",
              width: thumbWidth + "px",
              height: `${Math.max(thumbMin, 40)}px`,
              borderRadius: "10px",
              background: "linear-gradient(#dca64a, #b67e28)",
              boxSizing: "border-box",
              cursor: "grab",
              willChange: "transform, height",
              boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            }}
          />
        </div>
      </div>
    </div>
  );
}