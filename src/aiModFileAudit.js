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
//   export_descr_buildings.txt     — recruitment gating (naval especially).
//   descr_sm_resources.txt         — (reserved: resource values for economy
//                                    leads; parsed only if present.)
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

/**
 * auditModFiles({ findings, saveFacts, files })
 *   files: { aiPersonality, strat, smFactions, edu } — raw TEXT, any may be null
 * → { factions: {faction: facts}, leads: [ {severity, faction, file, key, issue, suggestion, evidence} ] }
 */
function auditModFiles({ findings = [], saveFacts = null, files = {}, economy = {}, buildAppetite = {} } = {}) {
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
      economy: economy[k] || null,
      buildAppetite: buildAppetite[k] || null,
      symptoms: sym[k] || null,
    };
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
    // 3c. income-limited: infrastructure is fine, the money/production isn't
    if (s.incomeBlocked > 0 && !s.recruitBlocked) {
      leads.push({
        severity: 2, faction: k,
        file: "descr_strat.txt + descr_sm_resources.txt",
        key: "starting economy / regional resources for this faction",
        issue: `INCOME-limited: ${s.incomeBlocked} impossible campaign(s) despite adequate military infrastructure (tier ${s.micMax})`,
        suggestion: "its towns can build the troops but it never affords them — check starting denari, regional resource values and trade access rather than the AI profile",
        evidence: `biggest ask ${s.maxReq.toLocaleString()} strength` + (F.menAtSave != null ? `, fields ${F.menAtSave.toLocaleString()} men` : "") + (F.startDenari != null ? `, started with ${F.startDenari.toLocaleString()} denari` : ""),
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
          suggestion: `lower ${nextLv}'s settlement_min, or lower the mic_tier_* requirement on mid-tier units, or give this faction a settlement that can actually grow`,
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
  leads.sort((a, b) => b.severity - a.severity || (b.evidence || "").length - (a.evidence || "").length);
  return { factions, leads };
}

module.exports = { auditModFiles, parseAiPersonality, parseStratFactions, parseNavalOwners, parseSmFactions, parseMicLadder, SETTLEMENT_TIERS };
