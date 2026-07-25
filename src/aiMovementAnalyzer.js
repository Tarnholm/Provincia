// AI Movement Analyzer (2026-07-24) — parse RTW:R campaign logs into per-army
// movement traces and detect AI pathing pathologies, for tuning the mod's AI.
//
// INPUT: the text of a message_log.txt (any session — live dir, an archived
// log, or one downloaded from the RIS Discord telemetry channel). Movement
// lines look like (empirically, from calibration/logs-archive/message_log-97turns.txt):
//   Captain Cambyses(a638fee0:army(a5bb19e0):parthia:general):MOVING_NORMAL:start(94,28):end(88,26)
//   Captain Phraotes(...):MOVING_NORMAL:start(49,37):end(38,39):multi-turns left(2)
//   Captain Syrus(...):EXCHANGE:start(113,39):end(114,39):loco(MOVING_NORMAL)
//   Captain Xerxes(parthia:a8ba7150) army(a5bb3ba0) found flee tile(129,26)
// Turn boundaries are the '========= ... end round N =========' banner lines —
// the same convention logWatchHandlers' backfill uses. All parsing reuses
// src/messageLogParser.parseLine (never a second regex for the same line).
//
// FINDINGS (each: { kind, charUuid, name, faction, fromTurn, toTurn, turns,
//                   x, y, detail, severity }):
//   stuck        — the army keeps emitting moves across ≥ MIN_STUCK_TURNS
//                  consecutive turns but its NET displacement over that window
//                  is < STUCK_NET_TILES while it actually walked ≥ 2× that —
//                  i.e. it is trying to go somewhere and not getting there.
//   oscillation  — ping-pong pathing: the army alternates between two tiles
//                  (A→B→A→B…) for ≥ MIN_OSC_CYCLES full cycles.
//   never_arrives— a multi-turn order (multi-turns left(N)) toward ~the same
//                  destination repeats across ≥ MIN_PATH_TURNS turns without
//                  the army ever getting within ARRIVE_TILES of it.
//   flee_loop    — the army flees (found flee tile / FLEEING) in
//                  ≥ MIN_FLEE_TURNS distinct turns inside a sliding window —
//                  usually a doom-stack camping it or a broken retreat target.
//
// PURE module (no fs, no Electron): callable from main-process IPC and from
// vitest against the archived real log. `regionAt(x, y)` is an optional
// callback so the caller can attach region names to findings.

"use strict";

const { parseLine } = require("./messageLogParser.js");

const DEFAULTS = {
  MIN_STUCK_TURNS: 3,   // consecutive moving-but-not-progressing turns
  STUCK_NET_TILES: 3,   // net displacement below this = "went nowhere"
  MIN_OSC_CYCLES: 2,    // A→B→A→B = 2 cycles
  MIN_PATH_TURNS: 3,    // multi-turn order repeated this many turns
  ARRIVE_TILES: 2,      // within this of the ordered end = arrived
  MIN_FLEE_TURNS: 3,    // distinct turns fleeing…
  FLEE_WINDOW: 6,       // …within this many turns
};

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// The flee lines aren't in messageLogParser's move regex — they have their own
// parsed types (flee_tile / fleeing_to_settlement). We only need char identity
// + turn, which parseLine already returns for those types.

function analyzeMovementLog(text, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const regionAt = typeof opts.regionAt === "function" ? opts.regionAt : null;

  // ── pass 1: turn-attributed event streams per character ────────────────
  let turn = 1;
  const armies = new Map(); // charUuid → { name, faction, role, moves: [], flees: [] }
  let moveLines = 0, fleeLines = 0, parsedLines = 0, cannotFlee = 0;
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (raw.startsWith("=================")) {
      if (raw.includes("end round")) turn++;
      continue;
    }
    // Bare context-free line the engine emits when a beaten army has NOWHERE
    // to retreat (real corpus: 14 in 97 turns). No identity on the line, so
    // it's a global health counter, never attributed to a specific army.
    if (raw.includes("(cannot find flee tile)")) { cannotFlee++; continue; }
    const ev = parseLine(raw);
    if (!ev) continue;
    parsedLines++;
    if (ev.type === "character_move") {
      moveLines++;
      const a = armies.get(ev.charUuid) || { name: ev.name, faction: ev.faction, role: ev.role, moves: [], flees: [] };
      a.name = ev.name; a.faction = ev.faction; // latest wins (captains promote etc.)
      a.moves.push({
        turn,
        fromX: ev.fromX, fromY: ev.fromY, toX: ev.toX, toY: ev.toY,
        multiTurnsLeft: ev.multiTurnsLeft || 0,
        status: ev.status, loco: ev.loco || null,
      });
      armies.set(ev.charUuid, a);
    } else if (ev.type === "flee_tile" || ev.type === "fleeing_to_settlement") {
      fleeLines++;
      const key = ev.charUuid || (ev.name + "|" + (ev.faction || ""));
      const a = armies.get(key) || { name: ev.name, faction: ev.faction || null, role: null, moves: [], flees: [] };
      a.flees.push({ turn, x: ev.x != null ? ev.x : null, y: ev.y != null ? ev.y : null });
      armies.set(key, a);
    }
  }
  const totalTurns = turn;

  // ── pass 2: findings per army ───────────────────────────────────────────
  const findings = [];
  const push = (kind, charUuid, a, fromTurn, toTurn, x, y, detail, severity) => {
    findings.push({
      kind, charUuid,
      name: a.name, faction: a.faction || "?",
      fromTurn, toTurn, turns: toTurn - fromTurn + 1,
      x, y,
      region: regionAt ? (regionAt(x, y) || null) : null,
      detail, severity,
    });
  };

  for (const [charUuid, a] of armies) {
    const mv = a.moves;

    // -- stuck: slide over consecutive-turn runs of moves ------------------
    if (mv.length >= cfg.MIN_STUCK_TURNS) {
      // group moves by turn (an army can emit several per turn)
      const byTurn = new Map();
      for (const m of mv) {
        const t = byTurn.get(m.turn) || [];
        t.push(m); byTurn.set(m.turn, t);
      }
      const turns = [...byTurn.keys()].sort((p, q) => p - q);
      let runStart = 0;
      for (let i = 1; i <= turns.length; i++) {
        const contiguous = i < turns.length && turns[i] === turns[i - 1] + 1;
        if (contiguous) continue;
        const run = turns.slice(runStart, i);
        runStart = i;
        if (run.length < cfg.MIN_STUCK_TURNS) continue;
        const first = byTurn.get(run[0])[0];
        const lastArr = byTurn.get(run[run.length - 1]);
        const last = lastArr[lastArr.length - 1];
        const net = dist(first.fromX, first.fromY, last.toX, last.toY);
        let walked = 0;
        for (const t of run) for (const m of byTurn.get(t)) walked += dist(m.fromX, m.fromY, m.toX, m.toY);
        if (net < cfg.STUCK_NET_TILES && walked >= cfg.STUCK_NET_TILES * 2) {
          push("stuck", charUuid, a, run[0], run[run.length - 1], last.toX, last.toY,
            `moved ${walked.toFixed(0)} tiles of path over ${run.length} turns but net displacement only ${net.toFixed(1)}`,
            Math.min(3, Math.floor(run.length / cfg.MIN_STUCK_TURNS)));
        }
      }
    }

    // -- oscillation: A→B→A→B tile ping-pong --------------------------------
    if (mv.length >= cfg.MIN_OSC_CYCLES * 2) {
      let cycles = 0, i0 = -1;
      for (let i = 0; i + 1 < mv.length; i++) {
        const m1 = mv[i], m2 = mv[i + 1];
        const pingPong = m1.toX === m2.fromX && m1.toY === m2.fromY &&
                         m2.toX === m1.fromX && m2.toY === m1.fromY;
        if (pingPong) { cycles++; if (i0 < 0) i0 = i; }
        else if (cycles >= cfg.MIN_OSC_CYCLES) break;
        else { cycles = 0; i0 = -1; }
      }
      if (cycles >= cfg.MIN_OSC_CYCLES) {
        const m = mv[i0];
        push("oscillation", charUuid, a, mv[i0].turn, mv[Math.min(mv.length - 1, i0 + cycles * 2)].turn,
          m.fromX, m.fromY,
          `ping-pongs between (${m.fromX},${m.fromY}) and (${m.toX},${m.toY}) ${cycles}×`,
          Math.min(3, cycles - 1));
      }
    }

    // -- never_arrives: repeated multi-turn orders toward ~same target -----
    const multi = mv.filter((m) => m.multiTurnsLeft > 0);
    if (multi.length >= cfg.MIN_PATH_TURNS) {
      // cluster by destination (within ARRIVE_TILES of each other)
      const clusters = [];
      for (const m of multi) {
        let c = clusters.find((k) => dist(k.x, k.y, m.toX, m.toY) <= cfg.ARRIVE_TILES);
        if (!c) { c = { x: m.toX, y: m.toY, moves: [] }; clusters.push(c); }
        c.moves.push(m);
      }
      for (const c of clusters) {
        const ts = [...new Set(c.moves.map((m) => m.turn))].sort((p, q) => p - q);
        if (ts.length < cfg.MIN_PATH_TURNS) continue;
        // did the army EVER get within ARRIVE_TILES of this destination?
        const arrived = mv.some((m) => dist(m.toX, m.toY, c.x, c.y) <= cfg.ARRIVE_TILES && m.multiTurnsLeft === 0);
        if (!arrived) {
          push("never_arrives", charUuid, a, ts[0], ts[ts.length - 1], c.x, c.y,
            `ordered toward (${c.x},${c.y}) across ${ts.length} turns, never got within ${cfg.ARRIVE_TILES} tiles`,
            Math.min(3, Math.floor(ts.length / cfg.MIN_PATH_TURNS)));
        }
      }
    }

    // -- flee_loop: fleeing in many turns of a short window -----------------
    if (a.flees.length >= cfg.MIN_FLEE_TURNS) {
      const ts = [...new Set(a.flees.map((f) => f.turn))].sort((p, q) => p - q);
      for (let i = 0; i + cfg.MIN_FLEE_TURNS - 1 < ts.length; i++) {
        const j = i + cfg.MIN_FLEE_TURNS - 1;
        if (ts[j] - ts[i] < cfg.FLEE_WINDOW) {
          const f = a.flees.find((q) => q.turn === ts[i]);
          push("flee_loop", charUuid, a, ts[i], ts[j],
            f && f.x != null ? f.x : 0, f && f.y != null ? f.y : 0,
            `fled in ${cfg.MIN_FLEE_TURNS}+ turns within a ${ts[j] - ts[i] + 1}-turn window`,
            2);
          break; // one finding per army is enough
        }
      }
    }
  }

  findings.sort((p, q) => q.severity - p.severity || q.turns - p.turns);

  // ── per-faction stats ────────────────────────────────────────────────────
  const factionStats = {};
  for (const [, a] of armies) {
    const f = a.faction || "?";
    const s = factionStats[f] = factionStats[f] || { armies: 0, moves: 0, walked: 0, net: 0, flees: 0 };
    s.armies++;
    s.moves += a.moves.length;
    s.flees += a.flees.length;
    for (const m of a.moves) s.walked += dist(m.fromX, m.fromY, m.toX, m.toY);
    if (a.moves.length) {
      const f0 = a.moves[0], l0 = a.moves[a.moves.length - 1];
      s.net += dist(f0.fromX, f0.fromY, l0.toX, l0.toY);
    }
  }
  for (const f of Object.keys(factionStats)) {
    const s = factionStats[f];
    s.wander = s.walked > 0 ? 1 - Math.min(1, s.net / s.walked) : 0; // 1 = pure circling
  }
  const findingCounts = {};
  for (const f of findings) findingCounts[f.kind] = (findingCounts[f.kind] || 0) + 1;

  // Is this log actually USABLE for movement analysis? A message_log from a
  // session that never played AI turns contains only engine warnings — no
  // MOVING_NORMAL entries and no "end round" markers. Reporting "0 findings"
  // for that read as "the AI is fine", which is false reassurance, so say
  // plainly that there was nothing to analyse (2026-07-25).
  const usable = moveLines > 0 || fleeLines > 0;
  let emptyReason = null;
  if (!usable) {
    const scanned = String(text || "").split(/\r?\n/).length;
    emptyReason = `no movement events in this log — ${scanned.toLocaleString()} lines scanned, ` +
      `0 movement entries (MOVING_NORMAL) and ${totalTurns <= 1 ? "no turn markers" : totalTurns + " turn markers"}. ` +
      `Movement traces only appear in a message_log from a campaign that was actually played; ` +
      `a log of engine warnings has none. Try a campaign_ai_log.txt (AI decisions) or a message_log from a played session.`;
  }
  return {
    logKind: "message_log", usable, emptyReason,
    totalTurns, moveLines, fleeLines, parsedLines, cannotFlee,
    armies: armies.size,
    findings, findingCounts, factionStats,
  };
}

