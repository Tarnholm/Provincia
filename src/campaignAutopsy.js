// Campaign Autopsy — pure, deterministic trajectory analysis across a scanned
// timeline. Given the rows produced by the Campaign Timeline scan (or any array
// of cracked saves), it reconstructs each faction's arc over time — settlement
// count, treasury and army size per turn — and derives a post-mortem verdict:
// when they peaked, when they began an unrecoverable decline, whether they were
// eliminated, and who ultimately won.
//
// The heavy lifting of normalizing one save/row into per-faction maps is REUSED
// from src/saveCompare.js's summarizeForCompare — the same normalization the
// Save Compare tool uses (ownerBySettlement / treasuryByFaction / unitCountByFaction).
// So this file adds no parsing; it only aggregates summaries into time series and
// runs the trajectory heuristics.
//
// Honors the project no-fabrication rule: a metric a save/row didn't supply stays
// null and never becomes a placeholder 0. Settlement counts are the exception —
// they come from a FULL ownership map, so a faction absent from a row that HAS
// ownership data genuinely owns 0 (that zero is how elimination is detected); a
// row with NO ownership data at all leaves settlements null.
//
//   analyzeCampaign(timelineRows) — pure, synchronous. Accepts timeline rows
//     (extractRow shape, carrying _ownerByCity + the tracked faction's treasury/
//     units) OR full crackSave() results (which populate every faction). Returns
//     { factions, turns, winner }.
//
// Pure and side-effect-free — covered by src/campaignAutopsy.test.js.
"use strict";

const { summarizeForCompare } = require("./saveCompare.js");

// Final settlements as a fraction of the faction's own peak: at or below this →
// the faction "declined" (lost a big chunk of its high-water territory).
const DECLINE_RATIO = 0.6;
// Final settlements as a multiple of the faction's starting count: at or above
// this → the faction "grew".
const GROWTH_RATIO = 1.25;
// A winner whose final settlements are still at least this fraction of its own
// peak (i.e. it didn't collapse) is elevated from growing/stagnant to "dominant".
const DOMINANT_HOLD_RATIO = 0.9;

// Tally settlement counts per faction from an ownerBySettlement map.
function tallySettlements(ownerBySettlement) {
  const t = {};
  for (const fac of Object.values(ownerBySettlement || {})) {
    if (fac) t[fac] = (t[fac] || 0) + 1;
  }
  return t;
}

// Trajectory heuristics for ONE faction given its chronological series
// ([{turn, settlements, treasury, units}], settlements possibly null=unknown).
function analyzeFactionTrajectory(faction, series) {
  // Only observations where settlements were actually decoded drive the verdict.
  const obs = series.filter((s) => s.settlements != null);
  const finalSettlements = obs.length ? obs[obs.length - 1].settlements : null;
  const startSettlements = obs.length ? obs[0].settlements : null;

  // Peak = maximum settlement count; recorded at the FIRST turn it was reached.
  let peak = null;
  for (const s of obs) {
    if (peak == null || s.settlements > peak.settlements) {
      peak = { turn: s.turn, settlements: s.settlements };
    }
  }

  // Elimination = first turn settlements hit 0 AFTER the faction had held ≥1
  // (a genuine wipe, not a leading data gap). Undefined if never observed at 0.
  let eliminated = null;
  {
    let sawPositive = false;
    for (const s of obs) {
      if (s.settlements > 0) sawPositive = true;
      else if (s.settlements === 0 && sawPositive) { eliminated = { turn: s.turn }; break; }
    }
  }

  // First decline = first turn after the peak where settlements drop below the
  // peak and NEVER recover to it (a temporary dip that later returns to peak is
  // not a decline). Needs a real peak of ≥1 and at least two observations.
  let firstDecline = null;
  if (peak && peak.settlements > 0 && obs.length > 1) {
    const peakIdx = obs.findIndex((s) => s.settlements === peak.settlements);
    for (let i = peakIdx + 1; i < obs.length; i++) {
      if (obs[i].settlements < peak.settlements) {
        const recovers = obs.slice(i).some((s) => s.settlements >= peak.settlements);
        if (!recovers) { firstDecline = { turn: obs[i].turn }; break; }
      }
    }
  }

  // Verdict from final-vs-peak / final-vs-start trend. (The winner may later be
  // promoted to "dominant" by analyzeCampaign once the whole field is known.)
  let verdict;
  if (finalSettlements === 0) {
    verdict = "eliminated";
  } else if (finalSettlements == null || peak == null) {
    verdict = "stagnant"; // no settlement signal at all — nothing to judge
  } else {
    const ratioPeak = peak.settlements > 0 ? finalSettlements / peak.settlements : 1;
    const ratioStart = startSettlements > 0
      ? finalSettlements / startSettlements
      : (finalSettlements > 0 ? Infinity : 1);
    if (ratioPeak <= DECLINE_RATIO) verdict = "declining";
    else if (ratioStart >= GROWTH_RATIO) verdict = "growing";
    else if (firstDecline) verdict = "declining"; // milder but unrecovered slide
    else verdict = "stagnant";
  }

  return { faction, series, peak, firstDecline, eliminated, verdict, finalSettlements };
}

