// src/culturePenalty.js
//
// SETTLEMENT CULTURE PENALTY — the engine formula (public-order factor 12), decompiled
// 2026-10-06/10 from Rome Remastered and checked against turn-1 saves.
//
//   Shares (FUN_140cb7700, saved as one byte per faction at settlement+0x298):
//     every building adds its level's `construction` turns to its CREATOR's counter
//     (a byte, so a faction's sum wraps past 255) and to a running total W;
//     W == 0  → the settlement creator gets 100;
//     else    → each faction gets floor(counter · 60 / W), then the settlement
//               creator gets +40; every share is capped at 100.
//   Penalty (FUN_140ccd850): S = Σ shares of the factions whose CULTURE equals the
//     owner's (plus every `egyptian` faction when the owner also owns the region that
//     holds the `pyramids_and_sphinx` landmark — landmark type 1); factor = (100 − S)/10
//     → penalty % = (100 − S)/2, so at most 50%. Fractional (Neapolis S=56 → 22%).
//
//   Who is a creator (descr_strat building parser FUN_1405190e0):
//     settlement creator = `faction_creator`, else the owner;
//     building creator   = the block's `creator <faction>`, else the owner — for a rebel
//                          (slave) town the town's remapped rebel faction, which on every
//                          RIS rebel town matches its settlement creator;
//     if that faction is not in the level's static faction set (FUN_140531630: the EDB
//     `requires` read with factions{}/culture lists as sets, every other condition = all
//     factions, `not` = complement, and/or grouped from the right) the engine silently
//     takes the FIRST faction (descr_sm_factions order) that is — or the LAST faction
//     when none is (its "cannot be built by any faction" warning never fires: off-by-one).
//
// Match (2026-10-10): Four Romans turn-1 saves Claudii + Antigonid, 1,306 settlements
// each — see culturePenalty.test.js for the counts and the two known misses (Athens'
// scriptorium_sp3 and Carthage's dockyard_sp1 count as foreign-made in game, which the
// static rule above does not reproduce).
//
// The shares are a START-OF-CAMPAIGN reading: in play the engine resets the settlement
// creator to the owner when a settlement grows a level, and every building finished or
// upgraded is credited to the owner at that moment. A save carries the live value.

"use strict";
const fs = require("fs");
const path = require("path");

const PYRAMIDS_LANDMARK = "pyramids_and_sphinx";

// ---- descr_sm_factions: order + culture --------------------------------------------
function parseFactionCultures(text) {
  const order = [], cultureOf = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\t"([a-z_0-9]+)":/i);
    if (m) { cur = m[1].toLowerCase(); order.push(cur); continue; }
    const c = line.match(/^\s*"culture"\s*:\s*"(\w+)"/);
    if (c && cur && !cultureOf[cur]) cultureOf[cur] = c[1].toLowerCase();
  }
  return { order, cultureOf };
}

// ---- EDB: per level, construction turns + requires ---------------------------------
function parseEdbLevels(text) {
  const levels = {};
  let chain = null, names = [], cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const ln = raw.replace(/;.*$/, "");
    const bm = ln.match(/^building\s+(\w+)/);
    if (bm) { chain = bm[1]; names = []; cur = null; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/);
    if (lm) { names = lm[1].trim().split(/\s+/); continue; }
    const t = ln.trim().split(/\s+/);
    if (chain && names.includes(t[0]) && (t[1] === "requires" || t.length === 1)) {
      const rq = ln.match(/\brequires\s+(.*)$/);
      cur = levels[chain + ":" + t[0]] = { construction: null, req: rq ? rq[1].trim() : "" };
      continue;
    }
    const cm = ln.match(/^\s*construction\s+(\d+)/);
    if (cm && cur && cur.construction == null) cur.construction = +cm[1];
  }
  return levels;
}

