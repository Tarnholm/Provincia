/**
 * Starting-armies builder (CommonJS).
 *
 * Extracted verbatim from scripts/bundle-mod-data.js so the SAME parser feeds:
 *   • the build-time data bundle (public/starting_armies_<suffix>.json), and
 *   • the live "auto-refresh starting armies from the live mod" path (main.js
 *     IPC get-live-starting-armies → buildStartingArmiesFromMod).
 *
 * The low-level functions below (parseArmiesClassified, buildStartingArmiesByRegion
 * and their helpers/constants) are byte-for-byte the same logic the bundler used.
 * Do NOT change their behaviour without re-running the bundle-parity diff
 * (public/starting_armies_classic.json + _large.json must stay byte-identical).
 */
const fs = require("fs");
const path = require("path");

// ── RLE → uncompressed TGA normaliser ───────────────────────────────────
// The builder's pixel math assumes an UNCOMPRESSED true-color TGA (imageType
// 2), but RIS ships map_regions.tga RLE-compressed (imageType 10). Feeding RLE
// bytes to the raw offset readers yielded garbage pixels → armies whose coords
// didn't accidentally land on a valid region were dropped (most of Italy).
// This decodes an RLE TGA into an equivalent uncompressed one (same 18-byte
// header with imageType flipped to 2) so every downstream reader works
// unchanged. Uncompressed input is returned as-is; anything unexpected too.
function ensureUncompressedTga(buf) {
  if (!buf || buf.length < 18 || buf[2] !== 10) return buf; // only RLE true-color
  const idLen = buf[0];
  const w = buf[12] | (buf[13] << 8);
  const h = buf[14] | (buf[15] << 8);
  const stride = buf[16] / 8;
  if (!w || !h || !stride) return buf;
  const dataOff = 18 + idLen;
  const px = w * h;
  const out = Buffer.alloc(18 + px * stride);
  buf.copy(out, 0, 0, 18);          // reuse header
  out[2] = 2;                        // mark uncompressed
  out[0] = 0;                        // drop image-ID (we didn't copy it)
  let sp = dataOff, dp = 18, count = 0;
  while (count < px && sp < buf.length) {
    const packet = buf[sp++];
    const n = (packet & 0x7f) + 1;
    if (packet & 0x80) {             // RLE packet: one pixel repeated n times
      for (let k = 0; k < n && count < px; k++) {
        for (let b = 0; b < stride; b++) out[dp++] = buf[sp + b];
        count++;
      }
      sp += stride;
    } else {                          // raw packet: n literal pixels
      for (let k = 0; k < n && count < px; k++) {
        for (let b = 0; b < stride; b++) out[dp++] = buf[sp++];
        count++;
      }
    }
  }
  return out;
}

// ── Minimal TGA reader — supports uncompressed 24/32-bit BGR(A) ──────────
function readTga(rawBuf) {
  const buf = ensureUncompressedTga(rawBuf);
  const idLen = buf[0];
  const w = buf[12] | (buf[13] << 8);
  const h = buf[14] | (buf[15] << 8);
  const bpp = buf[16];
  const stride = bpp / 8;
  const dataOff = 18 + idLen;
  // Strat coords: origin bottom-left, so TGA's bottom-left origin needs no flip
  const getPixel = (sx, sy) => {
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return null;
    const idx = dataOff + (sy * w + sx) * stride;
    // TGA stores BGR
    return [buf[idx + 2], buf[idx + 1], buf[idx]];
  };
  return { w, h, getPixel };
}

