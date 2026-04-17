/**
 * Shared parsers for Rome: Total War mod text/binary data.
 * Used by src/App.js (runtime import flow) and scripts/bundle-mod-data.js (build).
 *
 * CommonJS on purpose: Node's require() consumes it directly, and webpack
 * (via CRA) interops when App.js uses `import { ... } from "./parsers"`.
 */

function parseSmFactions(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentFaction = null;
  let braceDepth = 0;
  let wasInBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith(";;") || s.startsWith(";")) continue;
    const prevDepth = braceDepth;
    for (const ch of s) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    if (wasInBlock && braceDepth === 0) {
      currentFaction = null;
      wasInBlock = false;
    }
    if (prevDepth === 0 && braceDepth === 0) {
      const fm = s.match(/^"([^"]+)"\s*:\s*(?:;.*)?$/);
      if (fm) {
        const name = fm[1].toLowerCase();
        if (name !== "factions") {
          currentFaction = name;
        }
      }
    }
    if (currentFaction && prevDepth === 0 && braceDepth === 1) {
      wasInBlock = true;
    }
    if (currentFaction && braceDepth >= 1) {
      const cm = s.match(/"(primary|secondary)"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (cm) {
        if (!result[currentFaction]) result[currentFaction] = {};
        result[currentFaction][cm[1]] = [parseInt(cm[2]), parseInt(cm[3]), parseInt(cm[4])];
      }
    }
  }
  return result;
}

function parseDescrRegions(text) {
  const lines = text.split(/\r?\n/);
  const regions = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith(";")) { i++; continue; }
    if (i + 8 >= lines.length) break;
    const region = line;
    const city = lines[i + 1].trim();
    const faction = lines[i + 2].trim();
    const culture = lines[i + 3].trim();
    const rgbParts = lines[i + 4].trim().split(/\s+/);
    if (rgbParts.length !== 3 || !/^\d+$/.test(rgbParts[0])) { i++; continue; }
    const rgbKey = rgbParts.join(",");
    const tags = lines[i + 5].trim();
    const farm_level = lines[i + 6].trim();
    const pop_level = lines[i + 7].trim();
    const ethnicities = lines[i + 8].trim();
    regions[rgbKey] = { region, city, faction, culture, tags, farm_level, pop_level, ethnicities };
    i += 9;
  }
  return regions;
}

function parseDescrStratFactions(text) {
  const lines = text.split(/\r?\n/);
  const factionRegions = {};
  let currentFaction = null;
  let inSettlement = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith(";")) continue;
    const fm = s.match(/^faction\s+(\w+)/);
    if (fm) { currentFaction = fm[1].toLowerCase(); if (!factionRegions[currentFaction]) factionRegions[currentFaction] = []; inSettlement = false; continue; }
    if (s === "settlement") { inSettlement = true; continue; }
    if (s === "}" && inSettlement) { inSettlement = false; continue; }
    if (inSettlement && s.startsWith("region")) {
      const rn = s.replace("region", "").trim();
      if (currentFaction && rn) factionRegions[currentFaction].push(rn);
    }
  }
  return Object.fromEntries(Object.entries(factionRegions).filter(([, v]) => v.length > 0));
}

function parseDescrStratBuildings(text) {
  const lines = text.split(/\r?\n/);
  let startIdx = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].includes("; >>>> start of factions section <<<<")) { startIdx = idx + 1; break; }
  }
  const getBlock = (start) => {
    let braces = 0, found = false;
    for (let j = start; j < lines.length; j++) {
      if (lines[j].includes("{")) found = true;
      if (found) { braces += (lines[j].match(/{/g) || []).length; braces -= (lines[j].match(/}/g) || []).length; }
      if (found && braces === 0) return { block: lines.slice(start, j + 1), end: j };
    }
    return { block: [], end: start };
  };
  const extractMeta = (block) => {
    let region = null, level = "town", population = null, faction_creator = null;
    const buildings = [];
    let inBuilding = false;
    for (const ln of block) {
      const s = ln.trim();
      if (s.startsWith("region")) { const p = s.split(/\s+/); if (p.length >= 2) region = p[1]; }
      else if (s.startsWith("level")) { const p = s.split(/\s+/); if (p.length >= 2) level = p[1]; }
      else if (s.startsWith("population")) { const p = s.split(/\s+/); if (p.length >= 2) population = parseInt(p[1], 10) || null; }
      else if (s.startsWith("faction_creator")) { const p = s.split(/\s+/); if (p.length >= 2) faction_creator = p[1]; }
      else if (s.startsWith("building")) inBuilding = true;
      else if (inBuilding && s.startsWith("type")) { const p = s.split(/\s+/); if (p.length >= 3) buildings.push({ type: p[1], level: p[2] }); }
      else if (inBuilding && s.includes("}")) inBuilding = false;
    }
    return { region, level, population, faction_creator, buildings };
  };
  const factions = [];
  let i = startIdx;
  while (i < lines.length) {
    const s = lines[i].trim();
    const fm = s.match(/^faction\s+([^\s,]+)/);
    if (fm) {
      const factionName = fm[1]; const settlements = []; i++;
      while (i < lines.length) {
        const s2 = lines[i].trim();
        if (s2.startsWith("faction") || s2.startsWith("; >>>>")) break;
        if (s2.startsWith("settlement")) { const { block, end } = getBlock(i); settlements.push(extractMeta(block)); i = end + 1; }
        else i++;
      }
      factions.push({ faction: factionName, settlements });
    } else i++;
  }
  return factions;
}

