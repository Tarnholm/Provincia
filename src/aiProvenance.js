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
function logSaveAlignment({ logTurns = 0, saveTurn = 0, startsAtTurn1 = false } = {}) {
  if (!logTurns || !saveTurn) return null;

  // Without knowing the log starts at turn 1, its turn RANGE is unknown — only its
  // length is. Say so rather than computing a gap from an assumption.
  if (!startsAtTurn1) {
    return {
      logTurns, saveTurn, gapTurns: null, overlaps: false, confidence: "unknown",
      note: `This log covers ${logTurns} turns but its opening state does not match the ` +
            `campaign's starting ownership, so which turns it covers cannot be established. ` +
            `The save is turn ${saveTurn}. Treat any finding that pairs the two as unverified.`,
    };
  }

  const gapTurns = saveTurn - logTurns;
  if (gapTurns <= 0) {
    return {
      logTurns, saveTurn, gapTurns, overlaps: true, confidence: "good",
      note: `The log covers turns 1-${logTurns} and the save is turn ${saveTurn}, inside that ` +
            `range. Findings that pair the two are comparing the same period.`,
    };
  }
  // A gap of a few turns is normal and harmless — an army ordered late in the log may
  // legitimately still be marching. A gap as long as the log itself is not: it means
  // the save sits at twice the log's end, so the world has had as long again to change
  // as the log ever observed. `>=` and not `>` deliberately — the reference pairing is
  // exactly the boundary case (51-turn log, turn-102 save) and calling that merely
  // "fair" understates it.
  const severe = gapTurns >= logTurns;
  return {
    logTurns, saveTurn, gapTurns, overlaps: false,
    confidence: severe ? "poor" : "fair",
    note: severe
      ? `The log covers turns 1-${logTurns}; the save is turn ${saveTurn} — ${gapTurns} turns ` +
        `after the log ends, longer than the log itself. An army the log last mentions around ` +
        `turn ${logTurns} has had ${gapTurns} more turns to move, be destroyed, or change ` +
        `orders entirely, so "it never arrived" is not established by this save. Pair this log ` +
        `with a save from turn ${logTurns} or earlier for verdicts you can rely on.`
      : `The log covers turns 1-${logTurns}; the save is turn ${saveTurn}, ${gapTurns} turns ` +
        `later. Close enough that most verdicts hold, but an order given near the end of the ` +
        `log may simply still be in progress.`,
  };
}

/**
 * A lead when the pairing is weak. Deliberately severity "warn" and faction-agnostic:
 * it does not describe a mod bug, it qualifies every other finding on the screen.
 */
function provenanceLeads(alignment) {
  if (!alignment || alignment.confidence === "good") return [];
  return [{
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
  }];
}

module.exports = { logStartsAtCampaignStart, logSaveAlignment, provenanceLeads };
