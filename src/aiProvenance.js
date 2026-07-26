/**
 * Do this log and this save describe the same moment — or even the same campaign?
 *
 * WHY THIS EXISTS. The Lab's strongest findings are cross-referenced: "the AI ordered
 * this army to Nasium for 50 turns" (from the log) "and it is not there" (from the
 * save). That inference is only as good as the pairing. On the reference data the log
 * covers years -270..-245 — about 51 turns — while the save is turn 102. So every
 * "never arrived" verdict was being decided against a world state roughly 51 turns
 * after the log stopped talking about it.
 *
 * That was found the hard way: the log shows the rebel faction collapsing from ~497
 * settlements toward ~30, while the save shows it holding 522. Both numbers survived
 * scrutiny — 522 are real named settlements, not placeholders or unresolved owners —
 * which leaves the pairing itself as the thing that does not hold.
 *
 * This module does not guess which source is wrong. It states the relationship between
 * them and lets a reader discount accordingly, because a confident finding built on an
 * unexamined pairing is worse than an uncertain one.
 */

/**
 * Establish whether the log opens at the campaign's start.
 *
 * If a log's first-seen settlement counts match descr_strat's starting counts, the log
 * begins at turn 1 — and only then does "the save is N turns past the log" mean
 * anything. Compared over factions present in BOTH sources; a faction missing from
 * either cannot vote.
 *
 * @param {Object} a
 * @param {Object<string,{firstSettlements:number}>} a.factionHealth  analyser output
 * @param {Object<string,number>} a.startCounts  faction → settlements in descr_strat
 * @returns {{compared:number, matched:number, matchShare:number, startsAtTurn1:boolean, mismatches:Array}|null}
 */
function logStartsAtCampaignStart({ factionHealth = null, startCounts = null } = {}) {
  if (!factionHealth || !startCounts) return null;
  let compared = 0, matched = 0;
  const mismatches = [];
  for (const [fac, e] of Object.entries(factionHealth)) {
    const want = startCounts[String(fac).toLowerCase()];
    const got = e && e.firstSettlements;
    if (!want || !got) continue;          // absent from one side — no vote
    compared++;
    // Exact match is too strict: the engine's first pass can already reflect a
    // capture or two, and the counts are read a few lines into the turn. Within one
    // settlement is the same opening state for this purpose.
    if (Math.abs(got - want) <= 1) matched++;
    else if (mismatches.length < 8) mismatches.push({ faction: fac, strat: want, log: got });
  }
  if (!compared) return null;
  const matchShare = matched / compared;
  return {
    compared,
    matched,
    matchShare: +matchShare.toFixed(3),
    // A clear majority agreeing is enough. Demanding near-unanimity would fail on any
    // campaign that had a rebellion in its first season.
    startsAtTurn1: matchShare >= 0.75,
    mismatches,
  };
}

/**
 * How far apart in time are the log and the save?
 *
 * @param {Object} a
 * @param {number} a.logTurns    distinct turn blocks in the log
 * @param {number} a.saveTurn    the save's turn number
 * @param {boolean} a.startsAtTurn1  from logStartsAtCampaignStart
 * @returns {{logTurns:number, saveTurn:number, gapTurns:number|null, overlaps:boolean, confidence:string, note:string}|null}
 */
// RIS runs FOUR turns per year (twice the base game). Nothing in the mod's data
// files states this — there is no `timescale` anywhere in RIS/data — so it cannot be
// derived and is taken as a named constant, overridable per campaign.
//
// This matters more than it looks. The log's own season field only ever reads "summer"
// or "winter": two labels for four turns. Counting distinct (year, season) blocks
// therefore UNDERCOUNTS turns by 2x, and an earlier version of this check did exactly
// that — it reported the 26-year reference log as 51 turns, concluded the turn-102 save
// sat 51 turns beyond it, and flagged a gap that does not exist. At 4 turns/year the
// log spans ~104 turns and the save at turn 102 is inside it.
//
// So the comparison is done in YEARS, which are stated unambiguously on every faction
// header, and turns are converted into years rather than the reverse.
const DEFAULT_TURNS_PER_YEAR = 4;