// ── Per-region starting armies builder ──────────────────────────────────
// Mirrors the dev-import classification at App.js's import flow: walks the
// TGA pixel grid to find each region's settlement tile (a (0,0,0) pixel
// adjacent to a region-coloured pixel), then buckets armies into
// garrison/field per region. Synthetic garrisoned_army entries (no x/y) are
// snapped to their settlement tile via the captured `region` field.
function buildStartingArmiesByRegion(armies, tgaBufRaw, regionsMap, factions) {
  const tgaBuf = ensureUncompressedTga(tgaBufRaw); // RIS map is RLE — decode first
  // 0.9.853: region → owning faction (inverted from descr_strat
  // faction→regions). Used below so a FOREIGN army on/next to a settlement
  // tile (a besieger / passing stack, e.g. the Roman Aulus Gabinius beside
  // taras-owned Tarentum) is bucketed as FIELD, not merged into the garrison.
  const ownerByRegion = {};
  for (const [fac, regs] of Object.entries(factions || {})) {
    for (const rn of regs || []) ownerByRegion[rn] = String(fac).toLowerCase();
  }
  const idLen = tgaBuf[0];
  const w = tgaBuf[12] | (tgaBuf[13] << 8);
  const h = tgaBuf[14] | (tgaBuf[15] << 8);
  const bpp = tgaBuf[16];
  const stride = bpp / 8;
  const dataOff = 18 + idLen;
  const descriptor = tgaBuf[17];
  const topDown = (descriptor & 0x20) !== 0;
  const bufRow = (stratY) => topDown ? (h - 1 - stratY) : stratY;

  const rgbToRegion = {};
  for (const [rgb, r] of Object.entries(regionsMap)) {
    if (r.region) rgbToRegion[rgb] = r.region;
  }

  // Find each region's settlement tile (black pixel with a region-coloured neighbour).
  const settlementByRegion = {};
  for (let by = 0; by < h; by++) {
    for (let x = 0; x < w; x++) {
      const i = dataOff + (by * w + x) * stride;
      if (tgaBuf[i] !== 0 || tgaBuf[i + 1] !== 0 || tgaBuf[i + 2] !== 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = by + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const j = dataOff + (ny * w + nx) * stride;
        const key = tgaBuf[j + 2] + "," + tgaBuf[j + 1] + "," + tgaBuf[j];
        const reg = rgbToRegion[key];
        if (reg) {
          const stratY = topDown ? (h - 1 - by) : by;
          if (!settlementByRegion[reg]) settlementByRegion[reg] = { x, y: stratY };
          break;
        }
      }
    }
  }

  const tileKeyToRegion = {};
  for (const [reg, p] of Object.entries(settlementByRegion)) {
    tileKeyToRegion[`${p.x},${p.y}`] = reg;
  }
  const pixelRgb = (sx, sy) => {
    const by = bufRow(sy);
    if (sx < 0 || sx >= w || by < 0 || by >= h) return null;
    const idx = dataOff + (by * w + sx) * stride;
    return tgaBuf[idx + 2] + "," + tgaBuf[idx + 1] + "," + tgaBuf[idx];
  };

  const byRegion = {};
  for (const [reg, p] of Object.entries(settlementByRegion)) {
    byRegion[reg] = { garrison: [], field: [], settlement: p };
  }

  // Helper: normalise unit list into [{name, exp, armour, weapon}].
  const normUnits = (units) => (units || []).map(u =>
    typeof u === "string"
      ? { name: u, exp: 0, armour: 0, weapon: 0 }
      : { name: u.name, exp: u.exp || 0, armour: u.armour || 0, weapon: u.weapon || 0 }
  );
  for (const a of armies) {
    // Synthetic garrisoned_army: pin to its declared region's settlement tile.
    if (a._garrisoned && a.region) {
      const tile = settlementByRegion[a.region];
      if (!byRegion[a.region]) byRegion[a.region] = { garrison: [], field: [], settlement: tile || null };
      byRegion[a.region].garrison.push({
        character: a.name, faction: a.faction,
        x: tile?.x ?? null, y: tile?.y ?? null,
        units: normUnits(a.units),
        // garrisoned_army blocks have no character header so no traits/ancillaries/age — keep keys consistent
        age: null, tags: [], traits: [], ancillaries: [], charType: a.charType || "garrison",
      });
      continue;
    }
    if (a.x == null || a.y == null) continue;
    let region = tileKeyToRegion[`${a.x},${a.y}`];
    let isGarrison = !!region;
    if (!region) {
      const rgb = pixelRgb(a.x, a.y);
      region = rgb && rgbToRegion[rgb];
    }
    if (!region) continue;
    // 0.9.887: EXACT settlement-tile match only — no fuzzy tolerance. An audit of
    // every region confirmed every real garrison commander sits EXACTLY on the
    // settlement tile (the scan is precise); the old 1-tile tolerance only ever
    // pulled genuinely-adjacent FIELD armies (e.g. Capua's heir Auls one tile
    // outside) into the garrison. `isGarrison` is already true iff the army's
    // tile is a settlement tile (tileKeyToRegion hit) above.
    // 0.9.853: garrison membership requires the army to belong to the
    // settlement OWNER — a different faction's stack on/beside the tile is a
    // FIELD army. Owner unknown → keep the position-only result (no regression).
    if (isGarrison && region) {
      const owner = ownerByRegion[region];
      const aFac = (a.faction || "").toLowerCase();
      if (owner && aFac && aFac !== owner) isGarrison = false;
    }
    if (!byRegion[region]) byRegion[region] = { garrison: [], field: [], settlement: settlementByRegion[region] || null };
    byRegion[region][isGarrison ? "garrison" : "field"].push({
      character: a.name, faction: a.faction,
      x: a.x, y: a.y,
      units: normUnits(a.units),
      age: a.age ?? null,
      tags: Array.isArray(a.tags) ? a.tags : [],
      traits: Array.isArray(a.traits) ? a.traits : [],
      ancillaries: Array.isArray(a.ancillaries) ? a.ancillaries : [],
      charType: a.charType || "general",
    });
  }
  return byRegion;
}