// The level's static faction set, as the engine builds it at load.
function levelFactionSet(req, order, cultureOf) {
  const all = () => new Set(order);
  if (!req) return all();
  const words = req.replace(/[{},]/g, (c) => ` ${c} `).split(/\s+/).filter(Boolean);
  const terms = [], ops = [];
  let neg = false;
  for (let i = 0; i < words.length;) {
    const w = words[i];
    if (w === "and" || w === "or") { ops.push(w); i++; continue; }
    if (w === "not") { neg = !neg; i++; continue; }
    let set;
    if (w === "factions") {
      i++;
      if (words[i] === "{") i++;
      set = new Set();
      while (i < words.length && words[i] !== "}") {
        const x = words[i++].toLowerCase();
        if (x === ",") continue;
        if (x === "all") order.forEach((f) => set.add(f));
        else if (cultureOf[x] !== undefined || order.includes(x)) set.add(x);
        else order.forEach((f) => { if (cultureOf[f] === x) set.add(f); });
      }
      i++;
    } else {
      // any other condition: its own words run to the next and/or
      i++;
      while (i < words.length && words[i] !== "and" && words[i] !== "or") i++;
      set = all();
    }
    if (neg) { const c = new Set(); for (const f of order) if (!set.has(f)) c.add(f); set = c; neg = false; }
    terms.push(set);
  }
  if (!terms.length) return all();
  let acc = terms[terms.length - 1];
  for (let k = terms.length - 2; k >= 0; k--) {
    const a = terms[k];
    acc = ops[k] === "or" ? new Set([...a, ...acc]) : new Set([...a].filter((x) => acc.has(x)));
  }
  return acc;
}

// ---- descr_strat: settlements (owner, creators, buildings) + landmarks -------------
function parseStratSettlements(text) {
  const byRegion = {}, landmarks = [];
  let faction = null, s = null, b = null, depth = 0;
  for (const raw of text.split(/\r?\n/)) {
    const ln = raw.replace(/;.*$/, "");
    let m;
    if (!s) {
      if ((m = ln.match(/^\s*faction\s+(\w+)/))) { faction = m[1].toLowerCase(); continue; }
      if ((m = ln.match(/^\s*landmark\s+(\w+)\s+(\d+)\s*,\s*(\d+)/))) { landmarks.push({ type: m[1], x: +m[2], y: +m[3] }); continue; }
      if (/^\s*settlement\b/.test(ln)) { s = { owner: faction, creator: null, region: null, level: null, buildings: [] }; depth = 0; }
      continue;
    }
    for (const ch of ln) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (/^\s*building\s*$/.test(ln)) { b = { chain: null, level: null, creator: null }; s.buildings.push(b); continue; }
    if (b) {
      if ((m = ln.match(/^\s*type\s+(\w+)\s+(\S+)/))) { b.chain = m[1]; b.level = m[2]; }
      else if ((m = ln.match(/^\s*creator\s+(\w+)/))) b.creator = m[1].toLowerCase();
      if (depth <= 1 && /\}/.test(ln)) b = null;
    } else if ((m = ln.match(/^\s*region\s+(\S+)/))) s.region = m[1];
    else if ((m = ln.match(/^\s*faction_creator\s+(\w+)/))) s.creator = m[1].toLowerCase();
    else if ((m = ln.match(/^\s*level\s+(\w+)/))) s.level = m[1];
    if (depth <= 0 && /\}/.test(ln)) {
      if (s.region) byRegion[s.region] = s;
      s = null; b = null;
    }
  }
  return { byRegion, landmarks };
}

// ---- descr_regions: region → its creator faction (3rd line of the block) ----------
// Same field walk as descrStratGeneral.parseDescrRegions (comment lines skipped).
function parseRegionCreators(text) {
  const lines = text.split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    if (!name || /^[;\s]/.test(name) || !/^[A-Za-z]/.test(name)) continue;
    const fields = [];
    for (let j = i + 1; j < lines.length && fields.length < 4; j++) {
      const f = lines[j].trim();
      if (!f || f.startsWith(";")) continue;
      fields.push(f.replace(/\s*;.*$/, ""));
    }
    if (fields[0] && /^\d+\s+\d+\s+\d+/.test(fields[3] || "")) out[name.trim()] = fields[1].toLowerCase();
  }
  return out;
}

