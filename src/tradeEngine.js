// tradeEngine.js — every settlement's trade income exactly as RTW Remastered computes it.
//
// Rules are the engine's own (land: per-region-frontier routes; sea: greedy trade-fleet selection over the
// landing-frontier list; imports; Colossus), checked against the running game for every settlement on the
// RIS map (2026-10-01). The campaign STATE comes either from descr_strat (a new campaign, turn 1) or from a
// save (owners, population, buildings, capitals, governors, diplomacy, empire-size events, roads, armies).
//
//   computeTrade(modDataDir, state) -> { [region]: { region, settlement, faction, land: [{ to, value }],
//                                        fleets: [{ to, export }], imports: [{ from, value }], wonder,
//                                        landTotal, seaTotal, total } }
//   stateFromStrat(modDataDir, playerFaction)
//   stateFromSave(modDataDir, savePath)
"use strict";
const fs = require("fs");
const path = require("path");

const F = Math.fround;
const C013 = F(0.13), C033 = F(0.33), C01 = F(0.1), C8 = F(8), C05 = F(0.5), C066 = F(0.66), C100 = F(100), C02 = F(0.2);
function fastSqrt(x) { const b = new ArrayBuffer(4), f = new Float32Array(b), i = new Int32Array(b); f[0] = x; i[0] = (((i[0] - 0x3f800000) | 0) >> 1) + 0x3f800000; return f[0]; }
const ceilInt = (v) => Math.round(Math.ceil(v)); // rint(ceilf(v))

// empire_sizeN thresholds (RIS major_event_scripts/sizeN_true.txt): settlement count -> tier
function tierOfCount(n) { return n < 2 ? 1 : n < 5 ? 2 : n < 9 ? 3 : n < 16 ? 4 : n < 30 ? 5 : n < 51 ? 6 : n < 101 ? 7 : n < 201 ? 8 : n < 401 ? 9 : 10; }
const COUNT_OF_TIER = { 1: 1, 2: 2, 3: 5, 4: 9, 5: 16, 6: 30, 7: 51, 8: 101, 9: 201, 10: 401 };

