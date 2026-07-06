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

// A descr_strat character line may carry an OPTIONAL `sub_faction <name>` field
// BEFORE the character's name, e.g.:
//   character,	sub_faction athens,	Exainetos, named character, age 20, ...
// which shifts the name one comma-field to the right. Without handling this the
// name was misread as "sub_faction athens" (and swap/upgrade matching failed).
// Returns { name, subFaction } — subFaction null when the field is absent.
function parseCharacterLine(ln) {
  // TWO RIS line shapes (2026-07-02): "character\tName, named character, …" is the
  // MAIN format (914 lines); "character,\t[sub_faction X,\t]Name, …" the minority
  // (100 lines). The old parts[1]-after-comma read only handled the comma shape, so
  // tab-format characters got name "named character" and the whole army analysis
  // saw 4 of Rome's ~50 characters. Strip the keyword first, then field 0 is the
  // name — unless a sub_faction field shifts it one to the right.
  const rest = ln.replace(/^character[,\s]+/i, "");
  const parts = rest.split(",").map((s) => s.trim());
  let i = 0, subFaction = null;
  const sm = parts[0] && parts[0].match(/^sub_faction\s+(\S+)/i);
  if (sm) { subFaction = sm[1].toLowerCase(); i = 1; }
  return { name: parts[i] || "?", subFaction };
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
      const bt = ln.match(/^\s*type\s+\w+\s+(\S+)/); if (bt) curSettle.buildings.push(bt[1]); // \S+: levels like granary+1
      if (/\}/.test(ln)) { settleDepth -= (ln.match(/\}/g) || []).length; if (settleDepth <= 0) { out.settlements.push(curSettle); curSettle = null; } }
      continue;
    }
    if (/^character[,\s]/.test(ln)) {
      const { name, subFaction } = parseCharacterLine(ln);
      const ty = (ln.match(/,\s*(named character|general|spy|assassin|diplomat|merchant|admiral|princess)\s*,/i) || [])[1] || "general";
      // agents carry no army — skip them so the army analysis lists only commanders
      if (/^(spy|assassin|diplomat|merchant|princess)$/i.test(ty)) { curChar = null; inArmy = false; continue; }
      const role = /\bleader\b/.test(ln) ? "leader" : /\bheir\b/.test(ln) ? "heir" : ty.toLowerCase() === "admiral" ? "admiral" : "general";
      const ax = ln.match(/x\s+(\d+)/), ay = ln.match(/y\s+(\d+)/), aa = ln.match(/age\s+(\d+)/);
      curChar = { name, subFaction, role, age: aa ? +aa[1] : null, x: ax ? +ax[1] : null, y: ay ? +ay[1] : null, army: [] };
      out.characters.push(curChar);
      inArmy = false;
      continue;
    }
    if (/^army\b/.test(ln)) { inArmy = true; continue; }
    if (inArmy && curChar) {
      const um = ln.match(/^unit\s+(.+?)\s+exp\s+(\d+)\s+armour\s+(\d+)\s+weapon_lvl\s+(\d+)/);
      if (um) { curChar.army.push({ unit: um[1].trim(), exp: +um[2], armour: +um[3], weapon_lvl: +um[4] }); continue; }
      if (/^character_record|^character[,\s]|^;/.test(ln)) inArmy = false;
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
  // STARTING-ARMY UPKEEP: prefer the income model's calibrated EDU estimator — it
  // matches the engine charge to 0.1% (julii live 19,629 vs 19,616; the local Σ here
  // undercounted by ~1,000 — caught live 2026-06-11, the "too much money" report).
  try {
    // SAVE-AWARE bodyguards: read each general's actual retinue size from the loaded save via
    // faction-BLOCK attribution (catches field armies the region tagger misfiles under rebels), so
    // army upkeep is denarius-exact. No save → the descr_strat formula estimate inside armyUpkeepEDU.
    let saveGens = null;
    if (saveBuf) {
      try {
        const cr = require("./saveCracker.js").crackSave(saveBuf, modDataDir);
        saveGens = require("./incomeModel.js").bodyguardBlockByFaction(cr.units || [])[faction] || null;
      } catch { /* fall back to formula */ }
    }
    const edu = require("./incomeModel.js").armyUpkeepEDU(modDataDir, faction, saveGens);
    if (edu && typeof edu.upkeep === "number" && edu.upkeep > 0) armyUpkeep = edu.upkeep;
  } catch { /* keep local sum */ }
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

// Attribute EVERY faction's econ block from ONE save (cracked 2026-06-07).
// The save's faction-econ records are in descr_strat faction order, EXCEPT the
// player's record is swapped to recs[0] (the save is centered on the player).
// So: record[i] → descr_strat faction[i], with record[0] ↔ record[P] swapped,
// where P = the player's descr_strat index (found as the slot now holding
// descr_strat[0]'s record). Validated 230/239 by army-upkeep on the gades save;
// gades (player) net = −536 exact. Returns { byFaction:{name:{net,taxes,income,
// treasury,armyUpkeep}}, player, confidence }.
function attributeAllBudgets(saveBuf, modDataDir, playerHint) {
  const x = require("./saveCrackerExtras.js");
  const eco = require("./economyParser.js");
  const recs = x.parseFactionTreasuries(saveBuf);
  if (!Array.isArray(recs) || !recs.length) return { error: "no faction records" };
  const R = recs.map((r) => {
    const b = eco.readFinancialBlock(saveBuf, r.offset);
    const d = b && eco.decodeFinancialBlock(b);
    // RECURRING / PROJECTED net for BUDGETING (not the Financial-Overview actual
    // net). The completed-turn block for an AI faction includes one-time
    // RECRUITMENT (expenditure slot f13) and CONSTRUCTION (f14) it spent rushing a
    // turn-1 army/buildings — e.g. Carthage T2 f13=32450 makes d.net −11799 even
    // though its sustainable balance is +21651. Army-upkeep budgeting must use the
    // RECURRING expenditure only (wages + army_upkeep + other22), so we recompute
    // net = income.total − recurringExp, dropping the one-time f13/f14 (which
    // decodeFinancialBlock folds into expenditure.total + flags as `unattributed`).
    // This also normalises AI completed-turn blocks against the player's projected
    // block (which has no recruitment yet). See findings — turn-2 econ blocks.
    let net = d ? d.net : null;
    if (d && d.income && d.expenditure && d.income.total != null) {
      const recurringExp = (d.expenditure.wages || 0) + (d.expenditure.army_upkeep || 0) + (d.expenditure.other || 0);
      net = Math.round(d.income.total - recurringExp);
    }
    return {
      treasury: r.treasury,
      net,
      fullNet: d ? d.net : null, // Financial-Overview actual net (incl. one-time costs)
      taxes: d && d.income ? d.income.taxes : null,
      income: d && d.income ? d.income.total : null,
      armyUpkeep: d && d.expenditure ? d.expenditure.army_upkeep : null,
      // full itemized breakdown (Financial-Overview lines) — the static income
      // model is cracked/validated component-by-component against these.
      incomeBreakdown: d && d.income ? { farming: d.income.farming, taxes: d.income.taxes, mining: d.income.mining, trade: d.income.trade, other: d.income.other } : null,
      expenditureBreakdown: d && d.expenditure ? { wages: d.expenditure.wages, army_upkeep: d.expenditure.army_upkeep, other: d.expenditure.other } : null,
    };
  });
  // descr_strat faction order + denari + descr_strat army upkeep
  const p = findDescrStrat(modDataDir);
  if (!p) return { error: "descr_strat not found" };
  const ds = fs.readFileSync(p, "latin1");
  const us = recruitPool.parseUnitStats(modDataDir);
  const facs = [], den = {}, auF = {};
  { let cur = null, inArmy = false;
    for (const ln of ds.split(/\r?\n/)) {
      const m = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
      if (m) { cur = m[1]; facs.push(cur); auF[cur] = 0; inArmy = false; continue; }
      if (!cur) continue;
      const dm = ln.match(/^denari\s+(\d+)/); if (dm) { den[cur] = +dm[1]; continue; }
      if (/^army\b/.test(ln)) { inArmy = true; continue; }
      if (/^character[,\s]|^character_record/.test(ln)) inArmy = false;
      if (inArmy) { const u = ln.match(/^unit\s+(.+?)\s+exp\b/); if (u) auF[cur] += (us[u[1].trim().toLowerCase()] || {}).upkeep || 0; }
    }
  }
  // Locate the player index P (the save's econ records are descr_strat order with
  // the player's record swapped into recs[0]; descr_strat[0]'s record sits at
  // recs[P]). Priority:
  //   1. explicit playerHint (the user/panel designating the save's player)
  //   2. SWAP-IMPROVEMENT heuristic: pick the j whose 0↔j swap best aligns BOTH
  //      slots' treasury to their descr_strat starting denari. The swapped-out
  //      faction (descr_strat[0], a major faction with a large starting denari)
  //      leaves a big-treasury fingerprint at recs[P], so this is robust at turns
  //      1-2 even after the treasuries have moved (verified: Gades→101 imp 23.6k,
  //      Carthage→4 imp 6k, across T1/T1End/T2). Only swap when the matched record
  //      is a CLEARLY better descr_strat[0] than recs[0] is (so a faction-0 player
  //      correctly yields no swap). The old exact-treasury match (R[i]==den[facs0])
  //      is the imp==exact special case, so this subsumes it.
  const d0 = den[facs[0]];
  let P = -1;
  if (playerHint && facs.includes(String(playerHint).toLowerCase())) {
    const hi = facs.indexOf(String(playerHint).toLowerCase());
    P = hi === 0 ? -1 : hi; // hinting faction-0 means no swap
  } else if (d0 != null) {
    const noSwap0 = Math.abs((R[0].treasury || 0) - d0);
    let bestJ = -1, bestImp = 0;
    for (let j = 1; j < R.length && j < facs.length; j++) {
      const dj = den[facs[j]]; if (dj == null) continue;
      const noSwap = noSwap0 + Math.abs((R[j].treasury || 0) - dj);
      const swap = Math.abs((R[j].treasury || 0) - d0) + Math.abs((R[0].treasury || 0) - dj);
      const imp = noSwap - swap;
      if (imp > bestImp) { bestImp = imp; bestJ = j; }
    }
    // accept only if the swap meaningfully improves AND recs[bestJ] is a better
    // descr_strat[0] than recs[0] (guards the player-IS-faction-0 case → no swap).
    if (bestJ > 0 && bestImp > 1000 && Math.abs((R[bestJ].treasury || 0) - d0) < noSwap0) P = bestJ;
  }
  const byFaction = {};
  for (let i = 0; i < facs.length; i++) {
    let rec = i;
    if (P >= 0) { if (i === 0) rec = P; else if (i === P) rec = 0; }
    const r = R[rec];
    if (r) byFaction[facs[i]] = { net: r.net, fullNet: r.fullNet, treasury: r.treasury, armyUpkeep: r.armyUpkeep, armyUpkeepGT: auF[facs[i]], income: { total: r.income, taxes: r.taxes, ...(r.incomeBreakdown || {}) }, expenditure: r.expenditureBreakdown || null };
  }
  // Per-faction verification: a mapping is trustworthy if the block treasury
  // equals the faction's starting denari (EXACT key) OR the block army-upkeep is
  // near the descr_strat estimate (covers factions whose treasury already moved
  // off the start). Treasury alone covers the elephant/mercenary factions whose
  // in-game upkeep exceeds the EDU base sum (e.g. indians 15500==15500), so they
  // no longer get falsely flagged. `verified`/`verifyBy` attached per faction.
  let ok = 0, n = 0, noData = 0;
  for (const f of facs) {
    const r = byFaction[f]; if (!r) continue;
    // emergent / placeholder factions (egypt, gauls, greeks…) have no econ record:
    // treasury 0 + null block. Not active at start → no budget to attribute.
    if (r.net == null || (r.treasury === 0 && r.income && r.income.total == null)) { r.verified = false; r.verifyBy = "no-data"; r.active = false; noData++; continue; }
    r.active = true; n++;
    const tOk = r.treasury != null && den[f] != null && r.treasury === den[f];
    const auOk = r.armyUpkeep != null && Math.abs(r.armyUpkeep - (r.armyUpkeepGT || 0)) <= Math.max(300, (r.armyUpkeepGT || 0) * 0.4);
    r.verified = tOk || auOk;
    r.verifyBy = tOk ? "treasury" : auOk ? "army-upkeep" : "none";
    if (r.verified) ok++;
  }
  const playerLocated = P >= 0 || (playerHint && facs.includes(String(playerHint).toLowerCase()));
  return { byFaction, player: P >= 0 ? facs[P] : facs[0], playerIndex: P, playerLocated, hinted: !!playerHint, confidence: n ? ok / n : 0, matched: ok, total: n, noData };
}

// ── VIRTUAL TAX-SETTER ──────────────────────────────────────────────────────
// RTW's tax rate applies a FLAT population-growth modifier (a hard-coded game
// mechanic, NOT a Gades-only fit): Low +0.5%, Normal 0%, High −0.5%, Very High
// −1.0%. So a settlement's TAX-NEUTRAL ("base") growth = observed growth% minus
// the modifier of its current bracket; the optimal bracket is the HIGHEST one
// whose resulting growth stays ≥ 0 (the user's rule: "taxes as high as I can
// without going into negative growth; if negative at normal, set low").
const TAX_GROWTH_MOD = { low: 0.5, normal: 0.0, high: -0.5, very_high: -1.0 };

// Tax → PUBLIC-ORDER penalty on the marker−30 order total (the value Provincia's
// Economy Audit shows as "PO%"). Cracked 2026-06-07 from the controlled tax set
// (Gades save_low/medium/high/"very high"): order total was 285/255/235/215 at
// low/normal/high/very_high — i.e. RELATIVE to low: 0 / −30 / −50 / −70 (the
// bigger first step is losing the low-tax happiness bonus). Lets us project a
// settlement's order at a target bracket: order(target) = order(now) −
// TAX_ORDER_DELTA[now] + TAX_ORDER_DELTA[target]. (Calibrated from Gades; the RTW
// tax-happiness modifier is global so it should hold across settlements.)
const TAX_ORDER_DELTA = { low: 0, normal: -30, high: -50, very_high: -70 };

// Pick the optimal bracket given the tax-neutral base growth %.
function optimalBracketForBase(basePct) {
  // highest bracket whose growth (base + mod) is still ≥ 0; else floor at low
  for (let i = BRACKET_ORDER.length - 1; i >= 0; i--) {
    const b = BRACKET_ORDER[i];
    if (basePct + TAX_GROWTH_MOD[b] >= 0) return b;
  }
  return "low";
}

// Compute the optimal per-settlement tax plan for EVERY faction from ONE turn-2+
// save (growth is 0 on turn-1 saves — the one-turn compute lag — so this needs a
// turn-2-or-later save). For each settlement we read committed/projected pop →
// growth%, its current tax bracket (per-settlement byte; reliable for the
// player's own settlements, often 0/unset for AI), derive the base growth, and
// recommend the highest non-negative-growth bracket.
//
// Also produces an ESTIMATED net-at-optimal per faction: faction tax income
// (from the econ block via attributeAllBudgets) is distributed across the
// faction's settlements ∝ population×bracketMult, then re-scaled to the optimal
// bracket and re-summed. Labelled estimate — exact only for the player faction
// whose taxes are already the ones in the save.
//
//   saveBuf   = the GROWTH save Buffer (turn-2+; growth is read from here ONLY)
//   modDataDir= mod data dir (for descr_strat faction order / budgets)
//   cracked   = crackSave(saveBuf, modDataDir) result (for ownerByCity)
//   playerHint= optional player faction name (else auto-located)
//   economyBudgets = optional attributeAllBudgets() result from a TURN-1 save —
//     the BUDGET source. USER RULE (2026-06-08): the turn-2 save is used ONLY to
//     compute growth; the budget/economy must come from turn-1 (the AI inflates the
//     economy over turn 1 — very-high taxes + a turn of build-up — so AI-Carthage
//     reads ~21651 at turn 2 vs ~10179 at turn 1). When omitted, budgets fall back
//     to the growth save (clearly less accurate for AI factions).
// Returns { player, turnReady, budgetTurn1, byFaction:{ faction:{ settlements:[...],
//   currentNet, estNetAtOptimal, taxIncome, reliableSettlements, totalSettlements }},
//   counts }.
function optimalTaxPlan(saveBuf, modDataDir, cracked, playerHint, economyBudgets) {
  const { findAllSettlementMarkers } = require("./buildingParser.js");
  const { settlementFieldsAt } = require("./settlementFieldsParser.js");
  const owner = (cracked && (cracked.ownerByCity || cracked._ownerByCity)) || {};
  // Budget from the TURN-1 economy if supplied; else fall back to the growth save.
  const budgets = economyBudgets || attributeAllBudgets(saveBuf, modDataDir, playerHint);
  const byFacBudget = (budgets && budgets.byFaction) || {};
  const player = budgets && budgets.player;
  const budgetTurn1 = !!economyBudgets;

  const markers = findAllSettlementMarkers(saveBuf) || [];
  const byFaction = {};
  let anyGrowth = false;
  const counts = { low: 0, normal: 0, high: 0, very_high: 0 };

  // MODEL-GROWTH BASELINE for the player (2026-06-11): single-turn save snapshots embed
  // that turn's HARVEST roll and transient dips (a julii turn with every town at −0.5%
  // @normal dragged the whole plan to low taxes). The mod-file growth model is the
  // harvest-free annual baseline (validated 26/26 vs live growth panels), with governor
  // effects taken from the calibration save's real rolled traits when available.
  let modelBase = null;
  try {
    if (player) {
      const gvv = require("./growthEval.js");
      const teff = require("./traitEffects.js");
      let gov = null;
      try { gov = cracked ? teff.govEffectByCityFromSave(cracked, teff.parseTraitEffects(modDataDir), modDataDir) : null; } catch (e) { gov = null; }
      const G = gvv.computeFactionGrowth(modDataDir, (player || "").toLowerCase(), gov ? { govEffectByCity: gov } : undefined);
      if (G && !G.error && Array.isArray(G.settlements)) {
        modelBase = {};
        for (const s of G.settlements) {
          if (s && s.settlement && typeof s.baseGrowthEst === "number") modelBase[s.settlement] = s.baseGrowthEst;
        }
      }
    }
  } catch (e) { modelBase = null; }

  for (const m of markers) {
    if (!m || m.offset == null || !m.name) continue;
    const fac = (owner[m.name] || "").toLowerCase();
    if (!fac) continue;
    const f = settlementFieldsAt(saveBuf, m.offset);
    const pop = f.committedPopulation;
    const growth = f.populationGrowth; // projected − committed (population units)
    if (pop == null || !pop || growth == null) continue;
    // RTW population growth is always a multiple of 0.5% (the per-turn growth
    // modifiers — farming, health, tax — are all ±0.5% steps). The raw pop delta
    // ÷ pop gives noisy values (0.49/0.51/1.52) because population is integer-
    // rounded; snap to the nearest 0.5% so the plan reads in real game terms.
    const growthPct = Math.round((growth / pop) * 100 * 2) / 2;
    if (growth !== 0) anyGrowth = true;
    const curBracket = TAX_BYTE_TO_BRACKET[f.taxRate] || null;
    // The per-settlement tax byte is POPULATED for AI factions too (cracked
    // 2026-06-07 — the AI uses a bimodal low/very_high policy), so currentBracket
    // is the faction's REAL stored setting, not a guess. Only the PLAYER's byte is
    // controlled-diff-validated (gades save set), so bracketValidated marks that;
    // AI brackets are the save's value but unvalidated.
    const bracketValidated = curBracket != null && fac === (player || "").toLowerCase();
    const effBracket = curBracket || "normal"; // assume normal only if truly null
    // Player towns: prefer the harvest-free MODEL baseline (see modelBase above); the
    // raw save tick remains the fallback (and the AI factions' only source). RIS years
    // are 3 summer + 1 winter turn (start = summer, winter = seasonIndex 3); the winter
    // credit only matters on the fallback path.
    const winterCredit = (cracked && cracked.seasonIndex === 3) ? 0.5 : 0;
    const snapBase = growthPct - TAX_GROWTH_MOD[effBracket] + winterCredit;
    const basePct = (modelBase && fac === (player || "").toLowerCase() && typeof modelBase[m.name] === "number")
      ? modelBase[m.name] : snapBase;
    const optimalBracket = optimalBracketForBase(basePct);
    counts[optimalBracket] = (counts[optimalBracket] || 0) + 1;
    // project public order (marker−30, the Economy-Audit "PO%") at the optimal tax
    const orderNow = (typeof f.publicOrder === "number" && isFinite(f.publicOrder) && Math.abs(f.publicOrder) < 100000) ? Math.round(f.publicOrder) : null;
    const orderAtOptimal = (orderNow != null && curBracket)
      ? Math.round(orderNow - TAX_ORDER_DELTA[curBracket] + TAX_ORDER_DELTA[optimalBracket]) : null;
    (byFaction[fac] = byFaction[fac] || { settlements: [] }).settlements.push({
      name: m.name, region: null, population: pop,
      growthPct, // already snapped to 0.5%
      currentBracket: curBracket, bracketReliable: bracketValidated, bracketValidated,
      baseGrowthPct: Math.round(basePct * 10) / 10, // clean 0.5 multiple
      optimalBracket,
      growthAtOptimal: Math.round((basePct + TAX_GROWTH_MOD[optimalBracket]) * 10) / 10,
      orderNow, orderAtOptimal,
    });
  }

  // Per-faction budget + estimated net-at-optimal.
  for (const fac of Object.keys(byFaction)) {
    const rec = byFacBudget[fac] || {};
    const taxIncome = rec.income && rec.income.taxes != null ? rec.income.taxes : null;
    const currentNet = rec.net != null ? rec.net : null;
    const sts = byFaction[fac].settlements;
    let estNetAtOptimal = null;
    if (taxIncome != null && currentNet != null && sts.length) {
      // distribute the faction's tax income ∝ pop×mult(current), then re-scale to
      // optimal and sum the delta. mult(current) uses the best-effort bracket.
      const w = sts.map(s => (s.population || 0) * (TAX_BRACKETS[s.currentBracket || "normal"] || 1));
      const wSum = w.reduce((a, b) => a + b, 0);
      let delta = 0;
      if (wSum > 0) {
        for (let i = 0; i < sts.length; i++) {
          const taxShare = taxIncome * (w[i] / wSum);
          const curMult = TAX_BRACKETS[sts[i].currentBracket || "normal"] || 1;
          const optMult = TAX_BRACKETS[sts[i].optimalBracket] || 1;
          delta += taxShare * (optMult / curMult - 1);
        }
      }
      estNetAtOptimal = Math.round(currentNet + delta);
    }
    const reliableSettlements = sts.filter(s => s.bracketReliable).length;
    // EXACT-PLAN flag: when every settlement is at NORMAL tax, the stored growth
    // IS the base growth (normal modifier = 0), so the optimal-bracket plan is
    // exact (validated 67/67 across Carthage+Julii, 2026-06-08). This is the
    // recommended calibration save: an all-Normal turn-2 save of the faction.
    const allNormal = sts.length > 0 && sts.every(s => s.currentBracket === "normal");
    byFaction[fac] = {
      settlements: sts,
      currentNet, taxIncome, estNetAtOptimal, allNormal,
      reliableSettlements, totalSettlements: sts.length,
      isPlayer: fac === (player || "").toLowerCase(),
    };
  }

  return {
    player, turnReady: anyGrowth, taxGrowthMod: TAX_GROWTH_MOD, budgetTurn1,
    byFaction, counts,
    playerLocated: budgets && budgets.playerLocated,
    budgetConfidence: budgets && budgets.confidence,
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
  for (let i = fs0; i < fe; i++) { if (/^character[,\s]/.test(lines[i]) && parseCharacterLine(lines[i]).name.toLowerCase() === cname) { ci = i; break; } }
  if (ci < 0) return { ok: false, error: `character '${characterName}' not found` };
  let inArmy = false, fixed = 0;
  for (let i = ci + 1; i < fe; i++) {
    const ln = lines[i];
    if (/^character[,\s]|^character_record\b/.test(ln)) break;
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
    if (/^character[,\s]/.test(lines[i]) && parseCharacterLine(lines[i]).name.toLowerCase() === cname) { ci = i; break; }
  }
  if (ci < 0) return { ok: false, error: `character '${characterName}' not found in ${faction}` };
  // its army → first matching unit line (stop at next character/record)
  let inArmy = false;
  for (let i = ci + 1; i < fe; i++) {
    const ln = lines[i];
    if (/^character[,\s]|^character_record\b/.test(ln)) break;
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

// Append units to a NAMED CHARACTER's army in descr_strat text (the spend-headroom
// suggestions reinforce field armies; garrisons go through applyAddGarrison /
// applyReplaceGarrison instead). Mirrors applySwap's navigation: faction block →
// character line by name → its army block → insert after the last unit line.
// Enforces the engine's 20-unit army cap (bodyguard included): adds are CLIPPED to
// the remaining room, never silently over-filled. CRLF-safe.
// Returns { ok, text, addedCount, requested, capClipped, insertedAtLine, error }.
function applyAddArmyUnits(text, faction, characterName, unitNames) {
  if (!text || !faction || !characterName || !Array.isArray(unitNames) || !unitNames.length) return { ok: false, error: "missing args" };
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
  for (let i = fs0; i < fe; i++) {
    if (/^character[,\s]/.test(lines[i]) && parseCharacterLine(lines[i]).name.toLowerCase() === cname) { ci = i; break; }
  }
  if (ci < 0) return { ok: false, error: `character '${characterName}' not found in ${faction}` };
  let inArmy = false, lastUnit = -1, unitCount = 0;
  for (let i = ci + 1; i < fe; i++) {
    const ln = lines[i];
    if (/^character[,\s]|^character_record\b/.test(ln)) break;
    if (/^army\b/.test(ln)) { inArmy = true; continue; }
    if (!inArmy) continue;
    if (/^\s*unit\s+/.test(ln)) { lastUnit = i; unitCount++; }
  }
  if (lastUnit < 0) return { ok: false, error: `${characterName} has no army block` };
  const room = Math.max(0, 20 - unitCount);
  if (!room) return { ok: false, error: `${characterName}'s army is already at the 20-unit cap` };
  const toAdd = unitNames.slice(0, room);
  const addLines = toAdd.map(u => "unit\t\t" + u + "\t\t\texp 0 armour 0 weapon_lvl 0");
  lines.splice(lastUnit + 1, 0, ...addLines);
  return { ok: true, text: lines.join(eol), addedCount: toAdd.length, requested: unitNames.length, capClipped: toAdd.length < unitNames.length, insertedAtLine: lastUnit + 2 };
}

// ;comment name pattern treating space and underscore interchangeably: RIS comments a
// multi-word settlement with a SPACE (";Epizephyrian Locri") while the settlement/region
// names use underscores ("Epizephyrian_Locri" / "Lokroi_Epizephyrioi"). Without this the
// garrison locator misses multi-word towns and reads an empty garrison.
function _namePat(name) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc(String(name).trim().toLowerCase()).replace(/[_\s]+/g, "[_\\s]+");
}

// Append ONE unit into a settlement's garrison army in descr_strat text. CRLF-safe; mirrors
// applySwap. Resolves settlementName→region (via regionToCity), finds the ;<settlement> (or
// ;<region>) garrison comment within the faction block, walks to the next character's `army`,
// and inserts after its last `unit` line (mirroring the tab format). RIS comments these blocks
// with the SETTLEMENT name (;Paestum), not the region — so match settlement-first. No-garrison
// towns (buildings only, no character) return an error rather than synthesising a character.
// Returns { ok, text, insertedAtLine, anchor, newLine, error }.
function applyAddGarrison(text, faction, settlementName, unitName, regionToCity) {
  if (!text || !faction || !settlementName || !unitName) return { ok: false, error: "missing args" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sNorm = settlementName.trim().toLowerCase();
  let region = null;
  if (regionToCity) for (const [reg, city] of Object.entries(regionToCity)) if (city && city.trim().toLowerCase() === sNorm) { region = reg; break; }
  let fStart = -1, fEnd = lines.length;
  const facRe = new RegExp("^faction\\s+" + esc(faction) + "\\b", "i");
  for (let i = 0; i < lines.length; i++) if (facRe.test(lines[i])) { fStart = i; break; }
  if (fStart < 0) return { ok: false, error: `faction ${faction} not found` };
  for (let i = fStart + 1; i < lines.length; i++) if (/^faction\s+\S/i.test(lines[i])) { fEnd = i; break; }
  const cRe = new RegExp("^;\\s*(" + _namePat(sNorm) + (region ? "|" + _namePat(region) : "") + ")\\s*$", "i");
  let cIdx = -1;
  for (let i = fStart; i < fEnd; i++) if (cRe.test(lines[i])) { cIdx = i; break; }
  if (cIdx < 0) return { ok: false, error: `no garrison present at ${settlementName} — station a general or captain there first, then re-run.` };
  let chIdx = -1;
  for (let i = cIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^character\b|^character,/i.test(t)) { chIdx = i; break; } if (/^;\s*\S/.test(t) || /^settlement\b/i.test(t)) break; }
  if (chIdx < 0) return { ok: false, error: `no garrison character at ${settlementName}` };
  let armyIdx = -1;
  for (let i = chIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^army\b/i.test(t)) { armyIdx = i; break; } if (/^character\b|^character,|^;\s*\S|^settlement\b/i.test(t)) break; }
  if (armyIdx < 0) return { ok: false, error: `${settlementName}'s garrison has no army block` };
  let lastUnit = -1;
  for (let i = armyIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^unit\b/i.test(t)) lastUnit = i; else if (t === "") { if (lastUnit >= 0) break; } else if (/^character\b|^character,|^;\s*\S|^settlement\b|^army\b/i.test(t)) break; }
  if (lastUnit < 0) lastUnit = armyIdx;
  const newLine = "unit\t\t" + unitName + "\t\t\texp 0 armour 0 weapon_lvl 0";
  lines.splice(lastUnit + 1, 0, newLine);
  return { ok: true, text: lines.join(eol), insertedAtLine: lastUnit + 1, anchor: ";" + settlementName + " → character army", newLine };
}

// Read a settlement garrison's unit names in order ([0] is the general's bodyguard).
// Same navigation as applyAddGarrison. Returns [] when no garrison/character/army block.
function getGarrisonUnits(text, faction, settlementName, regionToCity) {
  if (!text || !faction || !settlementName) return [];
  const lines = text.split(/\r?\n/);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sNorm = settlementName.trim().toLowerCase();
  let region = null;
  if (regionToCity) for (const [reg, city] of Object.entries(regionToCity)) if (city && city.trim().toLowerCase() === sNorm) { region = reg; break; }
  let fStart = -1, fEnd = lines.length;
  const facRe = new RegExp("^faction\\s+" + esc(faction) + "\\b", "i");
  for (let i = 0; i < lines.length; i++) if (facRe.test(lines[i])) { fStart = i; break; }
  if (fStart < 0) return [];
  for (let i = fStart + 1; i < lines.length; i++) if (/^faction\s+\S/i.test(lines[i])) { fEnd = i; break; }
  const cRe = new RegExp("^;\\s*(" + _namePat(sNorm) + (region ? "|" + _namePat(region) : "") + ")\\s*$", "i");
  let cIdx = -1; for (let i = fStart; i < fEnd; i++) if (cRe.test(lines[i])) { cIdx = i; break; }
  if (cIdx < 0) return [];
  let chIdx = -1;
  for (let i = cIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^character\b|^character,/i.test(t)) { chIdx = i; break; } if (/^;\s*\S/.test(t) || /^settlement\b/i.test(t)) break; }
  if (chIdx < 0) return [];
  let armyIdx = -1;
  for (let i = chIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^army\b/i.test(t)) { armyIdx = i; break; } if (/^character\b|^character,|^;\s*\S|^settlement\b/i.test(t)) break; }
  if (armyIdx < 0) return [];
  const units = [];
  for (let i = armyIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); const m = t.match(/^unit\s+(.+?)\s+exp\b/i); if (m) units.push(m[1].trim()); else if (t === "" || /^character\b|^character,|^;\s*\S|^settlement\b|^army\b/i.test(t)) { if (units.length) break; } }
  return units;
}

