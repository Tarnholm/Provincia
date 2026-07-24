// AI-run digest + diff (2026-07-25) — the before/after harness for mod tuning.
//
// The whole point of the AI Movement Lab is to change something in the mod and
// find out whether it helped. That needs two runs compared like-for-like, which
// means a COMPACT, comparable summary of a run (a full result is thousands of
// findings and megabytes) plus a diff that separates real movement from noise.
//
//   makeDigest(result, meta)  → small JSON-safe snapshot, safe to store on disk
//   diffDigests(before, after) → { totals, byKind, byFaction, leads, verdict }
//
// PURE (no fs / Electron) so it unit-tests directly and can run in a worker.
//
// COMPARABILITY: two runs are only meaningfully comparable if they analysed the
// same KIND of log over a similar span. The diff carries a `comparable` flag and
// a plain-language `caveat` when they don't line up — a shorter campaign will
// naturally show fewer findings, and reporting that as an improvement would be
// worse than useless. We never hide that.

"use strict";

const FINDING_KINDS = [
  "stuck", "oscillation", "never_arrives", "flee_loop",
  "stuck_mission", "assign_churn", "campaign_stall", "aborted_hotspot",
  "abandoned", "rich_but_stalled",
];

function makeDigest(result, meta = {}) {
  if (!result || result.error) return null;
  const byKind = {};
  for (const k of FINDING_KINDS) byKind[k] = (result.findingCounts && result.findingCounts[k]) || 0;

  // per-faction symptom counts — this is where a targeted mod tweak shows up
  const byFaction = {};
  for (const f of (result.findings || [])) {
    const k = String(f.faction || "?").toLowerCase();
    if (k === "?") continue;
    const e = byFaction[k] = byFaction[k] || { total: 0, impossible: 0, neverArrived: 0, orphaned: 0 };
    e.total++;
    if (f.impossible) e.impossible++;
    if (/NEVER arrived/.test(f.verdict || "")) e.neverArrived++;
    if (f.orphaned) e.orphaned++;
  }

  const leadsByFile = {};
  for (const l of (result.modLeads || [])) {
    const key = String(l.file || "?");
    leadsByFile[key] = (leadsByFile[key] || 0) + 1;
  }

  return {
    schema: 1,
    label: meta.label || null,
    savedAt: meta.savedAt || null,          // caller stamps the time (no Date.now here)
    logPath: result.logPath || null,
    logKind: result.logKind || null,
    logBytes: result.logBytes || null,
    turns: result.totalTurns || 0,
    lines: result.lines || null,
    findings: (result.findings || []).length,
    byKind,
    byFaction,
    leads: (result.modLeads || []).length,
    leadsByFile,
    save: result.save
      ? {
        turn: result.save.turn,
        confirmedNeverArrived: result.save.confirmedNeverArrived,
        impossibleCampaigns: result.save.impossibleCampaigns,
        orphanedArmies: result.save.orphanedArmies,
        navalWorld: result.save.navalWorld,
        factionsWithUnits: result.save.factionsWithUnits,
      }
      : null,
    economySummary: summariseEconomy(result.economy),
  };
}

function summariseEconomy(economy) {
  if (!economy) return null;
  const rows = Object.values(economy).filter((e) => e && e.reports > 0);
  if (!rows.length) return null;
  const richPct = rows.reduce((a, e) => a + e.richPct, 0) / rows.length;
  const poorPct = rows.reduce((a, e) => a + e.poorPct, 0) / rows.length;
  return {
    factions: rows.length,
    avgRichPct: +richPct.toFixed(3),
    avgPoorPct: +poorPct.toFixed(3),
  };
}

// Findings scale with campaign length, so compare RATES (per turn) as well as
// raw counts — otherwise a shorter replay looks like an improvement.
function perTurn(n, turns) { return turns > 0 ? +(n / turns).toFixed(3) : 0; }

