// Diplomacy heatmap model (pure, ESM, no React/DOM).
//
// Builds an NxN pair-state model from the decoded live diplomacy attitude
// matrix (`diplomacyMatrix`, produced by saveCrackerExtras.parseDiplomacyMatrix
// and held in App state). That matrix is THE authoritative full-matrix source:
//   diplomacyMatrix = {
//     [factionIdLower]: {
//       war:           [partnerIds],   // attitude 600+ — formal war (ground truth)
//       allied:        [partnerIds],   // attitude 0
//       hostile:       [partnerIds],   // attitude 400..599 — AI drift, NOT formal war
//       trade:         [partnerIds],   // military bond >= 54 (ally OR protectorate bond)
//       protectorates: [partnerIds],   // partners that are THIS faction's clients
//       suzerains:     [partnerIds],   // partners that are THIS faction's suzerain
//       rel: [{ to, att, bond, agg, turnsAllied, turnsAtWar }], // raw non-neutral cells
//     },
//     _meta: { base, stride, key, C, N, symmetry, warPairs },
//   }
// `allFactionDiplomacy` (parseAllFactionDiplomacy) holds per-faction COUNTS only
// ({ wars, allies, ceasefires, locked, neutral, count, relationCount }) with no
// partner identity, so it cannot drive the grid — here it serves ONLY as the
// per-save liveness signal: its keys are the factions that actually have a
// diplomacy zone in the loaded save (~221 of 239 in RIS).
//
// Placeholder pseudo-factions (slave/rebels/dummies/italics/*_rebels) never get
// a row in the decoded matrix (saveCrackerExtras.isDiplomaticFaction), and we
// re-apply the same rule defensively so a stale cached matrix renders clean.

export const DIPLO_PLACEHOLDER_RE = /(_rebels|^slave$|^slaves$|^rebels$|^dummies$|^italics$)/;

export function isRealFaction(id) {
  return !!id && !DIPLO_PLACEHOLDER_RE.test(String(id).toLowerCase());
}