// Replace a settlement garrison's non-recruitable units with a recruitable one in
// descr_strat. CRLF-safe; mirrors applyAddGarrison navigation. Removes each name in
// removeUnitNames (honouring multiplicity — duplicate names each remove one line),
// NEVER the bodyguard (army[0]), then appends addCount × addUnitName after the last
// KEPT unit line (anchoring on a removed line would silently drop the additions).
// Returns { ok, text, removedCount, addedCount, removedLines, addedLine, anchor, lineDelta, error }.
function applyReplaceGarrison(text, faction, settlementName, removeUnitNames, addUnits, regionToCity) {
  if (!text || !faction || !settlementName) return { ok: false, error: "missing args" };
  removeUnitNames = removeUnitNames || [];
  addUnits = addUnits || [];  // flat list e.g. ["roman rorarii","roman rorarii","roman leves"]
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sNorm = settlementName.trim().toLowerCase();
  let region = null;
  if (regionToCity) for (const [reg, city] of Object.entries(regionToCity)) if (city && city.trim().toLowerCase() === sNorm) { region = reg; break; }
  let fStart = -1, fEnd = lines.length;
  const facRe = new RegExp("^faction\\s+" + esc(faction) + "\\b", "i");
  for (let i = 0; i < lines.length; i++) if (facRe.test(lines[i])) { fStart = i; break; }
  if (fStart < 0) return { ok: false, error: `faction ${faction} not found` };
  for (let i = fStart + 1; i < lines.length; i++) if (/^faction\s+\S/i.test(lines[i])) { fEnd = i; break; }
  const cRe = new RegExp("^;\\s*(" + _namePat(sNorm) + (region ? "|" + _namePat(region) : "") + ")\\s*$", "i");
  let cIdx = -1; for (let i = fStart; i < fEnd; i++) if (cRe.test(lines[i])) { cIdx = i; break; }
  if (cIdx < 0) return { ok: false, error: `no garrison present at ${settlementName}` };
  let chIdx = -1;
  for (let i = cIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^character\b|^character,/i.test(t)) { chIdx = i; break; } if (/^;\s*\S/.test(t) || /^settlement\b/i.test(t)) break; }
  if (chIdx < 0) return { ok: false, error: `no garrison character at ${settlementName}` };
  let armyIdx = -1;
  for (let i = chIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^army\b/i.test(t)) { armyIdx = i; break; } if (/^character\b|^character,|^;\s*\S|^settlement\b/i.test(t)) break; }
  if (armyIdx < 0) return { ok: false, error: `${settlementName}'s garrison has no army block` };
  const unitIdx = [];
  for (let i = armyIdx + 1; i < fEnd; i++) { const t = lines[i].trim(); if (/^unit\b/i.test(t)) unitIdx.push(i); else if (t === "") { if (unitIdx.length) break; } else if (/^character\b|^character,|^;\s*\S|^settlement\b|^army\b/i.test(t)) break; }
  if (!unitIdx.length) return { ok: false, error: `${settlementName}'s garrison has no units` };
  const nameAt = i => { const m = lines[i].match(/^\s*unit\s+(.+?)\s+exp\b/i); return m ? m[1].trim().toLowerCase() : null; };
  const want = {}; for (const u of removeUnitNames) { const k = String(u).trim().toLowerCase(); want[k] = (want[k] || 0) + 1; }
  const toRemove = new Set();
  for (let j = 1; j < unitIdx.length; j++) { const nm = nameAt(unitIdx[j]); if (nm && want[nm] > 0) { toRemove.add(unitIdx[j]); want[nm]--; } }  // j from 1: never the bodyguard
  let appendAfter = armyIdx;
  for (const li of unitIdx) if (!toRemove.has(li)) appendAfter = li;   // last KEPT unit line
  const removedLines = [...toRemove].sort((a, b) => a - b).map(i => lines[i].trim());
  const addLines = [];
  for (const un of addUnits) addLines.push("unit\t\t" + un + "\t\t\texp 0 armour 0 weapon_lvl 0");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (toRemove.has(i)) continue;
    out.push(lines[i]);
    if (i === appendAfter && addLines.length) for (const al of addLines) out.push(al);
  }
  return { ok: true, text: out.join(eol), removedCount: toRemove.size, addedCount: addLines.length, removedLines, addedLines: addUnits.slice(), anchor: ";" + settlementName, lineDelta: addLines.length - toRemove.size };
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
  findDescrStrat, parseFaction, balanceOf, projectNet, analyzeFaction, listCampaignFactions, applySwap, applyUpgradeFix, applyAddGarrison, applyAddArmyUnits, getGarrisonUnits, applyReplaceGarrison, attributeAllBudgets,
  optimalTaxPlan, optimalBracketForBase, TAX_GROWTH_MOD, TAX_ORDER_DELTA,
  parseUnitStats: recruitPool.parseUnitStats,
  poolForSettlement: recruitPool.poolForSettlement,
};