/**
 * How far apart in time are the log and the save?
 *
 * @param {Object} a
 * @param {number} a.firstYear  first year named in the log (negative for BC)
 * @param {number} a.lastYear   last year named in the log
 * @param {number} a.saveTurn   the save's turn number
 * @param {boolean} a.startsAtTurn1
 * @param {number} [a.turnsPerYear]  campaign timescale; RIS uses 4
 */
/**
 * The campaign's start year, from descr_strat's own `start_date` line.
 *
 * This removes the need to guess. Turn N's year is startYear + (N-1)/turnsPerYear, and
 * with that the log's years can be compared to the save's turn directly — no anchoring
 * required. It matters because the crash reporter ships a TAIL of the log (recent turn
 * blocks only), so a tester's extract never opens at turn 1: on the first real one
 * analysed, the check could only answer "unknown" and reported a saveYear 14 years wrong,
 * having assumed the log's first year was the campaign's.
 */
function parseCampaignStartYear(descrStratText) {
  if (!descrStratText) return null;
  const m = /^\s*start_date\s+(-?\d+)/m.exec(String(descrStratText));
  return m ? +m[1] : null;
}

function logSaveAlignment({ firstYear = null, lastYear = null, saveTurn = 0, startsAtTurn1 = false, turnsPerYear = DEFAULT_TURNS_PER_YEAR, campaignStartYear = null } = {}) {
  if (firstYear == null || lastYear == null || !saveTurn || !turnsPerYear) return null;

  const logYears = lastYear - firstYear + 1;
  // Prefer descr_strat's start_date. Falling back to the log's own first year is only
  // valid when the log begins at turn 1, which a reporter extract never does.
  const anchorYear = campaignStartYear != null ? campaignStartYear : firstYear;
  const saveYearsIn = (saveTurn - 1) / turnsPerYear;
  const saveYear = anchorYear + saveYearsIn;
  const anchoredBy = campaignStartYear != null ? "descr_strat start_date" : (startsAtTurn1 ? "log opens at turn 1" : null);

  if (!anchoredBy) {
    return {
      logYears, saveTurn, turnsPerYear, saveYear: null, anchoredBy: null,
      gapYears: null, overlaps: false, confidence: "unknown",
      note: `This log spans ${logYears} year(s) (${firstYear} to ${lastYear}), but without ` +
            `descr_strat's start_date — and with an opening state that does not match the campaign's ` +
            `starting ownership — the year of turn ${saveTurn} cannot be established. ` +
            `Treat any finding that pairs the two as unverified.`,
    };
  }

  // With a real anchor the question is simply whether the save's year falls inside the
  // years the log covers, which works for a tail extract as well as a full log.
  if (campaignStartYear != null) {
    const before = saveYear < firstYear - 1 / turnsPerYear;
    const after = saveYear > lastYear + 1;
    const gapYears = after ? +(saveYear - lastYear).toFixed(2) : (before ? +(saveYear - firstYear).toFixed(2) : 0);
    const inside = !before && !after;
    const severe = Math.abs(gapYears) >= Math.max(2, logYears);
    return {
      logYears, saveTurn, turnsPerYear, saveYear: +saveYear.toFixed(1), anchoredBy,
      gapYears, overlaps: inside,
      confidence: inside ? "good" : (severe ? "poor" : "fair"),
      note: inside
        ? `The log covers ${firstYear} to ${lastYear} and turn ${saveTurn} falls at year ` +
          `${saveYear.toFixed(0)} (campaign starts ${campaignStartYear}, ${turnsPerYear} turns/year) — ` +
          `inside that span. Findings that pair the two are comparing the same period.`
        : `The log covers ${firstYear} to ${lastYear}; turn ${saveTurn} is year ${saveYear.toFixed(0)} ` +
          `(campaign starts ${campaignStartYear}, ${turnsPerYear} turns/year), ${Math.abs(gapYears)} year(s) ` +
          `${after ? "after the log ends" : "before the log begins"}` +
          (severe
            ? ` — far enough that an army the log describes has had ample time to move, die or be re-tasked, so "it never arrived" is not established by this save.`
            : `. Close enough that most verdicts hold, but an order given near the edge of the log may simply still be in progress.`),
    };
  }

  // Inside the log's own span → the save is a moment the log describes.
  if (saveYear <= lastYear + 1 / turnsPerYear) {
    const gapYears = +Math.max(0, saveYear - lastYear).toFixed(2);
    return {
      logYears, saveTurn, turnsPerYear, saveYear: +saveYear.toFixed(1), anchoredBy, gapYears,
      overlaps: true, confidence: "good",
      note: `The log covers ${firstYear} to ${lastYear} (${logYears} years, about ` +
            `${logYears * turnsPerYear} turns at ${turnsPerYear} turns/year) and turn ${saveTurn} ` +
            `falls at year ${saveYear.toFixed(0)} — inside that span. Findings that pair the two are ` +
            `comparing the same period.`,
    };
  }

  const gapYears = +(saveYear - lastYear).toFixed(2);
  const severe = gapYears >= logYears;
  return {
    logYears, saveTurn, turnsPerYear, saveYear: +saveYear.toFixed(1), anchoredBy, gapYears,
    overlaps: false, confidence: severe ? "poor" : "fair",
    note: `The log ends at year ${lastYear}; turn ${saveTurn} is year ${saveYear.toFixed(0)}, ` +
          `${gapYears} year(s) later (${Math.round(gapYears * turnsPerYear)} turns at ` +
          `${turnsPerYear} turns/year)` +
          (severe
            ? ` — longer than the log itself, so an army the log last mentions has had as long again to move, be destroyed, or be re-tasked. "It never arrived" is not established by this save.`
            : `. Close enough that most verdicts hold, but an order given near the end of the log may simply still be in progress.`),
  };
}

