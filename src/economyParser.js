// economyParser.js — derive RTW's in-game "Financial Overview" (Finance & Family
// panel) economy figures for a faction from a parsed .sav.
//
// =============================================================================
// HEADLINE FINDING (2026-06-02 BREAKTHROUGH — the breakdown IS stored)
// =============================================================================
// The per-CATEGORY income/expenditure breakdown the in-game Financial Overview
// shows (Farming / Mining / Trade / Merchants / Taxes / income-Other  and
// Wages / Army-upkeep / Recruitment / Construction / expenditure-Other) **IS
// serialized in the save**, in the per-faction econ-history block that sits
// immediately before each faction record (the same N×23-i32 block whose field
// 13 is the per-turn treasury checkpoint — findings-treasury-history-keying).
//
// A prior pass (findings-financial-overview-2026-06-02.md /
// findings-financial-breakdown-2026-06-02.md) FOUND these exact integers in the
// Julii block ("18105, 8928, 4426, 2026, 26594, 2242") but DISCARDED them after
// wrongly assuming the gross income was 6347 (the per-settlement marker-1586 sum
// — a RED HERRING; 6350 is the *Wages* line rounded, not the income total). The
// MAPPED follow-up (findings-financial-overview-MAPPED-2026-06-02.md) corrects
// that: the block's LAST (current-turn) 23-i32 sub-block holds the breakdown.
//
// SLOT → CATEGORY MAP (block-field index within the final 23-i32 sub-block):
//   INCOME side (slots 0..10):
//     f0  = income.farming      (CONFIRMED: Julii 18105)
//     f1  = income.taxes        (CONFIRMED: Julii 8928)
//     f2  = income.mining       (INFERRED-STRONG: small/rare 5th income slot; 0 for
//                                Julii, 900 antigonid / 480 seleucid — the only spare
//                                nonzero income slot. Cross-faction CONFIRMS the
//                                mining label: of the 8 f2>0 factions on this save,
//                                6 own a `mines` building and the other 2 own
//                                resource-extraction industries; every f2=0-but-owns-
//                                `mines` faction has only a base L0 mine (pays 0).
//                                Merchants is RULED OUT — this save has 0 merchant
//                                agents (0/1049 characters) yet 8 factions show f2>0,
//                                so f2 cannot be Merchants. Not crib-pinned only
//                                because Julii's own mining is 0; see caveat.)
//     f3  = income.trade        (CONFIRMED: Julii 4426)
//     f9  = income.other        (CONFIRMED: Julii 2026)
//     f4-f8, f10 = always 0 across the whole corpus (reserved category slots,
//                  incl. Merchants — 0 in this corpus; not individually pinned).
//   EXPENDITURE side (slots 11..22):
//     f11 = expenditure.wages       (CONFIRMED: Julii 6350; generals/admirals/agents)
//     f12 = expenditure.army_upkeep (CONFIRMED: Julii 26594)
//     f22 = expenditure.other       (CONFIRMED: Julii 2242)
//     f13-f21 = 0 in the JULII crib save only (it neither recruited nor built that
//               turn). The 2026-06-07 turn-2 census (239 RIS factions,
//               findings-econ-slots-and-tax-mult-2026-06-07.md) OVERTURNS "always 0":
//                 f13 = RECRUITMENT  (215/239 nonzero, 700..80714; AI turn-1 army
//                       rush, e.g. Carthage 32450) — strongly pinned.
//                 f14 = CONSTRUCTION (39/239, round 1000/2000 building costs).
//                 f19 = DIPLOMACY expenditure — smoking gun: lysiad pays 805 (f19)
//                       and seleucid receives 805 (f8 income), a clean tribute pair.
//                 f15 (102/239, minor factions only), f16 (5/239) = stored but
//                       label UNPINNED (need per-faction in-game cribs; no fabrication).
//               Decode still sums the WHOLE expenditure half so totals/net stay
//               correct; these surface via `unattributed` until labelled. Truly
//               always-zero now: f6 f7 f10 f17 f18 f20 f21.
//     (INCOME f4 [2/239], f5 [11/239 tiny], f8 [DIPLOMACY income, 805 seleucid] are
//      the matching newly-seen income slots — see the same findings doc.)
//
//   income.total = f0+f1+f2+f3+f9   (Julii 33485 — matches in-game EXACTLY)
//   expenditure.total = f11+f12+f22 (Julii 35186 — matches in-game EXACTLY)
//   net = income.total - expenditure.total   (Julii -1701 — matches in-game)
//
// VALIDATION:
//   - Julii (save_Juliieco1.sav): all three crib sums match to the denarius
//     (33485 / 35186 / -1701). No rounding delta.
//   - Cross-faction: 220/220 faction blocks in the same save are internally
//     consistent (every income slot ≥0, every expenditure slot ≥0; net = inc-exp
//     by construction). carthage 64935/43153, ptolemaic 132813/120344, etc.
//   - Slot set is stable across julii1/julii3 saves (income {0,1,2,3,9},
//     expenditure {11,12,22}; all other slots zero).
//
// =============================================================================
// MERCHANTS / RECRUITMENT / CONSTRUCTION (0 in this corpus)
// =============================================================================
// The in-game cribs list Merchants, Recruitment and Construction all = 0 for the
// Julii save, and the engine income/expenditure TOTALS are FULLY accounted by the
// pinned nonzero slots (no residual): so these three categories are genuinely 0
// here and are reported as 0 ONLY when the pinned slots sum exactly to the income
// / expenditure total (no unattributed remainder). Their exact block slots are
// NOT individually pinned (they are zero in every save in this corpus), so if a
// future save shows a nonzero merchants/recruitment/construction line in an
// unattributed slot, the parser surfaces it as `_unattributed` rather than
// guessing the label — [[provincia-no-fallbacks]] (never fabricate a category).
//
// =============================================================================
// PER-LINE COUNTS (Generals&Admirals 34, Units 82) — NOT a stored finance field
// =============================================================================
// The Financial Overview's per-line counts ("Generals & Admirals: 34; Agents: 0"
// on the Wages line; "Units: 82" on Army-upkeep; "Buildings: 0" on Construction)
// are NOT serialized as dedicated finance fields. A file-wide crib search for
// 34 and 82 (i32/i16, aligned and unaligned) found NO clean count record near
// the Julii faction record or its econ-history block: the only 34/82 adjacencies
// sit in unrelated dense small-int noise (offset ~34.2M), and the lone isolated
// 34/82 pair (offset 19237816, Δ52) has junk between them — not a counts struct.
// The reserved finance slots f4–f8/f10/f13–f21 are all 0 for Julii, but Julii's
// counts are nonzero (34/82), so the counts are NOT in the 23-i32 block either.
// Conclusion: the panel COUNTS these at runtime from the character roster and the
// army/unit lists. They are therefore DERIVED from crackSave (characters/armies/
// units), never read from a finance offset — [[provincia-no-fallbacks]] forbids
// inventing an offset. (To pin a stored count we would need a save where a count
// changes by a known delta with everything else fixed — and even then the engine
// likely recomputes it; this is a runtime tally, not a saved ledger field.)
//
// =============================================================================
// PER-SETTLEMENT income — a single pop-tax scalar, NO category split
// =============================================================================
// The per-settlement income field (settlement marker −1586) is EXACTLY
// population × DEFAULT_TAX_COEFFICIENT (corr(income,pop)=1.000 over all 25 Julii
// cities; Rome 9000→924, every 3000-pop city→308 regardless of coastal/inland).
// Its companion (−1582) is that value ×4.19 (a derived display figure). A
// controlled same-population PORT-vs-INLAND diff over the whole −1620..−1100
// window found NO field that varies with trade exposure and reads as small
// denarii: the only differing neighbours are packed million-scale state words
// (building/order/growth bitfields), not an income split. So there is NO
// per-settlement trade/farming/tax breakdown stored — the per-settlement record
// carries only the pop-derived tax scalar; the trade/farming/tax SPLIT exists
// only at the faction level (the f0/f1/f3 econ-block slots). The Σ per-settlement
// income (6347) is the pop-tax sum, NOT the income total (33485) — the historical
// RED HERRING.
//
// =============================================================================
// TOTALS / NET — derived (summed), not stored as discrete fields
// =============================================================================
// The in-game income total (33485), expenditure total (35186) and net (−1701)
// are NOT stored as their own i32 fields anywhere in the faction region (a search
// of ehStart−400..core+3000 finds none of them). They are computed by summing the
// block's income / expenditure halves; net = income.total − expenditure.total
// (matches the in-game net to the denarius). The player's f13 per-turn treasury
// checkpoint is 0 for the in-progress turn (engine-zeroed), so there is no
// alternative stored net — the summed block net is the authoritative source and
// is what this module returns. The faction-record +4 field (−58483 for Julii) is
// the AI treasury accumulator, NOT income (see rtw-economy-and-regression-gate).
//
// =============================================================================
// [[provincia-no-fallbacks]] — HARD PROJECT RULE
// =============================================================================
// This module NEVER fabricates a placeholder/default number. A faction whose
// econ-history breakdown block cannot be located returns null for every breakdown
// field (the UI shows "—"/unknown). A genuine STORED 0 (e.g. Julii Mining 0) IS
// reported as 0 — that is the engine's real value, not a fabricated default.
//
// =============================================================================
// ATTRIBUTION (which block belongs to which faction)
// =============================================================================
// The econ-history block precedes each faction record (parseFactionTreasuries
// scans them in file order; field 13 = treasury checkpoint). crackSave's
// `factions` map is keyed by name in faction-id order, but a phantom/zero record
// in the raw scan introduces a one-slot drift partway through (the same drift the
// treasury-history keying note documents). We anchor by the faction record's
// treasury at +0: walk faction names in order and greedily consume the next raw
// record (within a tiny window) whose +0 treasury equals that faction's treasury.
// This matched 238/239 factions on the Julii save and keeps the PLAYER (record 0)
// exact. A faction we cannot align to a block gets a null breakdown (never faked).
//
// This module consumes the output of saveCracker.crackSave() (passed as
// `context`) for owners/settlement income/treasury, and reads the raw `buffer`
// (via saveCrackerExtras.parseFactionTreasuries) for the econ-history blocks.

