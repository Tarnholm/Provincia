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
  // RTW:R uses 8-line region blocks (region, city, faction, culture, RGB,
  // tags, farm_level, pop_level). Original RTW added a 9th "ethnicities"
  // line. Detect by checking whether the line after pop_level looks like
  // a new region start (non-indented name) vs. an ethnicities value.
  const lines = text.split(/\r?\n/);
  const regions = {};
  const isRegionStart = (raw) => {
    if (raw == null) return false;
    if (/^\s/.test(raw)) return false; // indented → field, not region name
    const t = raw.trim();
    if (!t || t.startsWith(";")) return false;
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(t);
  };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = (raw || "").trim();
    if (!line || line.startsWith(";")) { i++; continue; }
    if (i + 7 >= lines.length) break;
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
    // Look at line 8: is it ethnicities (RTW original) or the start of the
    // next region block (RTW:R)?
    let ethnicities = "";
    let step = 8;
    const nextRaw = lines[i + 8];
    if (nextRaw != null && !isRegionStart(nextRaw)) {
      const nt = (nextRaw || "").trim();
      if (nt && !nt.startsWith(";")) { ethnicities = nt; step = 9; }
    }
    regions[rgbKey] = { region, city, faction, culture, tags, farm_level, pop_level, ethnicities };
    i += step;
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

// Parse the per-faction `denari N` line from descr_strat. Returns
// { factionId: denari } using the first denari encountered after each
// `faction X, ai_X` block — descr_strat sometimes carries multiple denari
// lines (one per save snapshot etc.) but the first under each faction is
// the starting treasury we want to surface.
function parseDescrStratFactionWealth(text) {
  const lines = text.split(/\r?\n/);
  const out = {};
  let curFaction = null;
  let captured = false;
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || s.startsWith(";")) continue;
    const fm = s.match(/^faction\s+(\w+)/);
    if (fm) { curFaction = fm[1].toLowerCase(); captured = false; continue; }
    if (!curFaction || captured) continue;
    const dm = s.match(/^denari\s+(-?\d+)/);
    if (dm) { out[curFaction] = parseInt(dm[1], 10); captured = true; }
  }
  return out;
}

// 0.9.536: starting diplomacy from descr_strat `faction_relationships`
// lines: `faction_relationships <from>, <value> <to>`. Value encodes the
// stance: <=199 ally, 200 neutral, >=201 war. This is the only NAMED
// pairwise diplomacy available — the live save stores relation classes but
// NOT the partner faction (verified uncrackable 2026-05-22). Starting-state
// only; won't reflect mid-campaign changes. Returns
// { fromFaction: [{ to, kind }] } with kind in {"ally","war"} (neutral
// pairs are dropped as noise — neutral is the default).
function parseDescrStratFactionRelationships(text) {
  const out = {};
  const add = (a, b, kind) => {
    if (!out[a]) out[a] = [];
    if (!out[a].some((e) => e.to === b)) out[a].push({ to: b, kind });
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1].toLowerCase();
    const value = parseInt(m[2], 10);
    const to = m[3].toLowerCase();
    if (to === "slave" || from === to) continue; // global rebel-war / self — skip
    const kind = value <= 199 ? "ally" : (value === 200 ? "neutral" : "war");
    if (kind === "neutral") continue;
    // 0.9.538: store the relationship on BOTH parties. descr_strat usually
    // declares a pair only from one side (e.g. "antigonid, 201 romans_julii"
    // appears under antigonid but not romans_julii). Without the reverse,
    // romans_julii / carthage / etc. had no entry and the region Diplomacy
    // widget showed nothing for them. A relationship is symmetric, so the
    // target faction gets the mirrored entry too.
    add(from, to, kind);
    add(to, from, kind);
  }
  return out;
}

// 0.9.543: starting diplomacy declared in the CAMPAIGN SCRIPT (not
// descr_strat). RIS sets protectorates and some war/alliance stances via
// `console_command become_protector <protector> <protectorate>` and
// `console_command diplomatic_stance <a> <b> <war|allied>`. descr_strat even
// notes "Protectorate set with Scripting". Without this, factions whose only
// starting relations are scripted (e.g. romans_julii's 6 Italian
// protectorates) showed nothing. Skips commented (`;`) lines. Returns the
// same { factionId: [{ to, kind }] } shape (kinds: protects / protected_by /
// war / ally), merged into the descr_strat relations by the bundler.
function parseCampaignScriptDiplomacy(text) {
  const out = {};
  const add = (a, b, kind) => {
    if (a === b) return;
    if (!out[a]) out[a] = [];
    if (!out[a].some((e) => e.to === b && e.kind === kind)) out[a].push({ to: b, kind });
  };
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith(";")) continue;
    let m = s.match(/^console_command\s+become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
    if (m) {
      const a = m[1].toLowerCase(), b = m[2].toLowerCase();
      add(a, b, "protects");       // a is the protector of b
      add(b, a, "protected_by");   // b is a's protectorate
      continue;
    }
    m = s.match(/^console_command\s+diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i);
    if (m) {
      const a = m[1].toLowerCase(), b = m[2].toLowerCase(), st = m[3].toLowerCase();
      const kind = st === "war" ? "war" : ((st === "allied" || st === "alliance") ? "ally" : null);
      if (kind) { add(a, b, kind); add(b, a, kind); }
      continue;
    }
  }
  return out;
}