// Analyze a whole campaign timeline. `timelineRows` is an array of timeline rows
// (extractRow output) OR full crackSave() results — anything summarizeForCompare
// understands. Returns { factions, turns, winner }.
function analyzeCampaign(timelineRows) {
  const rows = Array.isArray(timelineRows) ? timelineRows.filter(Boolean) : [];

  // Normalize each row into per-faction maps via the shared Save-Compare
  // normalization, then fold in the tracked faction's top-level treasury/units.
  const points = rows.map((row) => {
    const s = summarizeForCompare(row);
    // Timeline rows carry ONLY the tracked faction's treasury/units, at the top
    // level (treasury: number, units: number). Fold those in so the player's
    // series isn't empty. Full crackSave() results already populate every
    // faction, and there row.units is an ARRAY / row.treasury is undefined, so
    // these guards no-op — no double counting.
    const pf = s.playerFaction;
    if (pf) {
      if (s.treasuryByFaction[pf] == null && row && typeof row.treasury === "number") {
        s.treasuryByFaction[pf] = row.treasury;
      }
      if (s.unitCountByFaction[pf] == null && row && typeof row.units === "number") {
        s.unitCountByFaction[pf] = row.units;
      }
    }
    return {
      turn: s.turn,
      hasOwnership: Object.keys(s.ownerBySettlement).length > 0,
      settleTally: tallySettlements(s.ownerBySettlement),
      treasuryByFaction: s.treasuryByFaction,
      unitCountByFaction: s.unitCountByFaction,
    };
  });

  // Chronological order: by turn (null turns sorted last), stable on ties.
  const ordered = points
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ta = a.p.turn == null ? Infinity : a.p.turn;
      const tb = b.p.turn == null ? Infinity : b.p.turn;
      if (ta !== tb) return ta - tb;
      return a.i - b.i; // preserve input order among equal/absent turns
    })
    .map((x) => x.p);

  // Turn axis: the real turn number when known, else the point's ordinal index.
  const turnKeys = ordered.map((p, i) => (p.turn != null ? p.turn : i));
  const turns = [...new Set(turnKeys)].sort((a, b) => a - b);

  // Faction universe = anyone that ever owned a settlement or had treasury/units.
  const universe = new Set();
  for (const p of ordered) {
    for (const f of Object.keys(p.settleTally)) universe.add(f);
    for (const f of Object.keys(p.treasuryByFaction)) universe.add(f);
    for (const f of Object.keys(p.unitCountByFaction)) universe.add(f);
  }

  const factions = [];
  for (const faction of universe) {
    const series = ordered.map((p, i) => ({
      turn: turnKeys[i],
      // hasOwnership → absent faction genuinely owns 0; no ownership data → unknown.
      settlements: p.hasOwnership ? (p.settleTally[faction] || 0) : null,
      treasury: p.treasuryByFaction[faction] != null ? p.treasuryByFaction[faction] : null,
      units: p.unitCountByFaction[faction] != null ? p.unitCountByFaction[faction] : null,
    }));
    factions.push(analyzeFactionTrajectory(faction, series));
  }

  const peakOf = (f) => (f.peak ? f.peak.settlements : 0);
  const finalOf = (f) => (f.finalSettlements || 0);

  // Winner = most final settlements (>0). Tie: higher peak, then name.
  let winner = null;
  const contenders = factions
    .filter((f) => finalOf(f) > 0)
    .sort((a, b) => (finalOf(b) - finalOf(a)) || (peakOf(b) - peakOf(a)) || a.faction.localeCompare(b.faction));
  if (contenders.length) winner = contenders[0].faction;

  // Promote the winner to "dominant" if it didn't collapse from its own peak.
  for (const f of factions) {
    if (f.faction === winner && f.verdict !== "eliminated") {
      const ratioPeak = peakOf(f) > 0 ? finalOf(f) / peakOf(f) : 1;
      if (ratioPeak >= DOMINANT_HOLD_RATIO) f.verdict = "dominant";
    }
  }

  // Post-mortem ordering: biggest survivors first, then peak size, then name.
  factions.sort((a, b) => (finalOf(b) - finalOf(a)) || (peakOf(b) - peakOf(a)) || a.faction.localeCompare(b.faction));

  return { factions, turns, winner };
}

module.exports = { analyzeCampaign, analyzeFactionTrajectory, DECLINE_RATIO, GROWTH_RATIO, DOMINANT_HOLD_RATIO };