// Canonical unordered pair key: cellKey("b","a") === cellKey("a","b") === "a|b".
export function cellKey(a, b) {
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

// Symmetric cell lookup — accepts either argument order.
export function getCell(model, a, b) {
  if (!model || !model.cells) return null;
  return model.cells[cellKey(a, b)] || null;
}

// Pair-state precedence, most specific first. "war" is engine ground truth;
// "protectorate" (asymmetric 54/55 bond) outranks the plain allied state;
// "trade" is a military-bond pair whose attitude state isn't (or isn't yet)
// allied; "hostile" is AI drift (400..599), not a formal war.
export const STATE_ORDER = ["war", "protectorate", "allied", "trade", "hostile", "neutral"];

const lcSet = (arr) => {
  const s = new Set();
  if (Array.isArray(arr)) for (const v of arr) if (v) s.add(String(v).toLowerCase());
  return s;
};

/**
 * buildHeatmapModel({ diplomacyMatrix, allFactionDiplomacy, factions,
 *                     factionCultures, aliveOnly, displayNames })
 *
 *  diplomacyMatrix     — decoded matrix (see header). Required for any output.
 *  allFactionDiplomacy — optional; keys used as the liveness signal for aliveOnly.
 *  factions            — optional array of faction ids; restricts rows to this set.
 *  factionCultures     — optional { factionId: cultureFolderName } for the
 *                        culture ordering (App.js `factionCultures` state).
 *  aliveOnly           — when true AND allFactionDiplomacy has keys, drop factions
 *                        without a diplomacy zone in the save. When the signal is
 *                        absent, all matrix factions are kept (aliveFiltered:false).
 *  displayNames        — optional { factionId: label }; alphabetical ordering
 *                        sorts by label when available (falls back to id).
 *
 * Returns {
 *   order:  [factionIds]           — the default (alphabetical) ordering,
 *   orders: { alphabetical, culture, wars },  — all three orderings
 *   cells:  { "a|b": { state, value } },      — canonical-key pair cells
 *            state: "war"|"protectorate"|"allied"|"trade"|"hostile"|"neutral"
 *            value: numeric attitude (0/200/400/600/…) when the raw rel entry
 *                   exists for the pair, else null
 *   stats:  { wars, alliances, mostWarring: [{ id, wars }] },
 *   warCounts: { factionId: nWars },
 *   aliveFiltered: bool            — whether the liveness filter was applied
 * }
 */
export function buildHeatmapModel({
  diplomacyMatrix,
  allFactionDiplomacy,
  factions,
  factionCultures,
  aliveOnly,
  displayNames,
} = {}) {
  const empty = {
    order: [], orders: { alphabetical: [], culture: [], wars: [] },
    cells: {}, stats: { wars: 0, alliances: 0, mostWarring: [] },
    warCounts: {}, aliveFiltered: false,
  };
  if (!diplomacyMatrix || typeof diplomacyMatrix !== "object") return empty;

  // ── Row set: real matrix rows, optionally restricted + liveness-filtered ──
  let ids = Object.keys(diplomacyMatrix)
    .filter((k) => k !== "_meta")
    .map((k) => k.toLowerCase())
    .filter(isRealFaction);
  if (Array.isArray(factions) && factions.length > 0) {
    const want = lcSet(factions);
    ids = ids.filter((id) => want.has(id));
  }
  const aliveKeys = (allFactionDiplomacy && typeof allFactionDiplomacy === "object")
    ? lcSet(Object.keys(allFactionDiplomacy)) : null;
  let aliveFiltered = false;
  if (aliveOnly && aliveKeys && aliveKeys.size > 0) {
    ids = ids.filter((id) => aliveKeys.has(id));
    aliveFiltered = true;
  }
  ids = [...new Set(ids)];
  if (ids.length === 0) return empty;
  const included = new Set(ids);

  // ── Per-row lookup sets (partner lists carry raw names; normalize) ──
  const rows = {};
  for (const id of ids) {
    const r = diplomacyMatrix[id] || diplomacyMatrix[Object.keys(diplomacyMatrix).find((k) => k.toLowerCase() === id)] || {};
    rows[id] = {
      war: lcSet(r.war),
      allied: lcSet(r.allied),
      hostile: lcSet(r.hostile),
      trade: lcSet(r.trade),
      protectorates: lcSet(r.protectorates),
      suzerains: lcSet(r.suzerains),
      rel: Array.isArray(r.rel) ? r.rel : [],
    };
  }

  // ── Cells: unordered pairs, union of both directions (matrix is symmetric;
  //    a one-sided decode still counts — war/ally are mutual by engine rule) ──
  const cells = {};
  const warCounts = {};
  for (const id of ids) warCounts[id] = 0;
  let wars = 0, alliances = 0;
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i], ra = rows[a];
    for (let j = i + 1; j < ids.length; j++) {
      const b = ids[j], rb = rows[b];
      let state = "neutral";
      if (ra.war.has(b) || rb.war.has(a)) state = "war";
      else if (ra.protectorates.has(b) || ra.suzerains.has(b) || rb.protectorates.has(a) || rb.suzerains.has(a)) state = "protectorate";
      else if (ra.allied.has(b) || rb.allied.has(a)) state = "allied";
      else if (ra.trade.has(b) || rb.trade.has(a)) state = "trade";
      else if (ra.hostile.has(b) || rb.hostile.has(a)) state = "hostile";
      // numeric attitude from the raw rel entry (either direction; A's view first)
      let value = null;
      const relA = ra.rel.find((e) => e && e.to && String(e.to).toLowerCase() === b);
      const relB = relA ? null : rb.rel.find((e) => e && e.to && String(e.to).toLowerCase() === a);
      const rel = relA || relB;
      if (rel && typeof rel.att === "number") value = rel.att;
      if (state !== "neutral" || value != null) cells[cellKey(a, b)] = { state, value };
      if (state === "war") { wars++; warCounts[a]++; warCounts[b]++; }
      else if (state === "allied" || state === "protectorate") alliances++;
    }
  }

  // ── Orderings ──
  const label = (id) => (displayNames && (displayNames[id] || displayNames[id.toLowerCase()])) || id;
  const alpha = [...ids].sort((x, y) => String(label(x)).localeCompare(String(label(y))) || x.localeCompare(y));
  const cultureOf = (id) => {
    if (!factionCultures) return "";
    return factionCultures[id] || factionCultures[id.toLowerCase()] || "";
  };
  const culture = [...alpha].sort((x, y) =>
    String(cultureOf(x)).localeCompare(String(cultureOf(y))) ||
    String(label(x)).localeCompare(String(label(y))) || x.localeCompare(y));
  const byWars = [...alpha].sort((x, y) => (warCounts[y] - warCounts[x]) ||
    String(label(x)).localeCompare(String(label(y))) || x.localeCompare(y));

  const mostWarring = ids
    .filter((id) => warCounts[id] > 0)
    .sort((x, y) => (warCounts[y] - warCounts[x]) || x.localeCompare(y))
    .slice(0, 5)
    .map((id) => ({ id, wars: warCounts[id] }));

  return {
    order: alpha,
    orders: { alphabetical: alpha, culture, wars: byWars },
    cells,
    stats: { wars, alliances, mostWarring },
    warCounts,
    aliveFiltered,
    _included: [...included],
  };
}

export default buildHeatmapModel;
