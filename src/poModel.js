// src/poModel.js
//
// STARTING PUBLIC ORDER estimate (2026-06-11) — the third pillar of the no-save balance
// harness (growth = exact; income = ±7%; PO = RISK RANKING, not exact yet).
//
// Model: linear fit on the 329-settlement turn-1 corpus, VALIDATED on 26 live Julii
// readings (holdout RMSE ≈ 19 on the marker−30 "PO%" scale, i.e. ±4 of the game's
// 5-point steps). Revolt-risk recall on the live set: 3/3 (Neapolis 75, Paestum 80,
// Thurii 90 — all flagged), with occasional over-flagging (Metapontum). USE AS A
// GARRISON-PRIORITY RANKING; the exact per-line crack needs in-game PO-tooltip
// readouts (pending). Tax→PO deltas are the controlled Gades values (validated).
//
// PO(bracket) = 5.96·Σhappiness + 3.33·Σlaw + 272.2·min(1.5, garrison/pop)
//             − 0.59·squalorPts(eff/1500) − 46.6·religionMismatch − 0.088·distToCapital
//             + 17.4·homeland + 38.1·capital + 150.9 + TAX_ORDER_DELTA[bracket]

"use strict";
const fs = require("fs");
const path = require("path");
const gv = require("./growthEval.js");

const TAX_ORDER_DELTA = { low: 0, normal: -30, high: -50, very_high: -70 };
const COEF = { H: 5.96, L: 3.33, gar: 272.2, sq: -0.59, relMis: -46.6, dist: -0.088, homeland: 17.4, capital: 38.1, c: 150.9 };
const SQ_BASE = { village: 400, town: 400, large_town: 2000, city: 4000, large_city: 9000, huge_city: 14000 };

