// src/poModel.js
//
// STARTING PUBLIC ORDER — EXACT COMPONENT MODEL (cracked 2026-06-12, task #10).
// Reproduces the in-game Settlement-Details panel row by row. Calibrated on the
// julii 26-town details corpus (jcrops/julii/po-corpus.tsv, screenshots
// 20260611231429-231448, same campaign as save_Julii1.sav whose settlement
// orderBreakdown[] cross-checks garrison/squalor/distance/culture pts 26/26) and
// validated out-of-sample on the egypt 80-town panel set (jcrops/egypt/all.tsv):
// garrison 74/86 exact, distance 81/86, squalor 85/86 (!), law 80/86 ±1pt.
//
// PANEL LAWS (all rows in 5% points):
//   base       = 100%
//   garrison   = 5·min(16, floor(70·men/pop)) — men = Σ EDU `soldiers`×4 (HUGE size,
//                no officers, generals = 6×4) for units stationed on the city tile.
//                80% display cap = 16 pts. (julii 25/26 exact, K interval [68.6,69.15)
//                with officers — without officers K=70 fits 25/26 with margin.)
//   law        = 5·(EDB law_bonus [walls/garrison-chain `is_toggled` lines count in
//                peace, terrain hinterland lines count] + governor trait Law with
//                LoyaltyLevel AND STRating excluded, L1-floor at any pts ≥ 1).
//                julii 23/26 exact (misses ±1pt = trait-points parse noise).
//   happiness  = 5·Σ EDB happiness_bonus with FULL predicate evaluation:
//                majority_religion X (region's max rel_X_N hidden resource),
//                faction_religion_X / faction_religion_group_X (descr_sm_factions
//                "default religion"), empire-size tier (exactly one sizeN active).
//                julii 26/26 EXACT — including Rome +20 (capital size5 −8 line) and
//                Paestum −70 (governmentC −8 "majority_religion dorian and not
//                faction_religion_dorian" unrest + colony −4).
//   gov infl.  = 5·influence stat (save card stat when available: 24/26 exact;
//                no-save fallback = trait Influence sum, ±1).
//   health     = 5·(EDB population_health_bonus pips + governor trait Health). 26/26.
//   squalor    = −5·max(0, floor((pop + max(0, pop − squalourPop[level]))/2300)
//                + governor trait Squalor) — descr_cultures "squalor rate" 2300,
//                each pop above the level's "squalour pop" counts DOUBLE.
//                egypt 85/86 exact, julii 21/26 (±1 = gov trait noise).
//   distance   = −5·floor(max(0, d_eu − 10)·0.2/5) — euclidean px to the capital,
//                descr_cultures "capital distance multiplier" 0.2 (all cultures).
//                egypt-verified to d=339 (Berenike −65); julii 25/26.
//   culture    = −20 when the region's majority religion ≠ faction religion AND no
//                colony level ≥ 2 (Paestum: dorian majority but colony_2 → exempt);
//                + leader-culture-differs −10 (same condition — the faction leader
//                always carries the faction culture). The −5 "governor's culture
//                differs" row is NOT modeled (needs per-character culture; ±5pp on
//                2-3 towns either way).
//   tax        = bracket delta on the total, relative to low: 0/−30/−50/−70
//                (live-verified Croton/Sena full sweeps 2026-06-11).
//
// Display behavior: the game caps the shown % at 200 (Rome stores 240, shows 200).

"use strict";
const fs = require("fs");
const path = require("path");
const gv = require("./growthEval.js");
const im = require("./incomeModel.js");
const te = require("./traitEffects.js");
const dg = require("./descrStratGeneral.js");
const rp = require("./recruitPool.js");

