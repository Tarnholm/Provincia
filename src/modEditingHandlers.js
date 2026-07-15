// descr_strat / mod EDITING + backup IPC handlers, extracted from main.js
// (2026-07-15). register(ipcMain, deps) wires the character/army/region edits
// (update-character-traits/position/fields/ancillaries, rename-character,
// update-army-units, relocate-garrison, update-region-buildings,
// update-core-attitudes), the Add-General flow (addgen-get-data/apply), the
// mod backups (backup-mod-files/list-mod-backups/restore-mod-backup), and the
// read handlers get-descr-strat-families/get-core-attitudes. Time-varying
// module state (activeModDataDir / _modExportDir / modDescrStratFamilies) is
// read through injected getters; findActiveDescrStratPath + backupTargets are
// used only here so they travel in. Logic unchanged. These write ONLY under the
// active mod dir — covered by the mod-sandbox tests (src/mainWriteHandlers.test.js).
"use strict";
const fs = require("fs");
const path = require("path");
const descrGen = require("./descrStratGeneral.js");
const { gameTextCRLF } = require("./mainUtils.js");

function registerModEditingHandlers(ipcMain, { getActiveModDataDir, getModExportDir, getModDescrStratFamilies, _writeLog, buildStartingArmiesFromMod, getVanillaDataDir, loadModCharacterData, loadPortraitMapping, resolvePortraitPool, modOut }) {
ipcMain.handle("update-character-traits", async (_event, firstName, faction, traits) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!firstName) return { ok: false, error: "missing firstName" };
  if (!Array.isArray(traits)) return { ok: false, error: "traits must be an array" };
  // Try imperial_campaign first, then alex / BI fallbacks (same order as
  // the loader).
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    // Find the `character` line for this firstName + faction. descr_strat
    // groups characters under `faction <id>,` headers, so we track the
    // current faction as we scan.
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null;
    let charLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      // Match `character` or `character,` then firstName as first comma-arg.
      const cm = lines[i].match(/^character[\s,]+([^,]+?),/);
      if (cm) {
        const parts = cm[1].trim().split(/\s+/);
        const fn = parts[0];
        if (fn === firstName && (!targetFaction || curFaction === targetFaction)) {
          charLineIdx = i;
          break;
        }
      }
    }
    if (charLineIdx < 0) return { ok: false, error: `character "${firstName}" (faction "${faction}") not found in ${path.basename(dsPath)}` };
    // The `traits …` line typically sits 1-2 lines below the `character`
    // header. Scan ahead until next blank / next character / next army.
    let traitsLineIdx = -1;
    for (let j = charLineIdx + 1; j < Math.min(charLineIdx + 8, lines.length); j++) {
      if (/^\s*traits\b/.test(lines[j])) { traitsLineIdx = j; break; }
      if (/^character[\s,]/.test(lines[j]) || /^army\b/.test(lines[j])) break;
    }
    // Format new traits line. Empty list → drop the existing line entirely.
    const newLine = traits.length > 0
      ? `traits ${traits.map(t => `${t.name} ${t.level}`).join(", ")}`
      : null;
    if (traitsLineIdx >= 0) {
      if (newLine == null) {
        lines.splice(traitsLineIdx, 1);
      } else {
        // Preserve the original indent.
        const indent = lines[traitsLineIdx].match(/^(\s*)/)[1] || "";
        lines[traitsLineIdx] = indent + newLine;
      }
    } else if (newLine != null) {
      // Insert traits line right after the character header.
      lines.splice(charLineIdx + 1, 0, "\t" + newLine);
    }
    // Write back. Preserve line endings as found in the file.
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    const out = lines.join(usesCRLF ? "\r\n" : "\n");
    fs.writeFileSync(modOut(dsPath), out, "utf8");
    console.log(`[trait-edit] wrote ${traits.length} traits for ${firstName} (faction ${faction || "?"}) to ${path.basename(dsPath)}:${traitsLineIdx >= 0 ? traitsLineIdx + 1 : charLineIdx + 2}${getModExportDir() ? " (exported)" : ""}`);
    return { ok: true, file: dsPath, line: traitsLineIdx >= 0 ? traitsLineIdx + 1 : charLineIdx + 2 };
  } catch (e) {
    console.warn(`[trait-edit] failed for ${firstName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Move an existing character's spawn tile in descr_strat. Matched by its
// current (oldX,oldY) within the faction — robust against name/token quirks.
// Used by the map drag-to-move-character feature; staged + applied on Save.
ipcMain.handle("update-character-position", async (_event, faction, oldX, oldY, newX, newY) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null, hitIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      if (/^character[\s,]/.test(lines[i])) {
        const cm = lines[i].match(/\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
        if (cm && Number(cm[1]) === Number(oldX) && Number(cm[2]) === Number(oldY) && (!targetFaction || curFaction === targetFaction)) {
          hitIdx = i; break;
        }
      }
    }
    if (hitIdx < 0) return { ok: false, error: `no character at (${oldX},${oldY}) in faction "${faction}"` };
    lines[hitIdx] = lines[hitIdx].replace(/\bx\s+-?\d+\s*,\s*y\s+-?\d+/i, `x ${newX}, y ${newY}`);
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    fs.writeFileSync(modOut(dsPath), lines.join(usesCRLF ? "\r\n" : "\n"), "utf8");
    if (!getModExportDir()) { try { loadModCharacterData(getActiveModDataDir()); } catch (e) { console.warn("[char-move] post-write re-parse failed:", e && e.message); } }
    console.log(`[char-move] ${faction} character (${oldX},${oldY}) → (${newX},${newY}) in ${path.basename(dsPath)}:${hitIdx + 1}`);
    return { ok: true, file: dsPath, line: hitIdx + 1 };
  } catch (e) {
    console.warn(`[char-move] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Edit an existing starting general's scalar fields (age, leader/heir tag) on
// its descr_strat `character` line. Matched by firstName + faction like the
// trait/ancillary editors. Surgical string edits preserve everything else on
// the line (inline stats, coords, the rest of the name). Staged + applied on Save.
ipcMain.handle("update-character-fields", async (_event, firstName, faction, fields) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!firstName) return { ok: false, error: "missing firstName" };
  if (!fields || typeof fields !== "object") return { ok: false, error: "missing fields" };
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null, charLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      const cm = lines[i].match(/^character[\s,]+([^,]+?),/);
      if (cm) {
        const fn = cm[1].trim().split(/\s+/)[0];
        if (fn === firstName && (!targetFaction || curFaction === targetFaction)) { charLineIdx = i; break; }
      }
    }
    if (charLineIdx < 0) return { ok: false, error: `character "${firstName}" (faction "${faction}") not found in ${path.basename(dsPath)}` };
    let line = lines[charLineIdx];
    const applied = [];
    if (typeof fields.age === "number" && fields.age > 0 && fields.age < 120) {
      if (/\bage\s+\d+/i.test(line)) { line = line.replace(/\bage\s+\d+/i, `age ${fields.age}`); applied.push(`age=${fields.age}`); }
    }
    if (typeof fields.tag === "string") {
      const tag = fields.tag.toLowerCase();
      // Drop any existing leader/heir token right after `named character,`…
      line = line.replace(/(\bnamed character\s*,\s*)(leader|heir)\s*,\s*/i, "$1");
      // …then re-insert the requested one (empty string = plain general).
      if (tag === "leader" || tag === "heir") {
        line = line.replace(/(\bnamed character\s*,\s*)/i, `$1${tag}, `);
      }
      applied.push(`tag=${tag || "(none)"}`);
    }
    if (!applied.length) return { ok: false, error: "no recognised fields to apply" };
    lines[charLineIdx] = line;
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    fs.writeFileSync(modOut(dsPath), lines.join(usesCRLF ? "\r\n" : "\n"), "utf8");
    if (!getModExportDir()) { try { loadModCharacterData(getActiveModDataDir()); } catch (e) { console.warn("[char-fields] post-write re-parse failed:", e && e.message); } }
    console.log(`[char-fields] ${firstName} (${faction || "?"}): ${applied.join(", ")} in ${path.basename(dsPath)}:${charLineIdx + 1}`);
    return { ok: true, file: dsPath, line: charLineIdx + 1, applied };
  } catch (e) {
    console.warn(`[char-fields] failed for ${firstName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Safety net for the descr_strat editors: back up the campaign text files before
// a Save writes them, and restore the most recent backup on demand. Backs up
// descr_strat.txt + names.txt + descr_names_lookup.txt + descr_win_conditions.txt
// to a single timestamped set; keeps the newest 10 sets (prunes older).
function backupTargets() {
  if (!getActiveModDataDir()) return [];
  const ds = findActiveDescrStratPath();
  const out = [];
  if (ds) {
    out.push(ds);
    out.push(ds.replace(/descr_strat\.txt$/i, "descr_win_conditions.txt"));
  }
  out.push(path.join(getActiveModDataDir(), "text", "names.txt"));
  out.push(path.join(getActiveModDataDir(), "descr_names_lookup.txt"));
  return out.filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
}
ipcMain.handle("backup-mod-files", async () => {
  try {
    const targets = backupTargets();
    if (!targets.length) return { ok: false, error: "no files to back up" };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const p of targets) { try { fs.copyFileSync(p, `${p}.provincia-${stamp}.bak`); } catch {} }
    // Prune: keep newest 10 backup stamps per file.
    for (const p of targets) {
      try {
        const dir = path.dirname(p), base = path.basename(p);
        const baks = fs.readdirSync(dir).filter((f) => f.startsWith(base + ".provincia-") && f.endsWith(".bak")).sort();
        while (baks.length > 10) { try { fs.unlinkSync(path.join(dir, baks.shift())); } catch {} }
      } catch {}
    }
    console.log(`[backup] mod files backed up @ ${stamp} (${targets.length} files)`);
    return { ok: true, stamp, files: targets.length };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("list-mod-backups", async () => {
  try {
    const ds = findActiveDescrStratPath();
    if (!ds) return { ok: false, backups: [] };
    const dir = path.dirname(ds), base = path.basename(ds);
    const stamps = fs.readdirSync(dir)
      .filter((f) => f.startsWith(base + ".provincia-") && f.endsWith(".bak"))
      .map((f) => f.slice((base + ".provincia-").length, -4))
      .sort().reverse();
    return { ok: true, backups: stamps };
  } catch (e) { return { ok: false, error: e.message, backups: [] }; }
});
ipcMain.handle("restore-mod-backup", async (_event, stamp) => {
  try {
    const targets = backupTargets();
    if (!targets.length) return { ok: false, error: "no active mod" };
    // Use the latest stamp if none given.
    let useStamp = stamp;
    if (!useStamp) {
      const ds = findActiveDescrStratPath();
      const dir = path.dirname(ds), base = path.basename(ds);
      const stamps = fs.readdirSync(dir).filter((f) => f.startsWith(base + ".provincia-") && f.endsWith(".bak")).map((f) => f.slice((base + ".provincia-").length, -4)).sort();
      useStamp = stamps[stamps.length - 1];
    }
    if (!useStamp) return { ok: false, error: "no backups found" };
    let restored = 0;
    for (const p of targets) {
      const bak = `${p}.provincia-${useStamp}.bak`;
      if (fs.existsSync(bak)) { try { fs.copyFileSync(bak, p); restored++; } catch {} }
    }
    try { loadModCharacterData(getActiveModDataDir()); } catch {}
    console.log(`[backup] restored ${restored} file(s) from ${useStamp}`);
    return { ok: true, stamp: useStamp, restored };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Relocate a settlement's leaderless `garrisoned_army` out to a field tile as a
// CAPTAIN-led army. Verified vanilla-RR syntax: a captain is `character <Name>,
// general, age 20, , x N, y N` (type `general` = captain, single first name that
// must exist in names.txt) followed by `army` + regular `unit` lines (no general
// bodyguard). We remove the garrisoned_army block from the settlement and emit
// the captain army in the OWNER faction's section (the section the settlement
// sits in — NOT faction_creator). The captain name reuses an existing first name
// from that faction (guaranteed to be in names.txt).
ipcMain.handle("relocate-garrison", async (_event, faction, region, newX, newY) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!region) return { ok: false, error: "missing region" };
  if (typeof newX !== "number" || typeof newY !== "number") return { ok: false, error: "missing coords" };
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const wantFac = String(faction || "").toLowerCase();
    // Global scan: track the enclosing faction; find the settlement by region
    // that has a garrisoned_army.
    let curFac = null, curFacLine = -1;
    let ownerFacLine = -1, gaLine = -1, unitEnd = -1, ownerFac = null;
    const units = [];
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
      if (fm) { curFac = fm[1].toLowerCase(); curFacLine = i; continue; }
      if (/^\s*settlement\s*$/.test(lines[i])) {
        let reg = null, ga = -1, uend = -1; const us = []; let j = i + 1;
        for (; j < lines.length; j++) {
          if (/^\s*\}/.test(lines[j])) break;
          const rm = lines[j].match(/^\s*region\s+(.+?)\s*$/); if (rm) reg = rm[1].trim();
          if (/^\s*garrisoned_army\s*$/.test(lines[j])) {
            ga = j; let k = j + 1;
            while (k < lines.length && /^\s*unit\s+/.test(lines[k])) { us.push(lines[k].replace(/^\s+/, "")); k++; }
            uend = k;
          }
        }
        if (reg === region && ga >= 0 && (!wantFac || curFac === wantFac)) {
          ownerFac = curFac; ownerFacLine = curFacLine; gaLine = ga; unitEnd = uend; units.push(...us); break;
        }
        i = j;
      }
    }
    if (gaLine < 0) return { ok: false, error: `no garrisoned_army found in region "${region}"${faction ? ` (faction ${faction})` : ""}` };
    if (units.length === 0) return { ok: false, error: `garrisoned_army in "${region}" has no units` };
    // Captain name: reuse an existing first name from the owner faction's
    // characters (already present in names.txt, so guaranteed valid).
    let captain = null;
    for (let i = ownerFacLine + 1; i < lines.length; i++) {
      if (/^faction\s/.test(lines[i])) break;
      const cm = lines[i].match(/^character[\s,]+([A-Za-z][A-Za-z_]*)\b/);
      if (cm) { captain = cm[1]; break; }
    }
    if (!captain) captain = "Captain";
    // Remove the garrisoned_army header + its unit lines.
    lines.splice(gaLine, unitEnd - gaLine);
    // Insertion point in the owner faction's section: before its first character
    // (or first settlement, or section end). gaLine > ownerFacLine, so the
    // removal above doesn't shift ownerFacLine.
    let insAt = -1;
    for (let i = ownerFacLine + 1; i < lines.length; i++) {
      if (/^faction\s/.test(lines[i])) { insAt = i; break; }
      if (/^character[\s,]/.test(lines[i])) { insAt = i; break; }
      if (/^\s*settlement\s*$/.test(lines[i])) { insAt = i; break; }
    }
    if (insAt < 0) insAt = ownerFacLine + 1;
    const block = [`character\t${captain}, general, age 20, , x ${newX}, y ${newY}`, "army", ...units, ""];
    lines.splice(insAt, 0, ...block);
    fs.writeFileSync(modOut(dsPath), lines.join(usesCRLF ? "\r\n" : "\n"), "utf8");
    if (!getModExportDir()) { try { loadModCharacterData(getActiveModDataDir()); } catch (e) { console.warn("[garrison-relocate] post-write re-parse failed:", e && e.message); } }
    console.log(`[garrison-relocate] ${ownerFac} ${region}: ${units.length} units → captain "${captain}" at (${newX},${newY}) in ${path.basename(dsPath)}`);
    return { ok: true, captain, units: units.length, faction: ownerFac };
  } catch (e) {
    console.warn(`[garrison-relocate] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Rename an existing starting character's FIRST name (the family/surname is
// kept). The name appears in descr_strat as a token on the `character` line AND
// in any `relative` line that references the character, so we replace the full
// "<First> <Family>" string everywhere within the character's faction section.
// The new first name must resolve in names.txt — if its token is missing we mint
// `{NewFirst}NewFirst` (sorted insert) + add it to descr_names_lookup, mirroring
// the Add-General writer. Refuses a rename that would duplicate an existing
// "<New> <Family>" in the faction (the engine dislikes identical full names).
ipcMain.handle("rename-character", async (_event, faction, oldFirst, newFirstRaw) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!oldFirst || !newFirstRaw) return { ok: false, error: "missing name" };
  const newFirst = String(newFirstRaw).trim().replace(/[^A-Za-z0-9_'-]/g, "");
  if (!newFirst) return { ok: false, error: "invalid new name" };
  const dsPath = findActiveDescrStratPath();
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const wantFac = String(faction || "").toLowerCase();
    // Locate the character's faction section.
    let secStart = -1, secEnd = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
      if (fm) { if (fm[1].toLowerCase() === wantFac) secStart = i; else if (secStart >= 0) { secEnd = i; break; } }
    }
    if (secStart < 0) return { ok: false, error: `faction "${faction}" not found` };
    // Find the character line + parse its family (surname) token.
    let charIdx = -1, family = null;
    for (let i = secStart; i < secEnd; i++) {
      const cm = lines[i].match(/^character[\s,]+([^,]+),/);
      if (cm) { const parts = cm[1].trim().split(/\s+/); if (parts[0] === oldFirst) { charIdx = i; family = parts.slice(1).join(" ") || null; break; } }
    }
    if (charIdx < 0) return { ok: false, error: `character "${oldFirst}" not found in ${faction}` };
    const oldFull = family ? `${oldFirst} ${family}` : oldFirst;
    const newFull = family ? `${newFirst} ${family}` : newFirst;
    if (oldFull === newFull) return { ok: false, error: "name unchanged" };
    // Reject duplicates: a different character/relative already named newFull.
    for (let i = secStart; i < secEnd; i++) {
      if (i === charIdx) continue;
      const t = lines[i].trim();
      if (/^(character|character_record|relative)\b/.test(t) && t.includes(newFull)) {
        return { ok: false, error: `"${newFull}" already exists in ${faction} — pick a different name` };
      }
    }
    // Replace the full name string everywhere in the section.
    let count = 0;
    for (let i = secStart; i < secEnd; i++) {
      if (lines[i].includes(oldFull)) { lines[i] = lines[i].split(oldFull).join(newFull); count++; }
    }
    // Ensure the new first name is a known names.txt token; mint if missing.
    let minted = false;
    const namesPath = path.join(getActiveModDataDir(), "text", "names.txt");
    const lookupPath = path.join(getActiveModDataDir(), "descr_names_lookup.txt");
    try {
      if (fs.existsSync(namesPath)) {
        const names = descrGen.parseNamesTxt(fs.readFileSync(namesPath, "utf16le"));
        if (!names.tokenToDisplay.has(newFirst)) {
          const nt = fs.readFileSync(namesPath, "utf16le");
          const ntEol = "\r\n"; // RTW:R names.txt (UTF-16LE) is CRLF
          const ntLines = nt.split(/\r?\n/);
          const tokenOf = (l) => { const m = l.match(/^﻿?\{([^}]*)\}/); return m ? m[1].toLowerCase() : null; };
          const tokLc = newFirst.toLowerCase();
          const entry = `{${newFirst}}${newFirst}`;
          let idx = ntLines.findIndex((l) => { const k = tokenOf(l); return k != null && k > tokLc; });
          if (idx < 0) { while (ntLines.length && ntLines[ntLines.length - 1].trim() === "") ntLines.pop(); ntLines.push(entry); }
          else ntLines.splice(idx, 0, entry);
          fs.writeFileSync(modOut(namesPath), ntLines.join(ntEol), "utf16le");
          minted = true;
          if (fs.existsSync(lookupPath)) {
            const lk = fs.readFileSync(lookupPath, "utf8");
            const lkEol = "\r\n"; // RTW:R always CRLF
            const lkLines = lk.split(/\r?\n/);
            if (!lkLines.some((l) => l.trim().toLowerCase() === tokLc)) {
              let li = lkLines.findIndex((l) => l.trim() && l.trim().toLowerCase() > tokLc);
              if (li < 0) { while (lkLines.length && lkLines[lkLines.length - 1].trim() === "") lkLines.pop(); lkLines.push(newFirst); }
              else lkLines.splice(li, 0, newFirst);
              fs.writeFileSync(modOut(lookupPath), lkLines.join(lkEol), "utf8");
            }
          }
        }
      }
    } catch (ne) { console.warn("[char-rename] names.txt update failed:", ne && ne.message); }
    fs.writeFileSync(modOut(dsPath), lines.join(eol), "utf8");
    if (!getModExportDir()) { try { loadModCharacterData(getActiveModDataDir()); } catch (e) { console.warn("[char-rename] re-parse failed:", e && e.message); } }
    console.log(`[char-rename] ${faction}: "${oldFull}" → "${newFull}" (${count} line(s)${minted ? ", minted name token" : ""})`);
    return { ok: true, count, minted, newFull };
  } catch (e) {
    console.warn(`[char-rename] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// Replace the unit list of a starting army block in descr_strat. The army is
// located either by a character's coords (x,y — a general/captain `army` block)
// or by a settlement region (a `garrisoned_army` block). `units` is the FULL new
// list [{name, exp, armour, weapon}] — the caller keeps the bodyguard as unit 0
// for named generals. Unit-line indentation is copied from the block so the file
// style is preserved. Staged + applied on Save.
ipcMain.handle("update-army-units", async (_event, faction, locator, units) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!Array.isArray(units)) return { ok: false, error: "units must be an array" };
  const dsPath = findActiveDescrStratPath();
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const byRegion = locator && locator.region != null;
    const byCoord = locator && typeof locator.x === "number" && typeof locator.y === "number";
    const byCharacter = locator && typeof locator.character === "string" && locator.character.length > 0;
    if (!byRegion && !byCoord && !byCharacter) return { ok: false, error: "locator needs region, x/y, or character" };
    const wantFac = String(faction || "").toLowerCase();
    let unitStart = -1, unitEnd = -1, indent = "\t";
    // 0.9.652: diagnostic logs for the "garrison block not found" class.
    // Surface faction, locator, units count, dsPath; then for each lookup
    // path (character/coord/region) log whether it matched and at what
    // line. Logs land in %AppData%\Roaming\Provincia\provincia.log.
    console.log(`[army-units] IPC start: faction="${faction}" locator=${JSON.stringify(locator)} units=${units.length} dsPath="${dsPath}"`);
    console.log(`[army-units] flags: byRegion=${byRegion} byCoord=${byCoord} byCharacter=${byCharacter} wantFac="${wantFac}"`);
    // 0.9.651: when locator.character is set (a named bodyguard commander
    // — e.g. Appius), find the character record in the faction's block,
    // then its `army { }` unit lines. Runs BEFORE the region-mode lookup
    // so a "garrison" whose units actually live inside a character army
    // (very common — provincial capitals + every named general) resolves
    // correctly. The region-mode `garrisoned_army` lookup below is the
    // fallback for the leaderless garrison case.
    if (byCharacter) {
      let curFac = null;
      const wantChar = String(locator.character).trim();
      const wantHasSpace = /\s/.test(wantChar);  // full name vs first-name-only
      // 0.9.661: descr_strat uses underscores inside compound family names
      // (e.g. `Fulvius_Flaccus`), while the renderer hands us the display
      // form `"Fulvius Flaccus"`. Compare with underscores-as-spaces both
      // sides so the exact-match disambiguator actually matches.
      const norm = (s) => String(s).toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
      const wantNorm = norm(wantChar);
      let charHeadersInWantFac = 0;
      let charFirstNamesSampled = [];
      // 0.9.659: collect all matches in pass 1 so we can detect ambiguity
      // (RIS has 2 Servius / 3 Manius / etc. in romans_julii alone — a
      // first-name-only match used to silently pick the WRONG character's
      // army, writing the edit to a no-op and returning ok:true). When the
      // locator carries a full "First Last" name we can disambiguate via
      // exact full-name match.
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
        if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (wantFac && curFac !== wantFac) continue;
        // descr_strat character header:
        //   regular:     `character\tFirstName Family, named character, ...`
        //   sub_faction: `character\tsub_faction athens,\tEumedes, named character, ...`
        // The sub_faction prefix is optional; the name we want is the first
        // non-`sub_faction` comma-separated field before `named character`.
        const cm = lines[i].match(/^character\s*,?\s*(?:sub_faction\s+\S+\s*,\s*)?([^,]+?)\s*,\s*named character/i);
        if (!cm) continue;
        charHeadersInWantFac++;
        const fullName = cm[1].trim();
        const firstName = fullName.split(/\s+/)[0];
        if (charFirstNamesSampled.length < 12) charFirstNamesSampled.push(firstName);
        const hit = wantHasSpace
          ? norm(fullName) === wantNorm
          : firstName === wantChar;
        if (hit) matches.push({ line: i, fullName, firstName });
      }
      if (matches.length > 1) {
        console.warn(`[army-units] byCharacter AMBIGUOUS: ${matches.length} matches for "${wantChar}" in faction "${wantFac}" — ${matches.map((m) => m.fullName).join(", ")}. Falling through to byCoord / ;Region path so the right army is found.`);
      } else if (matches.length === 1) {
        const i = matches[0].line;
        console.log(`[army-units] character match: line=${i + 1} fullName="${matches[0].fullName}" wantChar="${wantChar}" wantFac="${wantFac}"`);
        // Walk forward to this character's `army` block.
        for (let j = i + 1; j < lines.length && j < i + 40; j++) {
          if (/^character[\s,]/.test(lines[j])) { console.log(`[army-units] hit next character at line ${j + 1}, stopping forward walk`); break; }
          if (/^faction\s+/.test(lines[j])) { console.log(`[army-units] hit next faction at line ${j + 1}, stopping forward walk`); break; }
          if (/^\s*army\b/.test(lines[j])) {
            console.log(`[army-units] found army block at line ${j + 1}`);
            let k = j + 1;
            while (k < lines.length && /^\s*unit\s+/.test(lines[k])) {
              if (unitStart < 0) { unitStart = k; indent = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; }
              k++;
            }
            unitEnd = k;
            console.log(`[army-units] unit lines: ${unitStart + 1}..${unitEnd} (${unitEnd - unitStart} unit lines)`);
            break;
          }
        }
      }
      if (unitStart < 0 && matches.length === 0) {
        console.warn(`[army-units] byCharacter MISS with faction filter: wantChar="${wantChar}" wantFac="${wantFac}" — found ${charHeadersInWantFac} character headers in that faction. First names sampled: ${JSON.stringify(charFirstNamesSampled)}`);
        // 0.9.653: faction filter sometimes points at the wrong block (e.g.
        // the renderer passes the descr_regions REBEL faction `italics` when
        // a settlement is actually Roman). Retry the same character lookup
        // with NO faction constraint. 0.9.659: collect all matches first so
        // we can fall through on ambiguity instead of writing to the first
        // one we hit.
        let curFac2 = null;
        const matchesAny = [];
        for (let i = 0; i < lines.length; i++) {
          const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
          if (fm) { curFac2 = fm[1].toLowerCase(); continue; }
          const cm = lines[i].match(/^character\s*,?\s*(?:sub_faction\s+\S+\s*,\s*)?([^,]+?)\s*,\s*named character/i);
          if (!cm) continue;
          const fullName = cm[1].trim();
          const firstName = fullName.split(/\s+/)[0];
          const hit = wantHasSpace
            ? norm(fullName) === wantNorm
            : firstName === wantChar;
          if (hit) matchesAny.push({ line: i, fullName, faction: curFac2 });
        }
        if (matchesAny.length > 1) {
          console.warn(`[army-units] no-faction retry AMBIGUOUS: ${matchesAny.length} matches for "${wantChar}" — ${matchesAny.map((m) => `${m.fullName}(${m.faction})`).join(", ")}. Falling through.`);
        } else if (matchesAny.length === 1) {
          const i = matchesAny[0].line;
          console.log(`[army-units] character match (no-faction retry): line=${i + 1} actualFaction="${matchesAny[0].faction}" fullName="${matchesAny[0].fullName}"`);
          for (let j = i + 1; j < lines.length && j < i + 40; j++) {
            if (/^character[\s,]/.test(lines[j])) break;
            if (/^faction\s+/.test(lines[j])) break;
            if (/^\s*army\b/.test(lines[j])) {
              let k = j + 1;
              while (k < lines.length && /^\s*unit\s+/.test(lines[k])) {
                if (unitStart < 0) { unitStart = k; indent = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; }
                k++;
              }
              unitEnd = k;
              console.log(`[army-units] unit lines (no-faction retry): ${unitStart + 1}..${unitEnd} (${unitEnd - unitStart} unit lines)`);
              break;
            }
          }
        }
      }
    }
    if (unitStart < 0 && byCoord) {
      // Find the character at (x,y) [+ faction], then its `army` block's units.
      let curFac = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i); if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (/^character[\s,]/.test(lines[i])) {
          const cm = lines[i].match(/\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
          if (cm && Number(cm[1]) === Number(locator.x) && Number(cm[2]) === Number(locator.y) && (!wantFac || curFac === wantFac)) {
            // Scan to `army`, then unit lines.
            for (let j = i + 1; j < lines.length && j < i + 12; j++) {
              if (/^\s*army\b/.test(lines[j])) {
                let k = j + 1; while (k < lines.length && /^\s*unit\s+/.test(lines[k])) { if (unitStart < 0) { unitStart = k; indent = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; } k++; }
                unitEnd = k; break;
              }
              if (/^character[\s,]/.test(lines[j])) break;
            }
            break;
          }
        }
      }
    }
    if (unitStart < 0 && byRegion) {
      // garrisoned_army for region — fallback when character / x,y lookups didn't hit.
      let curFac = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i); if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (/^\s*settlement\s*$/.test(lines[i])) {
          let reg = null, ga = -1, uend = -1, us = -1, ind = "\t"; let j = i + 1;
          for (; j < lines.length; j++) {
            if (/^\s*\}/.test(lines[j])) break;
            const rm = lines[j].match(/^\s*region\s+(.+?)\s*$/); if (rm) reg = rm[1].trim();
            if (/^\s*garrisoned_army\s*$/.test(lines[j])) { ga = j; let k = j + 1; while (k < lines.length && /^\s*unit\s+/.test(lines[k])) { if (us < 0) { us = k; ind = (lines[k].match(/^(\s*)/) || ["", "\t"])[1]; } k++; } uend = k; }
          }
          if (reg === locator.region && ga >= 0 && (!wantFac || curFac === wantFac)) {
            // If the garrison had units, replace them; else insert right after the header.
            unitStart = us >= 0 ? us : ga + 1; unitEnd = us >= 0 ? uend : ga + 1; indent = ind;
            break;
          }
          i = j;
        }
      }
    }
    if (unitStart < 0 && byRegion) {
      // 0.9.658: ;Region-comment fallback. Most provincial capitals (Reate,
      // Pisae, Maleventum, …) have NO `garrisoned_army` block. Their garrison
      // lives inside a character army marked by a `;<region>` comment line
      // immediately above the `character,` header. RegionInfo also tries to
      // pass `locator.character` for this case, but if the live-save commander
      // resolution missed (no garrisonCommander on the save side, no
      // commanderName on the unit cards), only `locator.region` makes it
      // through and the previous byRegion path bailed silently. Now we read
      // the comment hint, walk to the next character, and edit their army
      // block.
      const wantedReg = String(locator.region).trim();
      const escaped = wantedReg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const commentRe = new RegExp(`^;\\s*${escaped}\\s*$`, "i");
      let curFac = null;
      for (let i = 0; i < lines.length; i++) {
        const fm = lines[i].match(/^faction\s+([a-z_0-9]+)/i);
        if (fm) { curFac = fm[1].toLowerCase(); continue; }
        if (wantFac && curFac !== wantFac) continue;
        if (!commentRe.test(lines[i])) continue;
        // Walk to the next character line within a few rows.
        for (let j = i + 1; j < lines.length && j < i + 6; j++) {
          if (/^character[\s,]/.test(lines[j])) {
            for (let k = j + 1; k < lines.length && k < j + 40; k++) {
              if (/^character[\s,]/.test(lines[k])) break;
              if (/^faction\s+/.test(lines[k])) break;
              if (/^\s*army\b/.test(lines[k])) {
                let m = k + 1;
                while (m < lines.length && /^\s*unit\s+/.test(lines[m])) {
                  if (unitStart < 0) { unitStart = m; indent = (lines[m].match(/^(\s*)/) || ["", "\t"])[1]; }
                  m++;
                }
                unitEnd = m;
                console.log(`[army-units] ;Region fallback: matched ";${wantedReg}" at line ${i + 1}, character at line ${j + 1}, army at line ${k + 1}, units ${unitStart + 1}..${unitEnd} (${unitEnd - unitStart} lines)`);
                break;
              }
            }
            break;
          }
        }
        if (unitStart >= 0) break;
      }
    }
    if (unitStart < 0 && !byRegion) return { ok: false, error: "army block not found" };
    if (unitStart < 0) return { ok: false, error: "garrison block not found" };
    // 0.9.651: accept either shape — pendingArmyUnits from the Recruitable-
    // click path stores {unit, exp, armour, weapon_lvl}; the original
    // ArmyUnitsEditor path stores {name, exp, armour, weapon}. Normalize
    // before formatting so both write valid descr_strat lines.
    const unitName = (u) => u && (u.name || u.unit);
    const unitExp = (u) => (u && (u.exp ?? u.xp)) || 0;
    const unitArm = (u) => (u && u.armour) || 0;
    const unitWep = (u) => (u && (u.weapon ?? u.weapon_lvl)) || 0;
    const fmtUnit = (u) => `${indent}unit\t\t${unitName(u)}\t\t\texp ${unitExp(u)} armour ${unitArm(u)} weapon_lvl ${unitWep(u)}`;
    const newLines = units.filter((u) => unitName(u)).map(fmtUnit);
    lines.splice(unitStart, unitEnd - unitStart, ...newLines);
    fs.writeFileSync(modOut(dsPath), lines.join(eol), "utf8");
    if (!getModExportDir()) { try { loadModCharacterData(getActiveModDataDir()); } catch (e) { console.warn("[army-units] re-parse failed:", e && e.message); } }
    console.log(`[army-units] ${faction} ${byCoord ? `@(${locator.x},${locator.y})` : locator.region}: wrote ${newLines.length} unit(s)`);
    return { ok: true, units: newLines.length };
  } catch (e) {
    console.warn(`[army-units] failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.550: Add-General feature — read descr_strat + name lists, return per-
// faction culture name pools + families + settlement coord index for the UI.
function findActiveDescrStratPath() {
  if (!getActiveModDataDir()) return null;
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
ipcMain.handle("addgen-get-data", async () => {
  try {
    if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const namesPath = path.join(getActiveModDataDir(), "text", "names.txt");
    const names = descrGen.parseNamesTxt(fs.readFileSync(namesPath, "utf16le"));
    const parsed = descrGen.parseDescrStrat(fs.readFileSync(dsPath, "utf8"));
    // LIVE culture namelists → so the name dropdowns offer every name registered
    // in descr_namelists.txt for the faction's culture (e.g. greek_men), not just
    // names already used by existing characters. Read fresh each call; best-effort.
    let facNamelists = {}, nlPools = {};
    try {
      const smP = path.join(getActiveModDataDir(), "descr_sm_factions.txt");
      if (fs.existsSync(smP)) facNamelists = descrGen.parseSmFactionNamelists(fs.readFileSync(smP, "utf8"));
      const nlP = path.join(getActiveModDataDir(), "descr_namelists.txt");
      if (fs.existsSync(nlP)) nlPools = descrGen.parseNamelistPools(fs.readFileSync(nlP, "utf8"));
      console.log(`[addgen] namelists: ${Object.keys(facNamelists).length} faction maps, ${Object.keys(nlPools).length} pools`);
    } catch (ne) { console.warn("[addgen] namelist load failed (dropdown = existing names only):", ne && ne.message); }
    const settIdx = descrGen.buildSettlementCoordIndex(parsed);
    const settlements = {};
    for (const [name, v] of settIdx) settlements[name] = { faction: v.faction, x: v.x, y: v.y, hint: v.hint };
    // OWNED settlements per faction (every settlement, by city name + coords) —
    // resolve coords via the map's black settlement pixels + region colours.
    let owned = {};
    try {
      const regPath = path.join(getActiveModDataDir(), "world", "maps", "base", "descr_regions.txt");
      const tgaPath = path.join(getActiveModDataDir(), "world", "maps", "base", "map_regions.tga");
      const { regionToCity, rgbToRegion } = descrGen.parseDescrRegions(fs.readFileSync(regPath, "utf8"));
      const regionCoords = descrGen.buildRegionCoords(fs.readFileSync(tgaPath), rgbToRegion);
      owned = descrGen.factionOwnedSettlements(parsed, regionToCity, regionCoords, settIdx);
      const totalOwned = Object.values(owned).reduce((s, l) => s + l.length, 0);
      const withCoords = Object.values(owned).reduce((s, l) => s + l.filter((x) => x.x != null).length, 0);
      console.log(`[addgen] owned settlements: ${totalOwned} across ${Object.keys(owned).length} factions, ${withCoords} with coords (${Object.keys(regionCoords).length} regions mapped from TGA)`);
    } catch (re) { console.warn("[addgen] owned-settlement resolve failed (falling back to governor index):", re && re.message); }
    const factions = {};
    for (const fac of parsed.factions) {
      const nl = facNamelists[fac.name] || {};
      const extra = { men: nlPools[nl.men] || [], women: nlPools[nl.women] || [] };
      const pools = descrGen.buildPools(fac, names, extra);
      factions[fac.name] = {
        name: fac.name, generalUnit: fac.generalUnit, generalUnits: fac.generalUnits,
        maleFirst: pools.maleFirst, femaleFirst: pools.femaleFirst, families: pools.families,
        usesSurnames: pools.usesSurnames,
        ownedSettlements: owned[fac.name] || [],
        duplicates: descrGen.findDuplicateNames(fac),
      };
    }
    console.log(`[addgen] data: ${Object.keys(factions).length} factions, ${Object.keys(settlements).length} governor-spots, file=${path.basename(dsPath)}`);
    return { ok: true, factions, settlements, file: path.basename(dsPath) };
  } catch (e) { console.warn("[addgen] get-data failed:", e && e.message); return { ok: false, error: e.message }; }
});
ipcMain.handle("addgen-apply", async (_event, selection) => {
  try {
    if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const namesPath = path.join(getActiveModDataDir(), "text", "names.txt");
    const lookupPath = path.join(getActiveModDataDir(), "descr_names_lookup.txt");
    const dsRaw = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const names = descrGen.parseNamesTxt(fs.readFileSync(namesPath, "utf16le"));
    const parsed = descrGen.parseDescrStrat(dsRaw);
    // Faction's descr_namelists pools (men/women) so composeAddGeneral can name
    // the general + family from VALID unused namelist entries instead of minting
    // suffixed tokens the game rejects ("Unknown name 'ApollodorosA'!").
    let pools = {};
    try {
      const smP = path.join(getActiveModDataDir(), "descr_sm_factions.txt");
      const nlP = path.join(getActiveModDataDir(), "descr_namelists.txt");
      if (fs.existsSync(smP) && fs.existsSync(nlP)) {
        const facNl = descrGen.parseSmFactionNamelists(fs.readFileSync(smP, "utf8"))[selection.factionName] || {};
        const nlPools = descrGen.parseNamelistPools(fs.readFileSync(nlP, "utf8"));
        pools = { men: nlPools[facNl.men] || [], women: nlPools[facNl.women] || [] };
        console.log(`[addgen] name pools for ${selection.factionName}: ${pools.men.length} men (${facNl.men}), ${pools.women.length} women (${facNl.women})`);
      }
    } catch (pe) { console.warn("[addgen] pool load failed (will fall back to minting):", pe && pe.message); }
    const res = descrGen.composeAddGeneral(parsed, names, selection, pools);
    // In export mode we don't back up the live files (we're not changing
    // them); the timestamped .bak is skipped and backupStamp returns null.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (!getModExportDir()) fs.copyFileSync(dsPath, dsPath + "." + stamp + ".bak");
    fs.writeFileSync(modOut(dsPath), res.lines.join(eol), "utf8");
    if (res.namesAppend.length) {
      if (!getModExportDir()) fs.copyFileSync(namesPath, namesPath + "." + stamp + ".bak");
      const nt = fs.readFileSync(namesPath, "utf16le");
      const ntEol = "\r\n"; // RTW:R always CRLF
      const ntLines = nt.split(/\r?\n/);
      // names.txt is sorted by token and the {ZZZZZ} entry is an end-marker —
      // appending AFTER it means the engine never reads the new names. Insert
      // each mint in its sorted-by-token position (which lands it before ZZZZZ).
      const tokenOf = (line) => { const m = line.match(/^﻿?\{([^}]*)\}/); return m ? m[1].toLowerCase() : null; };
      for (const n of res.namesAppend) {
        const entry = `{${n.token}}${n.display}`;
        const tokLc = n.token.toLowerCase();
        let idx = ntLines.findIndex((l) => { const k = tokenOf(l); return k != null && k > tokLc; });
        if (idx < 0) { while (ntLines.length && ntLines[ntLines.length - 1].trim() === "") ntLines.pop(); ntLines.push(entry); }
        else ntLines.splice(idx, 0, entry);
      }
      fs.writeFileSync(modOut(namesPath), ntLines.join(ntEol), "utf16le");
    }
    if (res.lookupAppend.length) {
      if (!getModExportDir()) fs.copyFileSync(lookupPath, lookupPath + "." + stamp + ".bak");
      const lk = fs.readFileSync(lookupPath, "utf8");
      const lkEol = "\r\n"; // RTW:R always CRLF
      const lkLines = lk.split(/\r?\n/);
      // descr_names_lookup.txt is alphabetically sorted (and ends with ZZZZZ).
      // Insert each token in sorted position so the engine's lookup finds it.
      for (const tok of res.lookupAppend) {
        const tokLc = tok.toLowerCase();
        let idx = lkLines.findIndex((l) => l.trim() && l.trim().toLowerCase() > tokLc);
        if (idx < 0) { while (lkLines.length && lkLines[lkLines.length - 1].trim() === "") lkLines.pop(); lkLines.push(tok); }
        else lkLines.splice(idx, 0, tok);
      }
      fs.writeFileSync(modOut(lookupPath), lkLines.join(lkEol), "utf8");
    }
    // 0.9.869: register minted names in the faction's CULTURE NAMELIST
    // (descr_namelists.txt). RTW validates every descr_strat character name
    // against the faction's men/women namelist — a minted token (e.g.
    // "PhilocharisA") that lives only in names.txt + descr_names_lookup.txt but
    // NOT here makes the campaign fail to start. Group minted tokens by gender.
    if (res.namesAppend.length) {
      try {
        const smP = path.join(getActiveModDataDir(), "descr_sm_factions.txt");
        const nlP = path.join(getActiveModDataDir(), "descr_namelists.txt");
        if (fs.existsSync(smP) && fs.existsSync(nlP)) {
          const facNl = (descrGen.parseSmFactionNamelists(fs.readFileSync(smP, "utf8"))[selection.factionName]) || {};
          const menToks = res.namesAppend.filter((n) => n.gender === "male").map((n) => n.token);
          const womenToks = res.namesAppend.filter((n) => n.gender === "female").map((n) => n.token);
          let nlRaw = fs.readFileSync(nlP, "utf8");
          const nlEol = nlRaw.includes("\r\n") ? "\r\n" : "\n";
          let changed = false;
          if (facNl.men && menToks.length) {
            const upd = descrGen.insertNamelistTokens(nlRaw, facNl.men, menToks, nlEol);
            if (upd) { nlRaw = upd; changed = true; }
          }
          if (facNl.women && womenToks.length) {
            const upd = descrGen.insertNamelistTokens(nlRaw, facNl.women, womenToks, nlEol);
            if (upd) { nlRaw = upd; changed = true; }
          }
          if (changed) {
            if (!getModExportDir()) fs.copyFileSync(nlP, nlP + "." + stamp + ".bak");
            fs.writeFileSync(modOut(nlP), gameTextCRLF(nlP, nlRaw), "utf8");
            console.log(`[addgen] registered minted names in descr_namelists.txt — ${menToks.length} male (${facNl.men}), ${womenToks.length} female (${facNl.women})`);
          } else {
            console.warn(`[addgen] descr_namelists NOT updated for ${selection.factionName} (men=${facNl.men} women=${facNl.women}); minted names: ${res.namesAppend.map((n) => n.token + ":" + n.gender).join(", ")} — campaign may reject them`);
          }
        } else {
          console.warn("[addgen] descr_sm_factions.txt / descr_namelists.txt missing — cannot register minted names in the namelist (RTW may reject the new character)");
        }
      } catch (nlErr) { console.warn("[addgen] namelist registration failed:", nlErr && nlErr.message); }
    }
    // Re-parse the mod's descr_strat so the new general shows in the Characters
    // view + Family Tree immediately (these read cached parses). Skip in export
    // mode: the live mod is unchanged, so re-parsing it would discard the edit
    // from the in-memory view.
    if (!getModExportDir()) {
      try { loadModCharacterData(getActiveModDataDir()); console.log("[addgen] re-parsed mod character data after write"); }
      catch (e) { console.warn("[addgen] post-write re-parse failed:", e && e.message); }
    }
    console.log(`[addgen] added ${res.summary.general} to ${res.summary.faction} @${selection.x},${selection.y}; minted=[${res.summary.minted.join(",")}]; ${getModExportDir() ? `exported under ${getModExportDir()}` : `backup ${stamp}`}`);
    return { ok: true, summary: res.summary, backupStamp: getModExportDir() ? null : stamp };
  } catch (e) { console.warn("[addgen] apply failed:", e && e.message); return { ok: false, error: e.message }; }
});

// Live starting-armies refresh: re-parse the active mod's descr_strat.txt (+
// map_regions.tga / descr_regions.txt / factions) and return the same
// { region: { garrison, field, settlement } } object the build-time bundle
// writes. Lets the non-live Garrison / Field-armies panel reflect mid-session
// edits (Add General, army-unit Save to Mod) instead of stale bundled data.
// modDataDir defaults to the active mod; campaignDir is the folder under
// world/maps/campaign (imperial_campaign / ris_classic). Returns { error } on
// failure — caller keeps the prior state (no fabricated data).
ipcMain.handle("get-live-starting-armies", async (_event, modDataDir, campaignDir) => {
  try {
    const dir = modDataDir || getActiveModDataDir();
    if (!dir) return { error: "no active mod" };
    const byRegion = await buildStartingArmiesFromMod(dir, campaignDir);
    if (!byRegion) {
      try { _writeLog(`[starting-armies] live refresh: no data (dir=${dir} campaign=${campaignDir || "auto"})`); } catch {}
      return { error: "starting armies not found" };
    }
    try { _writeLog(`[starting-armies] live refresh: ${Object.keys(byRegion).length} regions (campaign=${campaignDir || "auto"})`); } catch {}
    return byRegion;
  } catch (e) {
    try { _writeLog(`[starting-armies] live refresh failed: ${e && e.message}`); } catch {}
    return { error: e && e.message ? e.message : String(e) };
  }
});

// 0.9.437: descr_strat ancillary editor — rewrite the `ancillaries Foo,
// Bar` line on a character block. Mirrors update-character-traits exactly.
// Persistent; affects next non-live load. Does NOT touch live save data.
ipcMain.handle("update-character-ancillaries", async (_event, firstName, faction, ancillaries) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!firstName) return { ok: false, error: "missing firstName" };
  if (!Array.isArray(ancillaries)) return { ok: false, error: "ancillaries must be an array" };
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    const targetFaction = String(faction || "").toLowerCase();
    let curFaction = null;
    let charLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(/^faction\s+(\S+?),/);
      if (fm) { curFaction = fm[1].toLowerCase(); continue; }
      const cm = lines[i].match(/^character[\s,]+([^,]+?),/);
      if (cm) {
        const parts = cm[1].trim().split(/\s+/);
        const fn = parts[0];
        if (fn === firstName && (!targetFaction || curFaction === targetFaction)) {
          charLineIdx = i;
          break;
        }
      }
    }
    if (charLineIdx < 0) return { ok: false, error: `character "${firstName}" (faction "${faction}") not found` };
    // The `ancillaries …` line sits within ~8 lines below the character
    // header (alongside `traits …` and before `army`).
    let ancLineIdx = -1;
    for (let j = charLineIdx + 1; j < Math.min(charLineIdx + 8, lines.length); j++) {
      if (/^\s*ancillaries\b/.test(lines[j])) { ancLineIdx = j; break; }
      if (/^character[\s,]/.test(lines[j]) || /^army\b/.test(lines[j])) break;
    }
    const cleaned = ancillaries.map(a => typeof a === "string" ? a : a?.name).filter(Boolean);
    const newLine = cleaned.length > 0 ? `ancillaries ${cleaned.join(", ")}` : null;
    if (ancLineIdx >= 0) {
      if (newLine == null) {
        lines.splice(ancLineIdx, 1);
      } else {
        const indent = lines[ancLineIdx].match(/^(\s*)/)[1] || "";
        lines[ancLineIdx] = indent + newLine;
      }
    } else if (newLine != null) {
      // Insert just after a `traits` line if present (engine convention),
      // else right after the character header.
      let insertAt = charLineIdx + 1;
      for (let j = charLineIdx + 1; j < Math.min(charLineIdx + 8, lines.length); j++) {
        if (/^\s*traits\b/.test(lines[j])) { insertAt = j + 1; break; }
        if (/^character[\s,]/.test(lines[j]) || /^army\b/.test(lines[j])) break;
      }
      lines.splice(insertAt, 0, "\t" + newLine);
    }
    const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
    const out = lines.join(usesCRLF ? "\r\n" : "\n");
    fs.writeFileSync(modOut(dsPath), out, "utf8");
    const reportLine = ancLineIdx >= 0 ? ancLineIdx + 1 : charLineIdx + 2;
    console.log(`[ancillary-edit] wrote ${cleaned.length} ancillaries for ${firstName} (faction ${faction || "?"}) to ${path.basename(dsPath)}:${reportLine}`);
    return { ok: true, file: dsPath, line: reportLine };
  } catch (e) {
    console.warn(`[ancillary-edit] failed for ${firstName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.437: descr_strat region-buildings editor — replace the `building {
// type X Y }` blocks inside the settlement that has `region <RegionName>`.
// Persistent; affects next non-live load. Does NOT touch live save data.
// Input shape: buildings = [{ type: "core_building", level: "village" }, ...]
ipcMain.handle("update-region-buildings", async (_event, regionName, buildings) => {
  if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
  if (!regionName) return { ok: false, error: "missing regionName" };
  if (!Array.isArray(buildings)) return { ok: false, error: "buildings must be an array" };
  const candidates = [
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(getActiveModDataDir(), "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const dsPath = candidates.find((p) => fs.existsSync(p));
  if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
  try {
    const text = fs.readFileSync(dsPath, "utf8");
    const lines = text.split(/\r?\n/);
    // Walk settlement blocks. Each settlement is:
    //   settlement
    //   {
    //     level X
    //     region <Name>
    //     ...
    //     building { type CHAIN LEVEL }
    //     building { type ... }
    //   }
    // Find the settlement whose `region` line equals the regionName, then
    // splice out every `building { … }` block within the settlement's
    // braces and write fresh ones at the original first-building position.
    // 0.9.444: brace-depth tracking. The previous parser treated the FIRST
    // `}` inside a settlement as the settlement-closing brace — but every
    // `building { … }` block inside a settlement has its own `}`, so the
    // settlement was being "ended" at the first building's close. Result:
    // the building-range scan saw zero closed blocks (only the orphaned
    // opens), removed nothing, and inserted N new blocks below the orphans.
    // After a few edits, descr_strat looked like the user's corrupted file
    // (107 added `+ building` lines, repeating cores, stray `}`s). We now
    // track brace depth properly: depth 0 = outside braces, depth 1 = inside
    // the settlement, depth ≥2 = inside a building block. A `}` only closes
    // the settlement when depth drops back to 0.
    let settlementLineIdx = -1;
    let braceStart = -1;
    let regionLineIdx = -1;
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^settlement\b/.test(line)) {
        settlementLineIdx = i;
        braceStart = -1;
        regionLineIdx = -1;
        depth = 0;
        continue;
      }
      if (settlementLineIdx < 0) continue;
      // Count braces on the line (handles single-line `{ ... }` too).
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      if (braceStart < 0 && opens > 0) {
        braceStart = i;
        depth += opens;
        depth -= closes;
        if (depth <= 0) {
          // Pathological: `{}` on a single line w/ no body. Skip.
          settlementLineIdx = -1;
          braceStart = -1;
        }
        continue;
      }
      if (braceStart < 0) continue;
      const rm = line.match(/^\s*region\s+(\S+)/);
      if (rm) regionLineIdx = i;
      depth += opens;
      depth -= closes;
      if (depth > 0) continue; // still inside settlement (incl. inside building blocks)
      // depth === 0 (or below): settlement just closed. Decide if this is the
      // target region.
      const matchesRegion = regionLineIdx >= 0 &&
        (lines[regionLineIdx].match(/^\s*region\s+(\S+)/)?.[1] || "").toLowerCase() === regionName.toLowerCase();
      if (matchesRegion) {
        const blockStart = braceStart;
        const blockEnd = i;
        // Find building block ranges. Use brace depth (relative to the
        // settlement = 1) so a building opens at depth 2 and closes back to
        // depth 1. Records [start, end] inclusive for the building block.
        const buildingRanges = [];
        let bDepth = 1; // we re-walk; settlement's `{` already counted
        let bStart = -1;
        for (let j = blockStart + 1; j < blockEnd; j++) {
          const ln = lines[j];
          const isBuildingHead = /^\s*building\b/.test(ln);
          const o = (ln.match(/\{/g) || []).length;
          const c = (ln.match(/\}/g) || []).length;
          if (isBuildingHead && bDepth === 1 && bStart < 0) bStart = j;
          bDepth += o;
          bDepth -= c;
          if (bStart >= 0 && bDepth === 1 && (c > 0 || o === 0)) {
            // Close occurred and we're back at settlement-level depth.
            if (c > 0) {
              buildingRanges.push([bStart, j]);
              bStart = -1;
            }
          }
        }
        let insertAt;
        let indent;
        if (buildingRanges.length > 0) {
          insertAt = buildingRanges[0][0];
          indent = lines[insertAt].match(/^(\s*)/)[1] || "\t";
        } else {
          insertAt = blockEnd;
          const braceIndent = lines[braceStart].match(/^(\s*)/)[1] || "";
          indent = braceIndent + "\t";
        }
        // Remove building blocks bottom-up so indices stay valid.
        for (let r = buildingRanges.length - 1; r >= 0; r--) {
          const [s, e] = buildingRanges[r];
          lines.splice(s, e - s + 1);
          if (s < insertAt) insertAt -= (e - s + 1);
        }
        const newLines = [];
        for (const b of buildings) {
          const chain = String(b.type || "").trim();
          const level = String(b.level || "").trim();
          if (!chain || !level) continue;
          newLines.push(`${indent}building`);
          newLines.push(`${indent}{`);
          newLines.push(`${indent}\ttype ${chain} ${level}`);
          newLines.push(`${indent}}`);
        }
        lines.splice(insertAt, 0, ...newLines);
        const usesCRLF = true; // RTW:R game text files are ALWAYS CRLF
        const out = lines.join(usesCRLF ? "\r\n" : "\n");
        fs.writeFileSync(modOut(dsPath), out, "utf8");
        console.log(`[building-edit] wrote ${buildings.length} buildings for region "${regionName}" to ${path.basename(dsPath)}:${insertAt + 1} (replaced ${buildingRanges.length} existing blocks)${getModExportDir() ? " (exported)" : ""}`);
        return { ok: true, file: dsPath, line: insertAt + 1 };
      }
      // Not our settlement — reset and keep scanning.
      settlementLineIdx = -1;
      braceStart = -1;
      regionLineIdx = -1;
      depth = 0;
    }
    return { ok: false, error: `region "${regionName}" not found in ${path.basename(dsPath)}` };
  } catch (e) {
    console.warn(`[building-edit] failed for region ${regionName}: ${e.message}`);
    return { ok: false, error: e.message };
  }
});

// 0.9.437: building catalogue IPC — return the mod's full chain → levels
// map (already parsed in loadModCharacterData via modBuildingChains +
// modChainMaxLevels) plus the level NAMES per chain (buildingLevelsLookup
// is renderer-side; main process needs to re-emit chain → levels here).
// Used by the dev-mode Add Building picker.
ipcMain.handle("get-building-catalogue", async () => {
  if (!getActiveModDataDir()) return { chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {} };
  const edbPath = path.join(getActiveModDataDir(), "export_descr_buildings.txt");
  if (!fs.existsSync(edbPath)) return { chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {} };
  try {
    const edbText = fs.readFileSync(edbPath, "utf8");
    const blocks = edbText.split(/^building\s+/m).slice(1);
    const chains = {};            // chainName → [levelName, ...]
    const categories = {};        // chainName → category (icon line)
    // 0.9.441: per-level settlement_min, keyed by `${chain}|${level}` →
    // settlement-tier name (e.g. "village", "town", "large_town", ...). The
    // dev-mode building editor uses this to gate the ⬆ button — you can only
    // upgrade past a level whose settlement_min is met by the settlement's
    // core_building level.
    const settlementMins = {};
    // 0.9.443: raw `requires` expression per level, keyed by `${chain}|${level}`.
    // The renderer side parses this into a structured filter (factions /
    // hidden_resource / resource etc.) so the dev-mode Add Building picker
    // only shows chains the engine would actually accept for the current
    // region. Concatenating multiple `and / or` continuation lines means
    // the renderer gets a single string with the full clause to parse.
    const levelRequires = {};
    // 0.9.600: capture each chain's `tag` (government / temple / civic / port /
    // heavy_ind / …). A settlement holds at most ONE building per tag — the
    // engine enforces it via the `no_other_<tag>` requirement on every tagged
    // building — so the Add-building picker uses this to hide a second building
    // of an already-occupied slot (you must replace, not stack).
    const tags = {};
    for (const b of blocks) {
      const name = b.match(/^(\w+)/)?.[1];
      if (!name) continue;
      const lvLine = b.match(/^\s+levels\s+(.+)/m);
      const chainLevels = lvLine ? lvLine[1].trim().split(/\s+/).filter(Boolean) : [];
      if (chainLevels.length) chains[name] = chainLevels;
      const iconLine = b.match(/^\s+icon\s+(\w+)/m);
      if (iconLine) categories[name] = iconLine[1].toLowerCase();
      const tagLine = b.match(/^\s+tag\s+(\w+)/m);
      if (tagLine) tags[name] = tagLine[1].toLowerCase();
      // Walk the block line-by-line to find each level's settlement_min.
      // EDB structure inside a `building <chain> { ... }` block:
      //   levels lvl1 lvl2 lvl3
      //   { ... }      <- begin levels container
      //   lvl1
      //   {
      //     settlement_min village
      //     ...
      //   }
      //   lvl2
      //   { ... }
      const lvlSet = new Set(chainLevels);
      const blockLines = b.split(/\r?\n/);
      let curLevel = null;
      let curLevelHeader = null;
      for (const ln of blockLines) {
        // Level header. RTW EDB declares each level as either a bare
        // identifier or `<name> requires <expr>` on the same line, e.g.
        //   farms+2
        //   farms+3 requires factions { romans_julii, } and resource grain
        //   level core_building
        // Accept both forms. Level names can include `+`, `-`, digits, etc.
        const lm = ln.match(/^\s*(?:level\s+)?([A-Za-z][A-Za-z0-9_+\-]*)\b/);
        if (lm && lvlSet.has(lm[1])) {
          curLevel = lm[1];
          curLevelHeader = ln;
          // 0.9.443: capture per-level `requires` expression so the picker
          // can hide chains the engine would refuse. We collect the header
          // line PLUS subsequent lines up until the next sibling level so
          // multi-line `requires` clauses are captured. Then parse out the
          // bits we care about (factions / hidden_resource / resource).
          if (!levelRequires[`${name}|${curLevel}`]) levelRequires[`${name}|${curLevel}`] = "";
          // Append everything after the level name (handles `farms requires …`)
          const tail = ln.slice(ln.indexOf(lm[1]) + lm[1].length);
          levelRequires[`${name}|${curLevel}`] += " " + tail;
          continue;
        }
        if (!curLevel) continue;
        const sm = ln.match(/^\s*settlement_min\s+(\S+)/);
        if (sm) {
          settlementMins[`${name}|${curLevel}`] = sm[1].toLowerCase();
          continue;
        }
        // Pick up multi-line `requires` clauses. They typically start with
        // `requires …` on the level header but can continue with `and …`
        // / `or …` lines or appear inside a `capability { … }` block (which
        // we DON'T want to swallow). Be conservative: only pick up top-level
        // lines that look like a requires-clause continuation.
        if (/^\s*requires\s+/.test(ln) || /^\s*and\s+/.test(ln) || /^\s*or\s+/.test(ln)) {
          levelRequires[`${name}|${curLevel}`] += " " + ln.trim();
        }
        // Heuristic block-end: an opening of another top-level directive
        // resets curLevel so we don't bleed settings between sibling levels.
        if (/^\s*levels\s+/.test(ln)) { curLevel = null; curLevelHeader = null; }
      }
    }
    // Ordered settlement tier list — derived from the core_building chain
    // since that IS the settlement-level ladder (village → town → ... →
    // huge_city). UI uses it to compare settlement_min "is >= " requirements.
    const settlementTiers = (chains.core_building || []).slice();
    console.log(`[get-building-catalogue] chains=${Object.keys(chains).length} settlement_min entries=${Object.keys(settlementMins).length} requires entries=${Object.keys(levelRequires).length} tiers=${settlementTiers.length} tags=${Object.keys(tags).length}`);
    return { chains, categories, settlementMins, settlementTiers, levelRequires, tags };
  } catch (e) {
    console.warn(`[get-building-catalogue] failed: ${e.message}`);
    return { chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {} };
  }
});

// 0.9.418: RTW Remastered ships no per-trait icon files (vanilla RTW had
// `data/ui/<culture>/vnvs/<level_name>.tga` but Remastered bakes trait
// icons into a compiled UI atlas instead — no on-disk path resolves).
// We keep the IPC handler in case a mod adds icons under that path, but
// it's expected to return `{ ok: false }` for stock RTW Remastered.
ipcMain.handle("get-descr-strat-families", async () => {
  if (!getModDescrStratFamilies() || !getModDescrStratFamilies().byFaction) {
    return { ok: false, byFaction: {} };
  }
  return { ok: true, byFaction: getModDescrStratFamilies().byFaction };
});

// Diplomacy editor: read all three descr_strat diplomacy values per pair
// (core_attitudes / faction_relationships / faction_agression) →
// byFaction[from][to] = { core, rel, agg } + the full faction list.
ipcMain.handle("get-core-attitudes", async () => {
  try {
    if (!getActiveModDataDir()) return { ok: false };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const text = fs.readFileSync(dsPath, "utf8");
    const dip = descrGen.parseDiplomacy(text);
    const parsed = descrGen.parseDescrStrat(text);
    const factions = new Set();
    for (const f of parsed.factions) factions.add(f.name.toLowerCase());
    for (const from in dip.byFaction) { factions.add(from); for (const to in dip.byFaction[from]) factions.add(to); }
    return { ok: true, byFaction: dip.byFaction, factions: [...factions].sort(), file: path.basename(dsPath) };
  } catch (e) { console.warn("[diplo-edit] get failed:", e && e.message); return { ok: false, error: e.message }; }
});

// Apply a batch of diplomacy edits (called on Save). edits = [{kind,from,to,value}]
// where kind ∈ core|rel|agg. Updates the matching line in place, or inserts a new
// one after that kind's section (skipping no-op core/rel inserts of 200). Backs up.
ipcMain.handle("update-core-attitudes", async (_event, edits) => {
  try {
    if (!getActiveModDataDir()) return { ok: false, error: "no active mod" };
    if (!Array.isArray(edits) || edits.length === 0) return { ok: true, applied: 0 };
    const dsPath = findActiveDescrStratPath();
    if (!dsPath) return { ok: false, error: "descr_strat.txt not found" };
    const text = fs.readFileSync(dsPath, "utf8");
    const eol = "\r\n"; // RTW:R game text files are ALWAYS CRLF
    const lines = text.split(/\r?\n/);
    const dip = descrGen.parseDiplomacy(text);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (!getModExportDir()) fs.copyFileSync(dsPath, dsPath + "." + stamp + ".bak");
    const insertsByKind = { core: [], rel: [], agg: [] };
    let applied = 0;
    for (const e of edits) {
      const kind = (e.kind === "rel" || e.kind === "agg") ? e.kind : "core";
      const from = String(e.from).toLowerCase(), to = String(e.to).toLowerCase(), val = parseInt(e.value, 10);
      if (!from || !to || Number.isNaN(val)) continue;
      const key = `${kind}|${from}|${to}`;
      const newLine = descrGen.diploLine(kind, from, to, val);
      if (dip.lineOf[key] != null) { lines[dip.lineOf[key]] = newLine; applied++; }
      else if (!((kind === "core" || kind === "rel") && val === 200)) { insertsByKind[kind].push({ at: dip.lastLine[kind] != null ? dip.lastLine[kind] : lines.length, line: newLine }); applied++; }
    }
    // Insert new lines high index → low so positions stay valid.
    const allInserts = [...insertsByKind.core, ...insertsByKind.rel, ...insertsByKind.agg].sort((a, b) => b.at - a.at);
    for (const ins of allInserts) lines.splice(ins.at + 1, 0, ins.line);
    fs.writeFileSync(modOut(dsPath), lines.join(eol), "utf8");
    console.log(`[diplo-edit] applied ${applied} diplomacy edit(s) to ${path.basename(dsPath)}; ${getModExportDir() ? `exported under ${getModExportDir()}` : `backup ${stamp}`}`);
    return { ok: true, applied, backupStamp: getModExportDir() ? null : stamp };
  } catch (e) { console.warn("[diplo-edit] update failed:", e && e.message); return { ok: false, error: e.message }; }
});

}

module.exports = { registerModEditingHandlers };