// Merge two { faction: [{to,kind}] } relation maps (descr_strat + script),
// de-duplicating by (to, kind). Script protectorates take precedence in
// ordering (pushed first) since they're the more notable relationship.
function mergeFactionRelationships(...maps) {
  const out = {};
  for (const m of maps) {
    if (!m) continue;
    for (const f of Object.keys(m)) {
      if (!out[f]) out[f] = [];
      for (const e of m[f]) {
        if (!out[f].some((x) => x.to === e.to && x.kind === e.kind)) out[f].push(e);
      }
    }
  }
  return out;
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

// Parse resource lines from descr_strat.txt → { regionName: [{ type, amount, x, y, category }] }
// mapHeight is used to flip Y from strat coords (origin bottom) to TGA coords (origin top)
//
// Categories follow RIS's `;;;; HEADER ;;;;` sub-section markers in the
// resources block (see project memo on RIS resource organization):
//   - default (before any header)            → "trade"   (regular tradeable goods)
//   - after `;;;; SLAVE RESOURCES ;;;;`      → "slave"   (raw slaves commodity)
//   - after `;;;; AMBIENCE ;;;;`             → "ambience" (aqueducts, shipwrecks — decorative)
// Vanilla descr_strats without these headers just produce all-"trade" output,
// which matches prior behaviour.
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
  let category = "trade";
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    // Section-header switch. Comment lines like `;;;; SLAVE RESOURCES ;;;;`
    // or `;;;; AMBIENCE ;;;;` reset the active category for everything that
    // follows (including commented-out `;resource` lines we would otherwise
    // skip — those don't actually emit entries, but the header still flips
    // state). Match defensively on the words rather than exact punctuation.
    if (s.startsWith(";")) {
      const up = s.toUpperCase();
      if (/\bSLAVE\s+RESOURCES?\b/.test(up)) category = "slave";
      else if (/\bAMBIENCE\b/.test(up)) category = "ambience";
      continue;
    }
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
    result[region].push({ type, amount, x, y, category });
  }
  return result;
}

