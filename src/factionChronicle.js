// Faction Chronicle (📜, 2026-08-06) — turn the engine's own campaign_ai_log
// narration into a per-faction, per-turn plain-English chronicle: what the AI
// decided each turn (invasions with its stated reasons, finances, construction,
// recruitment, diplomat missions, war/peace status) so an AI test run can be
// READ instead of grepped.
//
// Parsing reuses the validated AI_RX manifest from src/aiMovementAnalyzer.js —
// hand-retyping those patterns is how the `+start` turn-header bug happened, so
// none are duplicated here. The two shapes AI_RX does not cover (the ltgd
// war/peace lists) are defined below, verified verbatim against the live RIS
// 0.7.0 log (2026-08-06):
//   AI: ltgd: are at war with: Roman Rebels, Roman Rebels, Italics, Free Peoples,
//   AI: ltgd: want peace with: Galatians,
// They live HERE and not in AI_RX deliberately: AI_RX feeds the exported
// AI_LOG_LINE_PATTERNS manifest that the crash reporter's generated Python
// mirrors, and adding shapes there forces a reporter release. The cost: a
// telemetry EXTRACT (aiLogExtract output) will lack war/peace lines — the
// chronicle still works, those two lines just won't appear.
//
// Turn model: one `start '<faction>' for year Y, season S` block = ONE game turn
// for that faction, so a faction's Nth block is game turn N. This sidesteps the
// 4-turns-per-year trap (the log only labels summer/winter, so counting distinct
// (year, season) pairs undercounts turns 2x — see the RIS timescale memory).
// message_log.txt "end round" ordinals count the same session turns, which is
// what lets the panel merge battleLedger events by turn number.
//
// Pure CJS module (consumed by saveCrackWorker.js): createChronicler() is
// stream-friendly (feedLine/finish, never holds the file), chronicleLogFile()
// wraps it with the same latin1 readline streaming as src/aiLogExtract.js.
// Covered by src/factionChronicle.test.js (real quoted lines + the reference
// 346MB log when present).

"use strict";

const { AI_RX } = require("./aiMovementAnalyzer.js");

// Shapes AI_RX does not cover (see header for why they are local).
const CHRON_RX = {
  atWar: /^AI: ltgd: are at war with: (.+)$/,
  wantPeace: /^AI: ltgd: want peace with: (.+)$/,
};

// ── translation vocab ────────────────────────────────────────────────────
// Engine enums → plain English. Unknown values fall back to humanize() so a
// changed engine yields readable-if-unpolished text, never a crash or a lie.

const INVADE_TEXT = {
  ALI_INVADE_IMMEDIATE: (t) => `Will invade ${t} immediately`,
  ALI_INVADE_OPPORTUNISTIC: (t) => `Watching for an opening to strike ${t}`,
  ALI_START_PLAN: (t) => `Started planning an invasion of ${t}`,
  ALI_CONTINUE_PLAN: (t) => `Continuing invasion preparations against ${t}`,
  ALI_NONE: (t) => `Decided against invading ${t}`,
};

const DEFEND_TEXT = {
  ALD_DEFEND_MINIMAL: "token defence",
  ALD_DEFEND_NORMAL: "standard defence",
  ALD_DEFEND_FRONTLINE: "hold the frontline",
  ALD_DEFEND_FORTIFIED: "fortified defence",
  ALD_DEFEND_DEEP: "defence in depth",
};

// "a, b, c, d … +12 more" — long faction lists must never become a wall.
function nameList(names, max = 8) {
  const arr = [...names];
  if (arr.length <= max) return arr.join(", ");
  return `${arr.slice(0, max).join(", ")} +${arr.length - max} more`;
}

// AFS_ economic states, poorest → richest (same family AFS_RICH/AFS_POOR uses
// in aiMovementAnalyzer.js).
const FINANCE_TEXT = {
  AFS_CROESUS: "rich as Croesus",
  AFS_ROLLING_IN_IT: "rolling in money",
  AFS_COMFORTABLE: "comfortable",
  AFS_ENOUGH: "solvent",
  AFS_OK: "getting by",
  AFS_SHOESTRING: "on a shoestring",
  AFS_PAUPER: "broke",
};

// Mission-type tallies (AI_RX.missionAny) → verbs for the per-turn orders line.
const MISSION_TEXT = {
  "move": "march",
  "move nonlocal": "march",
  "attack residence": "assault settlement",
  "siege residence": "lay siege",
  "attack enemy (army)": "attack enemy army",
  "attack enemy (navy)": "attack enemy fleet",
  "merge (army)": "merge armies",
  "merge (navy)": "merge fleets",
  "merge garrison": "reinforce garrison",
  "do nothing": "hold position",
  "wait for passengers": "await transport",
};