/**
 * Are the log and the save even from the SAME campaign?
 *
 * logStartsAtCampaignStart only establishes that the log begins at a campaign start —
 * which any campaign's log does. It cannot tell two playthroughs apart. This does, by
 * looking for divergence that elapsed time cannot explain.
 *
 * The signal that motivated it: the reference log leaves the independent peoples at
 * ~30 settlements after 51 turns of continuous, monotonic decline (497 → 450 → 413 →
 * … → 31 → 30). The save, 51 turns later, shows them holding 522. A faction cannot
 * grow 17-fold from near-death; conquered settlements pass to the conqueror, not back
 * to the rebels. So the two describe different playthroughs, and no amount of elapsed
 * time reconciles them.
 *
 * Only large, directional contradictions count. A faction that gains or loses normally
 * over 51 turns proves nothing — the point is to catch the impossible, not the busy.
 *
 * @param {Object} a
 * @param {Object<string,{lastSettlements:number, maxSeenSettlements:number}>} a.factionHealth
 * @param {Object<string,number>} a.saveCounts  faction → settlements in the save
 * @param {number} [a.factor]  how many times larger counts as impossible
 * @returns {{compared:number, contradictions:Array, sameCampaign:boolean}|null}
 */
function sameCampaignCheck({ factionHealth = null, saveCounts = null, factor = 5, rebelFaction = "slave" } = {}) {
  if (!factionHealth || !saveCounts) return null;
  let compared = 0;
  const contradictions = [];
  for (const [fac, e] of Object.entries(factionHealth)) {
    // THE REBEL FACTION IS EXCLUDED, and this exclusion is the whole lesson of this
    // check's first version. It fired on exactly one faction — the rebels — reporting
    // the log leaving them at ~31 settlements against 522 in the save, and concluded
    // "different campaigns". Once the timescale was corrected (RIS runs 4 turns/year,
    // so the save sits INSIDE the log's span, not 51 turns past it) that reading
    // became untenable: at the same moment, two figures 17x apart mean the two sources
    // are not measuring the same thing for this faction — not that the campaigns differ.
    //
    // aiExpansion.js already excludes the rebels from its arithmetic for the same
    // reason: RIS gives them ~499 of 1,305 settlements by design and the engine treats
    // them specially. A one-faction verdict resting on the one faction known to be
    // special was never sound.
    if (String(fac).toLowerCase() === String(rebelFaction).toLowerCase()) continue;
    const now = saveCounts[String(fac).toLowerCase()];
    const end = e && e.lastSettlements;
    if (!now || !end) continue;
    compared++;
    // Ignore tiny absolute numbers: 1 → 6 is a factor of 6 and entirely ordinary.
    if (now < 40) continue;
    if (now >= end * factor) {
      contradictions.push({
        faction: fac,
        logEnd: end,
        logPeak: e.maxSeenSettlements || end,
        save: now,
        factor: +(now / end).toFixed(1),
      });
    }
  }
  if (!compared) return null;
  contradictions.sort((a, b) => b.factor - a.factor);
  // TWO or more. One faction diverging is far more likely to be a quirk of what that
  // faction's numbers mean than proof of two playthroughs — which is precisely the
  // mistake this check made on its first outing. Several factions diverging at once is
  // a property of the pairing, not of any one faction.
  return {
    compared,
    contradictions,
    sameCampaign: contradictions.length < 2,
    singleOutlier: contradictions.length === 1 ? contradictions[0] : null,
  };
}

