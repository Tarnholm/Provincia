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
//   s10 = CAPITAL-status happiness bonus (≈6 at the faction capital, ~0        HYPOTHESIS
//         elsewhere; verified at Carthage=6 and Seleucia=6, near-0 in others)
//   s0/s3 = buildings & settlement-size happiness bonuses                      HYPOTHESIS
//   s9/s1 = population/trade-scaled happiness bonuses (corr pop ~0.7-0.8)      HYPOTHESIS
//   s7  = start-of-campaign transient bonus (populated turn-1 on every         HYPOTHESIS
//         faction, →0 after the first end-turn; not a stable runtime source)
//   s14 = tax-bracket / economic-management line (active mid-campaign; was     UNMAPPED
//         inactive turn-2 but broadly active by turn-5 — needs controlled diff)
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
    capitalBonus: orderBreakdown[10],             // s10 capital-status bonus   HYPOTHESIS
  };
  return {
    committedPopulation,
    projectedPopulation,
    populationGrowth: growth,
    income: u32(buf, o - 1586),
    publicOrder: f32(buf, o - 30),
    prevPublicOrder: f32(buf, o - 1190),
    governorUuid: (gov === 0 || gov === -1 || gov === (0xffffffff | 0)) ? 0 : (gov >>> 0),
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