// ── Armies parser (richer than parsers.js — needs TGA for garrison classification) ──
// Ported from scripts/parse_armies.py
const CHAR_RE = /^character,?\s+(.+)/;
const COORD_RE = /x\s+(\d+),\s*y\s+(\d+)/;
const UNIT_RE = /^unit\s+(.+?)(?:\s+exp\s|$)/;

function isSea(r, g, b) { return r < 60 && g >= 120 && g <= 160 && b >= 200; }

function findCityPixel(sx, sy, getPixel, radius) {
  let best = null, bestD2 = radius * radius + 1;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const p = getPixel(sx + dx, sy + dy);
      if (p && p[0] === 0 && p[1] === 0 && p[2] === 0 && d2 < bestD2) {
        bestD2 = d2; best = [sx + dx, sy + dy];
      }
    }
  }
  return best;
}

function armyClass(charLine, comment, sx, sy, getPixel) {
  const cl = charLine.toLowerCase();
  const co = comment.toLowerCase();
  if (cl.includes("admiral") || co.startsWith(";port of") || co.includes("(sea)")) return ["navy", sx, sy];
  if (co.startsWith(";outside") || co.startsWith(";near") || co.startsWith(";field")) return ["field", sx, sy];
  if (co.includes("(field)") || co.includes("(outside)")) return ["field", sx, sy];
  if (!comment.startsWith(";")) return ["field", sx, sy];
  const center = getPixel(sx, sy);
  if (center && isSea(center[0], center[1], center[2])) return ["field", sx, sy];
  const city = findCityPixel(sx, sy, getPixel, 3);
  if (city) return ["garrison", city[0], city[1]];
  return ["field", sx, sy];
}

function charType(line) {
  const l = line.toLowerCase();
  if (l.includes("admiral")) return "admiral";
  if (l.includes("spy")) return "spy";
  if (l.includes("diplomat")) return "diplomat";
  if (l.includes("merchant")) return "merchant";
  return "general";
}

