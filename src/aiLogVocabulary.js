// Complete accounting of campaign_ai_log.txt (2026-07-25).
//
// WHY THIS EXISTS
// --------------
// The analyser grew from 13 to 18 line patterns and reached 47% of the file. The
// remaining 53% was not "nothing" — it was unexamined. The honest way to reach
// full coverage is not to pretend every line yields a finding, but to ACCOUNT for
// every line: either it carries signal we parse, or it is recognised as carrying
// none and we say which and why.
//
// The payoff is that anything left over is, by construction, a line shape nobody
// has looked at. A new engine build or a mod change that starts emitting something
// new gets surfaced instead of silently ignored — which is exactly the failure this
// session kept running into from the other direction.
//
// SIGNAL patterns live in aiMovementAnalyzer's AI_RX (they produce findings and
// per-faction stats). This module holds the rest: shapes that are real log
// vocabulary but carry nothing analysable, each with the reason it is dismissed.
// Nothing here is guessed — every pattern was taken from a shape-frequency
// taxonomy of the 4.39M-line reference log, with the counts recorded.
"use strict";

/**
 * Log vocabulary that carries no analysable signal. Ordered roughly by frequency
 * so the common cases match first.
 *
 * Each entry: { rx, category, why, seen } — `seen` is the count in the reference
 * log, kept so a future reader can tell a major shape from a rarity.
 */
