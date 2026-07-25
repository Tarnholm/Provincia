// AI ↔ MOD-FILE audit (2026-07-24) — take the factions the AI log flags as
// broken and check what the MOD FILES say about them, so a finding becomes an
// editable lead ("faction X is super_aggressive but holds 1 town and fields
// 600 men — retier its personality") rather than just a symptom.
//
// Files consulted (the ones the user named as the AI-relevant set):
//   feral_descr_ai_personality.txt — personality → building/military/diplomatic
//                                    priority; `aggresiveness` per diplomatic
//                                    profile. THE aggression lever.
//   descr_strat.txt                — starting settlements, armies, unit counts,
//                                    treasury, navies per faction.
//   descr_regions.txt              — region ↔ settlement names.
//   descr_sm_factions.txt          — culture + default religion per faction.
//   export_descr_unit.txt          — which factions may own naval units.
//   export_descr_buildings.txt     — the military_industrial_complex ladder
//                                    (cost / build turns / settlement_min per
//                                    level) = the recruitment ceiling, plus
//                                    recruitment gating generally.
//   descr_sm_resources.txt         — resource trade values; combined with
//                                    descr_strat's `resource` placements into a
//                                    per-faction endowment, so an income
//                                    problem can be blamed on (or CLEARED of)
//                                    poor land against the map median.
//
// PURE-ish: takes already-read file TEXT (caller does the I/O), so it's unit
// testable. Returns per-faction facts + concrete leads with a `file` field
// naming what to edit. Never invents: anything a file doesn't state is null.

"use strict";

// ── parsers (narrow, only what the audit needs) ────────────────────────────

// personality name → { building, military, diplomatic }, and
// diplomatic profile → aggresiveness
function parseAiPersonality(text) {
  const personalities = {}, diplomatic = {};
  let curP = null, curD = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    if (!l) continue;
    let m;
    if ((m = l.match(/^personality\s+(\S+)/))) { curP = m[1]; curD = null; personalities[curP] = {}; continue; }
    if ((m = l.match(/^diplomatic_priority\s+(\S+)/))) {
      // inside a `personality` block this ASSIGNS a profile; at top level it DEFINES one
      if (curP) { personalities[curP].diplomatic = m[1]; continue; }
      curD = m[1]; diplomatic[curD] = diplomatic[curD] || {}; continue;
    }
    if ((m = l.match(/^building_priority\s+(\S+)/))) { if (curP) personalities[curP].building = m[1]; else curD = null; continue; }
    if ((m = l.match(/^military_priority\s+(\S+)/))) { if (curP) personalities[curP].military = m[1]; else curD = null; continue; }
    if (curD && (m = l.match(/^aggresiveness\s+(\d+)/))) { diplomatic[curD].aggresiveness = +m[1]; continue; }
  }
  return { personalities, diplomatic };
}

// descr_strat → per-faction starting position + which ai_personality it uses
function parseStratFactions(text) {
  const out = {};
  let cur = null;
  let inArmy = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "");
    const t = l.trim();
    let m;
    if ((m = t.match(/^faction\s+([a-z_0-9]+)\s*,\s*(\S+)/))) {
      cur = m[1];
      out[cur] = { faction: cur, aiPersonality: m[2].replace(/,$/, ""), settlements: 0, armies: 0, units: 0, admirals: 0, denari: null, ports: 0 };
      inArmy = false; continue;
    }
    if (!cur) continue;
    if ((m = t.match(/^denari\s+(\d+)/))) { out[cur].denari = +m[1]; continue; }
    if (/^settlement\b/.test(t)) { out[cur].settlements++; continue; }
    if (/^port_buildings\b/.test(t) || /type\s+port_buildings/.test(t)) { out[cur].ports++; continue; }
    if (/^character\b/.test(t)) { if (/admiral/i.test(t)) out[cur].admirals++; inArmy = false; continue; }
    if (/^(army|garrisoned_army)\b/.test(t)) { out[cur].armies++; inArmy = true; continue; }
    if (inArmy && /^unit\s/.test(t)) { out[cur].units++; continue; }
    if (inArmy && t && !/^unit\s/.test(t)) inArmy = false;
  }
  return out;
}

