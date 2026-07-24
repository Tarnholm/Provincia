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

  return {
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
};

function createAiDecisionAnalyzer(opts = {}) {
  const cfg = { ...AI_DEFAULTS, ...opts };
  let curFaction = null;
  let turnIdx = 0;                 // increments when (year, season) changes
  let lastYearSeason = null;
  let firstYear = null, lastYear = null;
  const regName = new Map();       // regId → settlement name (self-described by campaign lines)
  const missions = new Map();      // char|sett → { char, sett, faction, turns:Set }
  const churn = new Map();         // char → { assigns, releases, faction, regs:Set }
  const stalls = new Map();        // faction|regId → { faction, regId, gatherTurns:Set, lastReq, lastAlloc }
  const aborts = new Map();        // regId → Set(turnIdx)
  let lines = 0, matched = 0;

  const feedLine = (l) => {
    lines++;
    if (l.charCodeAt(0) !== 65 /* 'A' */) return; // every interesting line starts "AI:"
    let m;
    if ((m = AI_RX.factionStart.exec(l))) {
      curFaction = m[1];
      const ys = m[2] + "|" + m[3];
      if (ys !== lastYearSeason) { turnIdx++; lastYearSeason = ys; }
      if (firstYear == null) firstYear = +m[2];
      lastYear = +m[2];
      matched++; return;
    }
    if ((m = AI_RX.mission.exec(l)) || (m = AI_RX.toldMove.exec(l))) {
      const key = m[1] + "|" + m[2];
      const e = missions.get(key) || { char: m[1], sett: m[2], faction: curFaction, turns: new Set() };
      e.turns.add(turnIdx);
      missions.set(key, e);
      matched++; return;
    }
    if ((m = AI_RX.assigned.exec(l))) {
      const e = churn.get(m[1]) || { assigns: 0, releases: 0, faction: curFaction, regs: new Set() };
      e.assigns++; e.regs.add(m[2]); e.faction = e.faction || curFaction;
      churn.set(m[1], e);
      matched++; return;
    }
    if ((m = AI_RX.released.exec(l))) {
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
    if ((m = AI_RX.campaign.exec(l))) {
      regName.set(m[2], m[1]);
      const req = +m[4], alloc = +m[5];
      if (m[3] === "ACS_GATHERING" && alloc < req) {
        const key = (curFaction || "?") + "|" + m[2];
        const e = stalls.get(key) || { faction: curFaction || "?", regId: m[2], turns: new Set(), lastReq: req, lastAlloc: alloc };
        e.turns.add(turnIdx); e.lastReq = req; e.lastAlloc = alloc;
        stalls.set(key, e);
      }
      matched++; return;
    }
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
    findings.sort((p, q) => q.severity - p.severity || q.turns - p.turns);
    const findingCounts = {};
    for (const f of findings) findingCounts[f.kind] = (findingCounts[f.kind] || 0) + 1;
    return {
      logKind: "campaign_ai",
      totalTurns: turnIdx, firstYear, lastYear,
      parsedLines: matched, moveLines: 0, fleeLines: 0, cannotFlee: 0,
      armies: churn.size,
      findings, findingCounts, factionStats: {},
      lines,
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
    // ── actor-side: could this faction ever have afforded the campaign? ──
    if (fac && fac !== "?") {
      e.factionMenAtSave = men[fac] != null ? men[fac] : null;
      e.factionUnitsAtSave = F.unitsByFaction ? (F.unitsByFaction[fac] || 0) : null;
      e.factionSettlements = setts[fac] != null ? setts[fac] : null;
      e.factionNaval = naval[fac] != null ? naval[fac] : 0;
      if (f.kind === "campaign_stall") {
        const req = +(String(f.detail).match(/\/(\d+) strength/) || [0, 0])[1];
        if (req && e.factionMenAtSave != null) {
          e.reqVsHave = `needs ${req.toLocaleString()}, whole faction fields ${e.factionMenAtSave.toLocaleString()} men at turn ${F.turn}`;
          e.impossible = e.factionMenAtSave < req * 0.5; // can't get halfway there
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
  return {
    turn: save.turn,
    ownerByCity: save.ownerByCity || {},
    unitsByFactionRegion, menByFaction, unitsByFaction, navalByFaction, navalWorld,
    settlementsByFaction,
    regionOfSettlement: regionOfSettlement || {},
    sieges: (save.sieges || []).length,
  };
}

module.exports = { analyzeMovementLog, createAiDecisionAnalyzer, correlateWithSave, buildSaveFacts, DEFAULTS, AI_DEFAULTS };