// ════════════════════════════════════════════════════════════════════════
// campaign_ai_log.txt analyzer (2026-07-24) — the DECISION side. The engine
// narrates its own campaign AI: per-faction turn blocks, per-region campaign
// strategies, per-character orders. Real line shapes (346MB RIS telemetry log):
//   AI: 				start 'dummies' for year -270, season summer
//   AI: campaign: mission move nonlocal: char 'Captain Proteus' moving towards sett 'Pella', priority 400.
//   AI: named cc: character 'Bellovesus' told to move to 'Decetia', priority 100.
//   AI: campaign: res for char 'Alexandros' assigned to reg 983 at priority 528.
//   AI: resource for char 'Captain Bodmelqart' released by controller
//   AI: campaign for region '1040' aborted because of insufficient available strength.
//   AI: campaign: campaign for 'Pella' (reg 1306, des 129) using strategy ACS_GATHERING. required str 400 (ACZ_SOLID), allocated str 120; num res 3.
//
// STREAMING (feedLine/finish) — the telemetry logs are hundreds of MB; never
// hold the file in memory. Findings:
//   stuck_mission   — the SAME char is ordered toward the SAME settlement in
//                     ≥ MIN_MISSION_TURNS distinct turns: the AI re-issues the
//                     order every turn because the army never arrives.
//   assign_churn    — a char is assigned/released ≥ CHURN_MIN times: the
//                     controller thrashes it between jobs instead of using it.
//   campaign_stall  — a faction's campaign for a region sits in ACS_GATHERING
//                     with allocated < required for ≥ MIN_STALL_TURNS turns:
//                     it wants to act but never musters the strength.
//   aborted_hotspot — a region's campaign is aborted for insufficient strength
//                     in ≥ MIN_ABORT_TURNS distinct turns.

const AI_DEFAULTS = {
  MIN_STRIP_TURNS: 4,    // same town's garrison split apart in this many turns
  MIN_WAR_TARGETS: 6,    // attack authorisations against this many factions
  ABANDON_GAP: 6,        // silent for this many turns before the log ends…
  ABANDON_MIN_HITS: 5,   // …after having been actively commanded this much
  MIN_MISSION_TURNS: 4,
  CHURN_MIN: 10,
  MIN_STALL_TURNS: 6,
  MIN_ABORT_TURNS: 5,
};