"use strict";

const path = require("path");
// Read-only use of the sibling cracker extras (faction-record scanner). We do NOT
// edit it — only call parseFactionTreasuries to locate each faction record.
let parseFactionTreasuries = null;
try {
  ({ parseFactionTreasuries } = require(path.join(__dirname, "saveCrackerExtras.js")));
} catch (_e) {
  // If unavailable (e.g. isolated unit test of the pure helpers), the buffer-
  // backed breakdown simply stays null and the pure paths still work.
  parseFactionTreasuries = null;
}

// ── Econ-history block layout ────────────────────────────────────────────────
const BLOCK_STRIDE = 23; // i32 per per-turn sub-block
// Slot → category. (See SLOT → CATEGORY MAP in the header.)
const INCOME_SLOTS = { farming: 0, taxes: 1, mining: 2, trade: 3, other: 9 };
const EXPENDITURE_SLOTS = { wages: 11, army_upkeep: 12, other: 22 };
// Every slot we read on each side, used to detect any UNATTRIBUTED nonzero slot.
const INCOME_SLOT_SET = new Set(Object.values(INCOME_SLOTS));
const EXPENDITURE_SLOT_SET = new Set(Object.values(EXPENDITURE_SLOTS));
const INCOME_SLOT_RANGE = [0, 10];        // slots 0..10 are the income half
const EXPENDITURE_SLOT_RANGE = [11, 22];  // slots 11..22 are the expenditure half