// ---------------------------------------------------------------- static map data (per mod dir)
const _mapCache = {};
function mapData(modDataDir) {
  if (_mapCache[modDataDir]) return _mapCache[modDataDir];
  const dg = require("./descrStratGeneral.js");
  const im = require("./incomeModel.js");
  const base = path.join(modDataDir, "world", "maps", "base");
  const regTxt = fs.readFileSync(path.join(base, "descr_regions.txt"), "latin1");
  const { rgbToRegion } = dg.parseDescrRegions(regTxt);
  // stored region index <-> name (the index frontiers and saves use)
  const names = [...new Set(Object.values(rgbToRegion))];
  const b = fs.readFileSync(path.join(base, "map.rwm"));
  const v7b = b[0] >= 0x7b;
  const nameOfIdx = {}, idxOfName = {}, settlementOf = {}, bodyOf = {};
  for (const nm of names) {
    const pat = Buffer.from(nm + "\x00", "latin1");
    let i = b.indexOf(pat, 0);
    while (i >= 0) {
      if (i >= 2 && b.readUInt16LE(i - 2) === nm.length + 1 && b.readUInt16LE(i + nm.length + 1) === 0) {
        const sl = b.readUInt16LE(i + nm.length + 3);
        if (sl > 1 && sl < 48) {
          settlementOf[nm] = b.toString("latin1", i + nm.length + 5, i + nm.length + 4 + sl);
          let p = i + nm.length + 5 + sl; const cl = b.readUInt16LE(p); p += 2 + cl; bodyOf[nm] = p;
          const idx = b.readUInt32LE(p + (v7b ? 4 : 0));
          nameOfIdx[idx] = nm; idxOfName[nm] = idx;
          break;
        }
      }
      i = b.indexOf(pat, i + 1);
    }
  }
  // port sites: regions with base_port_level_N (the white map_regions pixel) get a PORT object
  const portSite = new Set(); let cur = null;
  for (const line of regTxt.split(/\r?\n/)) {
    if (/^\S/.test(line)) cur = line.trim();
    else if (cur && /base_port_level_\d/.test(line)) portSite.add(cur);
  }
  // goods per region incl. slaves: { region: { name: { qty, value } } }
  const tga = dg.tgaToRaw(fs.readFileSync(path.join(base, "map_regions.tga")));
  const bottomLeft = (tga.desc & 0x20) === 0;
  const pix = (x, yGame) => { const rowTop = tga.H - 1 - yGame; const r = bottomLeft ? (tga.H - 1 - rowTop) : rowTop; return r * tga.W + x; };
  const regionAtPix = (o) => rgbToRegion[tga.raw[o * 3 + 2] + "," + tga.raw[o * 3 + 1] + "," + tga.raw[o * 3]];
  const regionAt = (x, y) => {
    if (x < 0 || y < 0 || x >= tga.W || y >= tga.H) return null;
    const o = pix(x, y); let r = regionAtPix(o); if (r) return r;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { r = regionAtPix(o + dy * tga.W + dx); if (r) return r; }
    return null;
  };
  const resVal = im.parseResourceValues(modDataDir);
  const goods = {};
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  let disabled = false;
  for (const raw of fs.readFileSync(stratPath, "latin1").split(/\r?\n/)) {
    const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
    if (/resource_quantity_disabled/.test(t)) { disabled = true; continue; }
    if (disabled) continue;
    const m = t.match(/^\s*resource\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) continue;
    const name = m[1].toLowerCase(); const e = resVal[name];
    if (!e || e.hidden) continue;
    const reg = regionAt(+m[3], +m[4]); if (!reg) continue;
    const g = (goods[reg] = goods[reg] || {});
    g[name] = { qty: ((g[name] && g[name].qty) || 0) + (+m[2]), value: e.tradeValue || 0 };
  }
  const wonders = im.wonderOwners(modDataDir);          // { colossus: { region } ... }
  // every landing frontier incl. sailing distance -1: an import is booked on the PARTNER's entry that points
  // back at the exporter (FUN_1414a57f0), whatever its distance; no back entry, no import row
  // per region, straight from map.rwm: land frontiers [{ region, type }] (type 0 = land), landing frontiers in
  // file order [{ region, dist }] (sailing distance > 0 only: the fleet candidates), and every landing target
  const landingBack = {}, frontiers = {}, landing = {};
  for (const nm in idxOfName) {
    const bodyP = bodyOf[nm];
    if (bodyP == null) continue;
    let p = bodyP + (v7b ? 8 : 4);
    const tA = b.readUInt32LE(p); p += 4 + tA * 4; const tB = b.readUInt32LE(p); p += 4 + tB * 4;
    const fc = b.readUInt32LE(p); p += 4;
    const fl = [];
    for (let k = 0; k < fc; k++) {
      const ridx = b.readUInt32LE(p), type = b[p + 8]; p += 17;
      for (let a = 0; a < 5; a++) { const c = b.readUInt32LE(p); p += 4 + c * 4; }
      if (nameOfIdx[ridx]) fl.push({ region: nameOfIdx[ridx], type });
    }
    frontiers[nm] = fl;
    const lc = b.readUInt32LE(p); p += 4; const set = new Set();
    const ll = [];
    if (lc <= 400) for (let k = 0; k < lc; k++) {
      const ridx = b.readUInt32LE(p), dNav = b.readFloatLE(p + 8); p += 20; const tc = b.readUInt32LE(p); p += 4 + tc * 8;
      const rn = nameOfIdx[ridx]; if (!rn) continue; set.add(rn); if (dNav > 0) ll.push({ region: rn, dist: dNav });
    }
    landingBack[nm] = set; landing[nm] = ll;
  }
  return (_mapCache[modDataDir] = { nameOfIdx, idxOfName, settlementOf, portSite, goods, frontiers, landing, landingBack, wonders, regionAt });
}