const AI_RX = {
  factionStart: /^AI: \t*start '([^']+)' for year (-?\d+), season (\w+)/,
  mission: /^AI: campaign: mission move nonlocal: char '([^']+)' moving towards sett '([^']+)', priority (\d+)/,
  toldMove: /^AI: named cc: (?:character|army) '([^']+)' told to move to '([^']+)', priority (\d+)/,
  assigned: /^AI: campaign: res for char '([^']+)' assigned to reg (\d+) at priority (\d+)/,
  released: /^AI: resource for char '([^']+)' released by controller/,
  aborted: /^AI: campaign for region '(\d+)' aborted because of insufficient available strength/,
  campaign: /^AI: campaign: campaign for '([^']+)' \(reg (\d+), des \d+\) using strategy (ACS_\w+)\. required str (\d+) \(ACZ_\w+\), allocated str (\d+)/,
  // AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER
  finance: /^AI: finance: est income (-?\d+), est maintenance (-?\d+), est outgoings (-?\d+) -- spending max (-?\d+), spending norm (-?\d+); balance (\w+), state (AFS_\w+)/,
  // AI: -- building 'Training Grounds' at priority 3674.
  buildWant: /^AI: -- building '([^']+)' at priority (\d+)/,
  // AI: campaign: garrison of settlement 'Carthage' told to split, 10 units leaving, priority 650.
  garrisonSplit: /^AI: campaign: garrison of settlement '([^']+)' told to split, (\d+) units leaving, priority (\d+)/,
  // AI: mildir: invade_<other> attack authorised against 'epirus'.
  warAuth: /^AI: mildir: \S+ attack authorised against '([^']+)'/,
  // AI: 0 spies assigned this turn  |  AI: 0 assassins assigned this turn
  agents: /^AI: (\d+) (spies|assassins) assigned this turn/,
  // ── the AI's own strategic reasoning (ltgd = long-term goal decisions) ──
  // Its view of its OWN strength. "free" is the operative number: what it thinks
  // is available for offence, which is what it weighs against a campaign's
  // required strength.
  ltgdStrength: /^AI: ltgd: army strength (\d+), free army strength (\d+), navy strength (\d+)/,
  // Invade decision WITH REASON and priority, e.g.
  //   AI: ltgd: 'carthage' invade 'corsi', not at war, good production against strongest neighbour >> ALI_START_PLAN (200).
  ltgdInvade: /^AI: ltgd: '([^']+)' invade '([^']+)', (.+?) >> (ALI_\w+) \((\d+)\)/,
  // Defend posture WITH REASON, e.g.
  //   AI: ltgd: defend (frontline .000132, free 9.486274, product 21.18303) vs fac 'acragas': not at war, bad frontline, decent free strength >> ALD_DEFEND_DEEP.
  ltgdDefend: /^AI: ltgd: defend \([^)]*\) vs fac '([^']+)': (.+?) >> (ALD_\w+)/,
  // What the AI WANTS to recruit — the troop-side twin of buildWant, and the
  // single largest unparsed shape in the log (656,132 lines).
  troopWant: /^AI: -- troop type '([^']+)' at priority (\d+)/,
  // Tax level per settlement, with the engine's stated reason.
  taxChoice: /^AI: region control: settlement '([^']+)', \(pop (\d+), old order (-?\d+)\), tax (TAX_LEVEL_\w+) due to (.+?)\.?$/,
  // ── what the AI actually DID, as opposed to what it wanted ──
  // troopWant/buildWant are appetite; these two are actions taken.
  recruitStarted: /^AI: production: started recruitment of '([^']+)' at '([^']+)', priority (\d+), prod type (AI_PROD_\w+)/,
  buildStarted: /^AI: production: started '([^']+)' at '([^']+)', priority (\d+), prod type (AI_PROD_\w+)/,
  // How many invasion targets the AI can see AT ALL. Zero means it will not
  // attack whatever its strength — the most direct possible check on passivity.
  invasionTargets: /^AI: ltgd: number of invasion targets: (\d+)/,
  // Agents HELD, distinct from the agents-assigned-this-turn line.
  agentTotals: /^AI: number of spies (\d+), number of assassins (\d+)/,
  // Faction health snapshot: ungoverned cities is the interesting term.
  factionHealth: /^AI: named cc: leader status '([^']+)', heir status '([^']+)', ungoverned cities (\d+) \/ (\d+), adoptees (\d+), resources (\d+) \(total str (\d+)\)/,
  // A settlement the engine says is mid-construction on something invalid.
  buildBlocked: /^AI: production: settlement '([^']+)' is busy constructing (.+?), considering repairs/,
  // The WHOLE mission family, 11 types over 81,317 lines on the reference log:
  // move 25,888 · move nonlocal 22,027 · attack residence 8,683 · siege residence
  // 8,652 · merge (army) 7,066 · attack enemy (army) 3,310 · do nothing 3,166 ·
  // attack enemy (navy) 1,234 · merge (navy) 809 · merge garrison 354 · wait for
  // passengers 128. Only "move nonlocal" was read before, so the orders that
  // matter most — 8,683 assaults and 8,652 sieges — went uncounted. Matched
  // generically and aggregated by TYPE, alongside (not instead of) the specific
  // handlers that build findings.
  missionAny: /^AI: campaign: mission ([a-z]+(?: \([a-z]+\)| [a-z]+)*): /,
  // The worldwide (as opposed to campaign) controller assigning and releasing
  // characters — the agent-side twin of the campaign resource lines.
  worldwideAssign: /^AI: worldwide: char '([^']+)' assigned \(in region (\d+)\) at priority (\d+)/,
  worldwideRelease: /^AI: resource for char '([^']+)' released by worldwide controller in region (\d+)/,
  // A diplomat given a destination, with its task and priority.
  diplomatOrder: /^AI: Diplomat CC: Character "([^"]+)" told to move to settlement "([^"]+)"\. Task: (\w+)\. Initiate: (\w+)\. Priority (\d+)/,
  // The engine's stated reason for continuing or halting recruitment.
  productionReason: /^AI: production: (sufficient numbers of troops[^.]*|not enough cash[^.]*|no more useful[^.]*)\.?$/,
  // A console/script command that FAILED. Not AI output, but it shares this log
  // and it names a real mod-script bug: the commonest is a set_building_health
  // aimed at a building the settlement does not have (555x on the reference log).
  scriptErr: /^\s*err: (.+?)\s*$/,
};

// Economic states the engine reports, poorest → richest. "Rich but stalled" is
// the interesting case: money is NOT the constraint, so tuning income won't help.
const AFS_RICH = new Set(["AFS_CROESUS", "AFS_ROLLING_IN_IT"]);
const AFS_POOR = new Set(["AFS_PAUPER", "AFS_SHOESTRING"]);
// Military-infrastructure building names as they appear in the AI's own build
// list (RIS display names for the military_industrial_complex chain + armouries).
const MILITARY_BUILD_RX = /barrack|armour|armor|training ground|warriors encampment|garrison|foundry|drill|stable|siege works|academy/i;

function createAiDecisionAnalyzer(opts = {}) {
  const cfg = { ...AI_DEFAULTS, ...opts };
  let curFaction = null;
  let turnIdx = 0;                 // increments when (year, season) changes
  let lastYearSeason = null;
  let firstYear = null, lastYear = null;
  const regName = new Map();       // regId → settlement name (self-described by campaign lines)
  // Biggest OFFENSIVE ask per target, for the strength-scale report. Per target
  // rather than per line so a heavily-logged region cannot dominate it.
  const maxReqByTarget = new Map();

  // ── the AI's own reasoning, accumulated per faction ──
  // strength: what it believes it has. invade/defend: what it decided and why.
  const ltgd = new Map();      // faction -> { samples, armySum, freeSum, navySum, freeMax }
  const invade = new Map();    // faction -> { total, byDecision:{}, byReason:{}, targets:Set, bestPriority }
  const defend = new Map();    // faction -> { total, byDecision:{} }
  const troopWant = new Map(); // faction -> { picks, top:{name,priority} }
  const taxChoice = new Map(); // faction -> { total, byLevel:{}, byReason:{} }
  const recruited = new Map();   // faction -> { total, byUnit:Map }
  const built = new Map();       // faction -> { total, byItem:Map }
  const invTargets = new Map();  // faction -> { samples, zero, sum, max }
  const agentsHeld = new Map();  // faction -> { samples, spiesSum, assassinsSum, maxSpies }
  const health = new Map();      // faction -> { samples, ungovSum, ofSum, strSum }
  const blocked = new Map();     // settlement -> { total, invalid }
  const missionTypes = new Map(); // faction -> Map(type -> count)
  const worldwide = new Map();    // faction -> { assigned, released }
  const diplomats = new Map();    // faction -> { orders, byTask:{} }
  const scriptErrs = new Map();   // message -> count
  const missions = new Map();      // char|sett → { char, sett, faction, turns:Set }
  const churn = new Map();         // char → { assigns, releases, faction, regs:Set }
  const stalls = new Map();        // faction|regId → { faction, regId, gatherTurns:Set, lastReq, lastAlloc }
  const aborts = new Map();        // regId → Set(turnIdx)
  const charSeen = new Map();      // char → { first, last, hits, faction } (abandonment)
  const finance = new Map();       // faction → economy profile over the log
  const buildWant = new Map();     // faction → buildings EVALUATED (candidates, not decisions) + top military priority
  const garrisonSplits = new Map(); // settlement → { faction, turns:Set, unitsTotal, maxUnits }
  const warAuths = new Map();       // faction → { targets:Set, count }
  const agentUse = { spies: 0, assassins: 0, reports: 0, zeroReports: 0 };
  let lines = 0, matched = 0;

  const noteChar = (name) => {
    if (!name) return;
    const e = charSeen.get(name);
    if (e) { e.last = turnIdx; e.hits++; }
    else charSeen.set(name, { first: turnIdx, last: turnIdx, hits: 1, faction: curFaction });
  };

  // Complete accounting of the file: every line is either signal we parse, known
  // vocabulary that carries none, or genuinely new — and the third case is
  // reported so a changed engine or mod cannot slip past unnoticed.
  const { createCoverageTracker } = require("./aiLogVocabulary.js");
  const AI_RX_LIST = Object.values(AI_RX);
  // The predicate must mirror feedLine's own reachability, not just the pattern
  // list: feedLine fast-paths out of any line that is neither AI-prefixed nor a
  // recognised non-AI signal. Testing the patterns alone reported `err:` lines as
  // parsed while the handler never ran — an optimistic coverage number, which is
  // the one kind of coverage number that is worse than none.
  const coverage = createCoverageTracker((line) => {
    const c = line.charCodeAt(0);
    if (c === 101 /* 'e' */ && AI_RX.scriptErr.test(line)) return true;
    if (c !== 65 /* 'A' */) return false;
    return AI_RX_LIST.some((rx) => rx.test(line));
  });

  const feedLine = (l) => {
    lines++;
    coverage.feedLine(l);
    // Mission-type tally. Deliberately BEFORE the if-chain and without a return:
    // several mission types are also handled specifically below (move nonlocal
    // builds stuck-mission findings), and both need to see the line.
    //
    // It must still count toward parsedLines, or the parse rate under-reports the
    // 8,683 attack-residence and 8,652 siege-residence orders that ONLY this tally
    // reads. Bumping here would double-count the types a specific handler also
    // claims, so the bump is deferred to the fall-through at the end of feedLine —
    // reached only when no specific handler took the line.
    let missionTallied = false;
    {
      const mt = AI_RX.missionAny.exec(l);
      if (mt) {
        missionTallied = true;
        const f = curFaction || "?";
        let m2 = missionTypes.get(f);
        if (!m2) missionTypes.set(f, m2 = new Map());
        m2.set(mt[1], (m2.get(mt[1]) || 0) + 1);
      }
    }
    let m;
    // NOT every interesting line starts "AI:" — the game console and the campaign
    // script write into this same file. `err: ...` lines are script-command
    // failures and must be read BEFORE the fast-path guard below, which was
    // silently discarding all 555 of them while the coverage tracker (which has no
    // such guard) counted them as parsed. The two disagreeing is what exposed it.
    if (l.charCodeAt(0) === 101 /* 'e' */ && (m = AI_RX.scriptErr.exec(l))) {
      const msg = m[1].slice(0, 120);
      scriptErrs.set(msg, (scriptErrs.get(msg) || 0) + 1);
      matched++; return;
    }
    // Fast path: everything else worth reading is AI-prefixed. Worth ~4M charCode
    // checks instead of ~4M regex attempts, so it stays — but any new non-AI
    // pattern must be handled above it, as scriptErr now is.
    if (l.charCodeAt(0) !== 65 /* 'A' */) return;
    if ((m = AI_RX.factionStart.exec(l))) {
      curFaction = m[1];
      const ys = m[2] + "|" + m[3];
      if (ys !== lastYearSeason) { turnIdx++; lastYearSeason = ys; }
      if (firstYear == null) firstYear = +m[2];
      lastYear = +m[2];
      matched++; return;
    }
    if ((m = AI_RX.mission.exec(l)) || (m = AI_RX.toldMove.exec(l))) {
      noteChar(m[1]);
      const key = m[1] + "|" + m[2];
      const e = missions.get(key) || { char: m[1], sett: m[2], faction: curFaction, turns: new Set() };
      e.turns.add(turnIdx);
      missions.set(key, e);
      matched++; return;
    }
    if ((m = AI_RX.assigned.exec(l))) {
      noteChar(m[1]);
      const e = churn.get(m[1]) || { assigns: 0, releases: 0, faction: curFaction, regs: new Set() };
      e.assigns++; e.regs.add(m[2]); e.faction = e.faction || curFaction;
      churn.set(m[1], e);
      matched++; return;
    }
    if ((m = AI_RX.released.exec(l))) {
      noteChar(m[1]);
      const e = churn.get(m[1]) || { assigns: 0, releases: 0, faction: curFaction, regs: new Set() };
      e.releases++;
      churn.set(m[1], e);
      matched++; return;
    }
    if ((m = AI_RX.aborted.exec(l))) {
      const s = aborts.get(m[1]) || new Set();
      s.add(turnIdx); aborts.set(m[1], s);
      matched++; return;
    }
    if ((m = AI_RX.finance.exec(l))) {
      const f = curFaction || "?";
      const e = finance.get(f) || { reports: 0, income: 0, outgoings: 0, spendMax: 0, rich: 0, poor: 0, states: {} };
      e.reports++; e.income += +m[1]; e.outgoings += +m[3]; e.spendMax += +m[4];
      e.states[m[7]] = (e.states[m[7]] || 0) + 1;
      if (AFS_RICH.has(m[7])) e.rich++; else if (AFS_POOR.has(m[7])) e.poor++;
      finance.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.garrisonSplit.exec(l))) {
      const e = garrisonSplits.get(m[1]) || { faction: curFaction, turns: new Set(), unitsTotal: 0, maxUnits: 0 };
      e.turns.add(turnIdx); e.unitsTotal += +m[2];
      if (+m[2] > e.maxUnits) e.maxUnits = +m[2];
      e.faction = e.faction || curFaction;
      garrisonSplits.set(m[1], e);
      matched++; return;
    }
    if ((m = AI_RX.warAuth.exec(l))) {
      const f = curFaction || "?";
      const e = warAuths.get(f) || { targets: new Set(), count: 0 };
      e.targets.add(m[1]); e.count++;
      warAuths.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.agents.exec(l))) {
      const n = +m[1];
      agentUse[m[2]] += n; agentUse.reports++;
      if (n === 0) agentUse.zeroReports++;
      matched++; return;
    }
    if ((m = AI_RX.buildWant.exec(l))) {
      const f = curFaction || "?";
      const e = buildWant.get(f) || { picks: 0, military: 0, topMilitaryPriority: 0, topMilitaryName: null };
      e.picks++;
      if (MILITARY_BUILD_RX.test(m[1])) {
        e.military++;
        const pri = +m[2];
        if (pri > e.topMilitaryPriority) { e.topMilitaryPriority = pri; e.topMilitaryName = m[1]; }
      }
      buildWant.set(f, e);
      matched++; return;
    }
    { const cm = RX_ANY_CHAR.exec(l); if (cm) noteChar(cm[1] || cm[2] || cm[3]); }
    if ((m = AI_RX.worldwideAssign.exec(l))) {
      const f = curFaction || "?";
      const e = worldwide.get(f) || { assigned: 0, released: 0 };
      e.assigned++; worldwide.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.worldwideRelease.exec(l))) {
      const f = curFaction || "?";
      const e = worldwide.get(f) || { assigned: 0, released: 0 };
      e.released++; worldwide.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.diplomatOrder.exec(l))) {
      const f = curFaction || "?";
      const e = diplomats.get(f) || { orders: 0, byTask: {} };
      e.orders++;
      e.byTask[m[3]] = (e.byTask[m[3]] || 0) + 1;
      diplomats.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.productionReason.exec(l))) { matched++; return; }
    if ((m = AI_RX.invasionTargets.exec(l))) {
      const f = curFaction || "?";
      const n = +m[1];
      const e = invTargets.get(f) || { samples: 0, zero: 0, sum: 0, max: 0 };
      e.samples++; e.sum += n; if (n === 0) e.zero++; if (n > e.max) e.max = n;
      invTargets.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.recruitStarted.exec(l))) {
      const f = curFaction || "?";
      const e = recruited.get(f) || { total: 0, byUnit: new Map() };
      e.total++;
      e.byUnit.set(m[1], (e.byUnit.get(m[1]) || 0) + 1);
      recruited.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.buildStarted.exec(l))) {
      const f = curFaction || "?";
      const e = built.get(f) || { total: 0, byItem: new Map() };
      e.total++;
      e.byItem.set(m[1], (e.byItem.get(m[1]) || 0) + 1);
      built.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.agentTotals.exec(l))) {
      const f = curFaction || "?";
      const e = agentsHeld.get(f) || { samples: 0, spiesSum: 0, assassinsSum: 0, maxSpies: 0 };
      e.samples++; e.spiesSum += +m[1]; e.assassinsSum += +m[2];
      if (+m[1] > e.maxSpies) e.maxSpies = +m[1];
      agentsHeld.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.factionHealth.exec(l))) {
      const f = curFaction || "?";
      const e = health.get(f) || { samples: 0, ungovSum: 0, ofSum: 0, strSum: 0 };
      e.samples++; e.ungovSum += +m[3]; e.ofSum += +m[4]; e.strSum += +m[7];
      health.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.buildBlocked.exec(l))) {
      const e = blocked.get(m[1]) || { total: 0, invalid: 0 };
      e.total++;
      if (/\*\*invalid\*\*/.test(m[2])) e.invalid++;
      blocked.set(m[1], e);
      matched++; return;
    }
    if ((m = AI_RX.ltgdStrength.exec(l))) {
      const f = curFaction || "?";
      const e = ltgd.get(f) || { samples: 0, armySum: 0, freeSum: 0, navySum: 0, freeMax: 0 };
      e.samples++; e.armySum += +m[1]; e.freeSum += +m[2]; e.navySum += +m[3];
      if (+m[2] > e.freeMax) e.freeMax = +m[2];
      ltgd.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.ltgdInvade.exec(l))) {
      const f = m[1].toLowerCase();
      const e = invade.get(f) || { total: 0, byDecision: {}, byReason: {}, targets: new Set(), bestPriority: 0 };
      e.total++;
      e.byDecision[m[4]] = (e.byDecision[m[4]] || 0) + 1;
      const reason = m[3].trim().slice(0, 80);
      e.byReason[reason] = (e.byReason[reason] || 0) + 1;
      e.targets.add(m[2].toLowerCase());
      if (+m[5] > e.bestPriority) e.bestPriority = +m[5];
      invade.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.ltgdDefend.exec(l))) {
      const f = curFaction || "?";
      const e = defend.get(f) || { total: 0, byDecision: {} };
      e.total++;
      e.byDecision[m[3]] = (e.byDecision[m[3]] || 0) + 1;
      defend.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.troopWant.exec(l))) {
      const f = curFaction || "?";
      const e = troopWant.get(f) || { picks: 0, topName: null, topPriority: 0 };
      e.picks++;
      if (+m[2] > e.topPriority) { e.topPriority = +m[2]; e.topName = m[1]; }
      troopWant.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.taxChoice.exec(l))) {
      const f = curFaction || "?";
      const e = taxChoice.get(f) || { total: 0, byLevel: {}, byReason: {} };
      e.total++;
      e.byLevel[m[4]] = (e.byLevel[m[4]] || 0) + 1;
      const reason = m[5].trim().slice(0, 60);
      e.byReason[reason] = (e.byReason[reason] || 0) + 1;
      taxChoice.set(f, e);
      matched++; return;
    }
    if ((m = AI_RX.campaign.exec(l))) {
      regName.set(m[2], m[1]);
      const req = +m[4], alloc = +m[5];
      // What the AI DEMANDS, offensive postures only. ACS_DEFEND_* is excluded:
      // those asks look like frontier totals rather than one stack's worth — the
      // reference log's extremes (Consentia 890,300, Petelia 312,060) are all
      // DEFEND_DEEP / DEFEND_BORDER — and mixing the two makes the number
      // meaningless.
      if (/^ACS_(GATHERING|ATTACK)/.test(m[3])) {
        const prev = maxReqByTarget.get(m[2]) || 0;
        if (req > prev) maxReqByTarget.set(m[2], req);
      }
      if (m[3] === "ACS_GATHERING" && alloc < req) {
        const key = (curFaction || "?") + "|" + m[2];
        const e = stalls.get(key) || { faction: curFaction || "?", regId: m[2], turns: new Set(), lastReq: req, lastAlloc: alloc };
        e.turns.add(turnIdx); e.lastReq = req; e.lastAlloc = alloc;
        stalls.set(key, e);
      }
      matched++; return;
    }
    // Fall-through: no specific handler claimed the line. If the mission tally read
    // it, that still counts as parsed — see the note at the tally.
    if (missionTallied) matched++;
  };

  const finish = () => {
    const findings = [];
    const nameOf = (regId) => regName.get(regId) || ("region " + regId);
    for (const e of missions.values()) {
      if (e.turns.size >= cfg.MIN_MISSION_TURNS) {
        const ts = [...e.turns].sort((a, b) => a - b);
        findings.push({
          kind: "stuck_mission", name: e.char, faction: e.faction || "?",
          fromTurn: ts[0], toTurn: ts[ts.length - 1], turns: e.turns.size,
          region: e.sett, x: null, y: null,
          detail: `ordered toward '${e.sett}' in ${e.turns.size} separate turns — never arrives`,
          severity: Math.min(3, Math.floor(e.turns.size / cfg.MIN_MISSION_TURNS)),
        });
      }
    }
    for (const [char, e] of churn) {
      const cycles = Math.min(e.assigns, e.releases);
      if (cycles >= cfg.CHURN_MIN) {
        findings.push({
          kind: "assign_churn", name: char, faction: e.faction || "?",
          fromTurn: null, toTurn: null, turns: cycles,
          region: null, x: null, y: null,
          detail: `assigned/released ${cycles}× across ${e.regs.size} region(s) — the controller thrashes this army`,
          severity: Math.min(3, Math.floor(cycles / cfg.CHURN_MIN)),
        });
      }
    }
    for (const e of stalls.values()) {
      if (e.turns.size >= cfg.MIN_STALL_TURNS) {
        const ts = [...e.turns].sort((a, b) => a - b);
        findings.push({
          kind: "campaign_stall", name: nameOf(e.regId), faction: e.faction,
          fromTurn: ts[0], toTurn: ts[ts.length - 1], turns: e.turns.size,
          region: nameOf(e.regId), x: null, y: null,
          detail: `GATHERING for ${e.turns.size} turns, still ${e.lastAlloc}/${e.lastReq} strength — never launches`,
          severity: Math.min(3, Math.floor(e.turns.size / cfg.MIN_STALL_TURNS)),
        });
      }
    }
    for (const [regId, ts] of aborts) {
      if (ts.size >= cfg.MIN_ABORT_TURNS) {
        const arr = [...ts].sort((a, b) => a - b);
        findings.push({
          kind: "aborted_hotspot", name: nameOf(regId), faction: "?",
          fromTurn: arr[0], toTurn: arr[arr.length - 1], turns: ts.size,
          region: nameOf(regId), x: null, y: null,
          detail: `campaign aborted for insufficient strength in ${ts.size} separate turns`,
          severity: Math.min(3, Math.floor(ts.size / cfg.MIN_ABORT_TURNS)),
        });
      }
    }
    // abandoned: the AI actively commanded this character, then went silent for
    // the rest of the log. Whether that's a death or an ORPHANED army the AI
    // forgot about can only be settled by a save (correlateWithSave does that).
    for (const [name, e] of charSeen) {
      const silentFor = turnIdx - e.last;
      if (silentFor >= cfg.ABANDON_GAP && e.hits >= cfg.ABANDON_MIN_HITS) {
        findings.push({
          kind: "abandoned", name, faction: e.faction || "?",
          fromTurn: e.first, toTurn: e.last, turns: silentFor,
          region: null, x: null, y: null,
          detail: `commanded for ${e.hits} orders up to turn ${e.last}, then never mentioned again (${silentFor} turns of silence)`,
          severity: Math.min(3, Math.floor(silentFor / cfg.ABANDON_GAP)),
        });
      }
    }
    // rich_but_stalled: the faction spent most of the log RICH yet its campaigns
    // never launched — money is not the constraint, so income tuning is the
    // wrong lever for it (recruitment capacity / build throughput is).
    const stalledFactions = new Map();
    for (const e of stalls.values()) {
      if (e.turns.size >= cfg.MIN_STALL_TURNS) stalledFactions.set(e.faction, (stalledFactions.get(e.faction) || 0) + 1);
    }
    for (const [fac, nStalls] of stalledFactions) {
      const fin = finance.get(fac);
      if (!fin || fin.reports < 5) continue;
      const richPct = fin.rich / fin.reports;
      if (richPct >= 0.5) {
        findings.push({
          kind: "rich_but_stalled", name: fac, faction: fac,
          fromTurn: null, toTurn: null, turns: nStalls,
          region: null, x: null, y: null,
          detail: `${nStalls} stalled campaign(s) while ${Math.round(richPct * 100)}% of its turns were rich ` +
            `(avg income ${Math.round(fin.income / fin.reports)}, avg outgoings ${Math.round(fin.outgoings / fin.reports)}, ` +
            `avg spending headroom ${Math.round(fin.spendMax / fin.reports)})`,
          severity: richPct >= 0.75 ? 3 : 2,
        });
      }
    }
    // garrison_stripped: the AI keeps pulling defenders out of the same town.
    // Occasionally that's a legitimate offensive; over many turns it's a town
    // being cannibalised, which is how AI factions lose their own cities.
    for (const [sett, e] of garrisonSplits) {
      if (e.turns.size >= cfg.MIN_STRIP_TURNS) {
        const ts = [...e.turns].sort((a, b) => a - b);
        findings.push({
          kind: "garrison_stripped", name: sett, faction: e.faction || "?",
          fromTurn: ts[0], toTurn: ts[ts.length - 1], turns: e.turns.size,
          region: sett, x: null, y: null,
          detail: `garrison split apart in ${e.turns.size} separate turns — ${e.unitsTotal} units pulled out in total (worst single order: ${e.maxUnits})`,
          severity: Math.min(3, Math.floor(e.turns.size / cfg.MIN_STRIP_TURNS)),
        });
      }
    }
    // war_spam: authorising attacks on many factions at once. Paired with the
    // stall findings this is the aggression-vs-capability mismatch measured
    // straight from the AI's own decisions.
    for (const [fac, e] of warAuths) {
      if (e.targets.size >= cfg.MIN_WAR_TARGETS) {
        findings.push({
          kind: "war_spam", name: fac, faction: fac,
          fromTurn: null, toTurn: null, turns: e.targets.size,
          region: null, x: null, y: null,
          detail: `authorised attacks against ${e.targets.size} different factions (${e.count} authorisations): ${[...e.targets].slice(0, 8).join(", ")}${e.targets.size > 8 ? "…" : ""}`,
          severity: e.targets.size >= cfg.MIN_WAR_TARGETS * 2 ? 3 : 2,
        });
      }
    }
    findings.sort((p, q) => q.severity - p.severity || q.turns - p.turns);
    const findingCounts = {};
    for (const f of findings) findingCounts[f.kind] = (findingCounts[f.kind] || 0) + 1;
    const usable = turnIdx > 0 && matched > 0;
    return {
      logKind: "campaign_ai",
      usable,
      emptyReason: usable ? null : `no AI decision data in this log — ${lines.toLocaleString()} lines scanned, no faction turn blocks recognised.`,
      totalTurns: turnIdx, firstYear, lastYear,
      parsedLines: matched, moveLines: 0, fleeLines: 0, cannotFlee: 0,
      armies: churn.size,
      findings, findingCounts, factionStats: {},
      // Espionage health: the engine reports agents assigned each turn. If that
      // is always zero, the AI never uses spies/assassins at all — a whole
      // subsystem sitting idle. Reported as a global stat because the lines
      // carry no faction attribution.
      agents: agentUse.reports
        ? {
          reports: agentUse.reports,
          spies: agentUse.spies, assassins: agentUse.assassins,
          zeroTurnPct: +(agentUse.zeroReports / agentUse.reports).toFixed(3),
        }
        : null,
      // per-faction economy + build appetite, for the audit's leads
      economy: Object.fromEntries([...finance].map(([f, e]) => [f, {
        reports: e.reports, richPct: e.reports ? e.rich / e.reports : 0, poorPct: e.reports ? e.poor / e.reports : 0,
        avgIncome: e.reports ? Math.round(e.income / e.reports) : 0,
        avgOutgoings: e.reports ? Math.round(e.outgoings / e.reports) : 0,
        avgSpendMax: e.reports ? Math.round(e.spendMax / e.reports) : 0,
        states: e.states,
      }])),
      buildAppetite: Object.fromEntries([...buildWant].map(([f, e]) => [f, {
        picks: e.picks, military: e.military,
        militaryPct: e.picks ? e.military / e.picks : 0,
        topMilitaryPriority: e.topMilitaryPriority, topMilitaryName: e.topMilitaryName,
      }])),
      // The distribution of what the AI asks for, offensive postures only. Paired
      // with the save's men-per-faction in _correlateSave, this answers a question
      // no per-faction lead can: are the requirements themselves calibrated for
      // the states that exist on this map?
      // Per-target asks, keyed by SETTLEMENT name so the caller can join them to
      // the save's garrisons. Needed to answer a sharper question than the median:
      // does the requirement scale DOWN for a near-undefended target, or is there
      // a floor? (On the reference data there is a floor — see askByDefenders.)
      // ── the AI's OWN reasoning, per faction ──
      // Its view of its strength, and the invade/defend choices it made with the
      // reasons it gave. For an AI that will not attack, its stated reason for not
      // attacking is the most direct evidence there is.
      ltgdStrength: Object.fromEntries([...ltgd].map(([f, e]) => [f, {
        samples: e.samples,
        avgArmy: Math.round(e.armySum / e.samples),
        avgFree: Math.round(e.freeSum / e.samples),
        avgNavy: Math.round(e.navySum / e.samples),
        maxFree: e.freeMax,
      }])),
      invadeDecisions: Object.fromEntries([...invade].map(([f, e]) => [f, {
        total: e.total, byDecision: e.byDecision,
        distinctTargets: e.targets.size,
        bestPriority: e.bestPriority,
        topReason: Object.entries(e.byReason).sort((a, b) => b[1] - a[1])[0] || null,
      }])),
      defendDecisions: Object.fromEntries([...defend].map(([f, e]) => [f, { total: e.total, byDecision: e.byDecision }])),
      troopAppetite: Object.fromEntries([...troopWant].map(([f, e]) => [f, {
        picks: e.picks, topTroop: e.topName, topPriority: e.topPriority,
      }])),
      taxChoices: Object.fromEntries([...taxChoice].map(([f, e]) => [f, {
        total: e.total, byLevel: e.byLevel,
        topReason: Object.entries(e.byReason).sort((a, b) => b[1] - a[1])[0] || null,
      }])),
      // Console/script commands that failed. Shares this log with the AI output
      // but is a genuine mod-script defect: a command aimed at something absent.
      scriptCommandErrors: [...scriptErrs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20).map(([message, count]) => ({ message, count })),
      // Every mission type the AI issued, per faction. A faction that never issues
      // "attack residence" is passive in a different way from one that issues them
      // and never arrives — and only this tally distinguishes the two.
      missionTypes: Object.fromEntries([...missionTypes].map(([f, m2]) => [f, Object.fromEntries([...m2].sort((a, b) => b[1] - a[1]))])),
      worldwideControl: Object.fromEntries([...worldwide].map(([f, e]) => [f, e])),
      diplomatOrders: Object.fromEntries([...diplomats].map(([f, e]) => [f, e])),
      // ── COMPLETE FILE ACCOUNTING ──
      // What fraction of the log the tool can account for, and what it cannot.
      // `unknownShapes` is the important field: anything listed there is
      // vocabulary nobody has examined yet.
      vocabulary: coverage.finish(),
      // ── what the AI actually DID (vs merely wanted) ──
      recruitedUnits: Object.fromEntries([...recruited].map(([f, e]) => [f, {
        total: e.total,
        distinctUnits: e.byUnit.size,
        topUnit: [...e.byUnit.entries()].sort((a, b) => b[1] - a[1])[0] || null,
      }])),
      builtItems: Object.fromEntries([...built].map(([f, e]) => [f, {
        total: e.total,
        distinctItems: e.byItem.size,
        topItem: [...e.byItem.entries()].sort((a, b) => b[1] - a[1])[0] || null,
      }])),
      // Invasion targets VISIBLE to the AI. A faction whose count is always zero
      // will never attack, however strong it is — a completely different problem
      // from being too weak, and one no strength figure would reveal.
      invasionTargets: Object.fromEntries([...invTargets].map(([f, e]) => [f, {
        samples: e.samples, zeroPct: +(e.zero / e.samples).toFixed(3),
        avg: +(e.sum / e.samples).toFixed(2), max: e.max,
      }])),
      agentsHeld: Object.fromEntries([...agentsHeld].map(([f, e]) => [f, {
        samples: e.samples,
        avgSpies: +(e.spiesSum / e.samples).toFixed(2),
        avgAssassins: +(e.assassinsSum / e.samples).toFixed(2),
        maxSpies: e.maxSpies,
      }])),
      factionHealth: Object.fromEntries([...health].map(([f, e]) => [f, {
        samples: e.samples,
        avgUngoverned: +(e.ungovSum / e.samples).toFixed(2),
        avgSettlements: +(e.ofSum / e.samples).toFixed(2),
        avgTotalStrength: Math.round(e.strSum / e.samples),
      }])),
      constructionBlocked: (() => {
        const rows = [...blocked].filter(([, e]) => e.invalid > 0).sort((a, b) => b[1].invalid - a[1].invalid);
        return { settlements: rows.length, totalInvalid: rows.reduce((a, [, e]) => a + e.invalid, 0), worst: rows.slice(0, 10).map(([k, e]) => ({ settlement: k, invalid: e.invalid })) };
      })(),
      askByTarget: Object.fromEntries([...maxReqByTarget].map(([regId, req]) => [nameOf(regId), req])),
      askDistribution: (() => {
        const v = [...maxReqByTarget.values()].sort((a, b) => a - b);
        if (!v.length) return null;
        const q = (pp) => v[Math.min(v.length - 1, Math.floor(v.length * pp))];
        return {
          targets: v.length,
          p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), max: v[v.length - 1],
        };
      })(),
      lines,
    };
  };

  return { feedLine, finish };
}