// export_descr_unit → set of factions that may own a naval unit
function parseNavalOwners(text) {
  const owners = {};
  const blocks = String(text || "").split(/\n(?=type\s)/);
  for (const b of blocks) {
    if (!/^\s*category\s+ship\b/m.test(b)) continue;
    const m = b.match(/^ownership\s+(.+)$/m);
    if (!m) continue;
    for (const f of m[1].split(",")) {
      const k = f.trim().toLowerCase();
      if (k) owners[k] = (owners[k] || 0) + 1;
    }
  }
  return owners;
}

// export_descr_buildings → the military_industrial_complex ladder:
// level → { cost, turns, settlementMin }. RIS gates troop tiers on this chain
// (`mic_tier_*`), and each level carries a settlement_min, so a faction whose
// towns stay small is PERMANENTLY locked out of the units its own campaigns
// demand — verified on the reference save, where every faction's mic level
// equalled its best settlement tier exactly.
const SETTLEMENT_TIERS = ["village", "town", "large_town", "city", "large_city", "huge_city"];
function parseMicLadder(text) {
  if (!text) return null;
  const m = String(text).match(/\nbuilding\s+military_industrial_complex\b([\s\S]*?)(?=\nbuilding\s+\w)/);
  if (!m) return null;
  const blk = m[1];
  const anchors = [...blk.matchAll(/\n\t{2,3}(mic_\d)\s/g)].map((a) => ({ pos: a.index, name: a[1] }));
  const out = {};
  anchors.forEach((a, i) => {
    const seg = blk.slice(a.pos, i + 1 < anchors.length ? anchors[i + 1].pos : blk.length);
    const turns = seg.match(/^\s*construction\s+(\d+)/m);
    const cost = seg.match(/^\s*cost\s+(\d+)/m);
    const smin = seg.match(/^\s*settlement_min\s+(\w+)/m);
    out[a.name] = {
      level: +a.name.replace("mic_", ""),
      turns: turns ? +turns[1] : null,
      cost: cost ? +cost[1] : null,
      settlementMin: smin ? smin[1] : null,
      settlementMinTier: smin ? SETTLEMENT_TIERS.indexOf(smin[1]) : null,
    };
  });
  return Object.keys(out).length ? out : null;
}

// descr_sm_factions → faction → { culture, religion }
function parseSmFactions(text) {
  const out = {};
  let cur = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^\t"([a-z_0-9]+)":/))) { cur = m[1]; out[cur] = {}; continue; }
    if (!cur) continue;
    if ((m = raw.match(/"culture"\s*:\s*"(\w+)"/))) out[cur].culture = m[1];
    if ((m = raw.match(/"default religion"\s*:\s*"(\w+)"/))) out[cur].religion = m[1];
  }
  return out;
}

// Per-faction resource endowment, for the genuinely INCOME-limited factions.
// `resourceValues` = descr_sm_resources (resource → { tradeValue, tier }) and
// `resourcesByRegion` = descr_strat's `resource <type>, n, x, y; Region` lines —
// both come from the app's already-verified parsers (incomeModel /
// growthEval), passed in so this module stays pure. Answers "is this faction
// income-limited because it sits on poor land?" from the files themselves.
function factionResourceWealth({ ownerByCity = {}, regionOfSettlement = {}, resourceValues = {}, resourcesByRegion = {} } = {}) {
  const out = {};
  for (const [city, fx] of Object.entries(ownerByCity)) {
    const f = String(fx || "?").toLowerCase();
    const e = out[f] = out[f] || { regions: 0, resources: 0, tradeValue: 0, mineable: 0, topResource: null, topValue: 0 };
    e.regions++;
    const reg = regionOfSettlement[city] || city;
    const list = resourcesByRegion[reg];
    if (!list) continue;
    for (const r of (list instanceof Set ? [...list] : list)) {
      const v = resourceValues[String(r).toLowerCase()];
      if (!v) continue;
      e.resources++;
      e.tradeValue += v.tradeValue || 0;
      if (v.mineable) e.mineable++;
      if ((v.tradeValue || 0) > e.topValue) { e.topValue = v.tradeValue || 0; e.topResource = r; }
    }
  }
  for (const e of Object.values(out)) {
    e.tradeValuePerRegion = e.regions ? +(e.tradeValue / e.regions).toFixed(2) : 0;
    e.resourcesPerRegion = e.regions ? +(e.resources / e.regions).toFixed(2) : 0;
  }
  return out;
}