// happiness/law EDB pass (cached per mod dir)
const _edbCache = {};
function parseEDBHappy(modDataDir) {
  if (_edbCache[modDataDir]) return _edbCache[modDataDir];
  const lines = fs.readFileSync(path.join(modDataDir, "export_descr_buildings.txt"), "latin1").split(/\r?\n/);
  const capIndex = {}, chainLevels = {}, aliases = {};
  let cb = null, ll = [], cl = null, ca = null;
  const add = (k, o) => { if (!cb || !cl) return; const key = cb + ":" + cl; (capIndex[key] = capIndex[key] || { happy: [], law: [] })[k].push(o); };
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const am = ln.match(/^alias\s+(\S+)/); if (am) { ca = am[1]; continue; }
    if (ca) { const rq = ln.match(/^\s*requires\s+(.+)/); if (rq) { aliases[ca] = rq[1].trim(); ca = null; } else if (/^\s*\}/.test(ln)) ca = null; continue; }
    const bm = ln.match(/^building\s+(\w+)/); if (bm) { cb = bm[1]; ll = []; cl = null; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/); if (lm) { ll = lm[1].trim().split(/\s+/).filter(w => w && w !== "{"); chainLevels[cb] = ll.slice(); continue; }
    const tok = ln.trim().split(/\s+/);
    if (ll.length && tok[0] && ll.includes(tok[0]) && (tok[1] === "requires" || tok[1] === undefined || tok[1] === "{")) { cl = tok[0]; continue; }
    let m;
    if ((m = ln.match(/^\s*happiness_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("happy", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*law_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("law", { val: +m[1], req: (m[2] || "").trim() }); continue; }
  }
  return (_edbCache[modDataDir] = { capIndex, chainLevels, aliases });
}

// garrison soldiers per tile from descr_strat (cached)
const _garCache = {};
function garrisonByTile(modDataDir) {
  if (_garCache[modDataDir]) return _garCache[modDataDir];
  const out = {};
  try {
    const us = require("./recruitPool.js").parseUnitStats(modDataDir);
    const DS = fs.readFileSync(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "latin1").split(/\r?\n/);
    let pend = null;
    for (const raw of DS) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")).trim() : raw.trim();
      if (!t) continue;
      const cm = t.match(/^character[,\s].*?\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
      if (cm) { pend = cm[1] + "," + cm[2]; continue; }
      if (/^character_record|^faction\s/i.test(t)) { pend = null; continue; }
      const um = t.match(/^unit\s+(.+?)\s+exp\b/);
      if (um && pend) { const st = us[um[1].trim().toLowerCase()]; out[pend] = (out[pend] || 0) + (st && st.soldiers ? st.soldiers : 40); }
    }
  } catch { /* no garrison data */ }
  return (_garCache[modDataDir] = out);
}

const _coordCache = {};
function regionCoords(modDataDir) {
  if (_coordCache[modDataDir]) return _coordCache[modDataDir];
  let coords = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    coords = dg.buildRegionCoords(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga")), rgbToRegion);
  } catch { /* none */ }
  return (_coordCache[modDataDir] = coords);
}

const relsOf = (hidden) => [...hidden].map(h => { const m = String(h).match(/^rel_([a-z_]+)_(\d)$/); return m ? { rel: m[1], lvl: +m[2] } : null; }).filter(Boolean);

// → { [settlementName]: { poAt: {low,normal,high,very_high}, features } }
function computeStartingPO(modDataDir, faction) {
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(stratPath)) return {};
  const { byRegion } = gv.parseRegions(modDataDir);
  const resourcesByRegion = gv.parseResources(stratPath);
  const fg = gv.parseFactionGroups(modDataDir);
  const strat = gv.parseStrat(stratPath);
  const edb = parseEDBHappy(modDataDir);
  const coords = regionCoords(modDataDir);
  const gByTile = garrisonByTile(modDataDir);
  const want = String(faction || "").toLowerCase();
  const fset = strat[want];
  if (!fset) return {};
  const toks = gv.factionTokenSet(want, fg);
  // faction religion = dominant rel_* of the capital region
  let facRel = null;
  { const r0 = byRegion[fset.settlements[0] && fset.settlements[0].region];
    if (r0) { const rels = relsOf(r0.hidden); rels.sort((a, b) => b.lvl - a.lvl); if (rels[0]) facRel = rels[0].rel; } }
  const cap0 = fset.settlements[0] && coords[fset.settlements[0].region];
  const out = {};
  for (const sd of fset.settlements) {
    const region = byRegion[sd.region]; if (!region) continue;
    const buildings = new Map();
    for (const b of sd.buildings) { const o = edb.chainLevels[b.chain] || null; const i = o ? o.indexOf(b.level) : 0; buildings.set(b.chain, i < 0 ? 0 : i); }
    const ctx = { hidden: region.hidden || new Set(), buildings, chainLevels: edb.chainLevels, aliases: edb.aliases, capital: sd.capital, faction: want, factionTokens: toks, homeland: [...(region.hidden || [])].some(h => String(h).startsWith("homeland")), sizeTier: 1, resources: resourcesByRegion[sd.region] || new Set() };
    let H = 0, L = 0;
    for (const b of sd.buildings) {
      const cap = edb.capIndex[b.chain + ":" + b.level]; if (!cap) continue;
      for (const x of cap.happy) if (gv.evalReq(x.req, ctx)) H += x.val;
      for (const x of cap.law) if (gv.evalReq(x.req, ctx)) L += x.val;
    }
    const rels = relsOf(region.hidden || new Set());
    const tot = rels.reduce((a, r) => a + r.lvl, 0) || 1;
    const ownR = rels.filter(r => r.rel === facRel).reduce((a, r) => a + r.lvl, 0);
    const eff = sd.pop + Math.max(0, sd.pop - 2 * (SQ_BASE[sd.level] != null ? SQ_BASE[sd.level] : 2000));
    const sq = Math.floor(eff / 1500);
    const c = coords[sd.region];
    const base = COEF.H * H + COEF.L * L
      + COEF.gar * (c ? Math.min(1.5, (gByTile[c.x + "," + c.y] || 0) / Math.max(1, sd.pop)) : 0)
      + COEF.sq * sq + COEF.relMis * (1 - ownR / tot)
      + COEF.dist * ((c && cap0) ? Math.hypot(c.x - cap0.x, c.y - cap0.y) : 0)
      + COEF.homeland * (ctx.homeland ? 1 : 0) + COEF.capital * (sd.capital ? 1 : 0) + COEF.c;
    const poAt = {};
    for (const b of Object.keys(TAX_ORDER_DELTA)) poAt[b] = Math.round((base + TAX_ORDER_DELTA[b]) / 5) * 5;
    out[region.settlement] = { poAt };
  }
  return out;
}

module.exports = { computeStartingPO, TAX_ORDER_DELTA };