const NO_SIGNAL = [
  // The file's own header banner, written once at open. Carries the engine build
  // date, which IS worth having — but it is read by the header parser, not here.
  { rx: /^s*=+ campaign ai log start/i, category: "log-header", why: "file banner; build date is read by the header parser" },
  // NOTE: `err: ...` lines are NOT listed here. They are script-command failures
  // and are treated as signal — see scriptErrors in the analyser. The commonest,
  // `err: no building of this type in settlement` (555x on the reference log), is a
  // set_building_health aimed at a building the settlement does not have.
  // ── section markers and blank structure ──
  { rx: /^AI: =+$/, category: "separator", why: "banner rule between sections", seen: 46674 },
  { rx: /^AI:\s*$/, category: "blank", why: "empty AI-prefixed line", seen: 23397 },
  { rx: /^AI: -+$/, category: "separator", why: "dashed rule", seen: 0 },

  // ── headers that announce a list whose CONTENTS we already parse ──
  // The choice lines themselves (`-- building 'X' at priority N`, `-- troop type
  // 'X' at priority N`) are parsed; these headers add only the settlement name,
  // which those lines' surrounding faction context already gives us.
  { rx: /^AI: production choices \((?:buildings|troops)\) for settlement '[^']*'\.?$/, category: "list-header", why: "announces a choice list whose entries are parsed individually", seen: 290775 },

  // ── per-action progress markers with no payload ──
  { rx: /^AI: faction: move starts \(action (?:issued|continues)\)\.?$/, category: "progress-marker", why: "movement bookkeeping with no army, target or outcome", seen: 213597 },
  { rx: /^AI: forcing update of the resource manager during this faction's turn/, category: "progress-marker", why: "internal housekeeping notice", seen: 10659 },
  { rx: /^AI: End of subterfuge (?:turn:|update)/, category: "progress-marker", why: "end-of-phase marker; the agent counts are parsed separately", seen: 21118 },
  { rx: /^AI: production: stopping recruitment\.?$/, category: "progress-marker", why: "phase end; the reason variants are parsed where they carry one", seen: 8586 },
  { rx: /^Second pass to catch any bodyguard units we missed/, category: "progress-marker", why: "engine note, not even AI-prefixed", seen: 6214 },

  // ── diplomacy evaluation internals ──
  // The engine dumps its proposal arithmetic line by line. Individually these are
  // fragments of one calculation with no subject attached, and the outcome that
  // matters (whether a proposal issued) appears elsewhere. Recognised so the
  // ~200k lines are accounted for rather than silently skipped.
  { rx: /^AI: Proposition Value: -?\d+/, category: "diplomacy-arithmetic", why: "one term of a proposal valuation, no subject on the line", seen: 37317 },
  { rx: /^AI: (?:More )?Owed To(?: Recipient)?: /, category: "diplomacy-arithmetic", why: "proposal-valuation term", seen: 68710 },
  { rx: /^AI: (?:Recipient|Proposer): (?:Wins|Credit|Total)/, category: "diplomacy-arithmetic", why: "proposal-valuation term", seen: 91751 },

  // ── strategic assessments that duplicate a parsed decision ──
  // The `ltgd:` family states its assessment and then its DECISION. We parse the
  // decision lines (invade/defend, with reasons). These are the intermediate
  // numbers behind them: useful to a human reading one faction's turn, but they
  // carry no decision and no outcome.
  { rx: /^AI: ltgd: '[^']*' against '[^']*', (?:his frontline|frontline balance)/, category: "assessment-detail", why: "intermediate comparison behind an invade/defend decision that is parsed", seen: 164534 },
  { rx: /^AI: campaign: \d+ local armies, \d+ nonlocal armies marked for merging/, category: "assessment-detail", why: "merge bookkeeping; the resulting orders are parsed", seen: 27076 },

  // ── production focus, NOT ownership ──
  // This one reads like a conquest record and is not: the values are AI_PROD_*
  // enums. Recorded explicitly because it is the single most misleading shape in
  // the file and was nearly built into a "conquest timeline".
  { rx: /^AI: region control: settlement '[^']*' has changed from '(?:NUM_)?AI_PROD\w*' to '(?:NUM_)?AI_PROD\w*'/, category: "production-focus", why: "production-focus enum change, NOT a change of owner despite the wording", seen: 40685 },
];

/**
 * FAMILY-level accounting for the long tail.
 *
 * Checked only AFTER every specific pattern has failed, so a shape that is worth
 * extracting is never swallowed here. Each family is a prefix the engine uses
 * consistently, and membership is a weaker statement than being parsed: it means
 * "this is recognised commentary from a known subsystem", not "we read it".
 *
 * These are counted separately from signal in the coverage report, so the two can
 * never be confused. If one of these families later turns out to contain something
 * worth having — as `ltgd:` did, where the invade/defend decisions were buried in
 * exactly this kind of commentary — promote the specific shape to a real pattern.
 */
const KNOWN_FAMILIES = [
  // Wrapped continuation of a previous line: the engine breaks long mission lines
  // and the remainder starts with the bracketed detail. Not a line in its own right.
  { rx: /^\s*\((?:close|far|towards|move|heading)[^)]*\)\.?\s*$/i, family: "continuation", why: "wrapped remainder of the preceding mission line" },
  { rx: /^\s*\(tile: -?\d+, -?\d+\)/, family: "continuation", why: "wrapped remainder naming a tile" },

  // Production subsystem commentary: troop shortages, retraining notes, cash
  // reasoning. The production ACTIONS (started / started recruitment) are parsed.
  { rx: /^AI: production: /, family: "production-commentary", why: "production subsystem note; the start/recruit actions are parsed separately" },

  // Long-term and grand strategy commentary. The DECISIONS (invade/defend, war
  // authorisation) are parsed; these are the surrounding reasoning.
  { rx: /^AI: ltgd: /, family: "ltgd-commentary", why: "long-term-goal reasoning; the invade/defend decisions are parsed separately" },
  { rx: /^AI: gsd: /, family: "gsd-commentary", why: "grand-strategy note; war authorisation is parsed separately" },
  { rx: /^AI: mildir: /, family: "mildir-commentary", why: "military-director note; attack authorisation is parsed separately" },

  // Diplomacy: the proposal arithmetic is already classified; this catches the
  // remaining diplomat/court chatter.
  { rx: /^AI: Diplomat CC: /, family: "diplomacy-commentary", why: "diplomat order variant; settlement-target orders are parsed" },
  { rx: /^AI: (?:considering|Considering) /, family: "deliberation", why: "the AI narrating an option it is weighing, with no outcome on the line" },

  // Campaign and controller bookkeeping that carries no army/target/outcome.
  { rx: /^AI: campaign: /, family: "campaign-commentary", why: "campaign-subsystem note; missions, strategies and garrison splits are parsed" },
  { rx: /^AI: worldwide: /, family: "worldwide-commentary", why: "worldwide-controller note; assignment and release are parsed" },
  { rx: /^AI: named cc: /, family: "named-cc-commentary", why: "named-character controller note; move orders and health are parsed" },
  { rx: /^AI: region control: /, family: "region-control-commentary", why: "region-control note; tax choices and production focus are parsed" },
  { rx: /^AI: faction: /, family: "faction-commentary", why: "faction-turn bookkeeping" },

  // ── NOT AI output: the game console and the campaign script share this file ──
  // The console echoes each command it runs plus, for some, the multi-line help
  // text for that command. The script serialises its persistent counters. Neither
  // is AI reasoning, and neither was recognised until the coverage report made the
  // gap visible — which is exactly what it is for.
  { rx: /^\s*sudo /, family: "console-echo", why: "console command echoed as it ran" },
  { rx: /^\s*(?:set_building_health|add_money|give_trait|process_cq|create_unit|toggle_\w+|console_command)\b/, family: "console-echo", why: "console command or its usage text" },
  { rx: /^\s*(?:sets|in a settlement, so that|for building chains see)\b/, family: "console-help", why: "continuation of a console command's usage text" },
  { rx: /^\s*Serialising persistent counter /, family: "script-counter", why: "campaign script persisting a counter value" },
  { rx: /^\s*\((?:adjacent|not adjacent|same region)\)\.?\s*$/i, family: "continuation", why: "wrapped remainder of a preceding mission line" },

  // Engine notes with NO AI: prefix. The engine interleaves its own progress
  // notes into this file; they name a faction or an objective but carry no
  // decision. Listed explicitly rather than swept up by a catch-all, so a new
  // un-prefixed shape still reports as unknown.
  { rx: /^s*Performing unit swaps for faction /, family: "engine-note", why: "unit-swap pass announcement" },
  { rx: /^s*created a (?:disembark|embark|naval) objective/, family: "engine-note", why: "objective created; the resulting orders are parsed" },
  { rx: /^s*(?:Checking|Finished|Starting|Processing) /, family: "engine-note", why: "phase progress note" },
  // Asset loading chatter (logos, spritesheets, textures). Genuinely nothing to
  // analyse — but note that ASSET FAILURES are a different shape and are NOT
  // swept up here, because those name a missing file and are worth having.
  { rx: /^s*Loading (?:faction logo|spritesheet|texture|model)/i, family: "asset-loading", why: "asset load progress" },
  // Anything else the engine prefixes with AI: and we have not placed. Kept LAST

  // and deliberately broad, but still narrower than "everything": a line without
  // the AI: prefix is NOT swallowed, so non-engine output still shows up as unknown.
  { rx: /^AI: /, family: "other-ai-note", why: "AI-subsystem line in no recognised family — inspect if this grows" },
];

