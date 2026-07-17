// Victory-conditions region→owner CSV export (the vc-region-owners-csv IPC
// handler), extracted verbatim from main.js (2026-07-17). main.js's mutable
// activeModDataDir is injected as the getActiveModDataDir getter; dialog and
// BrowserWindow come in via deps. Logic unchanged.
"use strict";
const fs = require("fs");
const path = require("path");

function registerRegionOwnersCsvHandler(ipcMain, { dialog, BrowserWindow, getActiveModDataDir }) {

// Victory-conditions helper: pick a CSV/text list of region names, then write a
// CSV mapping each region → the faction that owns it in the mod's descr_strat.txt
// (the settlement-block owner). Region tokens may be comma/newline/semicolon/tab
// separated. Unmatched names are reported as NOT_FOUND so label rows stand out.
ipcMain.handle("vc-region-owners-csv", async (_event, modDataDir, campaign) => {
  try {
    const dataDir = modDataDir || getActiveModDataDir();
    if (!dataDir) return { error: "No mod loaded — import a mod first." };

    const folder = campaign === "classic" ? "ris_classic" : "imperial_campaign";
    const candidates = [
      path.join(dataDir, "world", "maps", "campaign", folder, "descr_strat.txt"),
      path.join(dataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
      path.join(dataDir, "world", "maps", "campaign", "ris_classic", "descr_strat.txt"),
    ];
    let stratPath = candidates.find((p) => fs.existsSync(p));
    if (!stratPath) {
      const base = path.join(dataDir, "world", "maps", "campaign");
      try {
        for (const d of fs.readdirSync(base, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const p = path.join(base, d.name, "descr_strat.txt");
          if (fs.existsSync(p)) { stratPath = p; break; }
        }
      } catch {}
    }
    if (!stratPath) return { error: "descr_strat.txt not found for this mod." };

    const parent = BrowserWindow.getFocusedWindow() || undefined;
    const inp = await dialog.showOpenDialog(parent, {
      title: "Select region list (CSV / text)",
      filters: [{ name: "CSV / text", extensions: ["csv", "txt"] }, { name: "All files", extensions: ["*"] }],
      properties: ["openFile"],
    });
    if (inp.canceled || !inp.filePaths[0]) return { canceled: true };
    const inputPath = inp.filePaths[0];

    // Parse region tokens (dedupe, preserve order).
    const seen = new Set();
    const regions = [];
    for (const tok of fs.readFileSync(inputPath, "utf8").split(/[\r\n,;\t]+/)) {
      const t = tok.trim();
      if (t && !seen.has(t)) { seen.add(t); regions.push(t); }
    }
    if (regions.length === 0) return { error: "No region names found in that file." };

    // region → owning faction, from descr_strat settlement blocks.
    const ownerByRegion = {}, ownerLower = {};
    {
      let curFaction = null, inSettlement = false;
      for (const line of fs.readFileSync(stratPath, "utf8").split(/\r?\n/)) {
        const s = line.trim();
        if (!s || s.startsWith(";")) continue;
        const fm = s.match(/^faction\s+([^\s,]+)/);
        if (fm) { curFaction = fm[1].toLowerCase(); inSettlement = false; continue; }
        if (s === "settlement") { inSettlement = true; continue; }
        if (inSettlement && /^region\b/.test(s)) {
          const rn = s.replace(/^region\s+/, "").trim();
          if (rn && curFaction) { ownerByRegion[rn] = curFaction; ownerLower[rn.toLowerCase()] = curFaction; }
          inSettlement = false;
        }
      }
    }

    // city → region (from descr_regions.txt) so a list of CITY names resolves too
    // (descr_strat's `region` field holds province names like Faliscia, not the
    // city Falerii). Blocks are 8 lines (region, city, faction, culture, rgb,
    // tags, farm, pop); original RTW adds a 9th (ethnicities) — detect per block
    // so the walk doesn't desync and skip later regions.
    const cityToRegion = {}, cityToRegionLower = {};
    {
      const regCandidates = [
        path.join(dataDir, "world", "maps", "campaign", folder, "descr_regions.txt"),
        path.join(dataDir, "world", "maps", "base", "descr_regions.txt"),
        path.join(dataDir, "world", "maps", "campaign", "imperial_campaign", "descr_regions.txt"),
      ];
      const regPath = regCandidates.find((p) => fs.existsSync(p));
      if (regPath) {
        const L = fs.readFileSync(regPath, "utf8").split(/\r?\n/);
        const isStart = (raw) => {
          if (raw == null || /^\s/.test(raw)) return false;
          const t = raw.trim();
          return !!t && !t.startsWith(";") && /^[A-Za-z][A-Za-z0-9_]*$/.test(t);
        };
        let i = 0;
        while (i < L.length) {
          const t = (L[i] || "").trim();
          if (!t || t.startsWith(";")) { i++; continue; }
          if (i + 7 >= L.length) break;
          const rgb = (L[i + 4] || "").trim().split(/\s+/);
          if (rgb.length !== 3 || !/^\d+$/.test(rgb[0])) { i++; continue; }
          const region = t, city = (L[i + 1] || "").trim();
          if (city) { cityToRegion[city] = region; cityToRegionLower[city.toLowerCase()] = region; }
          const next = L[i + 8];
          const has9 = next != null && !isStart(next) && !!next.trim() && !next.trim().startsWith(";");
          i += has9 ? 9 : 8;
        }
      }
    }

    const resolveOwner = (name) => {
      let o = ownerByRegion[name] || ownerLower[name.toLowerCase()];
      if (o) return o;
      const reg = cityToRegion[name] || cityToRegionLower[name.toLowerCase()];
      if (reg) return ownerByRegion[reg] || ownerLower[reg.toLowerCase()] || null;
      return null;
    };

    const csvCell = (v) => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    let found = 0, notFound = 0;
    const rows = ["region,owner_faction"];
    for (const r of regions) {
      const owner = resolveOwner(r);
      if (owner) { found++; rows.push(`${csvCell(r)},${csvCell(owner)}`); }
      else { notFound++; rows.push(`${csvCell(r)},NOT_FOUND`); }
    }

    const baseName = path.basename(inputPath).replace(/\.[^.]+$/, "");
    const out = await dialog.showSaveDialog(parent, {
      title: "Save region owners (CSV)",
      defaultPath: path.join(path.dirname(inputPath), `${baseName}_owners.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (out.canceled || !out.filePath) return { canceled: true };
    fs.writeFileSync(out.filePath, rows.join("\r\n") + "\r\n", "utf8");

    return { total: regions.length, found, notFound, outputPath: out.filePath };
  } catch (e) {
    return { error: e.message };
  }
});

}

module.exports = { registerRegionOwnersCsvHandler };