// Per-faction FARM endowment. The settlement-tier lock explains why a faction
// can't build military infrastructure; farm level explains why its settlements
// never grow in the first place — RIS carries a Farm<N> tag per region in
// descr_regions and growth scales off it. `farmByRegion` comes from the app's
// verified parser (growthEval.parseRegions → byRegion[region].farmN).
function factionFarmWealth({ ownerByCity = {}, regionOfSettlement = {}, farmByRegion = {} } = {}) {
  const out = {};
  for (const [city, fx] of Object.entries(ownerByCity)) {
    const f = String(fx || "?").toLowerCase();
    const e = out[f] = out[f] || { regions: 0, farmSum: 0, farmMax: 0, lowFarm: 0 };
    const reg = regionOfSettlement[city] || city;
    const farm = farmByRegion[reg];
    if (farm == null) continue;
    e.regions++; e.farmSum += farm;
    if (farm > e.farmMax) e.farmMax = farm;
    if (farm <= 4) e.lowFarm++;
  }
  for (const e of Object.values(out)) e.farmAvg = e.regions ? +(e.farmSum / e.regions).toFixed(2) : 0;
  return out;
}

/**
 * auditModFiles({ findings, saveFacts, files })
 *   files: { aiPersonality, strat, smFactions, edu } — raw TEXT, any may be null
 * → { factions: {faction: facts}, leads: [ {severity, faction, file, key, issue, suggestion, evidence} ] }
 */
// ── descr_character.txt ─────────────────────────────────────────────────────
// One file-level global, declared before the first `type` block, controlling the
// movement budget every character starts each turn with. Vanilla RTW:R ships 80.
//
// RIS annotates its own value, and those annotations are the best possible
// evidence for a suggestion — better than anything we could infer:
//   starting_action_points 128 ;99 = AI doesn't leave cities undefended, but is passive in harrassing
//   ;124 HIGHLY RECOMMENDED VALUE AS PER MEDIEVAL 2 AI'S (ex: SKYNET) ; x2 due to new map size so 128
// So we capture the value, its trailing comment, and any numbers the surrounding
// comments name as alternatives, and quote them back rather than inventing a
// target of our own.
const VANILLA_ACTION_POINTS = 80; // Contents/Resources/Data/data/descr_character.txt:44

function parseActionPoints(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*starting_action_points\s+(\d+)\s*(?:;(.*))?$/.exec(lines[i]);
    if (!m) continue;
    const value = +m[1];
    const comment = (m[2] || "").trim();
    // Numbers the modder names as alternatives, kept SEPARATE by which comment
    // they came from. The inline comment and the following comment lines say
    // different things (";99 = AI doesn't leave cities undefended" vs ";124
    // HIGHLY RECOMMENDED …"), so merging them would attach one comment's
    // reasoning to the other's number — a misquote, not a summary.
    const nums = (s) => [...String(s).matchAll(/\b(\d{2,3})\b/g)]
      .map((m) => +m[1])
      .filter((n) => n !== value && n >= 20 && n <= 500);
    const inlineThresholds = [...new Set(nums(comment))].sort((a, b) => a - b);
    const nearbyComments = [];
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const t = lines[j].trim();
      if (!t.startsWith(";")) break;
      const c = t.replace(/^;+/, "").trim();
      if (c) nearbyComments.push(c);
    }
    const otherThresholds = [...new Set(nearbyComments.flatMap(nums))]
      .filter((n) => !inlineThresholds.includes(n))
      .sort((a, b) => a - b);
    return {
      value, line: i + 1, comment,
      inlineThresholds,     // numbers the INLINE comment's text is about
      otherThresholds,      // numbers mentioned in adjacent comments
      nearbyComments,
      vanilla: VANILLA_ACTION_POINTS,
    };
  }
  return null;
}

