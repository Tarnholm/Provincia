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
//                                slot position = modifier type; mapping still open)
//
// The roll-forward invariant (committed[T+1] == projected[T]) confirmed the
// growth pair. Garrison strength and squalor are NOT stored (derived/recomputed).

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
  return {
    committedPopulation,
    projectedPopulation,
    populationGrowth: growth,
    income: u32(buf, o - 1586),
    publicOrder: f32(buf, o - 30),
    prevPublicOrder: f32(buf, o - 1190),
    governorUuid: (gov === 0 || gov === -1 || gov === (0xffffffff | 0)) ? 0 : (gov >>> 0),
    orderBreakdown, // raw f32 line-items; slot→source mapping still open
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
