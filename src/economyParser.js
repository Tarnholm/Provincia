// economyParser.js — derive RTW's in-game "Financial Overview" (Finance & Family
// panel) economy figures for a faction from a parsed .sav.
//
// =============================================================================
// HEADLINE FINDING (why this module looks the way it does)
// =============================================================================
// The per-CATEGORY income/expenditure breakdown the in-game Financial Overview
// shows (Trade / Mining / Farming / Tax  and  Wages / Construction / Recruitment)
// is **NOT serialized in the save**. It is recomputed at runtime by the engine
// from buildings + resources + population + unit roster + tax policy. Confirmed
// exhaustively across the RIS corpus:
//   - findings-economics-2026-05-30.md  (no per-faction income ledger; only
//     treasury +0 and an AI accumulator at +4)
//   - findings-treasury-net-2026-06-01.md / -v2  (+4 is NOT net income — it is a
//     campaign-seed-dependent AI accumulator; do NOT surface it)
//   - findings-financial-overview-2026-06-02.md (this module's evidence doc):
//     a byte scan of the player settlement records (Rome/Arretium/Neapolis/...)
//     around the income field marker-1586 shows the income is a SINGLE combined
//     u32 scalar with NO adjacent trade/mining/farming/tax sub-fields (the whole
//     neighbourhood is zero-padding; the only other copy of the value is a
//     prev-turn snapshot at marker-1142). There is no per-settlement category
//     decomposition stored.
//   - SAVE-FORMAT-SPEC.md §2 "NO per-faction income/expense/tax ledger exists".
//
// WHAT *IS* RELIABLY AVAILABLE (CONFIRMED), and what this module returns:
//   - GROSS turn income (total only)  = Σ over the faction's settlements of the
//     per-settlement income field (settlementFields[city].income, marker-1586),
//     selected via ownerByCity. CONFIRMED against in-game numbers (Rome
//     924/949/1005) and against the econ-history block f11 (julii sum 6347 vs
//     f11 6350). This is the engine's actual gross income, but it arrives as ONE
//     number — the trade/mining/farming/tax split is not recoverable.
//   - TREASURY (start-of-turn balance)  = factions[name].treasury (record +0).
//   - NET turn income  = consecutive-turn delta of the f13 treasury checkpoints
//     (treasuryHistory). Only available from turn >= 3 (a faction needs >= 2
//     completed checkpoints), and the PLAYER faction's own f13 series reads
//     all-zeros, so net is typically null for the player. We expose it ONLY when
//     the caller passes a usable history series; otherwise null.
//   - ESTIMATED next-turn balance  = treasury + net, ONLY when net is non-null.
//
// WHAT IS NULL, AND WHY (honest, per the [[provincia-no-fallbacks]] rule):
//   - income.trade / income.mining / income.farming / income.tax  → null
//     (category split not stored; recomputed at runtime — never fabricate).
//   - income.other → null (no residual category exists to attribute).
//   - expenditure.upkeep / .construction / .recruitment / .other → null
//     (NO per-unit upkeep, NO construction/recruitment cost ledger is stored;
//     SAVE-FORMAT-SPEC §2/§6. Could in theory be APPROXIMATED by summing EDU
//     upkeep over the unit roster + reading queued build/recruit costs, but that
//     is a derivation/estimate, not a save field, so it is intentionally left
//     null here rather than surfaced as if it were the engine's number.)
//   - expenditure.total / net (when no history) / estimatedNextTurn (when no
//     net) → null.
//
// =============================================================================
// [[provincia-no-fallbacks]] — HARD PROJECT RULE
// =============================================================================
// This module NEVER fabricates a placeholder/default number. Every field that
// cannot be reliably cracked is returned as `null` (the UI shows "—"/unknown).
// `income.total` is non-null ONLY when at least one of the faction's settlements
// produced a numeric income; if a faction has no resolvable settlement income at
// all, income.total is null (not 0).
//
// =============================================================================
// FIELD OFFSETS (all relative to a settlement NAME marker, already decoded by
// settlementFieldsParser.js / buildingParser.findAllSettlementMarkers):
//   marker-1586  u32  income this turn (CONFIRMED; Rome 924/949/1005)
//   marker-1142  u32  prev-turn income snapshot (sibling copy; not used here)
// Faction treasury record (saveCrackerExtras.parseFactionTreasuries):
//   +0  i32  treasury (start-of-turn balance)   CONFIRMED
//   +4  i32  AI accumulator — NOT net income     DO NOT SURFACE
// Treasury history (saveCrackerExtras.parseFactionTreasuryHistory):
//   f13 per-turn end-of-turn treasury checkpoint; net = checkpoint[n]-checkpoint[n-1]
// =============================================================================
//
// This is a PURE function module: it does NOT read the save itself for the
// confirmed fields — it consumes the output of saveCracker.crackSave() (passed
// as `context`), which already extracts settlementFields, ownerByCity, factions
// (treasury) and turn. It only touches the buffer (optional) for the OPTIONAL
// net-income history, which crackSave does not roll up per-faction.

