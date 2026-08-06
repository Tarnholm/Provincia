// src/battleLedger.js
//
// Per-faction battle ledger built from RTW:R message_log.txt lines (the same
// stream logWatchHandlers.js tails and forwards to the renderer on the
// "log-lines" channel) and/or from already-parsed event objects (App.js's
// parseLogLines events, or messageLogParser.js events).
//
// Pure module: no IPC, no React, no globals. createLedger() returns an
// isolated stateful instance. Feed it either RAW TEXT (preferred — the raw
// log carries faction attribution lines that neither existing parser
// extracts) or event objects, but not BOTH for the same underlying lines,
// or the dedupe keys won't line up and battles may double-count.
//
// What the raw log actually contains around a battle (verified against
// calibration/logs-archive/message_log-97turns.txt, 97 turns, ~127 battles):
//
//   Conflict Type(Naval|Normal|Siege|SallyBesieger)
//   ***** Battle Setup Phase Started *****
//   adding main army(a5bb1c20:macedon:1 alnce1) to battle       ← faction per army
//   X(a5bb1c20) has defeated Y(c0cfe280) in an autoresolved battle   (autoresolve only)
//   winning army Name(a5bb1c20:macedon) has been assessed        ← ALL battles
//   losing army Name(c0cfe280:slave) has been assessed
//   winning main army Name(a5bb1c20:macedon) has been fully resolved  (redundant)
//   finished post battle resolution
//   Name(slave) army(c0cfe280) is dead                           ← army destroyed
//
// Plus, outside battles:
//   siege by Name(charUuid) on Settlement(x,y) has begun
//   siege by Name(charUuid)(army:uuid) on Settlement(x,y) has been ended
//   promoting general(N:uuid) for sallying army(uuid) in Pella to attack army(N:uuid)
//   faction(a) surrenders S to faction(b). Reason - SUCCESSFUL_ASSAULT   (then a
//   duplicate "Reason - CAPTURED" surrender AND a "faction(b) captures S from a"
//   line for the same capture — deduped here by settlement+captor+turn)
//   ====================end round====================             ← turn counter
//
// NOTE: the engine writes without trailing newlines sometimes, so unrelated
// text gets glued onto the end (".. autoresolved battleSetting battle
// result(victory)") or front ("..flag is setlosing army X(..) has been
// assessed"). All battle regexes are therefore UNANCHORED.

const MAX_EVENTS = 500;

