// Diplomacy that happened after the loaded save, from message_log (see
// logWatchHandlers.collectDiplomacy): the save's matrix is the start of the
// turn; these events bring it up to the moment.
//   { type: "war", a, b, seq }     two factions fought a battle → at war
//                                  (attacking a faction declares war; the game
//                                  cancels their treaties — engine flags for a
//                                  pair gone to war lose trade rights)
//   { type: "dead", faction, seq } FACTION::remove_from_game — the game lists
//                                  no war or treaty with a dead faction
// Only events after the save's own 'Campaign saved' line apply (`isNew`), so an
// older battle can never undo a peace the save already holds.
const TREATY_LISTS = ["allied", "trade", "protectorates", "suzerains", "hostile"];

export function applyLiveDiplomacy(matrix, events, isNew = () => true) {
  if (!matrix || !Array.isArray(events) || events.length === 0) return matrix;
  const todo = events.filter((e) => e && isNew(e)).sort((x, y) => (x.seq || 0) - (y.seq || 0));
  if (todo.length === 0) return matrix;
  const out = { ...matrix };
  const rowOf = (name) => {
    const k = String(name).toLowerCase();
    if (!out[k]) return null;
    if (out[k] === matrix[k]) {
      const r = {};
      for (const [f, v] of Object.entries(matrix[k])) r[f] = Array.isArray(v) ? v.slice() : v;
      out[k] = r;
    }
    return out[k];
  };
  const without = (arr, name) => (Array.isArray(arr) ? arr.filter((e) => String(e && typeof e === "object" ? e.to : e).toLowerCase() !== name) : arr);
  for (const e of todo) {
    if (e.type === "war") {
      const a = String(e.a).toLowerCase(), b = String(e.b).toLowerCase();
      if (a === b) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        const r = rowOf(x);
        if (!r) continue;
        if (!Array.isArray(r.war)) r.war = [];
        if (!r.war.some((w) => String(w).toLowerCase() === y)) r.war.push(y);
        for (const l of TREATY_LISTS) if (Array.isArray(r[l])) r[l] = without(r[l], y);
      }
    } else if (e.type === "dead") {
      const d = String(e.faction).toLowerCase();
      delete out[d];
      const meta = out._meta || {};
      if (!(meta.dead || []).includes(d)) out._meta = { ...meta, dead: [...(meta.dead || []), d] };
      for (const [k, r] of Object.entries(out)) {
        if (k === "_meta" || !r) continue;
        if (Object.values(r).some((v) => Array.isArray(v) && v.some((x) => String(x && typeof x === "object" ? x.to : x).toLowerCase() === d))) {
          const row = rowOf(k);
          for (const [f, v] of Object.entries(row)) if (Array.isArray(v)) row[f] = without(v, d);
        }
      }
    }
  }
  return out;
}

// Characters the log moved to another faction after the save, as
// { charUuid(8-hex) -> toFaction }, last change wins.
export function liveFactionChanges(changes, isNew = () => true) {
  const out = new Map();
  for (const c of (changes || []).filter((x) => x && isNew(x)).sort((x, y) => (x.seq || 0) - (y.seq || 0))) {
    if (c.charUuid) out.set(String(c.charUuid).padStart(8, "0"), c.to);
  }
  return out;
}


// Agents as they stand now: the save's agents, moved by the log's agent actions
// since it. An action line names the agent's faction and name and the tile it
// started from, so it moves the agent of that faction and first name standing
// on that tile (the log's id is a runtime address the save doesn't hold); when
// the tile doesn't match, a faction + first name that is unique still does.
// A move with x == null (DYING) removes the agent.
// A NEW agent (recruited, placed in a town) is added at settlementTile(name).
export function applyAgentMoves(saveAgents, moves, isNew = () => true, settlementTile = () => null) {
  if (!Array.isArray(saveAgents)) return [];
  const list = saveAgents.map((a) => ({ ...a }));
  const first = (n) => String(n || "").toLowerCase().split(/\s+/)[0];
  for (const m of moves || []) {
    if (!m || !isNew(m)) continue;
    const f = String(m.faction || "").toLowerCase(), fn = first(m.name);
    if (m.action === "NEW") {
      const t = settlementTile(m.settlement);
      if (t) list.push({ name: m.name, faction: f, type: m.role, x: t.x, y: t.y, live: true });
      continue;
    }
    let i = list.findIndex((a) => a && a.faction === f && first(a.name) === fn && a.x === m.fromX && a.y === m.fromY);
    if (i < 0) {
      const same = list.filter((a) => a && a.faction === f && first(a.name) === fn);
      if (same.length === 1) i = list.indexOf(same[0]);
    }
    if (i < 0) continue;
    if (m.x == null) { list[i] = null; continue; }
    list[i] = { ...list[i], x: m.x, y: m.y, live: true };
  }
  return list.filter(Boolean);
}