// ---------------------------------------------------------------- capabilities (EDB, per owning faction)
function capabilities(modDataDir, state) {
  const im = require("./incomeModel.js");
  const caps = {};
  const facs = new Set(Object.values(state.owner));
  for (const f of facs) {
    if (!f) continue;
    const tier = state.sizeTier ? state.sizeTier[f] : null;
    const opts = {
      isPlayer: f === state.playerFaction, ownerOf: state.owner,
      capitalRegion: state.capital ? (state.capital[f] || undefined) : undefined,
      buildingsByRegion: state.buildings || undefined,
    };
    if (tier === 0) opts.noSizeEvents = true; else if (tier != null) opts.sizeCount = COUNT_OF_TIER[tier];
    let FT; try { FT = im.computeIncomeFeatures(modDataDir, f, opts); } catch { continue; }
    if (!FT || FT.error) continue;
    for (const s of FT.settlements) {
      caps[s.region] = {
        tradeBase: s.tradePct || 0,                       // trade_base_income_bonus (effective)
        tradeLevel: s.tradeLvlSum || 0,                   // trade_level_bonus
        fleets: Math.max(0, s.fleetLevel || 0),          // trade_fleet
        roadCap: Math.max(0, (s.roadLevel || 0) - 1),    // road_level capability (roads 0, paved 1, highways 2)
        roadByte: s.roadLevel || 0,                      // region road byte (none 0, roads 1, paved 2, highways 3)
        hasPortBuilding: (s.buildings || []).some(x => /^port_buildings:/.test(x)),
      };
    }
  }
  return caps;
}