const TAX_ORDER_DELTA = { low: 0, normal: -30, high: -50, very_high: -70 };
// pop above the level's "squalour pop" counts double (descr_cultures, all cultures share
// one table in RIS; read from the roman block — per-culture variation would go here).
const SQUALOUR_POP = { village: 1800, town: 6000, large_town: 9000, city: 17000, large_city: 28000, huge_city: 40000 };
const SQUALOR_RATE = 2300;          // pops per squalor point (descr_cultures "squalor rate")
const DIST_MULT = 0.2;              // descr_cultures "capital distance multiplier"
const GARRISON_K = 70;              // pts = floor(K · men/pop), 16-pt (80%) cap
const GARRISON_CAP_PTS = 16;
const SIZE_MULT = 4;                // HUGE unit size (user setting) — men = soldiers×4

// ---- EDB happiness pass (cached per mod dir) ----
const _edbCache = {};
function parseEDBHappy(modDataDir) {
  if (_edbCache[modDataDir]) return _edbCache[modDataDir];
  const lines = fs.readFileSync(path.join(modDataDir, "export_descr_buildings.txt"), "latin1").split(/\r?\n/);
  const capIndex = {}, chainLevels = {}, aliases = {};
  let cb = null, ll = [], cl = null, ca = null;
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const am = ln.match(/^alias\s+(\S+)/); if (am) { ca = am[1]; continue; }
    if (ca) { const rq = ln.match(/^\s*requires\s+(.+)/); if (rq) { aliases[ca] = rq[1].trim(); ca = null; } else if (/^\s*\}/.test(ln)) ca = null; continue; }
    const bm = ln.match(/^building\s+(\w+)/); if (bm) { cb = bm[1]; ll = []; cl = null; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/); if (lm) { ll = lm[1].trim().split(/\s+/).filter(w => w && w !== "{"); chainLevels[cb] = ll.slice(); continue; }
    const tok = ln.trim().split(/\s+/);
    if (ll.length && tok[0] && ll.includes(tok[0]) && (tok[1] === "requires" || tok[1] === undefined || tok[1] === "{")) { cl = tok[0]; continue; }
    let m;
    if ((m = ln.match(/^\s*happiness_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) {
      if (cb && cl) ((capIndex[cb + ":" + cl] = capIndex[cb + ":" + cl] || []).push({ val: +m[1], req: (m[2] || "").trim() }));
      continue;
    }
  }
  return (_edbCache[modDataDir] = { capIndex, chainLevels, aliases });
}

// ---- faction → default religion (descr_sm_factions, cached) ----
const _relCache = {};
function factionReligions(modDataDir) {
  if (_relCache[modDataDir]) return _relCache[modDataDir];
  const out = {};
  try {
    const lines = fs.readFileSync(path.join(modDataDir, "descr_sm_factions.txt"), "latin1").split(/\r?\n/);
    let cur = null;
    for (const raw of lines) {
      const fm = raw.match(/^\t"(\w+)":/); if (fm) { cur = fm[1]; continue; }
      const rm = raw.match(/"default religion":\s*"(\w+)"/); if (rm && cur) out[cur] = rm[1];
    }
  } catch { /* none */ }
  return (_relCache[modDataDir] = out);
}

// ---- garrison soldiers (EDU base men) per city tile from descr_strat (cached) ----
const _garCache = {};
function garrisonMenByTile(modDataDir) {
  if (_garCache[modDataDir]) return _garCache[modDataDir];
  const out = {};
  try {
    const us = rp.parseUnitStats(modDataDir);
    const DS = fs.readFileSync(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "latin1").split(/\r?\n/);
    let pend = null;
    for (const raw of DS) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")).trim() : raw.trim();
      if (!t) continue;
      const cm = t.match(/^character[,\s].*?\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
      if (cm) { pend = cm[1] + "," + cm[2]; continue; }
      if (/^character_record|^faction\s/i.test(t)) { pend = null; continue; }
      const um = t.match(/^unit\s+(.+?)\s+exp\b/);
      if (um && pend) {
        const st = us[um[1].trim().toLowerCase()];
        out[pend] = (out[pend] || 0) + (st && st.soldiers ? st.soldiers : 40) * SIZE_MULT;
      }
    }
  } catch { /* no garrison data */ }
  return (_garCache[modDataDir] = out);
}