// Observed effective tax yield per unit of population at the default ("normal")
// tax bracket. Retained for the legacy DERIVED estimate (incomeEstimate.tax);
// now that the real Taxes line is stored we keep the estimate only as a sanity
// cross-check / pre-breakthrough fallback. See findings-financial-breakdown §B/§C1.
const DEFAULT_TAX_COEFFICIENT = 0.10264;

// EDB metal-export industry chains → the player's un-cancelled mine_resource bonus
// (legacy DERIVED mining estimate; the real Mining line is now stored at slot f2).
const MINE_EXPORT_BONUS = {
  tin_industry: 5,    tin_supply: 5,
  copper_industry: 4, copper_supply: 4,
  lead_industry: 2,   lead_supply: 2,
  iron_industry: 2,   iron_supply: 2,
};
const PLAYER_ZERO_MINE_CHAINS = new Set(["mines", "mines+1", "hinterland_mines_silver"]);

// Build the canonical empty/unknown shape for one faction. Everything that is
// not reliably cracked is null (never a fabricated 0 — [[provincia-no-fallbacks]]).
function emptyFactionEconomy() {
  return {
    income: {
      // NOW STORED (2026-06-02 breakthrough) — null until the breakdown block is
      // located, then the engine's real per-category figure (a genuine stored 0
      // stays 0, e.g. Julii Mining 0).
      farming: null,
      mining: null,
      trade: null,
      merchants: null,   // 0 in this corpus; reported 0 only when fully accounted
      taxes: null,
      // back-compat alias of `taxes` (older callers/tests used `tax`)
      tax: null,
      other: null,
      total: null,       // = Σ income slots from the block (CONFIRMED Julii 33485)
    },
    expenditure: {
      wages: null,        // STORED slot f11 (CONFIRMED Julii 6350)
      army_upkeep: null,  // STORED slot f12 (CONFIRMED Julii 26594)
      recruitment: null,  // 0 in this corpus; reported 0 only when fully accounted
      construction: null, // 0 in this corpus; reported 0 only when fully accounted
      other: null,        // STORED slot f22 (CONFIRMED Julii 2242)
      // back-compat alias: older callers used `upkeep` for army upkeep.
      upkeep: null,
      total: null,        // = Σ expenditure slots (CONFIRMED Julii 35186)
    },
    // DERIVED (NOT stored) estimates, kept for back-compat / sanity cross-check.
    // Now that the real lines are stored, these are informational only.
    incomeEstimate: {
      tax: null,
      mining: null,
      estimated: true,
      taxCoefficient: null,
      citiesWithPopulation: 0,
      citiesWithMine: 0,
      miningContributors: [],
      method: "tax: population×taxCoefficient(default normal bracket); " +
              "mining: Σ EDB mine_resource bonus from metal-export industries",
      caveat: "Legacy derivation kept as a cross-check; the REAL Tax/Mining lines " +
              "are now read from the stored breakdown block (income.taxes / " +
              "income.mining).",
    },
    net: null,            // = income.total - expenditure.total (STORED breakdown), else history delta
    treasury: null,       // CONFIRMED record +0 (start-of-turn balance)
    estimatedNextTurn: null, // treasury + net, only when net is known
    _confidence: {
      incomeTotal: "none",
      incomeBreakdown: "not-located", // → "stored" once the block is read
      expenditure: "not-located",     // → "stored" once the block is read
      net: "unavailable",             // → "stored" (inc-exp) or "history" (delta)
      treasury: "none",
      // The income.mining slot (f2) label confidence. The slot VALUE is stored
      // exactly; only the category LABEL is cross-faction-inferred (see header):
      // → "inferred-strong" once read (f2>0 tracks mine/resource-industry
      // ownership; Merchants ruled out — no merchant agents exist in this corpus).
      mining: "none",
    },
    // Set when a nonzero income/expenditure slot falls OUTSIDE the pinned set
    // (so the UI never silently drops engine money). Normally empty.
    _unattributed: null,
  };
}

