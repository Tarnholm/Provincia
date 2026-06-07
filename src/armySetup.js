// src/armySetup.js
//
// Faction army-setup analysis for the Provincia Army Setup feature (2026-06-07):
//   - read a faction's starting armies + settlements from descr_strat
//   - per-unit upkeep + composition/balance (via export_descr_unit class/category)
//   - virtual-tax budget: project net income at a chosen tax bracket using the
//     cracked bracket multipliers, vs an editable deficit floor
//   - governor gaps + the recruitable pool (src/recruitPool.js)
//
// Works non-live (descr_strat) for army/pool/balance; the BUDGET needs a live
// save's faction net (the engine computes projected income — see economyParser /
// findings-projected-income-CRACKED-2026-06-06). Bracket multipliers cracked from
// the gades save_low/medium/high/very-high set.

"use strict";

const fs = require("fs");
const path = require("path");
const recruitPool = require("./recruitPool.js");

// Tax-income bracket multipliers (relative to normal), cracked 2026-06-07.
const TAX_BRACKETS = { low: 0.80, normal: 1.00, high: 1.20, very_high: 1.50 };
const BRACKET_ORDER = ["low", "normal", "high", "very_high"];

function findDescrStrat(modDataDir) {
  const cands = [
    ["world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"],
    ["world", "maps", "campaign", "alexander", "descr_strat.txt"],
    ["world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"],
  ];
  for (const c of cands) {
    const p = path.join(modDataDir, ...c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// List every faction token in the campaign's descr_strat (the `faction <name>,`
// lines) — the CURRENT campaign's roster, not the vanilla/all-mod set.
function listCampaignFactions(modDataDir) {
  const p = findDescrStrat(modDataDir);
  if (!p) return [];
  const txt = fs.readFileSync(p, "latin1");
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// Parse ONE faction's block from descr_strat → settlements (region+buildings) +
// characters (with armies). Reads the live (mod) descr_strat.
function parseFaction(modDataDir, faction) {
  const p = findDescrStrat(modDataDir);
  if (!p) return null;
  const txt = fs.readFileSync(p, "latin1");
  const lines = txt.split(/\r?\n/);
  const fac = String(faction).toLowerCase();
  // locate `faction <fac>,` … up to the next top-level `faction ` line
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (m && m[1].toLowerCase() === fac) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^faction\s+[a-z_0-9]+\s*,/i.test(lines[i])) { end = i; break; }
  }
  const seg = lines.slice(start, end);

  const out = { faction: fac, denari: null, settlements: [], characters: [] };
  let curChar = null, inArmy = false, curSettle = null, settleDepth = 0;
  for (let i = 0; i < seg.length; i++) {
    const ln = seg[i];
    const dm = ln.match(/^denari\s+(\d+)/); if (dm) { out.denari = +dm[1]; continue; }
    if (/^settlement\b/.test(ln)) { curSettle = { region: null, level: null, buildings: [] }; settleDepth = 0; continue; }
    if (curSettle) {
      if (/\{/.test(ln)) settleDepth += (ln.match(/\{/g) || []).length;
      const rg = ln.match(/^\s*region\s+(\w+)/); if (rg) curSettle.region = rg[1];
      const lv = ln.match(/^\s*level\s+(\w+)/); if (lv) curSettle.level = lv[1];
      const bt = ln.match(/^\s*type\s+\w+\s+(\w+)/); if (bt) curSettle.buildings.push(bt[1]);
      if (/\}/.test(ln)) { settleDepth -= (ln.match(/\}/g) || []).length; if (settleDepth <= 0) { out.settlements.push(curSettle); curSettle = null; } }
      continue;
    }
    const cm = ln.match(/^character,\s*([^,]+?),\s*(named character|general|spy|assassin|diplomat|merchant|admiral|princess)[^x]*?(?:age\s+(\d+))?[^x]*?(?:x\s+(\d+)\s*,\s*y\s+(\d+))?/);
    if (/^character,/.test(ln)) {
      const parts = ln.split(",").map(s => s.trim());
      const name = parts[1] || "?";
      const role = /\bleader\b/.test(ln) ? "leader" : /\bheir\b/.test(ln) ? "heir" : "general";
      const ax = ln.match(/x\s+(\d+)/), ay = ln.match(/y\s+(\d+)/), aa = ln.match(/age\s+(\d+)/);
      curChar = { name, role, age: aa ? +aa[1] : null, x: ax ? +ax[1] : null, y: ay ? +ay[1] : null, army: [] };
      out.characters.push(curChar);
      inArmy = false;
      continue;
    }
    if (/^army\b/.test(ln)) { inArmy = true; continue; }
    if (inArmy && curChar) {
      const um = ln.match(/^unit\s+(.+?)\s+exp\s+(\d+)\s+armour\s+(\d+)\s+weapon_lvl\s+(\d+)/);
      if (um) { curChar.army.push({ unit: um[1].trim(), exp: +um[2], armour: +um[3], weapon_lvl: +um[4] }); continue; }
      if (/^character_record|^character,|^;/.test(ln)) inArmy = false;
    }
  }
  return out;
}

// Balance summary of an army given unitStats (class/category from EDU).
function balanceOf(army, unitStats) {
  const tally = { heavy: 0, light: 0, missile: 0, spearmen: 0, cavalry: 0, other: 0 };
  let upkeep = 0;
  for (const u of army) {
    const st = unitStats[u.unit.toLowerCase()] || {};
    if (st.upkeep) upkeep += st.upkeep;
    if (/general/.test(u.unit)) continue; // skip bodyguard in role counts
    if (st.category === "cavalry") tally.cavalry++;
    else if (st.cls === "missile" || st.cls === "skirmish") tally.missile++;
    else if (st.cls === "heavy") tally.heavy++;
    else if (st.cls === "spearmen") tally.spearmen++;
    else if (st.cls === "light") tally.light++;
    else tally.other++;
  }
  const flags = [];
  const lineInf = tally.heavy + tally.spearmen;
  if (lineInf === 0) flags.push("no heavy/spear line infantry");
  if (tally.missile >= 3) flags.push(`skirmisher-heavy (${tally.missile})`);
  if (tally.cavalry === 0) flags.push("no cavalry");
  return { tally, upkeep, flags };
}

// Project a faction net from a known bracket to a target bracket using the tax
// multipliers. needs the faction's current net + its tax-income slot + current bracket.
function projectNet(currentNet, taxIncomeSlot, currentBracket, targetBracket) {
  const cm = TAX_BRACKETS[currentBracket] ?? 1.0;
  const tm = TAX_BRACKETS[targetBracket] ?? 1.0;
  if (currentNet == null || taxIncomeSlot == null) return null;
  return Math.round(currentNet + taxIncomeSlot * (tm / cm - 1));
}

const TAX_BYTE_TO_BRACKET = { 0: "low", 1: "normal", 2: "high", 3: "very_high" };

// Full faction army-setup analysis. modDataDir + faction (+ optional live save
// buffer for the budget & governor). Returns a structured advisory object.
//   floor = editable max-deficit (default -500).
function analyzeFaction(modDataDir, faction, saveBuf, floor) {
  const FLOOR = (typeof floor === "number") ? floor : -500;
  const cache = {};
  const f = parseFaction(modDataDir, faction);
  if (!f) return { error: `faction '${faction}' not found in descr_strat` };
  const unitStats = parseUnitStatsLocal(modDataDir, cache);

  // Upgrade capability: RIS weapon/armour upgrades come ONLY from the smith chain.
  // No smith in any of the faction's settlements ⇒ NO legitimate weapon/armour
  // upgrades, so any unit with weapon_lvl>0 / armour>0 is an illegal starting
  // upgrade the faction can't reproduce. (Weapons also need iron/coal, armour
  // flax/livestock/copper — but no-smith already rules both out.)
  const hasSmith = f.settlements.some(s => (s.buildings || []).some(b => /smith|blacksmith/.test(b)));
  const canWeapon = hasSmith, canArmour = hasSmith;

  // Per-character army + balance; per-settlement recruit pool.
  let armyUpkeep = 0;
  const characters = f.characters.map((c) => {
    const bal = balanceOf(c.army, unitStats);
    armyUpkeep += bal.upkeep;
    const illegalUpgrades = c.army
      .filter(u => (u.weapon_lvl > 0 && !canWeapon) || (u.armour > 0 && !canArmour))
      .map(u => ({ unit: u.unit, weapon_lvl: u.weapon_lvl, armour: u.armour }));
    const flags = [...bal.flags];
    if (illegalUpgrades.length) flags.push(`${illegalUpgrades.length} unit(s) with weapon/armour upgrades the town can't make (no smith)`);
    return { name: c.name, role: c.role, age: c.age, x: c.x, y: c.y, army: c.army.map(u => ({ ...u, upkeep: (unitStats[u.unit.toLowerCase()] || {}).upkeep ?? null })), upkeep: bal.upkeep, balance: bal.tally, flags, illegalUpgrades };
  });
  const settlements = f.settlements.map((s) => ({
    region: s.region, level: s.level,
    pool: recruitPool.poolForSettlement(modDataDir, faction, s.buildings, s.region, cache)
      .sort((a, b) => (a.upkeep || 0) - (b.upkeep || 0)),
    hasSmith: s.buildings.some(b => /smith|blacksmith/.test(b)),
  }));

  // NOTE: the budget (virtual-tax projection) is computed in the RENDERER from the
  // already-loaded saveEconomy.byFaction[faction] + projectNet(), because locating
  // the faction's econ block reliably needs the renderer's faction attribution;
  // an army-upkeep heuristic here mis-matched (another faction shared the upkeep).
  return {
    faction, denari: f.denari, armyUpkeep,
    characters, settlements, floor: FLOOR,
    taxBrackets: TAX_BRACKETS, hasSmith, canWeapon, canArmour,
    summary: {
      settlements: settlements.length, totalArmyUnits: characters.reduce((s, c) => s + c.army.length, 0),
      flags: [...new Set(characters.flatMap(c => c.flags))],
      illegalUpgradeUnits: characters.reduce((s, c) => s + c.illegalUpgrades.length, 0),
    },
  };
}

// Zero out illegitimate weapon/armour upgrades on one character's army (CRLF-safe).
// opts.weapon / opts.armour control which to zero (default both). Returns { ok, text, fixed }.
function applyUpgradeFix(text, faction, characterName, opts) {
  const doW = !opts || opts.weapon !== false;
  const doA = !opts || opts.armour !== false;
  if (!text) return { ok: false, error: "no descr_strat text" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const fac = String(faction).toLowerCase();
  const cname = String(characterName).trim().toLowerCase();
  let fs0 = -1;
  for (let i = 0; i < lines.length; i++) { const m = lines[i].match(/^faction\s+([a-z_0-9]+)\s*,/i); if (m && m[1].toLowerCase() === fac) { fs0 = i; break; } }
  if (fs0 < 0) return { ok: false, error: `faction '${faction}' not found` };
  let fe = lines.length;
  for (let i = fs0 + 1; i < lines.length; i++) { if (/^faction\s+[a-z_0-9]+\s*,/i.test(lines[i])) { fe = i; break; } }
  let ci = -1;
  for (let i = fs0; i < fe; i++) { if (/^character,/.test(lines[i]) && (lines[i].split(",")[1] || "").trim().toLowerCase() === cname) { ci = i; break; } }
  if (ci < 0) return { ok: false, error: `character '${characterName}' not found` };
  let inArmy = false, fixed = 0;
  for (let i = ci + 1; i < fe; i++) {
    const ln = lines[i];
    if (/^character,|^character_record\b/.test(ln)) break;
    if (/^army\b/.test(ln)) { inArmy = true; continue; }
    if (!inArmy) continue;
    if (!/^\s*unit\s+/.test(ln)) continue;
    let nl = ln;
    if (doW) nl = nl.replace(/(weapon_lvl\s+)\d+/, "$10");
    if (doA) nl = nl.replace(/(armour\s+)\d+/, "$10");
    if (nl !== ln) { lines[i] = nl; fixed++; }
  }
  return { ok: true, text: lines.join(eol), fixed };
}

// Swap ONE unit in a character's army in descr_strat text. Surgical + CRLF-safe:
// only the matched unit line's NAME token is changed; exp/armour/weapon_lvl and
// all other lines are untouched. Returns { ok, text, error }.
function applySwap(text, faction, characterName, oldUnit, newUnit) {
  if (!text) return { ok: false, error: "no descr_strat text" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const fac = String(faction).toLowerCase();
  const cname = String(characterName).trim().toLowerCase();
  const oldU = String(oldUnit).trim().toLowerCase();
  // faction block
  let fs0 = -1;
  for (let i = 0; i < lines.length; i++) { const m = lines[i].match(/^faction\s+([a-z_0-9]+)\s*,/i); if (m && m[1].toLowerCase() === fac) { fs0 = i; break; } }
  if (fs0 < 0) return { ok: false, error: `faction '${faction}' not found` };
  let fe = lines.length;
  for (let i = fs0 + 1; i < lines.length; i++) { if (/^faction\s+[a-z_0-9]+\s*,/i.test(lines[i])) { fe = i; break; } }
  // character within the faction block
  let ci = -1;
  for (let i = fs0; i < fe; i++) {
    if (/^character,/.test(lines[i])) {
      const nm = (lines[i].split(",")[1] || "").trim().toLowerCase();
      if (nm === cname) { ci = i; break; }
    }
  }
  if (ci < 0) return { ok: false, error: `character '${characterName}' not found in ${faction}` };
  // its army → first matching unit line (stop at next character/record)
  let inArmy = false;
  for (let i = ci + 1; i < fe; i++) {
    const ln = lines[i];
    if (/^character,|^character_record\b/.test(ln)) break;
    if (/^army\b/.test(ln)) { inArmy = true; continue; }
    if (!inArmy) continue;
    const m = ln.match(/^(\s*unit\s+)(.*?)(\s+exp\b.*)$/);
    if (m && m[2].trim().toLowerCase() === oldU) {
      lines[i] = m[1] + newUnit + m[3];
      return { ok: true, text: lines.join(eol), changedLine: i + 1, before: ln.trim(), after: lines[i].trim() };
    }
  }
  return { ok: false, error: `unit '${oldUnit}' not found in ${characterName}'s army` };
}

function parseUnitStatsLocal(modDataDir, cache) {
  if (cache.unitStats) return cache.unitStats;
  return (cache.unitStats = recruitPool.parseUnitStats(modDataDir));
}

// Dominant tax bracket across a faction's owned settlements (from the save's
// per-settlement taxRate byte). Falls back to "normal".
function dominantBracket(saveBuf, cracked, faction) {
  try {
    const { findAllSettlementMarkers } = require("./buildingParser.js");
    const { settlementFieldsAt } = require("./settlementFieldsParser.js");
    const owner = cracked.ownerByCity || {};
    const markers = findAllSettlementMarkers(saveBuf);
    const counts = {};
    for (const m of markers) {
      if ((owner[m.name] || "").toLowerCase() !== String(faction).toLowerCase()) continue;
      const t = settlementFieldsAt(saveBuf, m.offset).taxRate;
      const b = TAX_BYTE_TO_BRACKET[t]; if (b) counts[b] = (counts[b] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : "normal";
  } catch { return "normal"; }
}

module.exports = {
  TAX_BRACKETS, BRACKET_ORDER,
  findDescrStrat, parseFaction, balanceOf, projectNet, analyzeFaction, listCampaignFactions, applySwap, applyUpgradeFix,
  parseUnitStats: recruitPool.parseUnitStats,
  poolForSettlement: recruitPool.poolForSettlement,
};