function parseArmiesClassified(text, tgaBufRaw, mapHeight) {
  const tgaBuf = tgaBufRaw ? ensureUncompressedTga(tgaBufRaw) : null;
  const tga = tgaBuf ? readTga(tgaBuf) : null;
  const getPixel = tga ? tga.getPixel : () => null;
  const armies = [];
  let faction = null, current = null, inArmy = false, prevComment = "";
  // Settlement state: when we're inside `settlement { ... }` we track its
  // region name so a `garrisoned_army` block (which has no character/coord
  // line of its own) can attach its units to that region's settlement tile.
  let inSettlement = false, settlementRegion = null, settlementBraceDepth = 0;
  let inGarrisonedArmy = false, currentGarrison = null;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const s = rawLine.replace(/\s+$/, "");
    const t = s.trim();
    const fm = /^faction\s+(\w+)/.exec(s);
    if (fm) {
      if (current && current.units.length) armies.push(current);
      faction = fm[1]; current = null; inArmy = false; prevComment = "";
      inSettlement = false; settlementRegion = null; settlementBraceDepth = 0;
      inGarrisonedArmy = false; currentGarrison = null;
      continue;
    }
    if (t.startsWith(";") && !/^character,/.test(s)) prevComment = t;
    // Track settlement blocks so we can attach garrisoned_army to the right region.
    if (t === "settlement") { inSettlement = true; settlementRegion = null; settlementBraceDepth = 0; continue; }
    if (inSettlement) {
      // Track brace depth — a settlement block ends at depth 0 after closing `}`.
      if (t === "{") { settlementBraceDepth++; continue; }
      if (t === "}") {
        settlementBraceDepth--;
        if (settlementBraceDepth <= 0) {
          // End of settlement block. Flush garrisoned_army if open.
          if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
          inSettlement = false; settlementRegion = null; settlementBraceDepth = 0;
          inGarrisonedArmy = false; currentGarrison = null;
        }
        continue;
      }
      const rm = /^region\s+(\S+)/.exec(t);
      if (rm) { settlementRegion = rm[1]; continue; }
      // Start of a garrisoned_army block. RIS uses bare `unit` lines after
      // this header (no separate `army` keyword, and no character block —
      // just sub-faction-tagged loose units that the game places on the
      // settlement tile).
      if (t === "garrisoned_army") {
        // Flush any previous garrison army still open (defensive).
        if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
        currentGarrison = {
          name: settlementRegion ? `Garrison of ${settlementRegion}` : "Garrison",
          charType: "garrison",
          armyClass: "garrison",
          location: settlementRegion || "",
          faction,
          // x/y resolved at consumption time from settlementByRegion lookup —
          // garrisoned_army has no explicit coords. Leave null so the
          // renderer's classifier knows to snap to the settlement tile.
          x: null, y: null,
          region: settlementRegion || null,
          units: [],
          _garrisoned: true, // synthetic source flag for downstream
        };
        inGarrisonedArmy = true;
        continue;
      }
      if (inGarrisonedArmy) {
        const um = UNIT_RE.exec(t);
        if (um) {
          // Capture exp / armour / weapon_lvl from the same line.
          const exp = (t.match(/\bexp\s+(\d+)/) || [, "0"])[1] | 0;
          const armour = (t.match(/\barmour\s+(\d+)/) || [, "0"])[1] | 0;
          const weapon = (t.match(/\bweapon_lvl\s+(\d+)/) || [, "0"])[1] | 0;
          currentGarrison.units.push({ name: um[1].trim(), exp, armour, weapon });
          continue;
        }
        // Anything other than a `unit ...` line ends the garrisoned_army block.
        if (t === "building" || t.startsWith("building") || t === "{" || t === "}" ||
            /^[a-z_]+\s/.test(t)) {
          if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
          currentGarrison = null;
          inGarrisonedArmy = false;
          // Fall through so we don't lose the line — but we don't need to
          // process it specifically here.
        }
      }
    }
    const cm = CHAR_RE.exec(s);
    if (cm) {
      if (current && current.units.length) armies.push(current);
      inArmy = false;
      const rest = cm[1];
      const coord = COORD_RE.exec(rest);
      if (!coord) { current = null; prevComment = ""; continue; }
      const sx = parseInt(coord[1]), sy = parseInt(coord[2]);
      // descr_strat has two character header shapes:
      //   regular:        `character,\tName, named character, …`
      //   sub_faction:    `character,\tsub_faction athens,\tEumedes, named character, …`  (NAMED)
      //                   `character,\tsub_faction parni, named character, …`            (UNNAMED — engine names at runtime)
      // First field is either the name (regular) or `sub_faction <id>` (sub).
      // For sub_faction lines, the SECOND field is the name when it isn't a
      // type-label (named character/spy/diplomat/etc.) — Eumedes of Thurioi
      // is one of 80+ named sub_faction characters in RIS. Skipping all
      // sub_faction lines (0.9.506's original behaviour) hid them from the
      // garrison popup.
      const parts = rest.split(",").map((p) => p.trim());
      const TYPE_LABEL_RE = /^(?:named\s+character|spy|diplomat|princess|priest|merchant|assassin|admiral|captain)\b/i;
      let name;
      if (/^sub[ _]faction\b/i.test(parts[0])) {
        // sub_faction line — second field is the name unless it's a type label.
        if (parts[1] && !TYPE_LABEL_RE.test(parts[1])) {
          name = parts[1].replace(/_/g, " ");
        } else {
          console.log(`[bundle] skipped unnamed sub_faction marker at ${prevComment.trim() || `(${sx},${sy})`}`);
          current = null;
          prevComment = "";
          continue;
        }
      } else {
        name = parts[0].replace(/_/g, " ");
      }
      const [ac, snapX, snapY] = armyClass(rest, prevComment, sx, sy, getPixel);
      const loc = prevComment.startsWith(";") ? prevComment.replace(/^;/, "").trim() : "";
      // descr_strat header tags: parse `age N`, leader/heir flags, and the
      // character sub-type (named character vs spy vs diplomat...). These
      // give RegionInfo's character popup something to show in non-live
      // mode, mirroring what the save-cracker character parser surfaces.
      const ageMatch = /\bage\s+(\d+)/.exec(rest);
      const ageVal = ageMatch ? parseInt(ageMatch[1]) : null;
      const tags = [];
      if (/\bleader\b/i.test(rest)) tags.push("leader");
      if (/\bheir\b/i.test(rest)) tags.push("heir");
      if (/\bnamed character\b/i.test(rest)) tags.push("named");
      current = {
        name, charType: charType(rest), armyClass: ac, location: loc, faction,
        x: snapX,
        // descr_strat y is bottom-up (y=0 at bottom). Keep that convention
        // so the bundled JSON matches the dev-import / live-save data —
        // the renderer flips once for all of them.
        y: snapY,
        age: ageVal,
        tags,
        traits: [],
        ancillaries: [],
        units: [],
      };
      prevComment = "";
      continue;
    }
    // Capture `traits <name> <level>, <name> <level>, ...` and
    // `ancillaries <name>, <name>, ...` lines that follow the character
    // header. These appear before the `army` keyword. Both lines are
    // optional and either can be absent.
    if (current && !inArmy) {
      const tm = /^traits\s+(.+)$/i.exec(t);
      if (tm) {
        const parts = tm[1].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          const m = /^(\S+)\s+(\d+)$/.exec(p);
          if (m) current.traits.push({ name: m[1], level: parseInt(m[2]) });
          else if (p) current.traits.push({ name: p, level: 1 });
        }
        continue;
      }
      const am = /^ancillaries\s+(.+)$/i.exec(t);
      if (am) {
        const parts = am[1].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) current.ancillaries.push(p);
        continue;
      }
    }
    if (t === "army") { inArmy = true; continue; }
    if (inArmy && current) {
      const um = UNIT_RE.exec(t);
      if (um) {
        const exp = (t.match(/\bexp\s+(\d+)/) || [, "0"])[1] | 0;
        const armour = (t.match(/\barmour\s+(\d+)/) || [, "0"])[1] | 0;
        const weapon = (t.match(/\bweapon_lvl\s+(\d+)/) || [, "0"])[1] | 0;
        current.units.push({ name: um[1].trim(), exp, armour, weapon });
      }
      else if (t && !/^\s/.test(s) && s[0] !== "\t") inArmy = false;
    }
  }
  if (current && current.units.length) armies.push(current);
  if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
  return armies;
}