// Sum the per-settlement income (marker-1586) over a faction's settlements.
// Kept for back-compat / sanity (gross income cross-check). The authoritative
// income total now comes from the stored breakdown block.
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

// DERIVED population-based TAX estimate (legacy; cross-check only).
function estimateTaxIncome(factionName, ownerByCity, settlementFields, coefficient) {
  const k = (typeof coefficient === "number" && Number.isFinite(coefficient))
    ? coefficient : DEFAULT_TAX_COEFFICIENT;
  let popSum = 0;
  let citiesWithPopulation = 0;
  if (ownerByCity && settlementFields) {
    for (const [city, owner] of Object.entries(ownerByCity)) {
      if (owner !== factionName) continue;
      const f = settlementFields[city];
      const pop = f ? f.committedPopulation : null;
      if (typeof pop === "number" && Number.isFinite(pop) && pop > 0) {
        popSum += pop;
        citiesWithPopulation++;
      }
    }
  }
  return {
    tax: citiesWithPopulation > 0 ? Math.round(popSum * k) : null,
    citiesWithPopulation,
    coefficient: k,
  };
}

// DERIVED MINING income (legacy EDB-table estimate; cross-check only).
function deriveMiningIncome(factionName, ownerByCity, settlements) {
  if (!Array.isArray(settlements) || !ownerByCity) {
    return { mining: null, citiesWithMine: 0, contributingCities: [] };
  }
  let mining = 0;
  let citiesWithMine = 0;
  const contributingCities = [];
  let sawAnyFactionCity = false;
  for (const s of settlements) {
    if (!s || !s.name) continue;
    if (ownerByCity[s.name] !== factionName) continue;
    sawAnyFactionCity = true;
    const buildings = Array.isArray(s.buildings) ? s.buildings : [];
    let cityMine = 0;
    let hasMineChain = false;
    for (const b of buildings) {
      const n = b && b.name;
      if (!n) continue;
      if (PLAYER_ZERO_MINE_CHAINS.has(n)) hasMineChain = true;
      const bonus = MINE_EXPORT_BONUS[n];
      if (typeof bonus === "number") {
        cityMine += bonus;
        hasMineChain = true;
      }
    }
    if (hasMineChain) citiesWithMine++;
    if (cityMine > 0) contributingCities.push({ city: s.name, mining: cityMine });
    mining += cityMine;
  }
  return {
    mining: sawAnyFactionCity ? mining : null,
    citiesWithMine,
    contributingCities,
  };
}

// Net income from a per-faction f13 treasury-checkpoint history series (legacy
// path; only used when the stored breakdown block is unavailable).
function netFromHistory(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const a = history[history.length - 2];
  const b = history[history.length - 1];
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (a === 0 && b === 0) return null;
  return b - a;
}