function humanize(v) {
  return String(v || "")
    .replace(/^(ALI_|ALD_|AFS_|AFB_|TAX_LEVEL_|AI_PROD_|ACS_)/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}

function fmtNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("en-US") : String(n);
}

// "-270" → "270 BC"; the engine uses astronomical-ish negative years.
function fmtYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return String(year);
  return y < 0 ? `${-y} BC` : `${y} AD`;
}

// "Roman Rebels, Roman Rebels, Italics, " → unique trimmed names. The engine
// repeats entries (one per shared war?) and leaves a trailing comma.
function parseNameList(s) {
  const out = [];
  const seen = new Set();
  for (const part of String(s).split(",")) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// Per-turn line caps: a chronicle is for reading; past this it's a log again.
const MAX_PER_KIND = 15;
const MAX_TURNS_PER_FACTION = 800; // ~200 years at 4TPY; oldest dropped beyond

function createChronicler(opts = {}) {
  const displayNames = opts.displayNames || {};
  const disp = (tag) => displayNames[tag] || String(tag || "").replace(/_/g, " ");

  const factions = new Map();       // tag → { turns }
  const turnsByFaction = new Map(); // tag → [turn objects]
  const regName = new Map();        // regId → settlement name (self-described)
  let lines = 0, matched = 0;
  let cur = null; // accumulator for the open faction turn block

  // GLOBAL session turn — the ordinal message_log.txt's "end round" markers
  // count, which is what battleLedger events are keyed by. A faction's own
  // block count drifts from it when factions die or spawn mid-session, so the
  // global turn is tracked separately: the engine runs each living faction
  // once per turn, so a tag REPEATING means a new turn has begun.
  let globalTurn = 1;
  const tagsThisTurn = new Set();

  function open(tag, year, season) {
    if (tagsThisTurn.has(tag)) { globalTurn++; tagsThisTurn.clear(); }
    tagsThisTurn.add(tag);
    let f = factions.get(tag);
    if (!f) { f = { turns: 0, invades: 0, builds: 0, recruits: 0 }; factions.set(tag, f); }
    f.turns++;
    cur = {
      tag, turn: f.turns, g: globalTurn, year, season,
      finance: null, strength: null, invTargets: null, health: null,
      atWar: null, wantPeace: null,
      invadeByTarget: new Map(),   // target → { decision, reason }
      defendByDecision: new Map(), // decision → Set(target)
      warAuth: new Set(),
      gathering: new Map(),        // target → { required, allocated }
      aborted: new Set(),          // regId
      builds: [], recruits: [], diplomats: [],
      garrisonSplits: new Map(), // settlement → max units seen (engine double-logs)
      taxByLevel: new Map(),
      missionTally: new Map(),
      overflow: Object.create(null), // kind → dropped count
    };
  }

  function push(arr, kind, item) {
    if (arr.length >= MAX_PER_KIND) { cur.overflow[kind] = (cur.overflow[kind] || 0) + 1; return; }
    arr.push(item);
  }

  // ── narration: one turn accumulator → ordered English lines ──
  function narrate(c) {
    const out = []; // { k: kind, t: text }
    const add = (k, t) => out.push({ k, t });

    if (c.strength) {
      let t = `Army strength ~${fmtNum(c.strength.army)} (${fmtNum(c.strength.free)} free for offensives), navy ${fmtNum(c.strength.navy)}`;
      if (c.invTargets != null) t += c.invTargets === 0 ? " — sees no viable invasion target" : ` — sees ${c.invTargets} invasion target${c.invTargets === 1 ? "" : "s"}`;
      add("status", t);
    } else if (c.invTargets === 0) {
      add("status", "Sees no viable invasion target this turn");
    }

    if (c.finance) {
      const f = c.finance;
      const state = FINANCE_TEXT[f.state] || humanize(f.state);
      add("economy", `Treasury: ${state} — expects ${fmtNum(f.income)} income vs ${fmtNum(f.maintenance)} upkeep`);
    }

    if (c.atWar && c.atWar.length) add("war", `At war with: ${c.atWar.join(", ")}`);
    if (c.wantPeace && c.wantPeace.length) add("peace", `Wants peace with: ${c.wantPeace.join(", ")}`);

    // Invade decisions grouped by (decision, reason): the rebel faction is "at
    // war with everyone" and emits the SAME opportunistic line against 60+
    // targets — grouped, that is one readable sentence instead of a wall.
    {
      const grouped = new Map(); // decision|reason → targets[]
      for (const [target, d] of c.invadeByTarget) {
        const key = `${d.decision}|${d.reason}`;
        let g = grouped.get(key);
        if (!g) { g = { decision: d.decision, reason: d.reason, targets: [] }; grouped.set(key, g); }
        g.targets.push(disp(target));
      }
      for (const g of grouped.values()) {
        const mk = INVADE_TEXT[g.decision] || ((t) => `${humanize(g.decision)}: ${t}`);
        add("invade", `${mk(nameList(g.targets))} — ${g.reason}`);
      }
    }
    if (c.warAuth.size) add("invade", `Attack authorised against ${nameList([...c.warAuth].map(disp))}`);

    for (const [decision, targets] of c.defendByDecision) {
      if (decision === "ALD_DEFEND_NORMAL") continue; // routine posture = noise
      add("defend", `Defence vs ${nameList([...targets].map(disp))}: ${DEFEND_TEXT[decision] || humanize(decision)}`);
    }

    // Musters only count once strength is actually allocated — the AI "eyes"
    // dozens of targets at 0-of-N every turn and immediately aborts them,
    // which is window-shopping, not campaigning.
    for (const [target, g] of c.gathering) {
      if (g.allocated <= 0) continue;
      add("military", `Mustering against ${target} — ${fmtNum(g.allocated)} of ${fmtNum(g.required)} strength gathered`);
    }
    if (c.aborted.size) {
      const names = [...c.aborted].map((regId) => regName.get(regId) || `region ${regId}`);
      if (names.length === 1) add("military", `Called off the campaign for ${names[0]} — not enough strength`);
      else add("military", `Called off ${names.length} campaigns for lack of strength (${nameList(names, 5)})`);
    }
    // Garrison splits: deduped per settlement (the engine logs the same split
    // twice). A handful reads fine line-by-line; a mass mobilisation (the AI
    // stripping its whole interior) collapses to one summary.
    if (c.garrisonSplits.size > 5) {
      let total = 0;
      for (const u of c.garrisonSplits.values()) total += u;
      add("military", `Thinned out ${c.garrisonSplits.size} garrisons (${fmtNum(total)} units pulled out)`);
    } else {
      for (const [settlement, units] of c.garrisonSplits) add("military", `Pulled ${units} unit${units === 1 ? "" : "s"} out of ${settlement}'s garrison`);
    }

    const overflowNote = (kind) => {
      const n = c.overflow[kind];
      if (n) add(kind, `…and ${n} more ${kind} entr${n === 1 ? "y" : "ies"} this turn`);
    };
    for (const b of c.builds) {
      const m = /^building (new|upgrade), (.+)$/.exec(b.item);
      if (m && m[1] === "new") add("build", `Started building ${m[2]} at ${b.settlement}`);
      else if (m) add("build", `Upgrading ${m[2]} at ${b.settlement}`);
      else add("build", `Started ${b.item} at ${b.settlement}`);
    }
    overflowNote("build");
    for (const r of c.recruits) add("recruit", `Recruiting ${r.unit} at ${r.settlement}`);
    overflowNote("recruit");

    if (c.taxByLevel.size) {
      const parts = [...c.taxByLevel.entries()].map(([lvl, n]) => `${humanize(lvl)} ×${n}`);
      add("economy", `Taxes set: ${parts.join(" · ")}`);
    }

    for (const d of c.diplomats) {
      const task = d.task && d.task !== "DIPLOMACY" ? ` (${humanize(d.task)})` : "";
      add("diplomacy", `Diplomat ${d.name} dispatched to ${d.settlement}${task}`);
    }
    overflowNote("diplomacy");

    if (c.missionTally.size) {
      const parts = [...c.missionTally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `${MISSION_TEXT[type] || type} ×${n}`);
      add("orders", `Orders issued: ${parts.join(" · ")}`);
    }

    if (c.health && c.health.ungoverned > 0) {
      add("alert", `${c.health.ungoverned} of ${c.health.of} cities lack a governor`);
    }
    return out;
  }

  function flush() {
    if (!cur) return;
    let arr = turnsByFaction.get(cur.tag);
    if (!arr) { arr = []; turnsByFaction.set(cur.tag, arr); }
    arr.push({ turn: cur.turn, g: cur.g, year: cur.year, season: cur.season, lines: narrate(cur) });
    if (arr.length > MAX_TURNS_PER_FACTION) arr.shift();
    cur = null;
  }

  function feedLine(line) {
    lines++;
    if (!line || line.charCodeAt(0) !== 65 /* 'A' */) return;
    let m;
    if ((m = AI_RX.factionStart.exec(line))) {
      matched++;
      flush();
      open(m[1], parseInt(m[2], 10), m[3]);
      return;
    }
    if (!cur) return; // pre-first-block preamble
    const c = cur;
    if ((m = AI_RX.ltgdInvade.exec(line))) {
      matched++;
      factions.get(c.tag).invades++;
      if (c.invadeByTarget.size < 120) c.invadeByTarget.set(m[2], { decision: m[4], reason: m[3] });
      return;
    }
    if ((m = AI_RX.ltgdDefend.exec(line))) {
      matched++;
      let set = c.defendByDecision.get(m[3]);
      if (!set) { set = new Set(); c.defendByDecision.set(m[3], set); }
      if (set.size < 120) set.add(m[1]);
      return;
    }
    if ((m = AI_RX.missionAny.exec(line))) {
      matched++;
      c.missionTally.set(m[1], (c.missionTally.get(m[1]) || 0) + 1);
      return;
    }
    if ((m = AI_RX.finance.exec(line))) {
      matched++;
      c.finance = { income: +m[1], maintenance: +m[2], state: m[7] };
      return;
    }
    if ((m = AI_RX.ltgdStrength.exec(line))) {
      matched++;
      c.strength = { army: +m[1], free: +m[2], navy: +m[3] };
      return;
    }
    if ((m = AI_RX.invasionTargets.exec(line))) { matched++; c.invTargets = +m[1]; return; }
    if ((m = CHRON_RX.atWar.exec(line))) { matched++; c.atWar = parseNameList(m[1]); return; }
    if ((m = CHRON_RX.wantPeace.exec(line))) { matched++; c.wantPeace = parseNameList(m[1]); return; }
    if ((m = AI_RX.warAuth.exec(line))) { matched++; if (c.warAuth.size < 120) c.warAuth.add(m[1]); return; }
    if ((m = AI_RX.buildStarted.exec(line))) {
      matched++;
      factions.get(c.tag).builds++;
      push(c.builds, "build", { item: m[1], settlement: m[2] });
      return;
    }
    if ((m = AI_RX.recruitStarted.exec(line))) {
      matched++;
      factions.get(c.tag).recruits++;
      push(c.recruits, "recruit", { unit: m[1], settlement: m[2] });
      return;
    }
    if ((m = AI_RX.taxChoice.exec(line))) {
      matched++;
      c.taxByLevel.set(m[4], (c.taxByLevel.get(m[4]) || 0) + 1);
      return;
    }
    if ((m = AI_RX.diplomatOrder.exec(line))) {
      matched++;
      push(c.diplomats, "diplomacy", { name: m[1], settlement: m[2], task: m[3] });
      return;
    }
    if ((m = AI_RX.garrisonSplit.exec(line))) {
      matched++;
      if (c.garrisonSplits.size < 100 || c.garrisonSplits.has(m[1])) {
        c.garrisonSplits.set(m[1], Math.max(c.garrisonSplits.get(m[1]) || 0, +m[2]));
      }
      return;
    }
    if ((m = AI_RX.campaign.exec(line))) {
      matched++;
      regName.set(m[2], m[1]); // reg id → settlement, self-described by the log
      const required = +m[4], allocated = +m[5];
      if (m[3] === "ACS_GATHERING" && allocated < required && c.gathering.size < 20) {
        c.gathering.set(m[1], { required, allocated });
      }
      return;
    }
    if ((m = AI_RX.aborted.exec(line))) { matched++; if (c.aborted.size < 20) c.aborted.add(m[1]); return; }
    if ((m = AI_RX.factionHealth.exec(line))) {
      matched++;
      c.health = { ungoverned: +m[3], of: +m[4] };
      return;
    }
  }

  function finish() {
    flush();
    const facList = [...factions.entries()]
      .map(([tag, f]) => ({ tag, display: disp(tag), ...f }))
      // 'slave' (the rebel pseudo-faction, permanently at war with everyone)
      // always tops raw activity counts but is rarely what anyone wants to
      // read first — sort it last.
      .sort((a, b) => (a.tag === "slave") - (b.tag === "slave") || b.turns - a.turns || b.invades - a.invades || a.tag.localeCompare(b.tag));
    const turnsOut = {};
    for (const [tag, arr] of turnsByFaction) turnsOut[tag] = arr;
    return { factions: facList, turnsByFaction: turnsOut, lines, matched };
  }

  return { feedLine, finish };
}

// Stream a campaign_ai_log.txt through a chronicler. latin1, line-by-line —
// the telemetry logs run to hundreds of MB and must never be slurped (the same
// discipline as src/aiLogExtract.js).
async function chronicleLogFile(logPath, opts = {}, onProgress = null) {
  const fs = require("fs");
  const readline = require("readline");
  const chron = createChronicler(opts);
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of rl) {
    chron.feedLine(line);
    if (onProgress && ++n % 500000 === 0) onProgress(`reading log — ${(n / 1e6).toFixed(1)}M lines…`);
  }
  const result = chron.finish();
  result.logPath = logPath;
  return result;
}

module.exports = { createChronicler, chronicleLogFile, FINANCE_TEXT, INVADE_TEXT };
