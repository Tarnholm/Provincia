import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// Forward console output + errors to the main process log file so the user
// can send us one file instead of opening DevTools.
(() => {
  const api = window.electronAPI;
  if (!api?.logMessage) return;
  const fmt = (args) => args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === "object") { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  }).join(" ");
  for (const lvl of ["log", "info", "warn", "error"]) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...args) => {
      try { api.logMessage(lvl, fmt(args)); } catch {}
      orig(...args);
    };
  }
  window.addEventListener("error", (ev) => {
    api.logMessage("error",
      `UNHANDLED ERROR: ${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno}\n${ev.error?.stack || ""}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    api.logMessage("error", `UNHANDLED REJECTION: ${r?.stack || r?.message || r}`);
  });
})();

// Main-thread stall detector (2026-07-16 dev-button hunt). Logs every long
// task >= 300ms with its attribution so "the UI ate my click" moments are
// visible in provincia.log with a duration. A *permanently* hung thread never
// reports here (the task must end to be observed) — that case is covered by
// main.js's watchdogs + pre-armed CDP stack capture. Registered after the
// console patch above so the lines reach the log file.
try {
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.duration < 300) continue;
      const attr = e.attribution?.[0];
      const src = attr ? `${attr.containerType || ""} ${attr.containerName || attr.containerSrc || ""}`.trim() : "";
      console.warn(`[main-thread-stall] ${Math.round(e.duration)}ms long task at t+${Math.round(e.startTime)}ms${src ? ` (${src})` : ""}`);
    }
  });
  po.observe({ entryTypes: ["longtask"] });
} catch {}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);