"use strict";

// Build the canonical empty/unknown shape for one faction. Everything that is
// not reliably cracked is null (never a fabricated 0 — [[provincia-no-fallbacks]]).
function emptyFactionEconomy() {
  return {
    income: {
      trade: null,        // category split NOT stored in the save
      mining: null,       // category split NOT stored in the save
      farming: null,      // category split NOT stored in the save
      tax: null,          // category split NOT stored in the save
      other: null,        // no residual category to attribute
      total: null,        // = Σ settlement income (CONFIRMED) when available
    },
    expenditure: {
      upkeep: null,       // no per-unit upkeep ledger in the save
      construction: null, // no construction cost ledger in the save
      recruitment: null,  // no recruitment cost ledger in the save
      other: null,
      total: null,
    },
    net: null,            // CONFIRMED only from f13 history delta (turn >= 3, non-player)
    treasury: null,       // CONFIRMED record +0 (start-of-turn balance)
    estimatedNextTurn: null, // treasury + net, only when net is known
    // Provenance / confidence so the UI/debug log can be honest about coverage.
    _confidence: {
      incomeTotal: "none",       // "confirmed" once summed, else "none"
      incomeBreakdown: "not-stored",
      expenditure: "not-stored",
      net: "unavailable",        // "confirmed" if a history delta was used
      treasury: "none",
    },
  };
}

// Sum the per-settlement income (marker-1586) over a faction's settlements.
// Returns { total, citiesWithIncome, citiesTotal } — total is null when NO city
// produced a numeric income (so callers never see a fabricated 0).
function sumSettlementIncome(factionName, ownerByCity, settlementFields) {
  let total = 0;
  let citiesWithIncome = 0;
  let citiesTotal = 0;
  if (ownerByCity && settlementFields) {
    for (const [city, owner] of Object.entries(ownerByCity)) {
      if (owner !== factionName) continue;
      citiesTotal++;
      const f = settlementFields[city];
      const inc = f ? f.income : null;
      if (typeof inc === "number" && Number.isFinite(inc)) {
        total += inc;
        citiesWithIncome++;
      }
    }
  }
  return {
    total: citiesWithIncome > 0 ? total : null,
    citiesWithIncome,
    citiesTotal,
  };
}

// Net income from a per-faction f13 treasury-checkpoint history series.
// `history` (if provided) is the array of end-of-turn checkpoints for the
// faction (e.g. crackSave-side parseFactionTreasuryHistory[name]). Net = the
// delta of the last two checkpoints. Returns null when fewer than 2 checkpoints
// exist (turn < 3) or the player's all-zero series. NEVER fabricated.
function netFromHistory(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (a === 0 && b === 0) return null; // player's own series reads all-zeros
  return b - a;
}

