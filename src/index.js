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

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);