function diffDigests(before, after) {
  if (!before || !after) return { error: "need two runs to compare" };

  const sameKind = before.logKind === after.logKind;
  const turnRatio = before.turns > 0 && after.turns > 0 ? after.turns / before.turns : null;
  const similarSpan = turnRatio != null && turnRatio >= 0.75 && turnRatio <= 1.334;
  const comparable = sameKind && similarSpan;
  let caveat = null;
  if (!sameKind) {
    caveat = `different log kinds (${before.logKind} vs ${after.logKind}) — counts are not comparable at all.`;
  } else if (!similarSpan) {
    caveat = `campaign lengths differ a lot (${before.turns} vs ${after.turns} turns) — raw counts will move for that reason alone, so read the per-turn rates, not the totals.`;
  }

  const mk = (b, a) => ({
    before: b, after: a, delta: a - b,
    beforePerTurn: perTurn(b, before.turns), afterPerTurn: perTurn(a, after.turns),
    ratePct: perTurn(b, before.turns) > 0
      ? +(((perTurn(a, after.turns) - perTurn(b, before.turns)) / perTurn(b, before.turns)) * 100).toFixed(1)
      : null,
  });

  const byKind = {};
  for (const k of FINDING_KINDS) {
    const b = (before.byKind || {})[k] || 0, a = (after.byKind || {})[k] || 0;
    if (b || a) byKind[k] = mk(b, a);
  }

  // factions that improved / regressed most (by total symptoms)
  const facs = new Set([...Object.keys(before.byFaction || {}), ...Object.keys(after.byFaction || {})]);
  const factionRows = [];
  for (const f of facs) {
    const b = (before.byFaction || {})[f] || { total: 0, impossible: 0, neverArrived: 0, orphaned: 0 };
    const a = (after.byFaction || {})[f] || { total: 0, impossible: 0, neverArrived: 0, orphaned: 0 };
    if (b.total === a.total && b.impossible === a.impossible && b.orphaned === a.orphaned) continue;
    factionRows.push({
      faction: f,
      total: a.total - b.total,
      impossible: a.impossible - b.impossible,
      neverArrived: a.neverArrived - b.neverArrived,
      orphaned: a.orphaned - b.orphaned,
      beforeTotal: b.total, afterTotal: a.total,
    });
  }
  factionRows.sort((x, y) => x.total - y.total); // biggest improvements (most negative) first

  const leadFiles = new Set([...Object.keys(before.leadsByFile || {}), ...Object.keys(after.leadsByFile || {})]);
  const leads = { before: before.leads || 0, after: after.leads || 0, delta: (after.leads || 0) - (before.leads || 0), byFile: {} };
  for (const f of leadFiles) {
    const b = (before.leadsByFile || {})[f] || 0, a = (after.leadsByFile || {})[f] || 0;
    if (b !== a) leads.byFile[f] = { before: b, after: a, delta: a - b };
  }

  const save = (before.save && after.save)
    ? {
      neverArrived: mk(before.save.confirmedNeverArrived || 0, after.save.confirmedNeverArrived || 0),
      impossible: mk(before.save.impossibleCampaigns || 0, after.save.impossibleCampaigns || 0),
      orphaned: mk(before.save.orphanedArmies || 0, after.save.orphanedArmies || 0),
      turnBefore: before.save.turn, turnAfter: after.save.turn,
    }
    : null;

  // Headline verdict, expressed on RATES so campaign length can't fake it.
  const totalRateBefore = perTurn(before.findings || 0, before.turns);
  const totalRateAfter = perTurn(after.findings || 0, after.turns);
  const ratePct = totalRateBefore > 0 ? ((totalRateAfter - totalRateBefore) / totalRateBefore) * 100 : null;
  let verdict;
  if (!comparable) verdict = "inconclusive";
  else if (ratePct == null) verdict = "inconclusive";
  else if (ratePct <= -10) verdict = "improved";
  else if (ratePct >= 10) verdict = "regressed";
  else verdict = "unchanged";

  return {
    comparable, caveat, verdict,
    ratePct: ratePct == null ? null : +ratePct.toFixed(1),
    totals: {
      findings: mk(before.findings || 0, after.findings || 0),
      turns: { before: before.turns, after: after.turns },
    },
    byKind, factionRows, leads, save,
    economy: (before.economySummary && after.economySummary)
      ? {
        avgRichPct: { before: before.economySummary.avgRichPct, after: after.economySummary.avgRichPct },
        avgPoorPct: { before: before.economySummary.avgPoorPct, after: after.economySummary.avgPoorPct },
      }
      : null,
    labels: { before: before.label || "baseline", after: after.label || "current" },
  };
}

module.exports = { makeDigest, diffDigests, FINDING_KINDS };
