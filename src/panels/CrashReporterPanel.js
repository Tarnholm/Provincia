// Bundled crash reporter — control surface (2026-07-25).
//
// The reporter used to be a second program a tester had to remember to start
// before launching the game, and forgetting meant a crash went unreported. It is
// bundled now, so this panel is the whole interface: set your name once, press
// start, play. It watches for the game, and after the game exits it uploads the
// report by itself.
//
// The name matters and is easy to get wrong, so it is asked for FIRST and the
// start button stays disabled until it is set — standalone the reporter prompts
// on its console, but there is no console here, and reports would silently arrive
// tagged "unnamed".
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export default function CrashReporterPanel({ onClose }) {
  const [status, setStatus] = useState(null);
  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [configPath, setConfigPath] = useState("");

  const api = window.electronAPI || {};

  const refresh = useCallback(async () => {
    try {
      const st = await api.crashReporterStatus();
      setStatus(st);
    } catch (e) { setError(String(e && e.message ? e.message : e)); }
  }, [api]);

  useEffect(() => {
    refresh();
    (async () => {
      try {
        const n = await api.crashReporterGetName();
        if (n && n.ok) { setName(n.name || ""); setDraft(n.name || ""); setNameSaved(!!n.confirmed && !!n.name); }
        const c = await api.crashReporterConfigPath();
        if (c && c.ok) setConfigPath(c.path);
      } catch { /* the panel still works without these */ }
    })();
    // live status pushes while it runs; the poll is a safety net for a missed one
    const un = api.onCrashReporterStatus ? api.onCrashReporterStatus(setStatus) : null;
    const t = setInterval(refresh, 4000);
    return () => { clearInterval(t); if (un) un(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = async () => {
    setError(null);
    const v = draft.trim();
    if (!v) { setError("Enter the name you go by on the RIS Discord server."); return; }
    setBusy(true);
    try {
      const r = await api.crashReporterSetName(v);
      if (r && r.ok) { setName(r.name); setDraft(r.name); setNameSaved(true); }
      else setError((r && r.error) || "could not save the name");
    } finally { setBusy(false); }
  };

  const start = async () => {
    setError(null); setBusy(true);
    try {
      const r = await api.crashReporterStart();
      if (!r || !r.ok) setError((r && r.error) || "could not start the reporter");
      else setStatus(r);
    } finally { setBusy(false); }
  };
  const stop = async () => {
    setError(null); setBusy(true);
    try {
      const r = await api.crashReporterStop();
      if (!r || !r.ok) setError((r && r.error) || "could not stop the reporter");
      else setStatus(r);
    } finally { setBusy(false); }
  };

  const running = !!(status && status.running);
  const since = running && status.startedAt
    ? Math.max(0, Math.round((Date.now() - status.startedAt) / 60000))
    : null;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 16px 14px", width: "min(660px, 96vw)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#8fc9d8" }}>⚑ Crash Reporter</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ fontSize: "0.78rem", color: "#cfc6b0", lineHeight: 1.55, marginBottom: 10 }}>
          Start this before you launch Rome, and leave Provincia open while you play. It watches the game,
          and when the game exits it sends a report — crash details, the logs that explain them, your latest
          save, and an extract of the AI's own decision log for the Movement Lab.
          You no longer need to run a separate reporter program.
        </div>

        {/* the name gates starting, because a report tagged "unnamed" cannot be followed up */}
        <div style={{ padding: "8px 10px", borderRadius: 6, marginBottom: 10, background: nameSaved ? "rgba(143,209,143,0.08)" : "rgba(232,200,115,0.10)", border: `1px solid ${nameSaved ? "rgba(143,209,143,0.3)" : "rgba(232,200,115,0.4)"}` }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: nameSaved ? "#8fd18f" : "#e8c873", marginBottom: 4 }}>
            {nameSaved ? `Reports will be tagged: ${name}` : "Your name on the RIS Discord server"}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#9a8f7a", marginBottom: 6 }}>
            Discord lets you use a different nickname on each server — use the one you go by on the RIS
            server specifically, not your global handle. That is how a report gets matched to you.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
              placeholder="e.g. Tarnholm" maxLength={80}
              style={{ flex: 1, padding: "4px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.35)", color: "#f0f0f0", fontSize: "0.78rem", outline: "none" }} />
            <button onClick={saveName} disabled={busy || !draft.trim() || draft.trim() === name}
              style={{ padding: "4px 12px", borderRadius: 5, cursor: busy ? "default" : "pointer", border: "1px solid rgba(143,201,216,0.4)", background: "rgba(143,201,216,0.15)", color: "#8fc9d8", fontSize: "0.76rem", fontWeight: 600 }}>
              Save
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <button onClick={running ? stop : start} disabled={busy || (!running && !nameSaved)}
            title={!nameSaved && !running ? "Set your RIS Discord name first" : (running ? "Stop watching" : "Start watching for the game")}
            style={{ padding: "5px 16px", borderRadius: 6, fontWeight: 700, fontSize: "0.8rem",
              cursor: (busy || (!running && !nameSaved)) ? "default" : "pointer",
              border: `1px solid ${running ? "rgba(232,122,106,0.5)" : "rgba(143,209,143,0.5)"}`,
              background: running ? "rgba(232,122,106,0.18)" : "rgba(143,209,143,0.18)",
              color: running ? "#e87a6a" : "#8fd18f",
              opacity: (busy || (!running && !nameSaved)) ? 0.5 : 1 }}>
            {running ? "■ Stop" : "▶ Start watching"}
          </button>
          <span style={{ fontSize: "0.76rem", color: running ? "#8fd18f" : "#9a8f7a" }}>
            {running
              ? `Watching${since != null ? ` — ${since} min` : ""}${status.pid ? ` (pid ${status.pid})` : ""}`
              : "Not running"}
          </span>
          {status && status.lastExit && !running && (
            <span style={{ fontSize: "0.72rem", color: status.lastExit.code === 0 ? "#8fa89a" : "#e8c873" }}>
              last run exited with code {String(status.lastExit.code)}
            </span>
          )}
        </div>

        {error && (
          <div style={{ fontSize: "0.75rem", color: "#e87a6a", marginBottom: 8, padding: "5px 8px", borderRadius: 5, background: "rgba(232,122,106,0.1)", border: "1px solid rgba(232,122,106,0.3)" }}>
            {error}
          </div>
        )}

        {/* the reporter's own console output, so a tester can see it is alive and
            read what it decided without hunting for a log file */}
        {status && status.tail && status.tail.length > 0 && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#cfc6b0", marginBottom: 3 }}>Reporter output</div>
            <pre style={{ margin: 0, padding: "6px 8px", borderRadius: 5, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)", fontSize: "0.68rem", lineHeight: 1.45, color: "#bbb", maxHeight: 190, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {status.tail.join("\n")}
            </pre>
          </div>
        )}

        {configPath && (
          <div style={{ fontSize: "0.68rem", color: "#7a7266", marginTop: 8 }}>
            Settings: <code style={{ color: "#9a8f7a" }}>{configPath}</code>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