const _coordCache = {};
function regionCoords(modDataDir) {
  if (_coordCache[modDataDir]) return _coordCache[modDataDir];
  let coords = {};
  try {
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    coords = dg.buildRegionCoords(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga")), rgbToRegion);
  } catch { /* none */ }
  return (_coordCache[modDataDir] = coords);
}

function majorityRel(region) {
  let best = null, bestL = -1;
  for (const h of (region && region.hidden) || []) {
    const m = String(h).match(/^rel_([a-z_]+)_(\d)$/);
    if (m && +m[2] > bestL) { bestL = +m[2]; best = m[1]; }
  }
  return best;
}

// extended predicate evaluation: rewrite majority_religion / faction_religion_* /
// indirect_govs into atoms gv.evalReq understands (factionwide=true, unknown=false).
function prepReq(req, maj, facRel) {
  if (!req) return req;
  return req
    .replace(/majority_religion\s+(\w+)/g, (m, r) => (maj === r ? "factionwide" : "po_unknown_false"))
    .replace(/faction_religion_group_(\w+)/g, "po_unknown_false") // group tables unused by current factions' lines
    .replace(/faction_religion_(\w+)/g, (m, r) => (r === facRel ? "factionwide" : "po_unknown_false"))
    .replace(/indirect_govs/g, "po_unknown_false");
}

// governor trait Law for the PO panel row: LoyaltyLevel AND STRating excluded,
// L1 floor at any pts ≥ 1 (cyrene card rule). Recomputed from `hits` (Name/pts).
function govLawPO(g, fx) {
  if (!g || !Array.isArray(g.hits)) return 0;
  let law = 0;
  for (const h of g.hits) {
    if (h.startsWith("anc:")) continue;
    const i = h.lastIndexOf("/");
    const name = h.slice(0, i), pts = +h.slice(i + 1);
    if (name === "LoyaltyLevel" || name === "STRating") continue;
    const levels = fx[name]; if (!levels || !levels.length) continue;
    let chosen = null;
    for (const L of levels) if (pts >= L.threshold) chosen = L;
    if (!chosen && pts >= 1) chosen = levels[0];
    if (chosen && chosen.Law) law += chosen.Law;
  }
  return law;
}

// → { [settlementName]: { poAt: {low,normal,high,very_high}, rows } }
function computeStartingPO(modDataDir, faction, opts = {}) {
  const feats = im.computeIncomeFeatures(modDataDir, faction);
  if (!feats || !feats.settlements || !feats.settlements.length) return {};
  const want = String(faction || "").toLowerCase();
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  const { byRegion } = gv.parseRegions(modDataDir);
  const resourcesByRegion = gv.parseResources(stratPath);
  const fg = gv.parseFactionGroups(modDataDir);
  const toks = gv.factionTokenSet(want, fg);
  const edb = parseEDBHappy(modDataDir);
  const coords = regionCoords(modDataDir);
  const menByTile = garrisonMenByTile(modDataDir);
  const facRel = factionReligions(modDataDir)[want] || null;
  const fx = te.parseTraitEffects(modDataDir);
  const govByCity = opts.govEffectByCity || te.govEffectByCityFromStrat(modDataDir, fx) || {};
  const capRegion = feats.settlements[0].region; // first settlement = capital (strat order)
  let capC = null;
  for (const s of feats.settlements) if (s.capital) { capC = coords[s.region]; break; }
  if (!capC) capC = coords[capRegion];

  const out = {};
  for (const s of feats.settlements) {
    const region = byRegion[s.region]; if (!region) continue;
    const g = govByCity[s.settlement] || govByCity[s.settlement.replace(/_/g, " ")] || null;
    const c = coords[s.region];
    // garrison
    const men = c ? (menByTile[c.x + "," + c.y] || 0) : 0;
    const gar = Math.min(GARRISON_CAP_PTS, Math.floor(GARRISON_K * men / Math.max(1, s.pop)));
    // law
    const law = (s.lawBonus || 0) + govLawPO(g, fx);
    // happiness (EDB extended predicates)
    const buildings = new Map();
    for (const b of s.buildings) { const [ch, lv] = b.split(":"); const o = edb.chainLevels[ch] || null; const i = o ? o.indexOf(lv) : 0; buildings.set(ch, i < 0 ? 0 : i); }
    const ctx = {
      hidden: region.hidden || new Set(), buildings, chainLevels: edb.chainLevels, aliases: edb.aliases,
      capital: s.capital, faction: want, factionTokens: toks,
      homeland: [...(region.hidden || [])].some(h => String(h).startsWith("homeland")),
      sizeTier: 1, empireTier: feats.tier, resources: resourcesByRegion[s.region] || new Set(), isPlayer: opts.isPlayer !== false,
    };
    const maj = majorityRel(region);
    let hap = 0;
    for (const b of s.buildings) {
      const cap = edb.capIndex[b]; if (!cap) continue;
      for (const x of cap) if (gv.evalReq(prepReq(x.req, maj, facRel), ctx)) hap += x.val;
    }
    // governor influence (save card stat when present, trait sum fallback)
    const infl = g ? (g.influenceStat != null ? g.influenceStat : (g.influence || 0)) : 0;
    // health
    const health = (s.healthPips || 0) + (g ? (g.health || 0) : 0);
    // squalor (pop above the level's squalour-pop counts double) + gov traits
    const sqPop = SQUALOUR_POP[s.level] != null ? SQUALOUR_POP[s.level] : 6000;
    const sq = Math.max(0, Math.floor((s.pop + Math.max(0, s.pop - sqPop)) / SQUALOR_RATE) + (g ? (g.squalor || 0) : 0));
    // distance to capital
    const d = (c && capC) ? Math.hypot(c.x - capC.x, c.y - capC.y) : 0;
    const dist = Math.floor(Math.max(0, d - 10) * DIST_MULT / 5);
    // culture penalty, unless colony ≥ 2 converted the settlement: settlement-culture −22
    // + faction-leader-culture-differs −10 + governor-culture-differs −5 = 37. (Cracked exact from
    // the Neapolis in-game PO scroll 2026-07-01: −22 −10 −5 = −37 → PO 88.) The −22 settlement term
    // is a FLAT approximation — it truly varies with the foreign-culture conversion %; the −5/−10
    // are fixed RTW penalties that always apply here because the deterministic governor + faction
    // leader carry the owner faction's culture, which differs from a foreign settlement's official.
    let colonyLvl = 0;
    for (const b of s.buildings) { const m = b.match(/^colony:.*?(\d+)?$/); if (m) colonyLvl = m[1] ? +m[1] : 1; }
    const foreign = !!(maj && facRel && maj !== facRel && colonyLvl < 2);
    const cultPen = foreign ? 37 : 0;  // 22 settlement-culture + 10 leader-differs + 5 governor-differs (Neapolis scroll 2026-07-01)
    const poNormal = 100 + 5 * (gar + law + hap + infl + health - sq - dist) - cultPen;
    const poAt = {};
    for (const b of Object.keys(TAX_ORDER_DELTA)) {
      const v = poNormal + (TAX_ORDER_DELTA[b] - TAX_ORDER_DELTA.normal);
      poAt[b] = Math.max(0, Math.min(200, Math.round(v)));  // integer, NOT 5-snapped — culture penalties make PO non-5 (Neapolis 88)
    }
    out[region.settlement] = {
      poAt,
      rows: { base: 100, garrison: 5 * gar, law: 5 * law, happiness: 5 * hap, govInfluence: 5 * infl, health: 5 * health, squalor: -5 * sq, distance: -5 * dist, culture: -cultPen, men, pop: s.pop },
    };
  }
  return out;
}

module.exports = { computeStartingPO, TAX_ORDER_DELTA, GARRISON_K, GARRISON_CAP_PTS };