// ── Econ-history block reader ────────────────────────────────────────────────
// Walk backward from a faction record to its self-pointer-framed econ-history
// object header (same logic as saveCrackerExtras.findEconHistoryStart).
function findEconHistoryStart(buf, core) {
  for (let off = core - 4; off >= core - 60000 && off >= 0; off -= 4) {
    if (buf.readUInt32LE(off) === off) return off;
  }
  return -1;
}

// Read the per-faction econ-history 23-i32 sub-block to use for the Financial
// Overview. Returns the int32[23] array, or null if no block is present/parseable.
//
// 2026-06-07 FIX (turn-2+ saves): the econ-history grows one 23-i32 sub-block per
// turn; the LAST sub-block is the CURRENT (in-progress) turn. At a turn-START
// autosave the engine has already booked this turn's UPKEEP (slots 11/12/22) but
// has NOT yet computed this turn's INCOME (slots 0/1/2/3/9 = 0) for NON-player
// factions — so the literal last block decodes to income 0 − upkeep = a large
// bogus negative net (e.g. Carthage −37288 on "Gades Turn 2 Start"). The player's
// own last block IS income-populated (the engine projects the player's income),
// so this only bit AI factions. We therefore use the MOST RECENT sub-block that
// actually carries income (the last completed/projected turn); we fall back to the
// literal last block only if none has income (turn-1 saves have a single
// income-populated block, so they are unaffected). Verified across all 239 records
// on the turn-2 corpus: 218 corrected, Carthage −37288 → +21651, player unchanged.
function readFinancialBlock(buf, core) {
  const start = findEconHistoryStart(buf, core);
  if (start < 0) return null;
  const f = [];
  for (let o = start; o + 4 <= core; o += 4) f.push(buf.readInt32LE(o));
  // [0]=selfptr, [1]=turnSerial, then N×23 blocks, [last]=faction marker.
  const body = f.slice(2, f.length - 1);
  if (body.length < BLOCK_STRIDE || body.length % BLOCK_STRIDE !== 0) return null;
  const nBlocks = body.length / BLOCK_STRIDE;
  const blockAt = (b) => body.slice(b * BLOCK_STRIDE, (b + 1) * BLOCK_STRIDE);
  const incomeHalf = (blk) => {
    let s = 0;
    for (let i = INCOME_SLOT_RANGE[0]; i <= INCOME_SLOT_RANGE[1]; i++) s += Number.isFinite(blk[i]) ? blk[i] : 0;
    return s;
  };
  // most recent sub-block WITH income (skip trailing pre-income in-progress turns)
  for (let b = nBlocks - 1; b >= 0; b--) {
    const blk = blockAt(b);
    if (incomeHalf(blk) > 0) return blk;
  }
  return blockAt(nBlocks - 1); // none had income — preserve prior behaviour
}

// Turn a raw int32[23] block into a Financial Overview breakdown object, or null
// if the block carries no economy (all the income+expenditure slots are zero —
// e.g. a freshly-spawned faction before its first turn).
function decodeFinancialBlock(block) {
  if (!Array.isArray(block) || block.length < BLOCK_STRIDE) return null;
  const at = (i) => (Number.isFinite(block[i]) ? block[i] : 0);

  const income = {
    farming: at(INCOME_SLOTS.farming),
    taxes: at(INCOME_SLOTS.taxes),
    mining: at(INCOME_SLOTS.mining),
    trade: at(INCOME_SLOTS.trade),
    other: at(INCOME_SLOTS.other),
  };
  const expenditure = {
    wages: at(EXPENDITURE_SLOTS.wages),
    army_upkeep: at(EXPENDITURE_SLOTS.army_upkeep),
    other: at(EXPENDITURE_SLOTS.other),
  };

  // Engine totals = sum over the WHOLE half (every slot, so any nonzero slot we
  // have not individually labelled is still counted toward the total — money is
  // never silently dropped).
  let incomeTotal = 0;
  for (let s = INCOME_SLOT_RANGE[0]; s <= INCOME_SLOT_RANGE[1]; s++) incomeTotal += at(s);
  let expenditureTotal = 0;
  for (let s = EXPENDITURE_SLOT_RANGE[0]; s <= EXPENDITURE_SLOT_RANGE[1]; s++) expenditureTotal += at(s);

  if (incomeTotal === 0 && expenditureTotal === 0) return null; // no economy yet

  // Detect any nonzero slot OUTSIDE the pinned set (would be an unlabelled
  // merchants/recruitment/construction line). Normally none in this corpus.
  const unattributed = [];
  for (let s = INCOME_SLOT_RANGE[0]; s <= INCOME_SLOT_RANGE[1]; s++) {
    if (!INCOME_SLOT_SET.has(s) && at(s) !== 0) unattributed.push({ slot: s, side: "income", value: at(s) });
  }
  for (let s = EXPENDITURE_SLOT_RANGE[0]; s <= EXPENDITURE_SLOT_RANGE[1]; s++) {
    if (!EXPENDITURE_SLOT_SET.has(s) && at(s) !== 0) unattributed.push({ slot: s, side: "expenditure", value: at(s) });
  }

  // Merchants / Recruitment / Construction: genuinely 0 in this corpus, and the
  // pinned slots fully account for the engine totals (no unattributed money), so
  // they are real stored zeros — report 0. If an unattributed slot DID carry
  // money we leave them null (we cannot honestly say which category it is).
  const fullyAccountedIncome = unattributed.every((u) => u.side !== "income");
  const fullyAccountedExpenditure = unattributed.every((u) => u.side !== "expenditure");

  return {
    income: {
      ...income,
      tax: income.taxes,                 // back-compat alias
      merchants: fullyAccountedIncome ? 0 : null,
      total: incomeTotal,
    },
    expenditure: {
      ...expenditure,
      upkeep: expenditure.army_upkeep,   // back-compat alias
      recruitment: fullyAccountedExpenditure ? 0 : null,
      construction: fullyAccountedExpenditure ? 0 : null,
      total: expenditureTotal,
    },
    net: incomeTotal - expenditureTotal,
    unattributed: unattributed.length ? unattributed : null,
  };
}