function parseDescrStratArmies(text) {
  // Walk the file once, tracking the current faction and the most recent
  // `character ...` line. When an `army` keyword follows, collect the unit
  // list until a non-unit keyword breaks the block. descr_strat characters
  // look like:
  //   character Adymos of_Lissus, general, age 41, , x 10, y 50     (vanilla Alex)
  //   character,	Quintus Ogulnius_Gallus, named, leader, age 60, , x 285, y 404   (RIS etc.)
  // The separator after `character` is either whitespace (tab/space) OR a
  // comma-then-whitespace; the parser accepts both.
  //
  // Also captures `garrisoned_army` blocks defined inside `settlement { ... }`.
  // These have no character/coords — bare `unit` lines under the settlement
  // block. Each emitted entry carries `region` so the dev-import classifier
  // can pin it to the settlement tile. RIS uses garrisoned_army for nearly
  // every slave settlement (Friniatia → 1 celtic swordsman + 1 celtic
  // spearman, etc.) and dropping these is why imported saves rendered them
  // as empty.
  //
  // Returns [{ faction, character, x, y, units: [{ name, exp }] }].
  const armies = [];
  const lines = text.split(/\r?\n/);
  let curFaction = null;
  let curChar = null;   // { character, x, y }
  // Settlement block tracking for garrisoned_army.
  let inSettlement = false, settlementRegion = null, settlementBraceDepth = 0;
  let inGarrisonedArmy = false, currentGarrison = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s || s.startsWith(";")) continue;
    const fm = s.match(/^faction\s+(\w+)/);
    if (fm) {
      curFaction = fm[1].toLowerCase();
      curChar = null;
      inSettlement = false; settlementRegion = null; settlementBraceDepth = 0;
      if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
      currentGarrison = null; inGarrisonedArmy = false;
      continue;
    }
    // ── Settlement block tracking (for garrisoned_army) ────────────────
    if (s === "settlement") { inSettlement = true; settlementRegion = null; settlementBraceDepth = 0; continue; }
    if (inSettlement) {
      if (s === "{") { settlementBraceDepth++; continue; }
      if (s === "}") {
        settlementBraceDepth--;
        if (settlementBraceDepth <= 0) {
          if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
          inSettlement = false; settlementRegion = null; settlementBraceDepth = 0;
          inGarrisonedArmy = false; currentGarrison = null;
        }
        continue;
      }
      const rm = s.match(/^region\s+(\S+)/);
      if (rm) { settlementRegion = rm[1]; continue; }
      if (s === "garrisoned_army") {
        if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
        currentGarrison = {
          faction: curFaction,
          type: "garrisoned_army",
          armyClass: "garrison",
          character: settlementRegion ? `Garrison of ${settlementRegion}` : "Garrison",
          role: null,
          // x/y resolved by the consumer (App.js dev-import) via the captured
          // `region` field — settlement tile coords come from the TGA pixel walk.
          x: null, y: null,
          region: settlementRegion || null,
          units: [],
          _garrisoned: true,
        };
        inGarrisonedArmy = true;
        continue;
      }
      if (inGarrisonedArmy && currentGarrison) {
        const um = s.match(/^unit\s+(.+?)(?:\s+exp\s|\s{2,}|$)/);
        if (um) {
          const uname = um[1].replace(/,$/, "").trim();
          const exp = (s.match(/\bexp\s+(\d+)/) || [, "0"])[1] | 0;
          const armour = (s.match(/\barmour\s+(\d+)/) || [, "0"])[1] | 0;
          const weapon = (s.match(/\bweapon_lvl\s+(\d+)/) || [, "0"])[1] | 0;
          currentGarrison.units.push({ name: uname, exp, armour, weapon });
          continue;
        }
        // Anything else ends the garrisoned_army block (but not the settlement).
        if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
        currentGarrison = null;
        inGarrisonedArmy = false;
        // Fall through so the line still gets normal processing.
      }
    }
    const cm = s.match(/^character(?:_sub)?[,\s]+(.+)$/);
    if (cm) {
      const parts = cm[1].split(",").map((p) => p.trim());
      const name = parts[0];
      // Role is the second field and identifies admirals (naval commanders).
      const role = parts[1] || null;
      let x = null, y = null;
      for (const p of parts) {
        const mx = p.match(/^x\s+(-?\d+)/); if (mx) x = parseInt(mx[1], 10);
        const my = p.match(/^y\s+(-?\d+)/); if (my) y = parseInt(my[1], 10);
      }
      curChar = { character: name, role, x, y };
      continue;
    }
    if ((s === "army" || s === "navy") && curFaction && curChar) {
      const units = [];
      let j = i + 1;
      while (j < lines.length) {
        const sl = lines[j].trim();
        if (!sl || sl.startsWith(";")) { j++; continue; }
        const um = sl.match(/^unit\s+(.+?)(?:\s+exp\s|\s{2,}|$)/);
        if (um) {
          const uname = um[1].replace(/,$/, "").trim();
          const exp = (sl.match(/\bexp\s+(\d+)/) || [, "0"])[1] | 0;
          const armour = (sl.match(/\barmour\s+(\d+)/) || [, "0"])[1] | 0;
          const weapon = (sl.match(/\bweapon_lvl\s+(\d+)/) || [, "0"])[1] | 0;
          units.push({ name: uname, exp, armour, weapon });
          j++;
          continue;
        }
        // Any other keyword terminates the army block.
        break;
      }
      // Navy detection: explicit `navy` keyword, OR the army is commanded
      // by an admiral, OR every unit's name starts with "naval " (boats).
      const isAdmiral = (curChar.role || "").toLowerCase() === "admiral";
      const allNaval = units.length > 0 && units.every((u) => /^naval\b/.test((u.name || "").toLowerCase()));
      const armyClass = (s === "navy" || isAdmiral || allNaval) ? "navy" : "field";
      armies.push({
        faction: curFaction,
        type: s,
        armyClass,
        character: curChar.character,
        role: curChar.role,
        x: curChar.x,
        y: curChar.y,
        units,
      });
      i = j - 1;
      curChar = null;
    }
  }
  if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
  return armies;
}

export {
  parseSmFactions,
  parseDescrRegions,
  parseDescrStratFactions,
  parseDescrStratBuildings,
  parseDescrStratResources,
  parseDescrStratArmies,
  parseDescrStratFactionWealth,
  parseDescrStratFactionRelationships,
  parseCampaignScriptDiplomacy,
  mergeFactionRelationships,
};
