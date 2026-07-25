// Did the AI actually get anywhere? (2026-07-25)
//
// Every other part of the Lab measures ATTEMPTS — orders re-issued, campaigns
// gathering, strength never reached. This measures the OUTCOME: compare who owned
// what at campaign start (descr_strat.txt) against who owns it in the save. It is
// the only number in the tool that answers "did any of this matter".
//
// WHY THE REBEL FACTION MATTERS HERE
// ----------------------------------
// `slave` is the engine's independent-peoples faction (RIS labels it "Free
// Peoples") and RIS deliberately gives it most of the map — 499 of 1,305
// settlements at start. So its SIZE is not a finding. The DELTA is: on the
// reference campaign it grew to 522 while the 220 real factions collectively lost
// 17 settlements and 97 of them were wiped out entirely. The map consolidated by
// factions eating each other, not by anyone conquering the independents — which
// is exactly what you would predict from requirements that no small faction can
// meet.
//
// HONESTY REQUIREMENT
// -------------------
// The two sides are counted from different sources, so they can disagree. The
// reference data differs by 6 of 1,305 (0.5%) — settlements founded or destroyed
// mid-campaign, or a parse edge. Anything above a couple of percent means the
// comparison is not sound and `comparable` goes false, because a delta computed
// from two populations that do not match is not a delta.
"use strict";

// The engine's independent/rebel faction. Not a guess: descr_sm_factions defines
// "slave" (RIS comments it ";Free Peoples") and descr_strat assigns it the
// unowned settlements.
const DEFAULT_REBEL = "slave";

/**
 * @param {object} a
 * @param {Object<string, number>} a.startCounts  faction → settlements at start
 * @param {Object<string, string>} a.nowOwnerByCity settlement → faction, from the save
 * @param {string} [a.rebelFaction]
 * @param {number} [a.tolerancePct] max total-count divergence before refusing to compare
 */
function expansionReport({ startCounts = null, nowOwnerByCity = null, rebelFaction = DEFAULT_REBEL, tolerancePct = 2 } = {}) {
  if (!startCounts || !nowOwnerByCity) return null;
  const R = String(rebelFaction).toLowerCase();

  const nowCounts = {};
  for (const f of Object.values(nowOwnerByCity)) {
    const k = String(f || "?").toLowerCase();
    nowCounts[k] = (nowCounts[k] || 0) + 1;
  }
  const startTotal = Object.values(startCounts).reduce((a, b) => a + b, 0);
  const nowTotal = Object.values(nowCounts).reduce((a, b) => a + b, 0);
  if (!startTotal || !nowTotal) return null;

  const divergence = Math.abs(startTotal - nowTotal);
  const divergencePct = +((divergence / Math.max(startTotal, nowTotal)) * 100).toFixed(2);
  const comparable = divergencePct <= tolerancePct;

  const factions = new Set([...Object.keys(startCounts).map((k) => k.toLowerCase()), ...Object.keys(nowCounts)]);
  const rows = [];
  for (const f of factions) {
    if (f === R) continue;
    const before = startCounts[f] != null ? startCounts[f] : (startCounts[f.toLowerCase()] || 0);
    const after = nowCounts[f] || 0;
    rows.push({ faction: f, before, after, delta: after - before });
  }
  rows.sort((a, b) => b.delta - a.delta || b.after - a.after);

  const grew = rows.filter((r) => r.delta > 0);
  const shrank = rows.filter((r) => r.delta < 0);
  const unchanged = rows.filter((r) => r.delta === 0);
  const wipedOut = rows.filter((r) => r.after === 0 && r.before > 0);
  const netNonRebel = rows.reduce((s, r) => s + r.delta, 0);

  const rebelBefore = startCounts[R] || 0;
  const rebelAfter = nowCounts[R] || 0;

  return {
    comparable, divergence, divergencePct,
    startTotal, nowTotal,
    rebelFaction: R, rebelBefore, rebelAfter, rebelDelta: rebelAfter - rebelBefore,
    factions: rows.length,
    grew: grew.length, shrank: shrank.length, unchanged: unchanged.length, wipedOut: wipedOut.length,
    netNonRebel,
    topGainers: grew.slice(0, 8),
    topLosers: shrank.slice(-8).reverse(),
    wipedOutNames: wipedOut.map((r) => r.faction).slice(0, 40),
    rows,
  };
}

/**
 * One world-level lead, only when the outcome is genuinely bad. "The AI expanded
 * a bit less than you hoped" is not worth a severity-3 lead; the independents
 * gaining ground while half the roster dies is.
 */
function expansionLeads(report) {
  if (!report || !report.comparable) return [];
  const R = report;
  const wipedPct = R.factions ? Math.round((R.wipedOut / R.factions) * 100) : 0;
  // Fire when the independents did NOT lose ground overall, or when a large
  // share of the roster is gone. Either means conquest is not working.
  const independentsHeld = R.rebelDelta >= 0;
  if (!independentsHeld && wipedPct < 25) return [];

  return [{
    severity: 3,
    faction: "all (campaign outcome)",
    file: "descr_strat.txt (faction count / starting armies)",
    key: `${R.rebelFaction} ${R.rebelBefore} → ${R.rebelAfter} settlements`,
    issue:
      `CONQUEST IS NOT WORKING. The independent peoples (${R.rebelFaction}) went from ${R.rebelBefore} settlements to ` +
      `${R.rebelAfter} (${R.rebelDelta >= 0 ? "+" : ""}${R.rebelDelta}), while the ${R.factions} real factions ` +
      `${R.netNonRebel >= 0 ? "gained" : "lost"} ${Math.abs(R.netNonRebel)} between them and ${R.wipedOut} of them (${wipedPct}%) were wiped out entirely.`,
    suggestion:
      `The map consolidated by factions eating each other rather than by anyone taking the independents — which is what you would ` +
      `expect if the strength requirements are out of reach for small states. Fix that gap first; this number is the scoreboard for ` +
      `whether it worked, so re-measure it after any change.`,
    evidence:
      `${R.grew} factions gained ground, ${R.shrank} lost, ${R.unchanged} unchanged · ` +
      `biggest gainers ${R.topGainers.slice(0, 4).map((r) => `${r.faction} ${r.before}→${r.after}`).join(", ")} · ` +
      `${R.startTotal} settlements at start vs ${R.nowTotal} in the save` +
      (R.divergence ? ` (${R.divergence} apart — settlements founded or razed mid-campaign)` : ""),
  }];
}

module.exports = { expansionReport, expansionLeads, DEFAULT_REBEL };