// ════════════════════════════════════════════════════════════════════════
// scripting_log.txt ANALYSER (2026-07-25) — the engine's OWN complaints about
// the mod's data files.
//
// The AI logs describe *behaviour* ("this army gathered for 20 turns"), which
// always needs interpretation. scripting_log.txt is different: the engine names
// a file, a line and a column, and says what it could not parse. Every one of
// those is a concrete bug with an address, so this is the highest-confidence
// signal in the whole Lab — nothing has to be inferred.
//
// Real shapes from the RIS log (verified against the user's live 93,673-line
// scripting_log before writing a single regex):
//   Script Error in Q:\...\RIS/data/descr_formations_ai.txt, at line 1066, column 1. Group Formation script error: Formation early_germanic_pike_and_throw_envelopment does not cover all unit types in the formation blocks preference list
//   Script Error in Q:\...\descr_strat.txt, at line 40847, column 59. you have chosen an invalid tile(357, 398) for Skerviaidos (illyrian_kingdom)
//   Error while executing HasOffice for character Biggus Dickus, no office named Aedile assigned to senate roman_senate
//
// DELIBERATELY NOT REPORTED: the log's 8,132 bare `[FAILED]` markers and 5,377
// `HasResource [...::FAILED]` lines. Those are ordinary condition evaluations
// coming out false — the normal way a campaign script decides not to fire. They
// are the single largest pattern in the file and reporting them would bury the
// 13 real errors under 13,000 non-problems.
//
// Streaming (feedLine/finish) to match the other analysers and because these
// logs reach tens of MB in a long campaign.
const SCRIPT_RX = {
  // file, line, column, message — the path prefix varies by machine, so only
  // the basename is kept (that's what the modder actually opens).
  scriptError: /^\s*Script Error in (?:.*[\\/])?([^\\/,]+), at line (\d+), column (\d+)\.\s*(.+)$/,
  // runtime failures naming a definition the script expected to exist
  execError: /^\s*Error while executing (\w+) for character ([^,]+), (.+)$/,
};