// ---------------------------------------------------------------- the engine
function computeTrade(modDataDir, state) {
  const M = mapData(modDataDir);
  const caps = state.caps || capabilities(modDataDir, state);
  const own = state.owner;
  const dip = (a, b) => (state.diplo && state.diplo(a, b)) || {};
  const settled = (r) => !!own[r] && state.pop[r] > 0 && !(state.removed && state.removed.has(r));
  const gov = (r) => (state.govTrading && state.govTrading[r]) || 0;
  const pct = (r) => 10 * ((caps[r] || {}).tradeBase || 0) + gov(r);
  const goodsOf = (r) => M.goods[r] || {};
  const isActive = (r, name) => name !== "slaves" || !!(state.activeSlaves && state.activeSlaves.has(r));

  // LAND basket: 2·(our goods they lack) + (their goods we lack); shared types cancel on both sides
  function landBasket(a, b) {
    const ga = goodsOf(a), gb = goodsOf(b); const loc = {}, flag = {};
    for (const n in ga) loc[n] = (loc[n] || 0) + Math.round(2 * ((ga[n].qty * ga[n].value) << 16 >> 16));
    for (const n in gb) { const v = (gb[n].qty * gb[n].value) << 16 >> 16; if (!flag[n]) { loc[n] = loc[n] >= 1 ? -1 : v; flag[n] = 1; } else if (loc[n] >= 0) loc[n] += v; }
    let s = 0; for (const n in loc) if (loc[n] > 0) s += loc[n]; return s;
  }
  function landRoute(a, b) {
    if (!settled(b) || (state.besieged && state.besieged.has(b))) return 0;
    const fa = own[a], fb = own[b];
    if (fa !== fb && dip(fa, fb).embargo) return 0;
    let v = F(F(F(fastSqrt(state.pop[a] + state.pop[b]) * C013) + 0) + landBasket(a, b));
    if (fa !== fb) { const d = dip(fa, fb); if (d.war) v = 0; else if (!d.rights) v = F(v * C033); }
    const ca = caps[a] || {}, cb = caps[b] || {};
    const hasRoad = (ca.roadByte || 0) >= 1 && state.roadLink && state.roadLink(a, b) && !(state.roadBlocked && state.roadBlocked(a, b));
    const road = hasRoad ? Math.min(cb.roadByte || 0, ca.roadCap || 0) : 0;
    const mult = Math.max(0, (ca.tradeLevel || 0) + 1 + road);
    const row = Math.trunc(F(mult * v));
    return Math.max(0, Math.trunc(((100 + pct(a)) * row) / 100));
  }
  // SEA value of a fleet a -> b over sailing distance d
  function seaValue(a, b, d) {
    const fa = own[a], fb = own[b];
    if (fa !== fb && dip(fa, fb).embargo) return 0;
    let v = F(fastSqrt(state.pop[a] + state.pop[b]) * C01);
    const ga = goodsOf(a), gb = goodsOf(b);
    for (const n in ga) {
      const excluded = gb[n] && isActive(b, n) && gb[n].value !== 0;
      if (!excluded) v = F(v + ((ga[n].qty * ga[n].value) << 16 >> 16));
    }
    v = F(v * C8);
    if (fa !== fb) { const dd = dip(fa, fb); if (dd.war) v = 0; else if (!dd.rights) v = F(v * C05); }
    if (state.hostileIn && state.hostileIn(a)) v = F(v * C066);
    if (M.portSite.has(b)) {
      if (state.portBlockaded && state.portBlockaded(b)) v = 0;
      else if (!(caps[b] || {}).hasPortBuilding) v = F(v * C033);
    }
    v = F(v * C100); v = F(v / F(d));
    v = F(v * F(F(100 + pct(a)) / C100));
    return v;
  }

  const out = {};
  for (const a in own) {
    if (!settled(a)) continue;
    out[a] = { region: a, settlement: M.settlementOf[a], faction: own[a], land: [], fleets: [], imports: [], wonder: 0, landTotal: 0, seaTotal: 0, total: 0 };
  }
  // land
  for (const a in out) {
    if (state.besieged && state.besieged.has(a)) continue;
    for (const e of (M.frontiers[a] || [])) {
      if (e.type !== 0 || !settled(e.region)) continue;
      const v = landRoute(a, e.region);
      out[a].land.push({ to: e.region, toSettlement: M.settlementOf[e.region], value: v }); out[a].landTotal += v;
    }
  }
  // sea: each port with a dock fills its trade_fleet slots greedily by value
  const importsTo = {};
  for (const a in out) {
    if (state.besieged && state.besieged.has(a)) continue;
    const ca = caps[a] || {};
    if (!M.portSite.has(a) || !ca.hasPortBuilding || (state.portBlockaded && state.portBlockaded(a))) continue;
    const nb = new Set((M.frontiers[a] || []).map(e => e.region));
    const cands = (M.landing[a] || []).filter(c => settled(c.region) && !nb.has(c.region));
    const chosen = new Set();
    for (let s = 0; s < ca.fleets; s++) {
      let best = null, bv = 0;
      for (const c of cands) { if (chosen.has(c.region)) continue; const v = seaValue(a, c.region, c.dist); if (bv < v) { bv = v; best = c; } }
      if (!best) break;
      chosen.add(best.region);
      const exp = ceilInt(bv), imp = ceilInt(F(bv * C02));
      out[a].fleets.push({ to: best.region, toSettlement: M.settlementOf[best.region], export: exp });
      if (M.landingBack[best.region] && M.landingBack[best.region].has(a)) (importsTo[best.region] = importsTo[best.region] || []).push({ from: a, fromSettlement: M.settlementOf[a], value: imp });
    }
  }
  for (const b in importsTo) if (out[b]) out[b].imports = importsTo[b];
  // totals (+ Colossus: its owner's towns add ceil(0.2 x sea income))
  const colossus = state.wonderOwner ? state.wonderOwner("colossus") : null;
  for (const a in out) {
    const o = out[a];
    o.seaTotal = o.fleets.reduce((x, f) => x + f.export, 0) + o.imports.reduce((x, f) => x + f.value, 0);
    if (colossus && o.faction === colossus) o.wonder = ceilInt(F(o.seaTotal * C02));
    o.total = o.landTotal + o.seaTotal + o.wonder;
  }
  return out;
}

