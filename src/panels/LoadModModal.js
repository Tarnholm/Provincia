// "Load your mod to edit" modal, extracted from App.js (2026-07-15). Shown
// when the user tries to edit while on bundled sample data. Picks a mod folder,
// resolves its faction-icons dir (which drives the effect that activates the
// mod for writes), and reports via toast. Props: a close handler, the
// modIconsDir setter, and pushToast. Behavior identical to the inline block.
import React from "react";

export default function LoadModModal({ onClose, onSetModIconsDir, pushToast }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 12000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "90vw", background: "#1c2230", border: "1px solid rgba(110,140,190,0.5)", borderRadius: 8, padding: "20px 22px", color: "#cdd6e6", boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
      >
        <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "#ffd479", marginBottom: 10 }}>Load your mod to edit</div>
        <div style={{ fontSize: "0.85rem", lineHeight: 1.5, marginBottom: 16 }}>
          You're viewing Provincia's <b>bundled sample data</b>, so there's no mod to save changes into — that's why edits fail with <i>"no active mod."</i>
          <br /><br />
          Load your mod's folder (the one containing <code>data\</code>) to make and save edits.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "6px 14px", background: "transparent", color: "#9aa", border: "1px solid rgba(150,160,180,0.4)", borderRadius: 4, cursor: "pointer", fontSize: "0.82rem" }}
          >Cancel</button>
          <button
            onClick={async () => {
              const api = window.electronAPI;
              if (!api?.selectFolder || !api?.findFactionIconsDir) { pushToast("Folder picker unavailable.", "warning"); return; }
              const picked = await api.selectFolder();
              const folder = picked && (typeof picked === "string" ? picked : picked.dir);
              if (!folder) return; // cancelled
              // Locate the faction-icons dir inside the picked mod folder —
              // setting modIconsDir drives the effect that derives the data dir
              // and runs charactersInit (which sets the active mod in the main
              // process, enabling writes). Same path as auto-detect.
              const iconsDir = await api.findFactionIconsDir(folder);
              if (!iconsDir) {
                pushToast("That folder isn't a mod (no faction icons found). Pick the mod folder that contains data\\.", "warning", 8000);
                return;
              }
              onSetModIconsDir(iconsDir);
              try { localStorage.setItem("modIconsDir", iconsDir); } catch {}
              onClose();
              pushToast("Mod loaded — you can edit and save now.", "info", 5000);
            }}
            style={{ padding: "6px 14px", background: "rgba(110,140,190,0.25)", color: "#bfe0ff", border: "1px solid rgba(110,140,190,0.6)", borderRadius: 4, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}
          >Load mod folder…</button>
        </div>
      </div>
    </div>
  );
}
