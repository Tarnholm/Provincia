// Save-to-save COMPARE — pure summarize + diff functions (no I/O, no state).
//
// Complements src/saveDiff.js (live-watch event feed over parseSaveData
// snapshots) but works over CRACKED saves (src/saveCracker.js crackSave output),
// which expose per-faction treasuries, per-faction units, ownerByCity and
// per-settlement population — the fields the "what changed between these two
// saves" report needs. Shapes mirror scripts/campaign-timeline.js extractRow /
// computeDelta where they overlap (settlement flips from ownerByCity, treasury
// swings), but cover ALL factions, not just the tracked player.
//
// Honors the project no-fabrication rule: any metric the cracker did not supply
// stays null and its delta stays null — never a placeholder 0.
//
//   summarizeForCompare(row)   — normalize ONE cracked save (or a timeline-style
//                                row) into a small comparable summary.
//   diffSaveSummaries(a, b)    — diff two summaries → { flips, factionRows,
//                                popRows, meta }.
//
// Both are pure and synchronous — covered by src/saveCompare.test.js.
"use strict";

const SEASON_LABELS = ["Spring", "Summer", "Autumn", "Winter"]; // seasonIndex 0..3 (4 turns/year)

// How many population rows the diff keeps (top by |delta|).
const POP_TOP_N = 20;

// ── summarize ───────────────────────────────────────────────────────────────
// Accepts either a full crackSave() result OR a timeline-style row (which
// carries _ownerByCity). Fields the input lacks come out as empty maps / null —
// diffSaveSummaries tolerates that and simply reports nothing for them.
function summarizeForCompare(row) {
  const r = row || {};

  // Settlement → owning faction. crackSave calls it ownerByCity; the timeline
  // row keeps it as _ownerByCity.
  const ownerBySettlement = {};
  const own = r.ownerByCity || r._ownerByCity || {};
  for (const [city, fac] of Object.entries(own)) {
    if (typeof fac === "string" && fac) ownerBySettlement[city] = fac;
  }

  // Faction → treasury (null when the record decode failed for that faction).
  const treasuryByFaction = {};
  if (r.factions && typeof r.factions === "object") {
    for (const [fac, f] of Object.entries(r.factions)) {
      treasuryByFaction[fac] = f && f.treasury != null ? f.treasury : null;
    }
  }

  // Faction → unit count + soldier headcount, from the flat units array.
  const unitCountByFaction = {};
  const soldiersByFaction = {};
  if (Array.isArray(r.units)) {
    for (const u of r.units) {
      const fac = u && u.faction;
      if (!fac) continue; // unattributed unit — don't invent an owner
      unitCountByFaction[fac] = (unitCountByFaction[fac] || 0) + 1;
      soldiersByFaction[fac] = (soldiersByFaction[fac] || 0) + (u.soldiers || 0);
    }
  }

  // Settlement → population. committedPopulation is the start-of-turn value
  // (stable within a turn); fall back to projectedPopulation when absent.
  const popBySettlement = {};
  if (r.settlementFields && typeof r.settlementFields === "object") {
    for (const [city, f] of Object.entries(r.settlementFields)) {
      if (!f) continue;
      const pop = f.committedPopulation != null ? f.committedPopulation
        : (f.projectedPopulation != null ? f.projectedPopulation : null);
      if (pop != null) popBySettlement[city] = pop;
    }
  }

  const turn = r.turn != null ? r.turn : null;
  const year = r.currentYear != null ? r.currentYear : (r.year != null ? r.year : null);
  const seasonIndex = r.seasonIndex != null ? r.seasonIndex : null;

  // Human label: "Turn 12 · Summer 268 BC" with graceful degradation.
  const parts = [];
  if (turn != null) parts.push("Turn " + turn);
  const season = seasonIndex != null && SEASON_LABELS[seasonIndex] ? SEASON_LABELS[seasonIndex] : null;
  if (year != null) parts.push((season ? season + " " : "") + (year < 0 ? (-year) + " BC" : year + " AD"));
  else if (season) parts.push(season);
  const turnLabel = parts.length ? parts.join(" · ") : (r.file || "unknown turn");

  return {
    ownerBySettlement,
    treasuryByFaction,
    unitCountByFaction,
    soldiersByFaction,
    popBySettlement,
    turn,
    turnLabel,
    playerFaction: r.playerFaction || r.player || null,
    file: r.file || null,
    path: r.path || null,
  };
}