function auditModFiles({ findings = [], saveFacts = null, files = {}, economy = {}, buildAppetite = {}, resourceWealth = {}, farmWealth = {} } = {}) {
  const { personalities, diplomatic } = parseAiPersonality(files.aiPersonality);
  const strat = parseStratFactions(files.strat);
  const naval = parseNavalOwners(files.edu);
  const sm = parseSmFactions(files.smFactions);
  const micLadder = parseMicLadder(files.edb);

  // per-faction symptom tallies from the log findings
  const sym = {};
  for (const f of findings) {
    const k = String(f.faction || "?").toLowerCase();
    if (k === "?" ) continue;
    const e = sym[k] = sym[k] || { total: 0, byKind: {}, impossible: 0, neverArrived: 0, orphaned: 0, maxReq: 0 };
    e.total++;
    e.byKind[f.kind] = (e.byKind[f.kind] || 0) + 1;
    if (f.impossible) e.impossible++;
    if (/NEVER arrived/.test(f.verdict || "")) e.neverArrived++;
    if (f.orphaned) e.orphaned++;
    const req = +(String(f.detail).match(/\/(\d+) strength/) || [0, 0])[1];
    if (req > e.maxReq) e.maxReq = req;
    if (f.blockedBy === "recruitment") e.recruitBlocked = (e.recruitBlocked || 0) + 1;
    if (f.blockedBy === "income") e.incomeBlocked = (e.incomeBlocked || 0) + 1;
    if (f.micMax != null) { e.micMax = f.micMax; e.micMissing = f.micMissing; e.micTowns = f.micTowns; }
  }

  const men = (saveFacts && saveFacts.menByFaction) || {};
  const setts = (saveFacts && saveFacts.settlementsByFaction) || {};
  const navalNow = (saveFacts && saveFacts.navalByFaction) || {};
  const tierNow = (saveFacts && saveFacts.tierByFaction) || {};

  const factions = {};
  for (const k of new Set([...Object.keys(sym), ...Object.keys(strat)])) {
    const st = strat[k] || null;
    const pers = st && st.aiPersonality ? personalities[st.aiPersonality] : null;
    const dip = pers && pers.diplomatic ? diplomatic[pers.diplomatic] : null;
    factions[k] = {
      faction: k,
      aiPersonality: st ? st.aiPersonality : null,
      diplomaticProfile: pers ? (pers.diplomatic || null) : null,
      aggresiveness: dip && dip.aggresiveness != null ? dip.aggresiveness : null,
      militaryProfile: pers ? (pers.military || null) : null,
      buildingProfile: pers ? (pers.building || null) : null,
      startSettlements: st ? st.settlements : null,
      startUnits: st ? st.units : null,
      startAdmirals: st ? st.admirals : null,
      startDenari: st ? st.denari : null,
      culture: sm[k] ? sm[k].culture : null,
      canOwnShips: naval[k] || 0,
      menAtSave: men[k] != null ? men[k] : null,
      settlementsAtSave: setts[k] != null ? setts[k] : null,
      navalAtSave: navalNow[k] || 0,
      bestSettlementTier: tierNow[k] != null ? tierNow[k] : null,
      resourceWealth: resourceWealth[k] || null,
      farmWealth: farmWealth[k] || null,
      economy: economy[k] || null,
      buildAppetite: buildAppetite[k] || null,
      symptoms: sym[k] || null,
    };
  }

  // Map-wide median trade value per region, so "poor land" is measured against
  // this campaign rather than an invented threshold.
  let medianTradePerRegion = null;
  {
    const vals = Object.values(resourceWealth).filter((r) => r && r.regions > 0).map((r) => r.tradeValuePerRegion).sort((a, b) => a - b);
    if (vals.length) medianTradePerRegion = vals[Math.floor(vals.length / 2)];
  }
  let medianFarm = null;
  {
    const vals = Object.values(farmWealth).filter((r) => r && r.regions > 0).map((r) => r.farmAvg).sort((a, b) => a - b);
    if (vals.length) medianFarm = vals[Math.floor(vals.length / 2)];
  }

  // ── leads: each names the FILE and KEY to edit, with its evidence ────────
  const leads = [];
  for (const [k, F] of Object.entries(factions)) {
    const s = F.symptoms;
    if (!s) continue;

    // 1. max aggression on a faction that demonstrably cannot act
    if (F.aggresiveness != null && F.aggresiveness >= 100 && (s.impossible > 0 || s.neverArrived > 0)) {
      const scale = (F.settlementsAtSave != null ? F.settlementsAtSave : F.startSettlements);
      if (scale != null && scale <= 3) {
        leads.push({
          severity: 3, faction: k,
          file: "feral_descr_ai_personality.txt",
          key: `personality ${F.aiPersonality} → diplomatic_priority ${F.diplomaticProfile} (aggresiveness ${F.aggresiveness})`,
          issue: `maximum aggression on a ${scale}-settlement faction that never executes`,
          suggestion: "retier to passive/super_passive so it consolidates instead of planning invasions it cannot staff",
          evidence: `${s.impossible} impossible campaign(s), ${s.neverArrived} order(s) that never arrived` +
            (F.menAtSave != null ? `, fields ${F.menAtSave.toLocaleString()} men` : "") +
            (s.maxReq ? `, biggest ask ${s.maxReq.toLocaleString()} strength` : ""),
        });
      }
    }

    // 2. wants overseas targets but has no navy and never gets one
    if (s.neverArrived > 0 && (F.startAdmirals === 0 || F.startAdmirals == null) && F.navalAtSave === 0) {
      leads.push({
        severity: F.canOwnShips > 0 ? 2 : 3, faction: k,
        file: "descr_strat.txt" + (F.canOwnShips === 0 ? " + export_descr_unit.txt" : ""),
        key: F.canOwnShips === 0 ? "no starting admiral AND no ship in its ownership list" : "no starting admiral",
        issue: `${s.neverArrived} order(s) never arrived and the faction has no fleet at start or at save time`,
        suggestion: F.canOwnShips === 0
          ? "add the faction to a naval unit's `ownership` line (EDU) — it currently cannot own any ship — or drop its overseas objectives"
          : "give it a starting transport in descr_strat, or its overseas objectives will never execute",
        evidence: `startAdmirals=${F.startAdmirals ?? "?"} , shipTypesOwnable=${F.canOwnShips}, navalAtSave=${F.navalAtSave}`,
      });
    }

    // 3. campaign asks wildly beyond the faction's whole army
    if (s.impossible > 0 && F.menAtSave != null && s.maxReq > 0 && F.menAtSave > 0 && s.maxReq > F.menAtSave * 4) {
      leads.push({
        severity: 2, faction: k,
        file: "descr_strat.txt",
        key: "starting army / economy for this faction",
        issue: `campaign strength asks reach ${s.maxReq.toLocaleString()} while the faction fields ${F.menAtSave.toLocaleString()} men in total`,
        suggestion: "either thicken its starting forces/income so an offensive is reachable, or expect it to sit passive all game",
        evidence: `${s.impossible} impossible campaign(s); holds ${F.settlementsAtSave ?? "?"} settlement(s); start units ${F.startUnits ?? "?"}, start denari ${F.startDenari ?? "?"}`,
      });
    }

    // 3b. recruitment-capped: it isn't poverty, the faction structurally cannot
    //     field better troops (RIS gates units on military_industrial_complex tier)
    if (s.recruitBlocked > 0 && s.micMax != null) {
      leads.push({
        severity: 3, faction: k,
        file: "export_descr_buildings.txt + feral_descr_ai_personality.txt",
        key: `military_industrial_complex tier ${s.micMax} (mic_tier_* recruit gates) / building_priority ${F.buildingProfile || "(unmapped)"}`,
        issue: `RECRUITMENT-capped: ${s.recruitBlocked} impossible campaign(s) while its best military infrastructure is tier ${s.micMax}` +
          (s.micMissing != null ? ` and ${s.micMissing}/${s.micTowns} of its towns have none at all` : ""),
        suggestion: "this faction cannot recruit the troops its own campaigns demand — either lower the mic tier that unlocks mid-tier units, make mic cheaper/faster, or raise its weight in this faction's building_priority",
        evidence: `biggest ask ${s.maxReq.toLocaleString()} strength` + (F.menAtSave != null ? `, fields ${F.menAtSave.toLocaleString()} men` : "") + `, holds ${F.settlementsAtSave ?? "?"} settlement(s)`,
      });
    }
    // 3c. income-limited: infrastructure is fine, the money/production isn't.
    //     Quantified against the map: how resource-rich is its land really?
    if (s.incomeBlocked > 0 && !s.recruitBlocked) {
      const rw = F.resourceWealth;
      const poorLand = rw && medianTradePerRegion != null && rw.tradeValuePerRegion < medianTradePerRegion * 0.6;
      leads.push({
        severity: poorLand ? 3 : 2, faction: k,
        file: poorLand ? "descr_strat.txt (resource placements) + descr_sm_resources.txt (trade values)" : "descr_strat.txt + descr_sm_resources.txt",
        key: poorLand ? "regional resource endowment for this faction's provinces" : "starting economy / regional resources for this faction",
        issue: `INCOME-limited: ${s.incomeBlocked} impossible campaign(s) despite adequate military infrastructure (tier ${s.micMax})` +
          (rw && medianTradePerRegion != null
            ? (poorLand
              ? ` — and its land IS genuinely poor: ${rw.tradeValuePerRegion} trade value per region vs a map median of ${medianTradePerRegion}`
              // stating the negative matters: it stops anyone "fixing" resources that are already normal
              : ` — but its land is NOT the problem (${rw.tradeValuePerRegion} trade value per region vs a map median of ${medianTradePerRegion}), so look at tax base / settlement size / army upkeep instead of resources`)
            : ""),
        suggestion: poorLand
          ? "this faction sits on low-value land — add/raise resources in its provinces (descr_strat resource lines) or raise those resource trade values, rather than touching the AI profile"
          : "its towns can build the troops and its land is ordinary — the shortfall is tax base or upkeep, so look at settlement growth (population/farm level) and army maintenance rather than resources or the AI profile",
        evidence: `biggest ask ${s.maxReq.toLocaleString()} strength` +
          (F.menAtSave != null ? `, fields ${F.menAtSave.toLocaleString()} men` : "") +
          (F.startDenari != null ? `, started with ${F.startDenari.toLocaleString()} denari` : "") +
          (rw ? `; ${rw.resources} resource(s) across ${rw.regions} region(s), total trade value ${rw.tradeValue}` + (rw.topResource ? `, best is ${rw.topResource}` : "") : ""),
      });
    }
    // 3d. rich but stalled — the engine's own finance report says money is NOT
    //     the constraint, so income/resource tuning is the WRONG lever here.
    if (s.byKind.rich_but_stalled) {
      const ec = F.economy, ba = F.buildAppetite;
      const micNote = s.micMax != null ? `military infrastructure tier ${s.micMax}` : "unknown infrastructure";
      leads.push({
        severity: 3, faction: k,
        file: "export_descr_buildings.txt (mic cost/time + tier gates)",
        key: `NOT descr_sm_resources — ${F.buildingProfile ? `building_priority ${F.buildingProfile}` : "building_priority"} / mic construction cost & time`,
        issue: `rich but stalled: ${ec ? Math.round(ec.richPct * 100) : "?"}% of its turns were financially rich` +
          (ec ? ` (avg spending headroom ${ec.avgSpendMax.toLocaleString()})` : "") +
          ` yet its campaigns never launched, at ${micNote}`,
        suggestion: "do NOT raise its income — it already has money it cannot convert into troops. Look at military-building cost/construction time and the recruit tier gates instead",
        evidence: (ba ? `it ranks military buildings up to priority ${ba.topMilitaryPriority.toLocaleString()}` + (ba.topMilitaryName ? ` (${ba.topMilitaryName})` : "") + `, and military options are ${Math.round(ba.militaryPct * 100)}% of the buildings it evaluates` : "no build-choice data") +
          (F.menAtSave != null ? `; fields ${F.menAtSave.toLocaleString()} men at save` : ""),
      });
    }
    // 3e. settlement-tier lock — PROVEN on the reference save: a faction's
    //     military infrastructure never exceeds its best settlement tier,
    //     because every mic level carries a settlement_min. Small factions are
    //     therefore permanently barred from the troop tiers their own campaigns
    //     require, no matter how much money they accumulate.
    if ((s.recruitBlocked > 0 || s.impossible > 0) && micLadder && F.bestSettlementTier != null) {
      const nextLv = "mic_" + (F.bestSettlementTier + 1);
      const need = micLadder[nextLv];
      if (need && need.settlementMinTier != null && need.settlementMinTier > F.bestSettlementTier) {
        leads.push({
          severity: 3, faction: k,
          file: "export_descr_buildings.txt",
          key: `military_industrial_complex ${nextLv} → settlement_min ${need.settlementMin} (cost ${need.cost}, ${need.turns} turns)`,
          issue: `SETTLEMENT-TIER LOCKED: its best town is tier ${F.bestSettlementTier} (${SETTLEMENT_TIERS[F.bestSettlementTier] || "?"}), so ${nextLv} is unreachable however rich it gets — and without it the troop tiers its campaigns demand do not exist for this faction`,
          suggestion: (() => {
            const fw = F.farmWealth;
            const poorFarm = fw && medianFarm != null && fw.farmAvg < medianFarm * 0.75;
            return poorFarm
              // if the land can't feed growth, raising the farm level is the
              // upstream fix — the settlement_min is only the symptom's gate
              ? `its provinces average Farm ${fw.farmAvg} against a map median of ${medianFarm}, so its towns will never grow into ${need.settlementMin} — raise the Farm level on its regions in descr_regions.txt, or lower ${nextLv}'s settlement_min`
              : `lower ${nextLv}'s settlement_min, or lower the mic_tier_* requirement on mid-tier units, or give this faction a settlement that can actually grow (its farm land is ordinary, so growth is not the blocker)`;
          })(),
          evidence: `${s.impossible} impossible campaign(s), biggest ask ${s.maxReq.toLocaleString()} strength` +
            (F.menAtSave != null ? `, fields ${F.menAtSave.toLocaleString()} men` : "") +
            (s.micMax != null ? `, military infrastructure tier ${s.micMax}` : "") +
            (F.economy ? `, ${Math.round(F.economy.richPct * 100)}% of turns financially rich` : ""),
        });
      }
    }
    // 4. orphaned live armies concentrated in one faction
    if (s.orphaned >= 5) {
      leads.push({
        severity: 2, faction: k,
        file: "feral_descr_ai_personality.txt",
        key: `military_priority ${F.militaryProfile || "(unmapped)"}`,
        issue: `${s.orphaned} armies still alive at save time received no further orders`,
        suggestion: "check this faction's military profile / resource priorities — live stacks are being forgotten rather than reassigned",
        evidence: `${s.byKind.abandoned || 0} abandonment(s) logged, ${s.orphaned} confirmed alive in the save`,
      });
    }
  }

  // ── WORLD-LEVEL lead: descr_character.txt starting_action_points ───────────
  // Not per-faction — one global value that governs how far every character can
  // move in a turn, and therefore how far the AI will wander from its cities.
  //
  // This lead exists because the RIS file documents its own tradeoff in a
  // comment, and the log measures the exact symptom that comment describes.
  // We are not theorising: we quote the modder's note back to them next to the
  // count, and let them decide. Nothing here asserts causation.
  const ap = parseActionPoints(files.character);
  if (ap && ap.value != null) {
    const stripFindings = findings.filter((f) => f.kind === "garrison_stripped");
    const unitsPulled = stripFindings.reduce((n, f) => n + (f.unitsLeaving || 0), 0);
    // Only worth raising when the symptom is actually present in the log.
    if (stripFindings.length >= 25) {
      // A threshold the FILE names (e.g. ";99 = AI doesn't leave cities
      // undefended") is far better evidence than any number we could pick — but
      // only the inline comment's own numbers may be quoted alongside its text.
      const noted = (ap.inlineThresholds || []).filter((t) => t < ap.value);
      const others = (ap.otherThresholds || []).filter((t) => t < ap.value);
      leads.push({
        severity: 3,
        faction: "all (world setting)",
        file: "descr_character.txt",
        key: `starting_action_points ${ap.value}`,
        issue:
          `${stripFindings.length} settlement(s) had their garrison pulled out by their own owner` +
          (unitsPulled ? ` (${unitsPulled.toLocaleString()} units removed in total)` : "") +
          ` — the movement budget every character starts with is the setting that governs how far the AI ranges from its cities`,
        suggestion:
          (noted.length
            // quote the inline comment verbatim next to ITS number — no paraphrase
            ? `the value is ${ap.value}; this line's own comment says of ${noted.join("/")}: "${ap.comment}". That comment is better authority on what to try than anything measured here.`
            : `try lowering starting_action_points below ${ap.value} and re-measuring`) +
          (others.length ? ` The file also mentions ${others.join(" and ")} nearby.` : "") +
          ` The Lab's before/after tab compares two runs per-turn, so the change is directly testable.`,
        evidence:
          `descr_character.txt:${ap.line} — ${ap.value}` +
          (ap.vanilla != null ? ` vs ${ap.vanilla} in vanilla RTW:R` : "") +
          (ap.nearbyComments && ap.nearbyComments.length ? ` · adjacent note: "${ap.nearbyComments[0]}"` : "") +
          ` · this is a single global value, so changing it affects every faction including the player`,
      });
    }
  }

  leads.sort((a, b) => b.severity - a.severity || (b.evidence || "").length - (a.evidence || "").length);
  return { factions, leads };
}

module.exports = { auditModFiles, parseAiPersonality, parseStratFactions, parseNavalOwners, parseSmFactions, parseMicLadder, factionResourceWealth, factionFarmWealth, parseActionPoints, SETTLEMENT_TIERS };
