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

module.exports = { analyzeMovementLog, DEFAULTS };
