// src/settlementFieldsParser.js
//
// Per-settlement runtime fields decoded 2026-05-31
// (rtw-sav-parser/docs/findings-settlement-deep-2026-05-31.md). All offsets are
// relative to the settlement NAME marker (buildingParser.findAllSettlementMarkers
// → marker.offset). Verified on save_julii1/2/3 + Carthage1/2/3:
//
//   marker-1494  u32  committed population (start-of-turn value)
//   marker-34    u32  projected population (committed + this turn's net growth)
//                     → NET GROWTH this turn = projected - committed
//   marker-1586  u32  income this turn (verified Rome 924/949/1005)
//   marker-30    f32  current public order total
//   marker-1190  f32  previous-turn public-order snapshot
//   marker-1940  i32  governor character secondary-UUID (0 / 0xffffffff = none)
//   marker-1490..-1420  f32[18]  public-order breakdown line-items (0 = inactive;
//                                slot position = modifier type — see ORDER_SLOTS)
//
// The roll-forward invariant (committed[T+1] == projected[T]) confirmed the
// growth pair. Garrison strength and squalor are NOT stored (derived/recomputed).
//
// ORDER-BREAKDOWN SLOT MAP (slot i read at marker−1490+4·i; magnitudes, the slot
// identity carries the sign — penalty slots SUBTRACT from order). Mapped 2026-05-31
// (rtw-sav-parser/docs/findings-order-slots-v2-2026-05-31.md) by faction-scoped
// distance buckets + culture-homogeneity contrast + cross-turn diffs:
//
//   s2  = TAX effect (signed; 0 at fresh start, ±25 once a tax rate is set)   CONFIRMED
//   s4  = FOREIGN-CULTURE penalty (flat 6 when occupier ≠ settlement culture)  CONFIRMED
//   s11 = DISTANCE-TO-CAPITAL penalty (0 at capital, grows w/ map distance;    CONFIRMED
//         faction-scoped corr(distance)=0.99 in Carthage AND Seleucid territory)
//   s12 = RELIGIOUS / cultural-unrest penalty (0 in culturally-homogeneous     CONFIRMED
//         empires e.g. Carthage; flat ≈4 across Greek-over-Eastern Seleucid)
//   s10 = CAPITAL-status happiness bonus. EXACTLY ONE city per faction carries  CONFIRMED
//         the high value (Carthage=6 on all 5 Carthaginian saves; Rome=4..5 on
//         all 7 Julii/RoR saves; Capua=5 after the T34 capital relocation), and
//         that city is always the faction capital (its s11 distance penalty = 0).
//         Anti-distance shape: invariant across turns, single-city, ≈0 elsewhere.
//   s7  = START-OF-CAMPAIGN transient bonus. Nonzero ONLY on turn-1 saves        CONFIRMED
//         (36/41 Carthage, 17/25 Julii at T1, incl. RoR-T1End); EXACTLY 0 on
//         every own city at turns 2,3,5,8. The lone T34 hit (Arpi=1) is a
//         freshly-acquired settlement re-triggering it. A turn-1 placeholder.
//   s14 = mid-campaign TAX/economic-management line (turn-gated). 0 at turns     CONFIRMED
//         1-3; switches on (discrete 4 or 8) on 25-26/31 cities at turns 5 & 8,
//         co-active with s2 tax on 24/26; off again (0/34) by turn 34. A tax-
//         bracket/administration line that matures after the opening turns.
//   s9  = HEALTH / SEWERAGE happiness bonus. On turn-START saves (so the         CONFIRMED
//         one-turn compute deferral has settled) s9>0 ⇔ a sanitation/health
//         building is present, with ZERO mismatches on julii2/3 & RoR-T2Start
//         (14 tp / 11 tn each) and 1/40 on carthage2. Dose-responds to health
//         TIER: health0→s9≈0, h1→1.1, h2→2.6, h3→3.4, h4→6.0 (Rome). Trade
//         (4 false-neg on julii2) and temple (24 false-neg on carthage2) both
//         fail the same test, so it is HEALTH specifically, not generic dev.
//         (rtw-sav-parser/docs/findings-order-slots-v4-2026-05-31.md)
//   s0/s3 = buildings & settlement-size happiness bonuses                      HYPOTHESIS
//         s0 is STATIC per settlement (100% invariant across opening turns:
//         25/25 julii, 41/41 Carthage, 25/25 RoR) and building-/pop-/creator-/
//         government-independent — a scenario-baked base-order value, not a
//         building-tier function. s3 rises weakly across temple/health/trade
//         tiers alike with no single-category separation.
//   s1  = signed POPULATION/DEVELOPMENT-scaled happiness (recomputed per turn,  HYPOTHESIS
//         deferred one turn from a fresh start). Negative in tiny towns
//         (health0→-0.26, trade0→-0.87), rises with temple/health/trade tier
//         together — a fused city-development line, not slot-separable to one
//         source.
//   s5/s8/s16 = always 0 (reserved modifier slots); s6/s13/s15/s17 = rare/unmapped
//
// NOTE: slot index = orderBreakdown[i] read at marker−1490+4·i. (Distance lives
// in s11, NOT s10 — an earlier draft mis-indexed these; verified by explicit
// per-index dump against tile-map distance-to-capital, 2026-05-31.)
//
// Order total (marker−30) ≈ 127 + ~3·(Σ bonus − Σ penalty) — a 0..~400 scale,
// not 0-100%. Used only as a directional consistency check (penalties subtract).

"use strict";