const RX = {
  conflict: /Conflict Type\((Naval|Normal|Siege|SallyBesieger)\)/,
  setup: /\*\*\*\*\* Battle Setup Phase Started \*\*\*\*\*/,
  addArmy: /adding (?:main |reinforcement )?army\(([0-9a-f]+):([a-z_0-9]+):\d+ alnce(\d+)\) to battle/,
  assessed: /(winning|losing) army (.+?)\(([0-9a-f]+):([a-z_0-9]+)\) has been assessed/,
  resolved: /(winning|losing) main army (.+?)\(([0-9a-f]+):([a-z_0-9]+)\) has been fully resolved/,
  autoresolve: /(.+?)\(([0-9a-f]+)\) has defeated (.+?)\(([0-9a-f]+)\) in an autoresolved battle/,
  armyDead: /^(.+?)\(([a-z_0-9]+)\) army\(([0-9a-f]+)\) is dead\b/,
  siegeBegun: /siege by (.+?)\(([0-9a-f]+)\)(?:\(army:([0-9a-f]+)\))? on (.*?)\((\d+),(\d+)\) has begun/,
  siegeEnded: /siege by (.+?)\(([0-9a-f]+)\)(?:\(army:([0-9a-f]+)\))? on (.*?)\((\d+),(\d+)\) has been ended/,
  sally: /for sallying army\(([0-9a-f]+)\) in (.+?) to attack army\(/,
  surrender: /faction\(([a-z_0-9]+)\) surrenders (.+?) to faction\(([a-z_0-9]+)\)\. Reason - ([A-Z_]+)/,
  capture: /faction\(([a-z_0-9]+)\) captures (.+?) from ([a-z_0-9]+)\. Reason - ([A-Z_]+)/,
  // Faction-attribution feeders (same shapes messageLogParser.js reads):
  // "Name(charUuid:army(armyUuid):faction:role):MOVING_NORMAL:..."
  moveIds: /^(.+?)\(([0-9a-f]+):army\(([0-9a-f]+)\):([a-z_0-9]+):/,
  // "Name(charUuid:faction:role) takes command of this army(armyUuid)"
  takesCommand: /^(.+?)\(([0-9a-f]+):([a-z_0-9]+):[a-z_ ]+\) takes command of this army\(([0-9a-f]+)\)/,
};

const CONFLICT_TO_TYPE = {
  Naval: "naval",
  Normal: "field",
  Siege: "siege_assault",
  SallyBesieger: "sally",
};

// opts.maxEvents — event-feed cap (default 500, the live war-map ticker's
// budget). The Faction Chronicle passes a much higher cap: it narrates a whole
// campaign after the fact, and 500 is exceeded within ~16 turns of a real RIS
// session, which would silently drop every early-game battle.
export function createLedger(opts = {}) {
  const maxEvents = opts.maxEvents || MAX_EVENTS;
  // ── per-faction aggregates ──
  const byFaction = Object.create(null);
  function fac(name) {
    if (!byFaction[name]) {
      byFaction[name] = {
        fought: 0, won: 0, lost: 0, sieges: 0,
        armiesDestroyed: 0,   // enemy armies destroyed by this faction
        armiesLost: 0,        // this faction's own armies wiped out
        opponents: Object.create(null),  // faction → battles fought against
      };
    }
    return byFaction[name];
  }
  function opp(a, b) {
    const fa = fac(a);
    fa.opponents[b] = (fa.opponents[b] || 0) + 1;
  }

  // ── event feed (oldest → newest internally; snapshot reverses) ──
  const events = [];
  let seq = 0;
  function pushEvent(ev) {
    ev.seq = ++seq;
    ev.turn = turn;
    events.push(ev);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    return true;
  }

  // ── dedupe: keys are turn-scoped so a genuine rematch next turn counts ──
  const seen = new Set();
  function once(key) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 20000) seen.clear(); // unbounded-growth guard (long sessions)
    return true;
  }

  // ── attribution maps built from the firehose ──
  const armyFaction = new Map();  // armyUuid → faction
  const charFaction = new Map();  // charUuid → faction

  // ── running state ──
  let turn = 1;
  let battleOpen = false;
  let battleType = null;          // from Conflict Type, may stay null
  let battleCommitted = false;
  let pendingWinner = null;       // { name, armyUuid, faction }
  let pendingLoser = null;
  let lastBattle = null;          // { winner, loser } — valid until next battle opens
  let sallyLocation = null;       // settlement from the "sallying army ... in X" line
  let lastSiegeSettlement = null; // most recent siege target (location heuristic)
  const activeSieges = new Map(); // settlementLower → besieging faction

  function openBattle(type) {
    battleOpen = true;
    battleCommitted = false;
    pendingWinner = null;
    pendingLoser = null;
    battleType = type || null;
    lastBattle = null; // army-death kill credit only applies inside the window
  }

  function setPending(side, info) {
    const cur = side === "winning" ? pendingWinner : pendingLoser;
    const merged = {
      name: (cur && cur.name) || info.name || null,
      armyUuid: (cur && cur.armyUuid) || info.armyUuid || null,
      faction: (cur && cur.faction) || info.faction || null,
    };
    if (side === "winning") pendingWinner = merged; else pendingLoser = merged;
  }

  function tryCommitBattle() {
    if (battleCommitted) return false;
    if (!pendingWinner || !pendingLoser) return false;
    if (!pendingWinner.faction || !pendingLoser.faction) return false;
    battleCommitted = true; // even if deduped below, this window is done
    const w = pendingWinner, l = pendingLoser;
    const key = `b|${turn}|${w.armyUuid || w.name}|${l.armyUuid || l.name}`;
    if (!once(key)) return false;
    const type = battleType || "field";
    let location = null;
    if (type === "sally") location = sallyLocation || lastSiegeSettlement;
    else if (type === "siege_assault") location = lastSiegeSettlement;
    fac(w.faction).fought++; fac(w.faction).won++;
    fac(l.faction).fought++; fac(l.faction).lost++;
    opp(w.faction, l.faction);
    opp(l.faction, w.faction);
    lastBattle = { winner: w.faction, loser: l.faction };
    sallyLocation = null;
    pushEvent({
      kind: "battle", battleType: type,
      winner: w.faction, loser: l.faction,
      winnerName: w.name, loserName: l.name,
      location: location || null,
    });
    return true;
  }

  // ── raw-line ingestion ─────────────────────────────────────────────────
  function ingestLine(line) {
    if (!line || line.length < 8) return false;
    // Turn boundary marker: "====================end round===================="
    if (line.charCodeAt(0) === 61 /* '=' */) {
      if (line.includes("end round")) turn++;
      return false;
    }
    let m;

    // Attribution feeders first (they're the most common lines).
    if ((m = RX.moveIds.exec(line))) {
      charFaction.set(m[2], m[4]);
      armyFaction.set(m[3], m[4]);
      // fall through: a move line never doubles as a battle line
      return false;
    }
    if ((m = RX.takesCommand.exec(line))) {
      charFaction.set(m[2], m[3]);
      armyFaction.set(m[4], m[3]);
      return false;
    }

    if ((m = RX.conflict.exec(line))) {
      openBattle(CONFLICT_TO_TYPE[m[1]] || null);
      return false;
    }
    if (RX.setup.test(line)) {
      if (!battleOpen || battleCommitted) openBattle(battleType);
      // A sally line often shares this physical line (engine glomming); the
      // sally regex below still needs its shot, so no early return.
    }
    if ((m = RX.sally.exec(line))) {
      sallyLocation = m[2].trim();
      if (battleOpen && !battleType) battleType = "sally";
      return false;
    }
    if ((m = RX.addArmy.exec(line))) {
      if (!battleOpen || battleCommitted) openBattle(battleType);
      armyFaction.set(m[1], m[2]);
      return false;
    }
    if ((m = RX.autoresolve.exec(line))) {
      // uuids here are ARMY uuids; factions resolved via the map.
      setPending("winning", { name: m[1].trim(), armyUuid: m[2], faction: armyFaction.get(m[2]) || null });
      setPending("losing", { name: m[3].trim(), armyUuid: m[4], faction: armyFaction.get(m[4]) || null });
      return tryCommitBattle();
    }
    if ((m = RX.assessed.exec(line)) || (m = RX.resolved.exec(line))) {
      armyFaction.set(m[3], m[4]);
      setPending(m[1], { name: m[2].trim(), armyUuid: m[3], faction: m[4] });
      return tryCommitBattle();
    }
    if ((m = RX.armyDead.exec(line))) {
      const name = m[1].trim(), faction = m[2], armyUuid = m[3];
      // Guard: an 8-char pure-hex "faction" is actually a uuid from some
      // other glommed line shape — every real faction tag has a non-hex
      // letter or underscore.
      if (/^[0-9a-f]{8}$/.test(faction)) return false;
      if (!once(`d|${turn}|${armyUuid}`)) return false;
      fac(faction).armiesLost++;
      let destroyedBy = null;
      if (lastBattle && lastBattle.loser === faction) {
        destroyedBy = lastBattle.winner;
        fac(destroyedBy).armiesDestroyed++;
      }
      return pushEvent({ kind: "army_destroyed", faction, commanderName: name, destroyedBy });
    }
    if ((m = RX.siegeBegun.exec(line))) {
      const general = m[1].trim(), charUuid = m[2], armyUuid = m[3] || null;
      const settlement = m[4].trim() || null;
      const faction = charFaction.get(charUuid) || (armyUuid && armyFaction.get(armyUuid)) || null;
      if (!once(`sb|${turn}|${settlement}|${charUuid}`)) return false;
      if (settlement) lastSiegeSettlement = settlement;
      if (faction && settlement) {
        const k = settlement.toLowerCase();
        if (activeSieges.get(k) !== faction) fac(faction).sieges++;
        activeSieges.set(k, faction);
      }
      return pushEvent({ kind: "siege_begun", faction, general, settlement });
    }
    if ((m = RX.siegeEnded.exec(line))) {
      const settlement = m[4].trim() || null;
      if (!once(`se|${turn}|${settlement}|${m[2]}`)) return false;
      if (settlement) activeSieges.delete(settlement.toLowerCase());
      return pushEvent({ kind: "siege_ended", general: m[1].trim(), settlement });
    }
    if ((m = RX.surrender.exec(line))) {
      const from = m[1], settlement = m[2].trim(), to = m[3], reason = m[4];
      // SUCCESSFUL_ASSAULT and the follow-up CAPTURED surrender (and the
      // separate "captures" line) all describe ONE capture → one dedupe key.
      if (!once(`cap|${turn}|${settlement.toLowerCase()}|${to}`)) return false;
      return recordCapture(to, from, settlement, reason);
    }
    if ((m = RX.capture.exec(line))) {
      const to = m[1], settlement = m[2].trim(), from = m[3], reason = m[4];
      if (!once(`cap|${turn}|${settlement.toLowerCase()}|${to}`)) return false;
      return recordCapture(to, from, settlement, reason);
    }
    return false;
  }

  function recordCapture(to, from, settlement, reason) {
    const k = settlement.toLowerCase();
    const assault = reason === "SUCCESSFUL_ASSAULT";
    if (assault && activeSieges.get(k) !== to) {
      // Assault won but we never attributed the siege's start — count it now.
      fac(to).sieges++;
    }
    activeSieges.delete(k);
    return pushEvent({
      kind: assault ? "assault_captured" : "settlement_captured",
      winner: to, loser: from, settlement, reason,
    });
  }

  // ── pre-parsed event-object ingestion ─────────────────────────────────
  // Accepts App.js parseLogLines events AND messageLogParser.js events.
  // Faction-less shapes (battle_outcome carries only names/uuids) are
  // recorded in the feed but can only update byFaction when the uuid is
  // resolvable — raw-line ingestion is strictly richer.
  function ingestEvent(ev) {
    if (!ev || typeof ev.type !== "string") return false;
    switch (ev.type) {
      case "battle_outcome": {
        const wUuid = ev.winnerUuid || null, lUuid = ev.loserUuid || null;
        openBattle(battleType); // each outcome object is its own battle window
        setPending("winning", { name: ev.winnerName || ev.winner || null, armyUuid: wUuid, faction: wUuid ? armyFaction.get(wUuid) || null : null });
        setPending("losing", { name: ev.loserName || ev.loser || null, armyUuid: lUuid, faction: lUuid ? armyFaction.get(lUuid) || null : null });
        if (tryCommitBattle()) return true;
        // Unattributable — feed-only entry so the panel still shows it.
        const key = `b|${turn}|${wUuid || ev.winner || ev.winnerName}|${lUuid || ev.loser || ev.loserName}`;
        battleCommitted = true;
        if (!once(key)) return false;
        return pushEvent({
          kind: "battle", battleType: battleType || "field",
          winner: null, loser: null,
          winnerName: ev.winnerName || ev.winner || null,
          loserName: ev.loserName || ev.loser || null,
          location: null,
        });
      }
      case "army_dead": // messageLogParser shape
        return ingestLine(`${ev.commanderName}(${ev.faction}) army(${ev.armyUuid || "00000000"}) is dead`);
      case "siege": { // App.js shape: { general, settlement, status: "begun"|"ended" }
        if (ev.status === "begun") return ingestLine(`siege by ${ev.general}(00000000) on ${ev.settlement}(0,0) has begun`);
        return ingestLine(`siege by ${ev.general}(00000000) on ${ev.settlement}(0,0) has been ended`);
      }
      case "surrender": // App.js shape
        return ingestLine(`faction(${ev.from}) surrenders ${ev.settlement} to faction(${ev.to}). Reason - ${ev.reason}`);
      case "capture": // App.js shape
      case "settlement_capture": // messageLogParser shape
        return ingestLine(`faction(${ev.faction}) captures ${ev.settlement} from ${ev.from || ev.fromFaction}. Reason - ${ev.reason}`);
      case "character_move": // messageLogParser shape → attribution only
        if (ev.charUuid && ev.faction) charFaction.set(ev.charUuid, ev.faction);
        if (ev.armyUuid && ev.faction) armyFaction.set(ev.armyUuid, ev.faction);
        return false;
      case "turn": // App.js campaign_ai_log turn marker
        if (typeof ev.turn === "number" && ev.turn > turn) turn = ev.turn;
        return false;
      default:
        return false;
    }
  }

  // ── public API ────────────────────────────────────────────────────────
  return {
    /** Feed a raw log line, a multi-line raw chunk, or a parsed event
     *  object. Returns the number of new ledger events recorded. */
    ingest(input) {
      let added = 0;
      if (typeof input === "string") {
        for (const line of input.split(/\r?\n/)) {
          if (ingestLine(line)) added++;
        }
      } else if (input && typeof input === "object") {
        if (ingestEvent(input)) added++;
      }
      return added;
    },

    /** Immutable-ish view: per-faction aggregates + last 500 events,
     *  newest first. */
    snapshot() {
      const facsOut = {};
      for (const [f, s] of Object.entries(byFaction)) {
        facsOut[f] = { ...s, opponents: { ...s.opponents } };
      }
      return {
        byFaction: facsOut,
        events: events.slice().reverse().map(e => ({ ...e })),
        turn,
      };
    },

    /** Wipe everything (log truncated / new campaign / log-watch-reset). */
    reset() {
      for (const k of Object.keys(byFaction)) delete byFaction[k];
      events.length = 0;
      seen.clear();
      armyFaction.clear();
      charFaction.clear();
      activeSieges.clear();
      turn = 1; seq = 0;
      battleOpen = false; battleCommitted = false; battleType = null;
      pendingWinner = null; pendingLoser = null; lastBattle = null;
      sallyLocation = null; lastSiegeSettlement = null;
    },
  };
}

export default createLedger;