// A parse error means the engine DISCARDED the block — the mod is running
// without it. An incomplete-coverage warning means the block loaded but has a
// gap. The first kind is worse, so it sorts first.
function scriptErrorIsFatal(message) {
  return /(^|: )(Expected\b|unknown\b|at least one\b)/i.test(message) || /invalid tile/i.test(message);
}

function createScriptLogAnalyzer() {
  const byFileLine = new Map(); // file:line:message → { file, line, column, message, count }
  const execErrors = new Map(); // command|reason → { command, reason, chars:Set, count }
  let lines = 0;
  let matched = 0;

  const feedLine = (l) => {
    lines++;
    if (l.indexOf("Error") === -1) return; // cheap reject — >99.9% of lines
    let m;
    if ((m = SCRIPT_RX.scriptError.exec(l))) {
      const message = m[4].trim();
      const key = `${m[1]}:${m[2]}:${message}`;
      const e = byFileLine.get(key) || { file: m[1], line: +m[2], column: +m[3], message, count: 0 };
      e.count++;
      byFileLine.set(key, e);
      matched++;
      return;
    }
    if ((m = SCRIPT_RX.execError.exec(l))) {
      const reason = m[3].trim();
      const key = `${m[1]}|${reason}`;
      const e = execErrors.get(key) || { command: m[1], reason, chars: new Set(), count: 0 };
      e.count++;
      e.chars.add(m[2].trim());
      execErrors.set(key, e);
      matched++;
    }
  };

  const finish = () => {
    const findings = [];
    for (const e of byFileLine.values()) {
      const fatal = scriptErrorIsFatal(e.message);
      findings.push({
        kind: "script_error",
        name: e.file,
        faction: "—",
        fromTurn: null, toTurn: null, turns: e.count,
        region: null, x: null, y: null,
        file: e.file, line: e.line, column: e.column,
        message: e.message,
        detail:
          `${e.file}:${e.line}:${e.column} — ${e.message}` +
          (e.count > 1 ? ` (reported ${e.count}×)` : ""),
        verdict: fatal
          ? "BLOCK DISCARDED — the engine could not parse it, so the mod runs without this entry"
          : "loaded with a gap — the engine fell back to defaults for the missing cases",
        severity: fatal ? 3 : 2,
      });
    }
    for (const e of execErrors.values()) {
      const who = [...e.chars].slice(0, 3).join(", ");
      const more = e.chars.size > 3 ? ` +${e.chars.size - 3} more` : "";
      findings.push({
        kind: "script_runtime_error",
        name: e.command,
        faction: "—",
        fromTurn: null, toTurn: null, turns: e.count,
        region: null, x: null, y: null,
        detail:
          `${e.command} failed ${e.count}× — ${e.reason}` +
          (who ? ` (character: ${who}${more})` : ""),
        verdict: "condition could not be evaluated — the script branch behind it never runs",
        severity: 2,
      });
    }
    findings.sort((p, q) => q.severity - p.severity || q.turns - p.turns || p.name.localeCompare(q.name));

    const findingCounts = {};
    for (const f of findings) findingCounts[f.kind] = (findingCounts[f.kind] || 0) + 1;

    const usable = matched > 0;
    return {
      logKind: "scripting",
      usable,
      emptyReason: usable
        ? null
        : `no script errors in this log — ${lines.toLocaleString()} lines scanned. That is genuinely good news: the engine parsed every data file it was asked to load. It also means there is nothing here to fix, so use campaign_ai_log.txt for AI behaviour instead.`,
      totalTurns: 0,
      parsedLines: matched,
      moveLines: 0, fleeLines: 0, cannotFlee: 0, armies: 0,
      lines,
      findings,
      findingCounts,
      factionStats: {},
    };
  };

  return { feedLine, finish };
}