// ---- the formula -------------------------------------------------------------------
// ctx: { order, cultureOf, levels, pyramidsOwner } ; settlement: parseStratSettlements entry
function settlementCulture(settlement, ctx) {
  const { order, cultureOf, levels } = ctx;
  const N = order.length;
  const owner = settlement.owner;
  const creator = settlement.creator || owner;
  const regionCreator = ctx.regionCreator && ctx.regionCreator[settlement.region];
  const defaultBuilder = owner === "slave" ? (regionCreator || creator) : owner;
  const setCache = ctx._setCache || (ctx._setCache = {});
  const canBuild = (key) => {
    if (!setCache[key]) setCache[key] = levelFactionSet(levels[key] ? levels[key].req : "", order, cultureOf);
    return setCache[key];
  };
  const counter = {};
  const buildings = [];
  let W = 0;
  for (const b of settlement.buildings) {
    if (!b.chain || !b.level) continue;
    const key = b.chain + ":" + b.level;
    const L = levels[key];
    let by = b.creator || defaultBuilder;
    const set = canBuild(key);
    let fallback = false;
    if (!set.has(by)) {
      by = order.find((f) => set.has(f)) || order[N - 1];
      fallback = true;
    }
    const w = L && L.construction != null ? L.construction : 0;
    W += w;
    counter[by] = ((counter[by] || 0) + w) & 0xff;
    buildings.push({ chain: b.chain, level: b.level, creator: by, weight: w, fallback });
  }
  const shares = {};
  if (W === 0) shares[creator] = 100;
  else {
    for (const f of Object.keys(counter)) shares[f] = Math.floor(counter[f] * 60 / W);
    shares[creator] = (shares[creator] || 0) + 40;
  }
  for (const f of Object.keys(shares)) if (shares[f] > 100) shares[f] = 100;
  const ownCulture = cultureOf[owner];
  const egyptianCounts = !!(ctx.pyramidsOwner && ctx.pyramidsOwner === owner);
  const counts = (f) => cultureOf[f] === ownCulture || (egyptianCounts && cultureOf[f] === "egyptian");
  let S = 0;
  for (const f of Object.keys(shares)) if (counts(f)) S += shares[f];
  const pct = Math.min(50, Math.max(0, (100 - S) / 2));
  return {
    pct, S, ownCulture: ownCulture || null, creator, egyptianCounts,
    shares: Object.keys(shares).map((f) => ({ faction: f, culture: cultureOf[f] || null, pts: shares[f], same: counts(f) }))
      .sort((a, b) => b.pts - a.pts),
    buildings,
  };
}

// ---- mod-dir context (cached on the input files' mtimes) ---------------------------
function stratPathOf(modDataDir) {
  return path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
}

// Owner of the region whose map_regions.tga pixel holds the pyramids landmark.
function pyramidsOwnerFrom(landmarks, byRegion, tgaBuf, descrRegionsText) {
  const lm = landmarks.find((l) => l.type === PYRAMIDS_LANDMARK);
  if (!lm || !tgaBuf || !descrRegionsText) return null;
  const { readTga } = require("./startingArmiesBuilder.js");
  const { parseDescrRegions } = require("./descrStratGeneral.js");
  const t = readTga(tgaBuf);
  const y = (tgaBuf[17] & 0x20) ? t.h - 1 - lm.y : lm.y;
  const px = t.getPixel(lm.x, y);
  if (!px) return null;
  const region = parseDescrRegions(descrRegionsText).rgbToRegion[px.join(",")];
  return region && byRegion[region] ? byRegion[region].owner : null;
}

const _ctxCache = new Map();
function loadContext(modDataDir) {
  const files = {
    sm: path.join(modDataDir, "descr_sm_factions.txt"),
    edb: path.join(modDataDir, "export_descr_buildings.txt"),
    strat: stratPathOf(modDataDir),
    regions: path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"),
    tga: path.join(modDataDir, "world", "maps", "base", "map_regions.tga"),
  };
  const stamp = Object.values(files).map((p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }).join("|");
  const hit = _ctxCache.get(modDataDir);
  if (hit && hit.stamp === stamp) return hit.ctx;
  let ctx = null;
  try {
    const { order, cultureOf } = parseFactionCultures(fs.readFileSync(files.sm, "latin1"));
    const levels = parseEdbLevels(fs.readFileSync(files.edb, "latin1"));
    const { byRegion, landmarks } = parseStratSettlements(fs.readFileSync(files.strat, "latin1"));
    let pyramidsOwner = null, regionCreator = {};
    try {
      const regionsText = fs.readFileSync(files.regions, "latin1");
      regionCreator = parseRegionCreators(regionsText);
      pyramidsOwner = pyramidsOwnerFrom(landmarks, byRegion, fs.readFileSync(files.tga), regionsText);
    } catch { /* no descr_regions / map: no rebel builder, no pyramids rule */ }
    if (order.length) ctx = { order, cultureOf, levels, byRegion, pyramidsOwner, regionCreator };
  } catch { ctx = null; }
  _ctxCache.set(modDataDir, { stamp, ctx });
  return ctx;
}

// → settlementCulture() for one region of the mod's descr_strat, or null.
function culturePenaltyForRegion(modDataDir, region) {
  const ctx = loadContext(modDataDir);
  if (!ctx || !ctx.byRegion[region]) return null;
  return settlementCulture(ctx.byRegion[region], ctx);
}

module.exports = {
  parseFactionCultures, parseEdbLevels, levelFactionSet, parseStratSettlements, parseRegionCreators,
  settlementCulture, pyramidsOwnerFrom, loadContext, culturePenaltyForRegion, PYRAMIDS_LANDMARK,
};