// Build { factionName: int32[23] block } by anchoring each raw faction record's
// econ-history block to a faction NAME via the +0 treasury (greedy in-order
// window match; tolerates the one-slot phantom-record drift). See header.
function buildFactionBlocks(buffer, factions, playerFaction) {
  const out = {};
  if (!buffer || typeof parseFactionTreasuries !== "function" || !factions) return out;
  let recs;
  try { recs = parseFactionTreasuries(buffer); } catch (_e) { return out; }
  if (!Array.isArray(recs) || recs.length === 0) return out;

  // Faction names in factionId order (crackSave emits them in record order).
  const names = Object.keys(factions);
  let rp = 0;
  const WINDOW = 3; // tolerate up to (WINDOW-1) phantom/zero records between hits
  for (const name of names) {
    const f = factions[name];
    const treasury = f && typeof f.treasury === "number" ? f.treasury : null;
    if (treasury == null) continue;
    let found = -1;
    for (let k = rp; k < Math.min(rp + WINDOW, recs.length); k++) {
      if (recs[k].treasury === treasury) { found = k; break; }
    }
    if (found < 0) continue;
    rp = found + 1;
    const block = readFinancialBlock(buffer, recs[found].offset);
    if (block) out[name] = block;
  }

  // 0.9.873: the PLAYER faction's econ record is ROTATED TO recs[0] (the save is
  // centered on the player), while its NAME stays at its normal factionId
  // position in `factions` — so the name-ordered window-walk above never reaches
  // recs[0] and the player's OWN breakdown was missed, falling back to a
  // misleading settlement-income sum (Athens t56: showed gross 1183, real 45437).
  // Anchor the player explicitly: prefer recs[0] when its treasury matches, else
  // a globally-UNIQUE treasury match. Verified recs[0]==player in 6/7 corpus
  // saves (findings-economy-corpus-2026-06-03.md). Additive — only fills the gap.
  if (playerFaction && factions[playerFaction]) {
    const pt = typeof factions[playerFaction].treasury === "number" ? factions[playerFaction].treasury : null;
    if (pt != null && recs[0] && recs[0].treasury === pt) {
      // recs[0] IS the player's record — AUTHORITATIVE. Override even if the
      // name-walk already attributed the player to a DIFFERENT record that
      // merely shares the player's treasury (common at turn 1 when dozens of
      // factions start at the same denari — Parni T1 had 79 records == 5500,
      // so the walk grabbed the wrong one and decoded an empty block).
      const block = readFinancialBlock(buffer, recs[0].offset);
      if (block) out[playerFaction] = block;
    } else if (pt != null && !out[playerFaction]) {
      // recs[0] treasury didn't match (rare) — only attribute on a GLOBALLY
      // UNIQUE treasury so we never grab a same-treasury neighbour.
      const matches = [];
      for (let k = 0; k < recs.length; k++) if (recs[k].treasury === pt) matches.push(k);
      if (matches.length === 1) {
        const block = readFinancialBlock(buffer, recs[matches[0]].offset);
        if (block) out[playerFaction] = block;
      }
    }
  }
  return out;
}