// ════════════════════════════════════════════════════════════════════════
// LOG ↔ SAVE CORRELATION (2026-07-24) — turn a log finding into a verdict by
// checking the world state in an actual save. The log says what the AI TRIED;
// the save says whether it worked.
//
// `saveFacts` is a compact digest the caller builds from a cracked save (see
// buildSaveFacts below) so this stays pure and unit-testable:
//   { turn, ownerByCity: {settlement: faction},
//     unitsByFactionRegion: {"faction|Region": nUnits},
//     menByFaction: {faction: men}, unitsByFaction: {faction: n},
//     navalByFaction: {faction: n}, navalWorld: n,
//     settlementsByFaction: {faction: n}, regionOfSettlement: {settlement: Region} }
//
// Every enrichment is evidence-only — where the save can't answer (a name the
// save doesn't carry, a faction with no attributed units), the verdict is
// "unknown" rather than a guess.
function correlateWithSave(findings, saveFacts) {
  const F = saveFacts || {};
  const owner = F.ownerByCity || {};
  const unitsFR = F.unitsByFactionRegion || {};
  const men = F.menByFaction || {};
  const naval = F.navalByFaction || {};
  const setts = F.settlementsByFaction || {};
  const regOf = F.regionOfSettlement || {};
  const out = [];
  for (const f of findings || []) {
    const e = { ...f };
    const fac = String(f.faction || "").toLowerCase();
    // ── target-side: who holds the place the AI kept marching at? ──
    if ((f.kind === "stuck_mission" || f.kind === "never_arrives" || f.kind === "campaign_stall") && f.region) {
      const tgt = f.region;
      const held = owner[tgt] || owner[String(tgt).replace(/ /g, "_")] || null;
      if (held) {
        e.targetOwner = held;
        e.targetTaken = held.toLowerCase() === fac;      // they DID eventually take it
        const reg = regOf[tgt] || regOf[String(tgt).replace(/ /g, "_")] || null;
        const present = reg ? (unitsFR[fac + "|" + reg] || 0) : 0;
        e.unitsAtTarget = reg ? present : null;
        e.verdict = e.targetTaken
          ? `arrived eventually — holds ${tgt} at turn ${F.turn}`
          : (present > 0
            ? `reached ${tgt}'s region (${present} unit(s) there at turn ${F.turn}) but ${held} still holds it`
            : `NEVER arrived — ${held} holds ${tgt} and ${fac} has no units in that region at turn ${F.turn}`);
      } else {
        e.verdict = "unknown — save has no owner record for " + tgt;
      }
    }
    // ── abandoned: did the AI orphan a LIVE army, or did the char just die? ──
    if (f.kind === "abandoned") {
      const alive = F.aliveNames || {}, dead = F.deadNames || {};
      const k = String(f.name || "").replace(/^(Captain|Admiral|General)\s+/i, "").replace(/_/g, " ").trim().toLowerCase();
      if (alive[k]) {
        e.orphaned = true;
        e.verdict = `ORPHANED — still alive at turn ${F.turn}, but the AI issued it no orders after turn ${f.toTurn}`;
        e.severity = Math.min(3, (e.severity || 1) + 1); // a live forgotten army is worse than a dead one
      } else if (dead[k]) {
        e.orphaned = false;
        e.verdict = `died — not an AI fault (dead in the turn-${F.turn} save)`;
        e.severity = 0;                                  // benign: sort it to the bottom
      } else {
        e.verdict = `unknown — no character named "${f.name}" in the turn-${F.turn} save (destroyed, or a name the save spells differently)`;
      }
    }
    // ── actor-side: could this faction ever have afforded the campaign? ──
    if (fac && fac !== "?") {
      e.factionMenAtSave = men[fac] != null ? men[fac] : null;
      e.factionUnitsAtSave = F.unitsByFaction ? (F.unitsByFaction[fac] || 0) : null;
      e.factionSettlements = setts[fac] != null ? setts[fac] : null;
      // Naval units in the save carry no faction (all land under "?"), so this
      // is null rather than a confident 0 — see navalFactionKnown below.
      e.factionNaval = naval[fac] != null ? naval[fac] : null;
      if (f.kind === "campaign_stall") {
        const req = +(String(f.detail).match(/\/(\d+) strength/) || [0, 0])[1];
        if (req && e.factionMenAtSave != null) {
          e.reqVsHave = `needs ${req.toLocaleString()}, whole faction fields ${e.factionMenAtSave.toLocaleString()} men at turn ${F.turn}`;
          e.impossible = e.factionMenAtSave < req * 0.5; // can't get halfway there
          const mic = (F.micByFaction || {})[fac];
          if (e.impossible && mic) {
            e.micMax = mic.max; e.micMissing = mic.missing; e.micTowns = mic.towns;
            // mic tier gates which troops exist at all → distinguishes a poor
            // faction from one that structurally cannot field better units.
            e.blockedBy = mic.max <= 1 ? "recruitment" : "income";
            e.reqVsHave += mic.max <= 1
              ? ` · RECRUITMENT-capped: best military infrastructure is tier ${mic.max} (${mic.missing}/${mic.towns} towns have none)`
              : ` · infrastructure is fine (tier ${mic.max}) — this is an INCOME/production limit`;
          }
        }
      }
    }
    out.push(e);
  }
  return out;
}