// ── High-level convenience for the live-refresh path ─────────────────────
// Reads the mod's descr_strat.txt, map_regions.tga, descr_regions.txt and
// descr_sm_factions/factions for a campaign, then returns the same
// { region: { garrison, field, settlement } } object the bundler writes.
//
// modDataDir   — the mod's `data` dir (the one main.js holds as activeModDataDir)
// campaignDir  — campaign folder under world/maps/campaign (e.g.
//                "imperial_campaign", "ris_classic"). Optional; falls back to
//                whichever of imperial_campaign / ris_classic exists.
//
// Returns the byRegion object on success, or null on any failure (no
// fabricated defaults — caller keeps the prior state). Async because
// parsers.js is ESM and loaded via dynamic import (the same module the
// bundler uses, so behaviour stays identical).
async function buildStartingArmiesFromMod(modDataDir, campaignDir) {
  if (!modDataDir) return null;
  const parsers = await import("./parsers.js");
  const { parseDescrRegions, parseDescrStratFactions } = parsers;

  // Resolve the campaign folder: caller-supplied, else first that exists.
  const campaignBase = path.join(modDataDir, "world", "maps", "campaign");
  const candidates = [];
  if (campaignDir) candidates.push(campaignDir);
  for (const c of ["imperial_campaign", "ris_classic"]) {
    if (!candidates.includes(c)) candidates.push(c);
  }
  let stratDir = null;
  for (const c of candidates) {
    const p = path.join(campaignBase, c, "descr_strat.txt");
    if (fs.existsSync(p)) { stratDir = path.join(campaignBase, c); break; }
  }
  if (!stratDir) return null;
  const baseDir = path.join(modDataDir, "world", "maps", "base");

  // Locate a file in the campaign dir, fall back to base dir — same resolution
  // order bundle-mod-data.js's findSource() and main.js's addgen TGA load use.
  const findSource = (name) => {
    const primary = path.join(stratDir, name);
    if (fs.existsSync(primary)) return primary;
    const fallback = path.join(baseDir, name);
    if (fs.existsSync(fallback)) return fallback;
    return null;
  };

  const stratPath = path.join(stratDir, "descr_strat.txt");
  const regionsPath = findSource("descr_regions.txt");
  const mapPath = findSource("map_regions.tga");
  if (!fs.existsSync(stratPath) || !regionsPath || !mapPath) return null;

  const stratText = fs.readFileSync(stratPath, "utf8");
  const regionsText = fs.readFileSync(regionsPath, "utf8");
  const regions = parseDescrRegions(regionsText);
  const factions = parseDescrStratFactions(stratText);
  const tgaBuf = fs.readFileSync(mapPath);
  // mapHeight derived from the TGA header (matches how the bundler reads it for
  // the classified parse; parseArmiesClassified only uses tgaBuf for pixels).
  const mapHeight = tgaBuf[14] | (tgaBuf[15] << 8);

  const armies = parseArmiesClassified(stratText, tgaBuf, mapHeight);
  return buildStartingArmiesByRegion(armies, tgaBuf, regions, factions);
}

module.exports = {
  readTga,
  isSea,
  findCityPixel,
  armyClass,
  charType,
  parseArmiesClassified,
  buildStartingArmiesByRegion,
  buildStartingArmiesFromMod,
  CHAR_RE,
  COORD_RE,
  UNIT_RE,
};