/**
 * parseFinancialOverview — read the STORED per-faction Financial Overview
 * breakdown from the save's econ-history blocks. Pure with respect to `context`
 * except for reading `buffer` to locate the blocks.
 *
 * @param {Buffer} buffer   the raw .sav buffer (required for the stored breakdown).
 * @param {object} context  crackSave() output (uses context.factions for the
 *                          name→treasury anchor; optional context.factionsOnly).
 * @returns {{ byFaction: { name: { income, expenditure, net, treasury,
 *             estimatedNextTurn, _confidence, _unattributed } },
 *             playerFaction, turn, _meta }}
 */
function parseFinancialOverview(buffer, context) {
  // parseFinancialOverview is just parseFactionEconomy with the stored breakdown
  // as the primary source — they share one implementation.
  return parseFactionEconomy(buffer, context);
}

/**
 * parseFactionEconomy — derive the Financial Overview economy object per faction,
 * now reading the STORED per-category breakdown (2026-06-02 breakthrough) and
 * falling back to confirmed totals / history for anything not located.
 *
 * @param {Buffer|null} buffer  raw .sav buffer; needed for the stored breakdown
 *        block and (optionally) net history. With null buffer the stored
 *        breakdown is skipped and only context-derived fields are returned.
 * @param {object} context  crackSave() output. Consumed:
 *          - context.factions        { name: { treasury, ... } }  (anchor + treasury)
 *          - context.ownerByCity      { city: factionName }       (legacy gross/tax)
 *          - context.settlementFields { city: { income, committedPopulation } }
 *          - context.playerFaction, context.turn
 *        Optional: context.treasuryHistory, context.factionsOnly,
 *                  context.settlements (legacy mining estimate), context.taxCoefficient.
 * @returns see parseFinancialOverview.
 */