// Build the correlation digest from a cracked save (crackSave output). Kept
// next to the correlator so the two evolve together; caller supplies the save.
function buildSaveFacts(save, regionOfSettlement) {
  const unitsByFactionRegion = {}, menByFaction = {}, unitsByFaction = {}, navalByFaction = {};
  let navalWorld = 0;
  for (const u of (save.units || [])) {
    const f = String(u.faction || "?").toLowerCase();
    const key = f + "|" + u.region;
    unitsByFactionRegion[key] = (unitsByFactionRegion[key] || 0) + 1;
    unitsByFaction[f] = (unitsByFaction[f] || 0) + 1;
    menByFaction[f] = (menByFaction[f] || 0) + (u.soldiers || 0);
    if (u.naval) { navalWorld++; navalByFaction[f] = (navalByFaction[f] || 0) + 1; }
  }
  const settlementsByFaction = {};
  for (const fx of Object.values(save.ownerByCity || {})) {
    const f = String(fx || "?").toLowerCase();
    settlementsByFaction[f] = (settlementsByFaction[f] || 0) + 1;
  }
  // Military-infrastructure ceiling per faction. RIS gates troop recruitment on
  // the military_industrial_complex tier (EDB `mic_tier_*` aliases), so a
  // faction whose towns never get past mic_0/1 is RECRUITMENT-capped no matter
  // how rich it is — that's what separates "poor" from "can't build troops"
  // among the impossible campaigns. Measured from the save, not assumed.
  const settByName = {};
  for (const st of (save.settlements || [])) if (st && st.name) settByName[st.name] = st;
  const micByFaction = {};
  for (const [city, fx] of Object.entries(save.ownerByCity || {})) {
    const f = String(fx || "?").toLowerCase();
    const e = micByFaction[f] = micByFaction[f] || { max: 0, missing: 0, towns: 0 };
    e.towns++;
    const st = settByName[city];
    const mic = st && (st.buildings || []).find((b) => b && b.name === "military_industrial_complex");
    if (mic) { if ((mic.level || 0) > e.max) e.max = mic.level || 0; }
    else e.missing++;
  }
  // Best settlement tier per faction (core_building level IS the settlement's
  // upgrade tier). Every mic level carries a settlement_min in EDB, so this is
  // the hard ceiling on a faction's military infrastructure — verified on the
  // reference save: micMax === best core_building level for every faction
  // checked (aulerci 0/0, treveri 1/1, arados 2/2, romans_julii 3/3).
  const tierByFaction = {};
  for (const [city, fx] of Object.entries(save.ownerByCity || {})) {
    const f = String(fx || "?").toLowerCase();
    const st = settByName[city];
    const core = st && (st.buildings || []).find((b) => b && b.name === "core_building");
    const lv = core ? (core.level || 0) : 0;
    if (tierByFaction[f] == null || lv > tierByFaction[f]) tierByFaction[f] = lv;
  }
  // Character names, normalised, split alive/dead. Used to settle "abandoned"
  // findings: still-alive = the AI ORPHANED a live army; dead = benign.
  const aliveNames = {}, deadNames = {};
  const norm = (n) => String(n || "").replace(/^(Captain|Admiral|General)\s+/i, "").replace(/_/g, " ").trim().toLowerCase();
  const ch = save.characters || {};
  for (const c of (ch.v1 || [])) {
    const k = norm(c.firstName); if (!k) continue;
    if (c.isDead) deadNames[k] = true; else aliveNames[k] = true;
  }
  for (const c of (ch.family || [])) {
    const k = norm(c.fullName || c.firstName); if (!k) continue;
    if (c.alive === false) deadNames[k] = true; else aliveNames[k] = true;
  }
  // KNOWN LIMITATION, reported rather than hidden (found 2026-07-25): naval units
  // in the save do not carry a faction, so every ship lands under "?" —
  // navalByFaction comes out as {"?": 50} on the reference save. Per-faction ship
  // counts are therefore NOT available from the save, and anything claiming "this
  // faction has no ships" on that basis is claiming nothing. Consumers must check
  // this flag; descr_strat's starting admirals is the fact to use instead.
  const namedNaval = Object.keys(navalByFaction).filter((k) => k && k !== "?").length;
  const navalFactionKnown = navalWorld === 0 ? null : namedNaval > 0;

  return {
    turn: save.turn,
    aliveNames, deadNames,
    ownerByCity: save.ownerByCity || {},
    unitsByFactionRegion, menByFaction, unitsByFaction, navalByFaction, navalWorld,
    navalFactionKnown,
    settlementsByFaction, micByFaction, tierByFaction,
    regionOfSettlement: regionOfSettlement || {},
    sieges: (save.sieges || []).length,
  };
}