// ── diff ────────────────────────────────────────────────────────────────────
// a = earlier save's summary, b = later save's summary. Returns:
//   flips:       [{ settlement, from, to }]           owner changes, sorted by name
//   factionRows: [{ faction, settlementsFrom, settlementsTo, settlementsDelta,
//                   treasuryFrom, treasuryTo, treasuryDelta,
//                   unitsFrom, unitsTo, unitsDelta,
//                   soldiersFrom, soldiersTo, soldiersDelta,
//                   appeared, disappeared }]           only factions with a change
//   popRows:     [{ settlement, from, to, delta }]     top ±POP_TOP_N by |delta|
//   meta:        { a, b, identical, orderSuspect, popRowsTruncated, popChangedTotal }
function diffSaveSummaries(a, b) {
  const A = a || {}, B = b || {};
  const ownA = A.ownerBySettlement || {}, ownB = B.ownerBySettlement || {};

  // Ownership flips — settlements present in BOTH (a settlement missing from one
  // crack is a decode gap, not a conquest).
  const flips = [];
  for (const city of Object.keys(ownA)) {
    const from = ownA[city], to = ownB[city];
    if (to && from !== to) flips.push({ settlement: city, from, to });
  }
  flips.sort((x, y) => x.settlement.localeCompare(y.settlement));

  // Per-faction settlement tallies from the ownership maps.
  const tally = (own) => {
    const t = {};
    for (const fac of Object.values(own)) t[fac] = (t[fac] || 0) + 1;
    return t;
  };
  const setA = tally(ownA), setB = tally(ownB);

  const trA = A.treasuryByFaction || {}, trB = B.treasuryByFaction || {};
  const unA = A.unitCountByFaction || {}, unB = B.unitCountByFaction || {};
  const soA = A.soldiersByFaction || {}, soB = B.soldiersByFaction || {};

  const allFactions = new Set([
    ...Object.keys(setA), ...Object.keys(setB),
    ...Object.keys(trA), ...Object.keys(trB),
    ...Object.keys(unA), ...Object.keys(unB),
  ]);

  // Delta helper honoring the no-fabrication rule: null when either side is
  // missing (can't distinguish "0" from "not decoded").
  const delta = (x, y) => (x != null && y != null ? y - x : null);

  const factionRows = [];
  for (const faction of allFactions) {
    const row = {
      faction,
      settlementsFrom: setA[faction] != null ? setA[faction] : 0,
      settlementsTo: setB[faction] != null ? setB[faction] : 0,
      treasuryFrom: trA[faction] != null ? trA[faction] : null,
      treasuryTo: trB[faction] != null ? trB[faction] : null,
      unitsFrom: unA[faction] != null ? unA[faction] : null,
      unitsTo: unB[faction] != null ? unB[faction] : null,
      soldiersFrom: soA[faction] != null ? soA[faction] : null,
      soldiersTo: soB[faction] != null ? soB[faction] : null,
    };
    // Settlement counts come from full ownership maps, so 0 is a real zero —
    // but only when that side had ANY ownership data at all.
    row.settlementsDelta = (Object.keys(ownA).length || Object.keys(ownB).length)
      ? row.settlementsTo - row.settlementsFrom : null;
    row.treasuryDelta = delta(row.treasuryFrom, row.treasuryTo);
    row.unitsDelta = delta(row.unitsFrom, row.unitsTo);
    row.soldiersDelta = delta(row.soldiersFrom, row.soldiersTo);
    // A faction with units/settlements in only one summary appeared or was wiped.
    const hadA = (setA[faction] || 0) > 0 || (unA[faction] || 0) > 0;
    const hadB = (setB[faction] || 0) > 0 || (unB[faction] || 0) > 0;
    row.appeared = !hadA && hadB;
    row.disappeared = hadA && !hadB;

    const changed = row.appeared || row.disappeared
      || (row.settlementsDelta != null && row.settlementsDelta !== 0)
      || (row.treasuryDelta != null && row.treasuryDelta !== 0)
      || (row.unitsDelta != null && row.unitsDelta !== 0)
      || (row.soldiersDelta != null && row.soldiersDelta !== 0);
    if (changed) factionRows.push(row);
  }
  // Biggest territorial movers first, then biggest treasury swings.
  factionRows.sort((x, y) =>
    Math.abs(y.settlementsDelta || 0) - Math.abs(x.settlementsDelta || 0)
    || Math.abs(y.treasuryDelta || 0) - Math.abs(x.treasuryDelta || 0)
    || x.faction.localeCompare(y.faction));

  // Population changes — settlements with a decoded population on BOTH sides.
  const popA = A.popBySettlement || {}, popB = B.popBySettlement || {};
  let popRowsAll = [];
  for (const city of Object.keys(popA)) {
    if (popB[city] == null) continue;
    const d = popB[city] - popA[city];
    if (d !== 0) popRowsAll.push({ settlement: city, from: popA[city], to: popB[city], delta: d });
  }
  popRowsAll.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.settlement.localeCompare(y.settlement));
  const popRows = popRowsAll.slice(0, POP_TOP_N);

  const identical = flips.length === 0 && factionRows.length === 0 && popRowsAll.length === 0;
  return {
    flips,
    factionRows,
    popRows,
    meta: {
      a: { turn: A.turn != null ? A.turn : null, turnLabel: A.turnLabel || null, file: A.file || null, path: A.path || null, settlements: Object.keys(ownA).length, factions: Object.keys(trA).length },
      b: { turn: B.turn != null ? B.turn : null, turnLabel: B.turnLabel || null, file: B.file || null, path: B.path || null, settlements: Object.keys(ownB).length, factions: Object.keys(trB).length },
      // Both turns known and "earlier" save is actually later → user likely
      // picked them in reverse; the UI shows a hint (we don't silently swap).
      orderSuspect: A.turn != null && B.turn != null && A.turn > B.turn,
      identical,
      popChangedTotal: popRowsAll.length,
      popRowsTruncated: popRowsAll.length > POP_TOP_N,
    },
  };
}

module.exports = { summarizeForCompare, diffSaveSummaries, POP_TOP_N };