function u32(buf, o) { return (o >= 0 && o + 4 <= buf.length) ? buf.readUInt32LE(o) : null; }
function i32(buf, o) { return (o >= 0 && o + 4 <= buf.length) ? buf.readInt32LE(o) : null; }
function f32(buf, o) { return (o >= 0 && o + 4 <= buf.length) ? buf.readFloatLE(o) : null; }

// Decode the deep fields for one settlement, given its name-marker offset.
function settlementFieldsAt(buf, markerOffset) {
  const o = markerOffset;
  const committedPopulation = u32(buf, o - 1494);
  const projectedPopulation = u32(buf, o - 34);
  const growth = (committedPopulation != null && projectedPopulation != null)
    ? projectedPopulation - committedPopulation : null;
  const gov = i32(buf, o - 1940);
  const orderBreakdown = [];
  for (let d = -1490; d <= -1420; d += 4) {
    const v = f32(buf, o + d);
    orderBreakdown.push(v == null ? 0 : Math.round(v * 100) / 100);
  }
  // CONFIRMED slot sources (see ORDER_SLOTS doc above). Penalty slots are stored
  // as positive magnitudes; they reduce public order. Raw array kept verbatim.
  const order = {
    tax: orderBreakdown[2],                       // s2  signed tax effect      CONFIRMED
    foreignCulturePenalty: orderBreakdown[4],     // s4  flat foreign-culture   CONFIRMED
    distanceToCapitalPenalty: orderBreakdown[11], // s11 distance penalty       CONFIRMED
    religiousUnrestPenalty: orderBreakdown[12],   // s12 religion/culture       CONFIRMED
    capitalBonus: orderBreakdown[10],             // s10 capital-status bonus   CONFIRMED
    startTransientBonus: orderBreakdown[7],       // s7  turn-1-only transient  CONFIRMED
    taxAdminLine: orderBreakdown[14],             // s14 mid-campaign tax line  CONFIRMED
    healthBonus: orderBreakdown[9],               // s9  health/sewerage bonus  CONFIRMED
  };
  return {
    committedPopulation,
    projectedPopulation,
    populationGrowth: growth,
    // 0.9.872: SIGNED — a settlement can run NEGATIVE income (e.g. just-captured
    // / money-losing). Read as u32 it returned 0xFFFFFFFF (4294967295) for a -1
    // settlement (Athens/Skyros t56), which then summed to a 4.29-billion faction
    // "income" in the Financial Overview. i32 keeps -1 as -1. (marker-1586)
    income: i32(buf, o - 1586),
    publicOrder: f32(buf, o - 30),
    prevPublicOrder: f32(buf, o - 1190),
    governorUuid: (gov === 0 || gov === -1 || gov === (0xffffffff | 0)) ? 0 : (gov >>> 0),
    // marker-886 u8 (stored as u32, upper 3 bytes 0): the settlement's DOMINANT
    // POPULACE RELIGION id — a small enum (0..~52). DYNAMIC: converts toward the
    // owner faction's religion over turns (independent of the temple building);
    // it's the value the s12 religious-unrest penalty is computed against.
    // (Cracked 2026-06-06, findings-novel-cracks-2026-06-06.md.) The id→name map
    // is per-campaign — derive it by correlating ids with temple religions.
    dominantReligionId: (() => { const v = u32(buf, o - 886); return (v == null || v > 255) ? null : (v & 0xff); })(),
    // SETTLEMENT_MECHANICS_STATS ledger (16.16 fixed-point block at marker
    // −1564..−1516, read as i32/65536). SQUALOR lives at marker−1544 as a
    // penalty (≤0, typ −50..0), monotonic in population across the corpus.
    // OVERTURNS the prior "squalor is derived, not stored" assumption — it IS
    // serialized, but as a deferred-compute cache: EXACTLY 0 on turn-1 saves
    // (the one-turn compute lag, same signature as the s9 health bonus and the
    // dominant-religion field), nonzero from turn 2. Cracked 2026-06-06
    // (findings-settlement-mechanics-stats-2026-06-06.md). Returns ≤0, or null
    // when out of range. Callers should render "—" on turn-1 (squalor==0) per
    // the no-fabricated-defaults rule rather than implying zero squalor.
    squalor: (() => { const v = i32(buf, o - 1544); return (v == null || v / 65536 > 0 || v / 65536 < -1000) ? null : v / 65536; })(),
    // TAX RATE the settlement is set to: u8 @ marker−2269. Cracked 2026-06-06 from
    // a user controlled pair (save_Gades high vs normal taxes — a 10-byte whole-file
    // diff; this byte flipped 2→1). Enum: 1=normal, 2=high (3=very_high, 0=low/auto
    // — inferred; the pair confirmed normal/high). Confirmed for the player's own
    // settlement; AI/unmanaged settlements often read 0. (findings-tax-rate-CRACKED-2026-06-06.md)
    taxRate: (() => { const v = (o - 2269 >= 0 && o - 2269 < buf.length) ? buf[o - 2269] : null; return (v == null || v > 3) ? null : v; })(),
    orderBreakdown,  // raw f32 line-items (18 slots); see order{} for named sources
    order,           // named CONFIRMED order-breakdown sources (subset of orderBreakdown)
  };
}

// Decode deep fields for every settlement. `markers` = findAllSettlementMarkers(buf).
// Returns { [settlementName]: fields }.
function parseSettlementFields(buf, markers) {
  const out = {};
  if (!Array.isArray(markers)) return out;
  for (const m of markers) {
    if (!m || m.offset == null || !m.name) continue;
    out[m.name] = settlementFieldsAt(buf, m.offset);
  }
  return out;
}

module.exports = { parseSettlementFields, settlementFieldsAt };