/**
 * parseFactionEconomy — derive the Financial Overview economy object per faction.
 *
 * @param {Buffer|null} buffer  the raw .sav buffer. OPTIONAL: only used if the
 *        caller wants the (rarely-available) net-income history and did not
 *        pre-supply it in context.treasuryHistory. Pass null to skip all buffer
 *        access — the confirmed fields come entirely from `context`.
 * @param {object} context  the output of saveCracker.crackSave(buf, modDir).
 *        Required keys consumed:
 *          - context.ownerByCity        { city: factionName }
 *          - context.settlementFields   { city: { income, ... } }
 *          - context.factions           { name: { treasury, ... } }
 *          - context.playerFaction      (string) — used to pick the focus faction
 *          - context.turn               (number) — informational
 *        Optional:
 *          - context.treasuryHistory    { name: number[] }  per-faction f13 series
 *                 (NOT produced by crackSave by default; pass it if you have it,
 *                  e.g. from parseFactionTreasuryHistory). Used for `net`.
 *          - context.factionsOnly       (string[]) — restrict output to these
 *                 faction names (default: every faction in context.factions).
 * @returns {{ byFaction: Object, playerFaction: string|null, turn: number|null,
 *             _meta: object }}
 *          byFaction[name] = {
 *            income: { trade, mining, farming, tax, other, total },
 *            expenditure: { upkeep, construction, recruitment, other, total },
 *            net, treasury, estimatedNextTurn, _confidence
 *          }
 *          (null for any field not reliably cracked — see header.)
 */
function parseFactionEconomy(buffer, context) {
  const ctx = context || {};
  const ownerByCity = ctx.ownerByCity || {};
  const settlementFields = ctx.settlementFields || {};
  const factions = ctx.factions || {};
  const treasuryHistory = ctx.treasuryHistory || null;

  // Which factions to compute for.
  let names;
  if (Array.isArray(ctx.factionsOnly) && ctx.factionsOnly.length) {
    names = ctx.factionsOnly.slice();
  } else {
    // Union of factions present in the treasury map and as a city owner, so we
    // also cover factions that have settlements but no treasury record (rare).
    const set = new Set(Object.keys(factions));
    for (const owner of Object.values(ownerByCity)) if (owner) set.add(owner);
    names = [...set];
  }

  const byFaction = {};
  let factionsWithIncome = 0;

  for (const name of names) {
    const eco = emptyFactionEconomy();

    // ── Treasury (start-of-turn balance) — CONFIRMED record +0 ──────────────
    const frec = factions[name];
    if (frec && typeof frec.treasury === "number" && Number.isFinite(frec.treasury)) {
      eco.treasury = frec.treasury;
      eco._confidence.treasury = "confirmed";
    }

    // ── Gross income total = Σ settlement income — CONFIRMED ────────────────
    const inc = sumSettlementIncome(name, ownerByCity, settlementFields);
    if (inc.total != null) {
      eco.income.total = inc.total;
      eco.income.other = null; // we have a total but NO breakdown — other stays null
      eco._confidence.incomeTotal = "confirmed";
      factionsWithIncome++;
    }
    // trade/mining/farming/tax stay null: not stored in the save.

    // ── Net income — CONFIRMED only from a history delta (turn >= 3) ─────────
    const series = treasuryHistory ? treasuryHistory[name] : null;
    const net = netFromHistory(series);
    if (net != null) {
      eco.net = net;
      eco._confidence.net = "confirmed";
      if (eco.treasury != null) {
        // Estimated next-turn balance = current treasury + this turn's net.
        eco.estimatedNextTurn = eco.treasury + net;
      }
    }

    byFaction[name] = eco;
  }

  return {
    byFaction,
    playerFaction: ctx.playerFaction || null,
    turn: typeof ctx.turn === "number" ? ctx.turn : null,
    _meta: {
      factions: names.length,
      factionsWithIncome,
      // Categories we deliberately leave null and why (kept here so a debug
      // dump / provincia.log line can state the coverage honestly).
      unstoredCategories: [
        "income.trade", "income.mining", "income.farming", "income.tax",
        "expenditure.upkeep", "expenditure.construction", "expenditure.recruitment",
      ],
      note: "Per-category income/expenditure breakdown is recomputed at runtime " +
            "and is NOT stored in the save; only gross income total (Σ settlement " +
            "income), treasury, and (turn>=3, non-player) net are recoverable.",
    },
  };
}

module.exports = {
  parseFactionEconomy,
  // Exported helpers for unit testing / reuse.
  sumSettlementIncome,
  netFromHistory,
  emptyFactionEconomy,
};