/**
 * Extra SIGNAL patterns beyond AI_RX: shapes worth parsing that the analyser now
 * reads. Kept here with their counts so the vocabulary table is the one place
 * describing the whole file. The analyser owns the actual extraction.
 */
const SIGNAL_NOTES = [
  { category: "recruitment-started", why: "the AI actually began recruiting a unit (vs merely wanting one)", seen: 15499 },
  { category: "construction-started", why: "the AI actually began a building", seen: 15657 },
  { category: "invasion-targets", why: "how many invasion targets the AI can see at all — zero means it will never attack", seen: 21172 },
  { category: "agent-totals", why: "spies/assassins the faction holds, distinct from those assigned this turn", seen: 44146 },
  { category: "faction-health", why: "leader/heir status, ungoverned cities, total strength", seen: 23349 },
  { category: "diplomat-order", why: "a diplomat told to move, with task and priority", seen: 23857 },
  { category: "construction-blocked", why: "settlement busy constructing something the engine calls invalid", seen: 5872 },
];

/**
 * Normalise a line to a comparable SHAPE: quoted names, numbers and paths
 * collapsed. Used to aggregate unknown lines so a report names shapes, not
 * thousands of near-identical strings.
 */
function lineShape(line) {
  return String(line)
    .replace(/'[^']*'/g, "'X'")
    .replace(/"[^"]*"/g, '"X"')
    .replace(/-?\d+\.\d+/g, "F")
    .replace(/-?\d+/g, "N")
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/** The family a line belongs to, or null. Checked only after specific patterns. */
function classifyFamily(line) {
  for (const e of KNOWN_FAMILIES) if (e.rx.test(line)) return e.family;
  return null;
}

/** True when the line is recognised vocabulary that carries no signal. */
function classifyNoSignal(line) {
  for (const e of NO_SIGNAL) if (e.rx.test(line)) return e.category;
  return null;
}

/**
 * Track coverage while streaming a log. Feed every line; `finish()` reports how
 * much was accounted for and names whatever was not.
 *
 * @param {(line:string)=>boolean} isSignal  true if the analyser parses this line
 */
function createCoverageTracker(isSignal) {
  const byCategory = Object.create(null);
  const unknown = new Map();
  let total = 0, signal = 0, noSignal = 0, familyLines = 0;

  const bump = (cat) => { byCategory[cat] = (byCategory[cat] || 0) + 1; };

  return {
    feedLine(line) {
      total++;
      if (isSignal(line)) { signal++; bump("signal"); return; }
      const cat = classifyNoSignal(line);
      if (cat) { noSignal++; bump(cat); return; }
      const s = lineShape(line);
      if (!s) { noSignal++; bump("blank"); return; }
      // Family accounting comes after every specific pattern, so nothing worth
      // extracting is swallowed. Counted apart from signal — belonging to a known
      // family is not the same as having been read.
      const fam = classifyFamily(line);
      if (fam) { familyLines++; bump("family:" + fam); return; }
      const e = unknown.get(s);
      if (e) e.n++;
      else unknown.set(s, { n: 1, sample: line.length < 300 ? line : line.slice(0, 300) });
    },
    finish() {
      const unknownCount = [...unknown.values()].reduce((a, e) => a + e.n, 0);
      const accounted = signal + noSignal + familyLines;
      return {
        totalLines: total,
        signalLines: signal,
        noSignalLines: noSignal,
        // recognised as coming from a known subsystem, but not individually read
        familyLines,
        unknownLines: unknownCount,
        // The headline: what fraction of the file the tool can account for.
        coveragePct: total ? +((accounted / total) * 100).toFixed(2) : 0,
        signalPct: total ? +((signal / total) * 100).toFixed(2) : 0,
        byCategory,
        // Biggest unexamined shapes, so a new engine or mod line gets noticed
        // rather than quietly dropped.
        unknownShapes: [...unknown.entries()]
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, 25)
          .map(([shape, e]) => ({ shape, count: e.n, sample: e.sample })),
        distinctUnknownShapes: unknown.size,
      };
    },
  };
}

module.exports = { NO_SIGNAL, SIGNAL_NOTES, KNOWN_FAMILIES, lineShape, classifyNoSignal, classifyFamily, createCoverageTracker };