// Any line naming a character counts as "the AI is still managing them" for the
// abandonment detector. Module-scope so the line manifest can export it.
const RX_ANY_CHAR = /char '([^']+)'|character '([^']+)'|army '([^']+)'/;

// ════════════════════════════════════════════════════════════════════════
// LINE MANIFEST (2026-07-25) — the exact line shapes this analyser consumes.
//
// The crash reporter has to ship campaign_ai_log data back from testers, and the
// raw file is 330MB. It cannot attach that, but it does not need to: only 21.8%
// of the lines are ever read, and a verbatim extract of just those compresses to
// 7.5MB. That extract is only equivalent to the original if the reporter filters
// on EXACTLY these patterns — so they are defined here, once, and exported.
//
// This exists because hand-copying them went wrong immediately: the faction turn
// header is `AI: <tabs>start 'faction' …`, and a retyped version guessed
// `+start`, which matched nothing and would have dropped every turn boundary
// (and with it all faction attribution) without any error.
//
// src/aiLogExtract.js consumes this, and its test asserts the analyser produces
// identical findings from an extract and from the full log.
// The manifest is NOT just AI_RX. The `abandoned` detector also counts any line
// that merely NAMES a character as evidence the AI is still managing them, via
// RX_ANY_CHAR — a much broader, unanchored match. Leaving it out of the manifest
// cost 560 findings (abandoned 1,695 instead of 2,255) in the extract-equivalence
// test, because dropped mentions pushed characters below the 5-order threshold.
// It is included here so an extract really is equivalent, and the test proves it.
const AI_LOG_LINE_PATTERNS = [...Object.values(AI_RX).map((rx) => rx.source), RX_ANY_CHAR.source];

module.exports = { analyzeMovementLog, createAiDecisionAnalyzer, createScriptLogAnalyzer, AI_LOG_LINE_PATTERNS, AI_RX, correlateWithSave, buildSaveFacts, DEFAULTS, AI_DEFAULTS };