function parseFactionEconomy(buffer, context) {
  const ctx = context || {};
  const ownerByCity = ctx.ownerByCity || {};
  const settlementFields = ctx.settlementFields || {};
  const factions = ctx.factions || {};
  const treasuryHistory = ctx.treasuryHistory || null;
  const taxCoefficient = (typeof ctx.taxCoefficient === "number" && Number.isFinite(ctx.taxCoefficient))
    ? ctx.taxCoefficient : DEFAULT_TAX_COEFFICIENT;

  // Stored breakdown blocks, keyed by faction name (empty if no buffer/cracker).
  const blocks = buildFactionBlocks(buffer, factions, ctx.playerFaction);

  let names;
  if (Array.isArray(ctx.factionsOnly) && ctx.factionsOnly.length) {
    names = ctx.factionsOnly.slice();
  } else {
    const set = new Set(Object.keys(factions));
    for (const owner of Object.values(ownerByCity)) if (owner) set.add(owner);
    names = [...set];
  }

  const byFaction = {};
  let factionsWithBreakdown = 0;
  let factionsWithIncome = 0;

  for (const name of names) {
    const eco = emptyFactionEconomy();

    // ── Treasury (start-of-turn balance) — CONFIRMED record +0 ──────────────
    const frec = factions[name];
    if (frec && typeof frec.treasury === "number" && Number.isFinite(frec.treasury)) {
      eco.treasury = frec.treasury;
      eco._confidence.treasury = "confirmed";
    }

    // ── STORED breakdown (2026-06-02 breakthrough) ──────────────────────────
    const decoded = blocks[name] ? decodeFinancialBlock(blocks[name]) : null;
    if (decoded) {
      eco.income.farming = decoded.income.farming;
      eco.income.taxes = decoded.income.taxes;
      eco.income.tax = decoded.income.tax;          // alias
      eco.income.mining = decoded.income.mining;
      eco.income.trade = decoded.income.trade;
      eco.income.merchants = decoded.income.merchants;
      eco.income.other = decoded.income.other;
      eco.income.total = decoded.income.total;

      eco.expenditure.wages = decoded.expenditure.wages;
      eco.expenditure.army_upkeep = decoded.expenditure.army_upkeep;
      eco.expenditure.upkeep = decoded.expenditure.upkeep; // alias
      eco.expenditure.recruitment = decoded.expenditure.recruitment;
      eco.expenditure.construction = decoded.expenditure.construction;
      eco.expenditure.other = decoded.expenditure.other;
      eco.expenditure.total = decoded.expenditure.total;

      eco.net = decoded.net;
      eco._unattributed = decoded.unattributed;

      eco._confidence.incomeTotal = "confirmed";
      eco._confidence.incomeBreakdown = "stored";
      eco._confidence.expenditure = "stored";
      eco._confidence.net = "stored";
      // Mining VALUE is stored exactly; the category LABEL is cross-faction
      // inferred (strong: tracks mine/resource ownership; Merchants ruled out).
      eco._confidence.mining = "inferred-strong";
      if (eco.treasury != null) eco.estimatedNextTurn = eco.treasury + decoded.net;

      factionsWithBreakdown++;
      factionsWithIncome++;
    } else {
      // ── FALLBACK: gross income total = Σ settlement income (CONFIRMED) ─────
      const inc = sumSettlementIncome(name, ownerByCity, settlementFields);
      if (inc.total != null) {
        eco.income.total = inc.total;
        eco._confidence.incomeTotal = "confirmed";
        factionsWithIncome++;
      }
      // Net from history if available (turn >= 3, non-player).
      const series = treasuryHistory ? treasuryHistory[name] : null;
      const net = netFromHistory(series);
      if (net != null) {
        eco.net = net;
        eco._confidence.net = "history";
        if (eco.treasury != null) eco.estimatedNextTurn = eco.treasury + net;
      }
    }

    // ── DERIVED legacy estimates (cross-check; informational) ───────────────
    const taxEst = estimateTaxIncome(name, ownerByCity, settlementFields, taxCoefficient);
    eco.incomeEstimate.tax = taxEst.tax;
    eco.incomeEstimate.taxCoefficient = taxEst.tax != null ? taxEst.coefficient : null;
    eco.incomeEstimate.citiesWithPopulation = taxEst.citiesWithPopulation;
    const mineEst = deriveMiningIncome(name, ownerByCity, ctx.settlements);
    eco.incomeEstimate.mining = mineEst.mining;
    eco.incomeEstimate.citiesWithMine = mineEst.citiesWithMine;
    eco.incomeEstimate.miningContributors = mineEst.contributingCities;

    byFaction[name] = eco;
  }

  return {
    byFaction,
    playerFaction: ctx.playerFaction || null,
    turn: typeof ctx.turn === "number" ? ctx.turn : null,
    _meta: {
      factions: names.length,
      factionsWithBreakdown,
      factionsWithIncome,
      slotMap: {
        income: { ...INCOME_SLOTS },        // farming:0 taxes:1 mining:2 trade:3 other:9
        expenditure: { ...EXPENDITURE_SLOTS }, // wages:11 army_upkeep:12 other:22
        note: "Block-field index within the final 23-i32 econ-history sub-block.",
      },
      note: "Per-category breakdown is READ FROM THE SAVE (2026-06-02 breakthrough): " +
            "income {farming,taxes,mining,trade,other} from slots {0,1,2,3,9} and " +
            "expenditure {wages,army_upkeep,other} from slots {11,12,22}; totals = " +
            "the full income/expenditure half sums; net = income.total-expenditure.total. " +
            "Merchants/recruitment/construction are 0 in this corpus (reported 0 only " +
            "when the pinned slots fully account for the engine totals). Factions whose " +
            "block cannot be located fall back to Σ settlement income + history net.",
      // 2026-06-02 finance-DETAIL pass (findings-finance-detail-2026-06-02.md):
      detail: {
        mining: "f2=income.mining upgraded to inferred-strong: f2>0 tracks " +
                "mine/resource-industry ownership across factions; Merchants ruled " +
                "out (0 merchant agents in this save). Value stored exactly; label inferred.",
        counts: "Per-line counts (Generals&Admirals 34, Units 82, Agents/Buildings 0) " +
                "are NOT a stored finance field — no count record found near the faction " +
                "record/econ-block; the engine tallies them at runtime from the character " +
                "roster + army/unit lists. Derived from crackSave, never from an offset.",
        perSettlement: "No per-settlement category split: marker-1586 income = " +
                "population×taxCoefficient exactly (pure pop-tax); same-pop port vs " +
                "inland cities are identical. Trade/farming/tax split exists only at " +
                "the faction level (econ-block slots).",
        totalsNet: "income/expenditure TOTALS and NET are derived (summed), not stored " +
                "as discrete fields; net = income.total-expenditure.total (matches in-game).",
      },
      taxCoefficient,
    },
  };
}

module.exports = {
  parseFinancialOverview,
  parseFactionEconomy,
  // Exported helpers for unit testing / reuse.
  sumSettlementIncome,
  estimateTaxIncome,
  deriveMiningIncome,
  netFromHistory,
  emptyFactionEconomy,
  readFinancialBlock,
  decodeFinancialBlock,
  buildFactionBlocks,
  DEFAULT_TAX_COEFFICIENT,
  MINE_EXPORT_BONUS,
  INCOME_SLOTS,
  EXPENDITURE_SLOTS,
};