// Parse resource lines from descr_strat.txt → { regionName: [{ type, amount, x, y }] }
// mapHeight is used to flip Y from strat coords (origin bottom) to TGA coords (origin top)
function parseDescrStratResources(text, mapHeight, tgaBuf, regionsMap) {
  let pixelLookup = null;
  if (tgaBuf && regionsMap) {
    const ab = tgaBuf instanceof ArrayBuffer ? tgaBuf : (tgaBuf.buffer || tgaBuf);
    const view = new DataView(ab);
    const idLen = view.getUint8(0);
    const w = view.getUint16(12, true);
    const h = view.getUint16(14, true);
    const bpp = view.getUint8(16);
    const bytesPerPx = bpp / 8;
    const dataOff = 18 + idLen;
    const bytes = new Uint8Array(ab);
    const rgbToRegion = {};
    for (const [rgb, r] of Object.entries(regionsMap)) {
      if (r.region) rgbToRegion[rgb] = r.region;
    }
    pixelLookup = (mx, my) => {
      if (mx < 0 || mx >= w || my < 0 || my >= h) return null;
      const fy = h - 1 - my;
      const idx = dataOff + (fy * w + mx) * bytesPerPx;
      const key = bytes[idx + 2] + "," + bytes[idx + 1] + "," + bytes[idx];
      return rgbToRegion[key] || null;
    };
  }

  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("resource")) continue;
    const m = s.match(/^resource\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) continue;
    const type = m[1].trim();
    const amount = parseInt(m[2]);
    const x = parseInt(m[3]);
    const y = mapHeight ? mapHeight - parseInt(m[4]) : parseInt(m[4]);
    let region;
    if (pixelLookup) {
      region = pixelLookup(x, y - 1);
    } else {
      const cm = s.match(/;\s*(.+)/);
      region = cm ? cm[1].trim() : null;
    }
    if (!region) continue;
    if (!result[region]) result[region] = [];
    result[region].push({ type, amount, x, y });
  }
  return result;
}

function parseDescrStratArmies(text) {
  const armies = [];
  const lines = text.split(/\r?\n/);
  let currentFaction = null;
  let i = 0;
  while (i < lines.length) {
    const s = lines[i].trim();
    const fm = s.match(/^faction\s+(\w+)/);
    if (fm) { currentFaction = fm[1].toLowerCase(); i++; continue; }
    const am = s.match(/^(army|navy)\s+(.+)/);
    if (am && currentFaction) {
      const entry = { faction: currentFaction, type: am[1], name: am[2].replace(/,.*/, "").trim() };
      i++;
      while (i < lines.length) {
        const sl = lines[i].trim();
        if (!sl || sl.startsWith(";") || sl.startsWith("faction") || sl.startsWith("army") || sl.startsWith("navy") || sl.startsWith("settlement")) break;
        const cm = sl.match(/^character\s+(.+)/);
        if (cm) { entry.character = cm[1].split(",")[0].trim(); }
        const csm = sl.match(/^character_sub\s+(.+)/);
        if (csm) { entry.character = csm[1].split(",")[0].trim(); }
        if (sl.startsWith("mercenary_pool") || sl.startsWith("denari")) break;
        i++;
      }
      armies.push(entry);
    } else {
      i++;
    }
  }
  return armies;
}

module.exports = {
  parseSmFactions,
  parseDescrRegions,
  parseDescrStratFactions,
  parseDescrStratBuildings,
  parseDescrStratResources,
  parseDescrStratArmies,
};