/**
 * A lead when the pairing is weak. Deliberately severity "warn" and faction-agnostic:
 * it does not describe a mod bug, it qualifies every other finding on the screen.
 */
function provenanceLeads(alignment, sameCampaign = null) {
  const leads = [];

  // A different-campaign verdict outranks a timing caveat: if the two files are not
  // the same playthrough, no gap arithmetic makes them comparable.
  if (sameCampaign && sameCampaign.contradictions.length >= 2) {
    const worst = sameCampaign.contradictions.slice(0, 3)
      .map((c) => `${c.faction}: log ends at ${c.logEnd} settlements (peak ${c.logPeak}), save has ${c.save} — ${c.factor}x`)
      .join(" · ");
    leads.push({
      severity: 3,
      faction: "all (data provenance)",
      file: "(no file — this is about the log and save you selected)",
      key: "log and save disagree beyond what time explains",
      issue: `THIS LOG AND THIS SAVE LOOK LIKE DIFFERENT CAMPAIGNS. ${sameCampaign.contradictions.length} faction(s) hold ` +
        `far more territory in the save than the log leaves them with, by a margin elapsed time cannot explain — ` +
        `conquered settlements pass to the conqueror, not back to their former owner. Every finding that pairs the ` +
        `two (never-arrived verdicts, unaffordable campaigns, orphaned armies) is unsafe.`,
      suggestion: `Re-run with a save from the same playthrough as this log. Findings that rest on the log alone — ` +
        `orders issued, strength requirements, script errors, invasion targets — are unaffected and remain valid.`,
      evidence: `${worst}${sameCampaign.contradictions.length > 3 ? ` · +${sameCampaign.contradictions.length - 3} more` : ""} · ` +
        `${sameCampaign.compared} factions compared`,
    });
  }

  if (!alignment || alignment.confidence === "good") return leads;
  return leads.concat([{
    severity: "warn",
    faction: "all (data provenance)",
    file: "(no file — this is about the log and save you selected)",
    key: `save turn ${alignment.saveTurn} vs log turns 1-${alignment.logTurns}`,
    issue: `THE LOG AND SAVE DESCRIBE DIFFERENT MOMENTS — ${alignment.note}`,
    suggestion: alignment.gapTurns && alignment.gapTurns > 0
      ? `Load a save from around turn ${alignment.logTurns} instead. Findings that rest only on the log (orders issued, strength requirements, script errors) are unaffected and remain valid.`
      : `Confirm the log and save come from the same campaign. Log-only findings are unaffected.`,
    evidence: `log: ${alignment.logTurns} turn blocks · save: turn ${alignment.saveTurn}` +
      (alignment.gapTurns != null ? ` · gap: ${alignment.gapTurns} turns` : " · gap: not determinable"),
  }]);
}

module.exports = { logStartsAtCampaignStart, logSaveAlignment, sameCampaignCheck, provenanceLeads, parseCampaignStartYear };