// ---------------------------------------------------------------- state: a new campaign (descr_strat)
function stateFromStrat(modDataDir, playerFaction) {
  const gv = require("./growthEval.js");
  const im = require("./incomeModel.js");
  const M = mapData(modDataDir);
  const strat = gv.parseStrat(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
  const owner = {}, pop = {}, count = {};
  for (const [f, fd] of Object.entries(strat)) for (const s of fd.settlements) { if (!s.region) continue; owner[s.region] = f; pop[s.region] = s.pop || 0; count[f] = (count[f] || 0) + 1; }
  const sizeTier = {}; for (const f in count) sizeTier[f] = f === "slave" ? 10 : tierOfCount(count[f]);
  const ctx = im.tradePartnerCtx(modDataDir);
  const prot = im.parseProtectorates(modDataDir);
  const allied = (a, b) => (ctx.allies[a] && ctx.allies[a].has(b)) || prot.suzerainOf[a] === b || prot.suzerainOf[b] === a;
  const diplo = (a, b) => ({ war: a === "slave" || b === "slave" || !!(ctx.wars[a] && ctx.wars[a].has(b)), rights: allied(a, b), embargo: false });
  const stratGov = (() => { try { return require("./traitEffects.js").govEffectByCityFromStrat(modDataDir, require("./traitEffects.js").parseTraitEffects(modDataDir)) || {}; } catch { return {}; } })();
  const govTrading = {}; for (const r in owner) { const g = stratGov[M.settlementOf[r]] || stratGov[r]; if (g && g.trading) govTrading[r] = g.trading; }
  return {
    playerFaction, owner, pop, sizeTier, diplo, govTrading,
    // a new campaign: every roaded town links to every land neighbour it can path to — unknown without
    // the game's road A*, so no road bonus is assumed (turn-1 descr_strat roads are almost all level 1)
    roadLink: () => false,
    wonderOwner: (w) => { const x = M.wonders[w]; return x && x.region ? owner[x.region] : null; },
  };
}

// ---------------------------------------------------------------- state: a save
function stateFromSave(modDataDir, savePath, opts) {
  const { crackSave } = require("./saveCracker.js");
  const im = require("./incomeModel.js");
  const M = mapData(modDataDir);
  const buf = fs.readFileSync(savePath);
  const cr = (opts && opts.cracked) || crackSave(buf, modDataDir); // reuse a parse the caller already made
  const regionOfCity = {}; for (const r in M.settlementOf) regionOfCity[M.settlementOf[r]] = r;
  const owner = {}, pop = {}, buildings = {}, capital = {};
  const sf = cr.settlementFields || {};
  for (const city in cr.ownerByCity || {}) { const r = regionOfCity[city]; if (r) owner[r] = cr.ownerByCity[city]; }
  for (const city in sf) { const r = regionOfCity[city]; if (r) pop[r] = sf[city].projectedPopulation || sf[city].committedPopulation || 0; }
  const inc = im.parseEDBIncome(path.join(modDataDir, "export_descr_buildings.txt"));
  for (const s of cr.settlements || []) {
    const r = regionOfCity[s.name]; if (!r) continue;
    buildings[r] = (s.buildings || []).filter(x => x.health > 0).map(x => ({ chain: x.name, level: (inc.chainLevels[x.name] || [])[x.level] || String(x.level) }));
    // capital flag: one byte 2265 bytes before the settlement record's name (flipped on all six AI capital moves)
    if (s.offset > 2265 && buf[s.offset - 2265] === 1 && owner[r]) capital[owner[r]] = r;
  }
  // governors: the save's own Trading attribute (vector index 24)
  const cc = cr.characters; const chars = Array.isArray(cc) ? cc : (cc && cc.v1) || [];
  const byU = {}; for (const c of chars) { if (c.secondaryUuid != null) byU[c.secondaryUuid >>> 0] = c; if (c.primaryUuid != null && byU[c.primaryUuid >>> 0] == null) byU[c.primaryUuid >>> 0] = c; }
  const govTrading = {};
  for (const city in sf) { const r = regionOfCity[city]; const u = sf[city].governorUuid; const ch = u && byU[u >>> 0]; if (r && ch && ch.tradingEffect) govTrading[r] = ch.tradingEffect; }
  // diplomacy
  const D = cr.diplomacy || {};
  // the rebels ("slave") are at war with every faction; the save's table has no row for them
  // emergent factions (seleucid_rebels…) have no row either: read each pair from whichever side lists it
  const has = (a, key, b) => ((D[a] || {})[key] || []).includes(b);
  const diplo = (a, b) => {
    if (a === "slave" || b === "slave") return { war: a !== b, rights: false, embargo: false };
    return { war: has(a, "war", b) || has(b, "war", a), rights: has(a, "trade", b) || has(b, "trade", a), embargo: false };
  };
  // empire-size events: 95 x [u32 30][u8][30-byte faction bitset]; empire_size1..10 by name order
  const sizeTier = sizeTiersFromSave(modDataDir, buf, cr);
  // road links + tiles: records [u32 own offset][u32 regionA][u32 regionB][u32][u32][u32 n][n x (x, y)]...
  const roads = roadRecordsFromSave(buf, M);
  // a region points at a road its neighbour built only if it ran build_road_links AFTER that neighbour: on load the
  // game walks the settlements in save order and each run links only the records that already exist (354/354 Turn 2;
  // Margiane, early in the order, has no pointer to the roads Baktriane and Chorasmene built to it)
  const order = {}; for (const st of cr.settlements || []) { const r = regionOfCity[st.name]; if (r && order[r] == null) order[r] = Object.keys(order).length; }
  const linkSet = new Set();
  for (const r of roads) {
    linkSet.add(r.a + ">" + r.b);
    if (order[r.b] == null || order[r.a] == null || order[r.b] > order[r.a]) linkSet.add(r.b + ">" + r.a);
  }
  // ARMIES on the map (an army at war with a region's owner cuts that region's sea trade x0.66 and blocks the
  // roads it stands on): general-led armies at their commander's tile, captain-led armies (brigands, rebels,
  // detachments) at their type-5 position record [u32 type 5][u32 army id][u32 own offset][x][y]; a captain
  // army's id sits 20 bytes before its first unit, and the nearest preceding captain_card_<faction>[_rebel]
  // marker names its faction (_rebel = the rebels).
  const armyTiles = []; const inRegion = {};
  const addArmy = (x, y, faction) => { const reg = M.regionAt(x, y); armyTiles.push({ x, y, faction }); if (reg) (inRegion[reg] = inRegion[reg] || []).push(faction); };
  const commanders = new Set((cr.armies || []).map(a => a.commanderUuid >>> 0));
  for (const c of chars) {
    if (c.isDead || c.tileX == null || !c.faction) continue;
    if (!commanders.has(c.primaryUuid >>> 0) && !commanders.has(c.secondaryUuid >>> 0)) continue;
    addArmy(c.tileX, c.tileY, c.faction);
  }
  {
    const pos = new Map();
    for (let p = 24; p < buf.length - 8; p++) {
      if (buf.readUInt32LE(p - 4) !== p - 4 || buf.readUInt32LE(p - 12) !== 5) continue;
      const x = buf.readUInt32LE(p), y = buf.readUInt32LE(p + 4), id = buf.readUInt32LE(p - 8);
      if (id && x <= 4096 && y <= 4096 && !pos.has(id)) pos.set(id, { x, y });
    }
    const marker = Buffer.from("captain_card_");
    for (const u of cr.units || []) {
      if (u.commanderUuid || u.naval || u.offset < 20) continue;
      const at = pos.get(buf.readUInt32LE(u.offset - 20)); if (!at) continue;
      const mp = buf.lastIndexOf(marker, u.offset); if (mp < 0) continue;
      const tag = buf.toString("latin1", mp + marker.length, buf.indexOf(0x2e, mp));
      addArmy(at.x, at.y, /_rebel$/.test(tag) ? "slave" : tag);
    }
  }
  const tileFactions = {}; for (const t of armyTiles) (tileFactions[t.x + "," + t.y] = tileFactions[t.x + "," + t.y] || []).push(t.faction);
  const roadByPair = {}; for (const r of roads) roadByPair[[r.a, r.b].sort().join("|")] = r;
  return {
    playerFaction: cr.playerFaction, owner, pop, buildings, capital, govTrading, diplo, sizeTier,
    roadLink: (a, b) => linkSet.has(a + ">" + b),
    roadBlocked: (a, b) => {
      const r = roadByPair[[a, b].sort().join("|")]; if (!r) return false;
      const fa = owner[a], fb = owner[b];
      return r.tiles.some(([x, y]) => (tileFactions[x + "," + y] || []).some(f => (f !== fa && diplo(f, fa).war) || (f !== fb && diplo(f, fb).war)));
    },
    hostileIn: (r) => (inRegion[r] || []).some(f => f !== owner[r] && diplo(f, owner[r]).war),
    wonderOwner: (w) => { const x = M.wonders[w]; return x && x.region ? owner[x.region] : null; },
    _roads: roads,
  };
}

function sizeTiersFromSave(modDataDir, buf, cr) {
  const txt = fs.readFileSync(path.join(modDataDir, "descr_sm_major_events.txt"), "latin1").replace(/;[^\n]*/g, "");
  const names = [...txt.matchAll(/"([A-Za-z0-9_]+)"\s*:\s*\{\s*"affects"/g)].map(m => m[1]);
  const n = names.length; if (!n) return null;
  let base = -1;
  for (let p = 0; p + n * 35 < Math.min(buf.length, 4 << 20); p++) {
    if (buf.readUInt32LE(p) !== 30) continue;
    let ok = true; for (let e = 1; e < n; e++) if (buf.readUInt32LE(p + e * 35) !== 30) { ok = false; break; }
    if (ok) { base = p; break; }
  }
  if (base < 0) return null;
  const facIdx = factionIndexMap(cr);
  const tier = {};
  for (let t = 1; t <= 10; t++) {
    const e = names.indexOf("empire_size" + t); if (e < 0) continue;
    const bits = buf.subarray(base + e * 35 + 5, base + e * 35 + 35);
    for (const [f, i] of Object.entries(facIdx)) if (bits[i >> 3] >> (i & 7) & 1) tier[f] = t;
  }
  for (const f of Object.keys(facIdx)) if (tier[f] == null) tier[f] = 0;
  return tier;
}
function factionIndexMap(cr) {
  const out = {};
  for (const [k, v] of Object.entries(cr.factions || {})) { const name = v.name || k; if (v.factionId != null) out[name] = v.factionId; }
  return out;
}
function roadRecordsFromSave(buf, M) {
  const recs = [];
  const nb = (a, b) => (M.frontiers[a] || []).some(e => e.region === b);
  for (let q = 0; q + 28 < buf.length; q++) {
    if (buf.readUInt32LE(q) !== q) continue;               // record id = its own stream position
    const ai = buf.readUInt32LE(q + 4), bi = buf.readUInt32LE(q + 8);
    const a = M.nameOfIdx[ai], b = M.nameOfIdx[bi]; if (!a || !b || a === b || !nb(a, b)) continue;
    const n = buf.readUInt32LE(q + 20); if (n < 1 || n > 600 || q + 24 + n * 8 > buf.length) continue;
    const tiles = []; let ok = true;
    for (let i = 0; i < n; i++) { const x = buf.readInt32LE(q + 24 + i * 8), y = buf.readInt32LE(q + 28 + i * 8); if (x < 0 || y < 0 || x > 4096 || y > 4096) { ok = false; break; } tiles.push([x, y]); }
    if (!ok) continue;
    // the record carries a second tile list after this one ([u32 m][m x (x, y)]); not used yet — its meaning
    // (continuation vs. another segment) is unconfirmed, and adding it broke the frontier-cost check
    recs.push({ a, b, tiles });
  }
  return recs;
}

// The engine result for a save, cached per (mod dir, save path, size, mtime): reading a save's state scans the
// whole file, so the budget, the panel and the map share one computation per save.
const _saveCache = new Map();
function tradeForSave(modDataDir, savePath, cracked) {
  const st = fs.statSync(savePath);
  const key = modDataDir + "|" + savePath + "|" + st.size + "|" + st.mtimeMs;
  if (_saveCache.has(key)) return _saveCache.get(key);
  const state = stateFromSave(modDataDir, savePath, { cracked });
  const res = { playerFaction: state.playerFaction, byRegion: computeTrade(modDataDir, state) };
  if (_saveCache.size > 4) _saveCache.delete(_saveCache.keys().next().value);
  _saveCache.set(key, res);
  return res;
}

module.exports = { computeTrade, stateFromStrat, stateFromSave, tradeForSave, capabilities, mapData, tierOfCount };
