// map_ground_types.tga → per-region terrain composition, for the AI Lab.
//
// WHY THIS FILE MATTERS TO THE AI
// ------------------------------
// The other mod files explain whether a faction CAN raise the troops a campaign
// needs. This one explains whether the ground it is ordered across can actually
// be walked. The engine derives campaign movement cost from map_ground_types,
// and three of its classes are impassable outright — so a target sitting behind
// them produces exactly the pathology the Lab keeps finding: the same move order
// re-issued turn after turn, never arriving.
//
// GROUND TRUTH
// ------------
//   • The RGB → terrain mapping is the app's own GROUND_TYPE_PALETTE (App.js),
//     already used by the Terrain map mode. Verified against the RIS file:
//     exactly 14 distinct colours, 100.000% covered by the palette, no unknowns.
//   • map_ground_types.tga is DOUBLE resolution: RIS ships 2041×1401 against
//     map_regions.tga's 1020×700 (the engine's 2N+1 convention). So each ground
//     pixel maps back to region pixel (floor(gx/2), floor(gy/2)) — iterating the
//     ground image and reducing gives every ground pixel a region, rather than
//     throwing 3/4 of the detail away.
//   • Both TGAs are bottom-up (desc 0x00) and share an aspect ratio, so the same
//     orientation is used for both. That is safe here because everything this
//     module produces is a per-region AGGREGATE — no screen coordinates.
//
// Never invents: a region absent from the region image simply gets no entry.
"use strict";

// name → movement class. The impassable set is the palette's own annotation
// (MOUNTAINS_HIGH / FOREST_DENSE / OCEAN are marked impassable there).
const GROUND_TYPES = {
  "0,128,128": { name: "Fertile land", cls: "easy" },
  "96,160,64": { name: "Fertile land", cls: "easy" },
  "101,124,0": { name: "Fertile highland", cls: "easy" },
  "0,0,0": { name: "Wilderness", cls: "easy" },
  "255,255,255": { name: "Beach", cls: "easy" },
  "128,128,64": { name: "Hills", cls: "rough" },
  "98,65,65": { name: "Mountains", cls: "rough" },
  "0,128,0": { name: "Forest", cls: "rough" },
  "0,255,128": { name: "Swamp", cls: "rough" },
  "196,128,128": { name: "High mountains", cls: "impassable" },
  "0,64,0": { name: "Dense forest", cls: "impassable" },
  "64,0,0": { name: "Ocean", cls: "sea", impassableSea: true },
  "128,0,0": { name: "Deep sea", cls: "sea" },
  "196,0,0": { name: "Shallow sea", cls: "sea" },
};

/**
 * Per-region terrain composition.
 *
 * @param {object} a
 * @param {{W:number,H:number,raw:Buffer|Uint8Array}} a.groundTga  map_ground_types
 * @param {{W:number,H:number,raw:Buffer|Uint8Array}} a.regionTga   map_regions
 * @param {Object<string,string>} a.colToRegion  "r,g,b" → region name
 * @returns {{byRegion:Object, world:object, unknownColours:Array}|null}
 */
function regionTerrain({ groundTga, regionTga, colToRegion } = {}) {
  if (!groundTga || !regionTga || !colToRegion) return null;
  const { W: gW, H: gH, raw: g } = groundTga;
  const { W: rW, H: rH, raw: r } = regionTga;
  if (!gW || !rW) return null;

  // ground → region pixel scale (2 for RIS; computed, not assumed)
  const sx = gW / rW, sy = gH / rH;

  const byRegion = Object.create(null);
  const unknown = new Map();

  for (let gy = 0; gy < gH; gy++) {
    const ry = Math.min(rH - 1, Math.floor(gy / sy));
    const rowR = ry * rW;
    const rowG = gy * gW;
    for (let gx = 0; gx < gW; gx++) {
      const gi = (rowG + gx) * 3;
      const key = g[gi + 2] + "," + g[gi + 1] + "," + g[gi];
      const t = GROUND_TYPES[key];
      if (!t) { unknown.set(key, (unknown.get(key) || 0) + 1); continue; }

      const rx = Math.min(rW - 1, Math.floor(gx / sx));
      const ri = (rowR + rx) * 3;
      const region = colToRegion[r[ri + 2] + "," + r[ri + 1] + "," + r[ri]];
      if (!region) continue;

      let e = byRegion[region];
      if (!e) e = byRegion[region] = { region, px: 0, land: 0, easy: 0, rough: 0, impassable: 0, sea: 0, byType: {} };
      e.px++;
      e.byType[t.name] = (e.byType[t.name] || 0) + 1;
      if (t.cls === "sea") { e.sea++; continue; }
      e.land++;
      e[t.cls]++;
    }
  }

  // percentages of LAND, since sea pixels inside a coastal region's box say
  // nothing about whether an army can cross it
  for (const e of Object.values(byRegion)) {
    e.impassablePct = e.land ? +(e.impassable / e.land * 100).toFixed(1) : 0;
    e.roughPct = e.land ? +(e.rough / e.land * 100).toFixed(1) : 0;
    e.easyPct = e.land ? +(e.easy / e.land * 100).toFixed(1) : 0;
    e.seaPct = e.px ? +(e.sea / e.px * 100).toFixed(1) : 0;
    // One 0–100 score for "how hard is this ground to cross": impassable ground
    // weighs full, rough ground half. Kept inside 0–100 deliberately — an
    // earlier version let it reach 190%, which reads like a broken number.
    e.difficulty = e.land ? +((e.rough * 0.5 + e.impassable) / e.land * 100).toFixed(1) : 0;
    // dominant land type, for a human-readable label
    let top = null, topN = -1;
    for (const [n, c] of Object.entries(e.byType)) {
      const t = Object.values(GROUND_TYPES).find((x) => x.name === n);
      if (!t || t.cls === "sea") continue;
      if (c > topN) { topN = c; top = n; }
    }
    e.dominant = top;
  }

  const land = Object.values(byRegion).filter((e) => e.land > 0);
  const med = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const world = {
    regions: land.length,
    medianDifficulty: med(land.map((e) => e.difficulty)),
    medianImpassablePct: med(land.map((e) => e.impassablePct)),
    medianRoughPct: med(land.map((e) => e.roughPct)),
    groundPx: gW * gH,
    scale: sx,
  };
  return {
    byRegion, world,
    unknownColours: [...unknown.entries()].map(([k, n]) => ({ colour: k, px: n })).sort((a, b) => b.px - a.px),
  };
}

// ── LAND REACHABILITY ───────────────────────────────────────────────────────
// Terrain composition alone only supports a hedge ("may be failing on the
// ground"). Flood-filling the WALKABLE pixels into connected components turns it
// into a fact: if the ordering faction's territory and the target share no land
// component, an army cannot walk there, full stop.
//
// VALIDATED against geography we already know, before anything was built on it.
// On the RIS map the fill yields 2,176 components over 1,919,994 walkable pixels,
// and they line up with the real world: one continental mass of 1,017 regions
// containing Roma, Etruria, Arvernia and Aeduia; Britain its own 45-region
// component; Ireland 5; Sicily 16; Crete 11; Cyprus 5; Sardinia/Corsica, Euboia
// and Scandinavia each separate. Chios — the reference log's champion stuck
// mission, ordered to Erythrai in 50 of 51 turns — is its own island component,
// and Erythrai sits in mainland Mimas. That order never had a land route.
//
// Passability comes from GROUND_TYPES: `easy` and `rough` walk, `impassable`
// (high mountains, dense forest) and `sea` do not. 4-connected, because diagonal
// leaks would join landmasses across a single touching corner.
function landComponents({ groundTga, regionTga, colToRegion, minShare = 0.05, minPx = 20 } = {}) {
  if (!groundTga || !regionTga || !colToRegion) return null;
  const { W, H, raw: g } = groundTga;
  const { W: rW, H: rH, raw: r } = regionTga;
  const N = W * H;

  const walkable = new Uint8Array(N);
  let walkPx = 0;
  for (let i = 0, p = 0; i < N; i++, p += 3) {
    const t = GROUND_TYPES[g[p + 2] + "," + g[p + 1] + "," + g[p]];
    if (t && (t.cls === "easy" || t.cls === "rough")) { walkable[i] = 1; walkPx++; }
  }

  // explicit stack — a recursive fill on ~1.9M pixels overflows
  const comp = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let nComp = 0;
  for (let s = 0; s < N; s++) {
    if (!walkable[s] || comp[s] !== -1) continue;
    const id = nComp++;
    let sp = 0;
    stack[sp++] = s; comp[s] = id;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % W, y = (i - x) / W;
      if (x > 0 && walkable[i - 1] && comp[i - 1] === -1) { comp[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && walkable[i + 1] && comp[i + 1] === -1) { comp[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && walkable[i - W] && comp[i - W] === -1) { comp[i - W] = id; stack[sp++] = i - W; }
      if (y < H - 1 && walkable[i + W] && comp[i + W] === -1) { comp[i + W] = id; stack[sp++] = i + W; }
    }
  }

  // region → { compId: pixels }
  const sx = W / rW, sy = H / rH;
  const perRegion = new Map();
  for (let gy = 0; gy < H; gy++) {
    const ry = Math.min(rH - 1, Math.floor(gy / sy));
    const rowR = ry * rW, rowG = gy * W;
    for (let gx = 0; gx < W; gx++) {
      const c = comp[rowG + gx];
      if (c < 0) continue;
      const ri = (rowR + Math.min(rW - 1, Math.floor(gx / sx))) * 3;
      const reg = colToRegion[r[ri + 2] + "," + r[ri + 1] + "," + r[ri]];
      if (!reg) continue;
      let m = perRegion.get(reg);
      if (!m) perRegion.set(reg, m = new Map());
      m.set(c, (m.get(c) || 0) + 1);
    }
  }

  // A region can legitimately straddle two components (land either side of an
  // impassable ridge). Keep every component it holds a real share of, so a
  // sliver of border bleed can't fabricate a connection — and so a genuine
  // two-sided region isn't wrongly reported as unreachable.
  const compsOfRegion = Object.create(null);
  const mainOfRegion = Object.create(null);
  for (const [reg, m] of perRegion) {
    let total = 0, best = -1, bestN = -1;
    for (const [c, n] of m) { total += n; if (n > bestN) { bestN = n; best = c; } }
    const keep = [];
    for (const [c, n] of m) if (n >= minPx || n / total >= minShare) keep.push(c);
    compsOfRegion[reg] = keep.length ? keep : [best];
    mainOfRegion[reg] = best;
  }

  // the continental mass = the component holding the most regions
  const regionsPerComp = new Map();
  for (const c of Object.values(mainOfRegion)) regionsPerComp.set(c, (regionsPerComp.get(c) || 0) + 1);
  let mainland = null, mn = -1;
  for (const [c, n] of regionsPerComp) if (n > mn) { mn = n; mainland = c; }

  return {
    compsOfRegion, mainOfRegion, mainland,
    mainlandRegions: mn,
    components: nComp,
    walkablePx: walkPx,
    regionsWithLand: perRegion.size,
  };
}

/**
 * Definitive land-route verdicts for movement findings.
 *
 * FALSIFICATION, and why the obvious version of it does not work.
 * ---------------------------------------------------------------
 * The first version of this checked "does the save show the faction already
 * holding the region we call unreachable?" — which can NEVER fire: owning a
 * region puts its component into that faction's own home set, so the overlap
 * test passes before the check is ever reached. It was dead code dressed up as a
 * safety property, which is worse than having none.
 *
 * The check that DOES fire uses an independent signal — where the faction's
 * UNITS are, which is not what the home set is built from. For a faction the
 * save says owns no ships, a unit standing in a region that shares no walkable
 * land with any of its settlements is a genuine contradiction: it could neither
 * walk nor sail there. That faction is then excluded from verdicts, rather than
 * poisoning the whole run — the model can be wrong about one strait without
 * being wrong about Britain.
 */
function reachabilityVerdicts({
  findings = [], components = null, ownerByCity = null,
  regionOfSettlement = null, navalByFaction = null, unitsByFactionRegion = null,
} = {}) {
  if (!components || !ownerByCity) return { verdicts: 0, reliable: null, contradictions: [], leads: [], excluded: [] };
  const { compsOfRegion } = components;
  const regionOf = (name) => (compsOfRegion[name] ? name : (regionOfSettlement && regionOfSettlement[name]) || null);

  // faction → set of land components it can start from (built from SETTLEMENTS)
  const homeComps = new Map();
  for (const [city, fx] of Object.entries(ownerByCity)) {
    const f = String(fx || "?").toLowerCase();
    const reg = regionOf(city);
    if (!reg) continue;
    let s = homeComps.get(f);
    if (!s) homeComps.set(f, s = new Set());
    for (const c of compsOfRegion[reg] || []) s.add(c);
  }

  // ── the falsifier: units somewhere a no-navy faction could not have got to ──
  const contradictions = [];
  const excluded = new Set();
  if (unitsByFactionRegion) {
    for (const [fac, byRegion] of Object.entries(unitsByFactionRegion)) {
      const f = String(fac || "?").toLowerCase();
      const ships = navalByFaction ? (navalByFaction[f] || 0) : 0;
      if (ships > 0) continue;                 // could have sailed — proves nothing
      const home = homeComps.get(f);
      if (!home || !home.size) continue;
      for (const regName of Object.keys(byRegion || {})) {
        const reg = regionOf(regName);
        const cs = reg ? compsOfRegion[reg] : null;
        if (!cs || !cs.length) continue;
        if (!cs.some((c) => home.has(c))) {
          contradictions.push({ faction: f, region: reg, why: "has units there but no ships and no land route" });
          excluded.add(f);
        }
      }
    }
  }

  const candidates = [];
  for (const f of findings) {
    if (!MOVEMENT_KINDS.has(f.kind) || !f.region) continue;
    const fac = String(f.faction || "?").toLowerCase();
    if (fac === "?") continue;                 // no faction named → nothing to test
    if (excluded.has(fac)) continue;           // model disproved for this faction
    const home = homeComps.get(fac);
    const targetReg = regionOf(f.region);
    if (!home || !home.size || !targetReg) continue;
    const tComps = compsOfRegion[targetReg] || [];
    if (!tComps.length) continue;
    if (tComps.some((c) => home.has(c))) continue;
    candidates.push({ f, fac, targetReg });
  }

  const perFaction = new Map();
  for (const { f, fac, targetReg } of candidates) {
    const ships = navalByFaction ? (navalByFaction[fac] || 0) : null;
    f.noLandRoute = true;
    f.verdict = `NO LAND ROUTE — ${targetReg} shares no walkable land with any of ${fac}'s settlements` +
      (ships === null ? "" : ships > 0 ? `; it has ${ships} ship(s), so this needs a transport` : "; and it has no ships");
    let e = perFaction.get(fac);
    if (!e) perFaction.set(fac, e = { faction: fac, hits: 0, regions: new Set(), ships });
    e.hits++; e.regions.add(targetReg);
  }

  const leads = [];
  for (const e of perFaction.values()) {
    const regs = [...e.regions];
    leads.push({
      severity: 3,
      faction: e.faction,
      file: e.ships ? "descr_strat.txt" : "export_descr_unit.txt + descr_strat.txt",
      key: regs.slice(0, 3).join(", ") + (regs.length > 3 ? ` +${regs.length - 3}` : ""),
      issue:
        `${e.hits} move order(s) to ${regs.length} region(s) an army CANNOT WALK TO — no shared walkable land with any settlement this faction owns` +
        (e.ships ? `` : `, and it has no ships to carry them`),
      suggestion: e.ships
        ? `it owns ${e.ships} ship(s) but the army never embarks — check it has a transport in range, or give it a starting fleet near these objectives in descr_strat.txt`
        : `either give this faction a navy (a starting transport in descr_strat.txt, and a ship type it may own in export_descr_unit.txt) or it will re-issue these orders forever`,
      evidence: `verified against the save: the faction holds none of ${regs.slice(0, 6).join(", ")}, and none share a land component with its territory`,
    });
  }
  leads.sort((a, b) => b.severity - a.severity);
  return {
    verdicts: candidates.length,
    // "reliable" is now per-faction rather than all-or-nothing: it reports
    // whether the model survived everywhere it could be tested.
    reliable: contradictions.length === 0,
    contradictions,
    excluded: [...excluded],
    leads,
  };
}

// The finding kinds whose failure mode terrain can plausibly explain: an order
// that keeps being re-issued, a target never reached, a campaign that never
// launches at a particular place. Deliberately NOT the economic/political ones —
// terrain has nothing to say about war spam or garrison stripping.
const MOVEMENT_KINDS = new Set(["stuck", "stuck_mission", "never_arrives", "oscillation", "campaign_stall", "aborted_hotspot"]);

/**
 * Annotate movement findings with their target region's terrain, and emit leads
 * where a faction's failures cluster on hard ground.
 *
 * Thresholds are relative to the MAP's own medians, not absolute numbers, so
 * this works on any mod's map rather than being tuned to RIS.
 */
// `minLandPx` exists because a third of the RIS map's regions are tiny: 471 of
// 1,311 have under 200 land pixels, and "94.9% impassable" measured over 98
// pixels is a true statement about the file but weak evidence about an army's
// route. Findings are still ANNOTATED for every region — only lead emission is
// gated, and the pixel count is always shown so the reader can judge.
// `regionOfSettlement` matters more than it looks: the campaign_ai log names a
// SETTLEMENT as a mission target ("moving towards sett 'Erythrai'"), while this
// terrain map is keyed by REGION. Without the translation only the handful of
// findings whose target happens to share its region's name resolve — 15 of 6,399
// on the reference log.
function terrainLeads({ findings = [], terrain = null, minFindings = 3, minLandPx = 300, regionOfSettlement = null } = {}) {
  if (!terrain || !terrain.byRegion) return { leads: [], annotated: 0 };
  const { byRegion, world } = terrain;
  const resolve = (name) => {
    if (!name) return null;
    if (byRegion[name]) return byRegion[name];             // already a region
    const reg = regionOfSettlement && regionOfSettlement[name];
    return reg ? byRegion[reg] || null : null;
  };
  // "hard" = clearly worse than the median region on this map. Relative to the
  // map's own median, so this works on any mod rather than being tuned to RIS.
  const hardCut = Math.min(90, Math.max(20, (world.medianDifficulty || 0) * 1.6));
  const perFaction = new Map();
  let annotated = 0;

  for (const f of findings) {
    if (!MOVEMENT_KINDS.has(f.kind) || !f.region) continue;
    const t = resolve(f.region);
    if (!t || !t.land) continue;
    // attach the facts to the finding itself, so the Findings list can show them
    f.terrain = {
      dominant: t.dominant, difficulty: t.difficulty,
      impassablePct: t.impassablePct, roughPct: t.roughPct,
    };
    annotated++;
    if (t.difficulty < hardCut || t.land < minLandPx) continue;
    const k = String(f.faction || "?").toLowerCase();
    let e = perFaction.get(k);
    if (!e) perFaction.set(k, e = { faction: k, hits: 0, regions: new Map() });
    e.hits++;
    e.regions.set(f.region, t);
  }

  const leads = [];
  for (const e of perFaction.values()) {
    if (e.hits < minFindings) continue;
    const worst = [...e.regions.values()].sort((a, b) => b.difficulty - a.difficulty);
    const names = worst.slice(0, 4).map((t) =>
      `${t.region}: ${t.difficulty}% hard, ${t.impassablePct}% impassable, mostly ${t.dominant} (${t.land.toLocaleString()} land px)`);
    // Some log lines name a region but not the faction behind the order
    // (`campaign for region 'N' aborted …`). Those still aggregate into useful
    // signal, but calling the bucket a faction would be a lie — so it is labelled
    // for what it is rather than shown as "?".
    const unattributed = e.faction === "?";
    leads.push({
      severity: 2,
      faction: unattributed ? "all (faction not named in the log)" : e.faction,
      file: "map_ground_types.tga",
      key: worst.map((t) => t.region).slice(0, 3).join(", ") + (worst.length > 3 ? ` +${worst.length - 3}` : ""),
      issue:
        `${e.hits} failed move order(s) across ${e.regions.size} region(s) whose ground is far harder than this map's median ` +
        `(difficulty ${worst[0].difficulty}% vs median ${world.medianDifficulty}%) — the orders may be failing on the terrain rather than on strength`,
      suggestion:
        `check these regions are actually crossable from this faction's territory. High mountains and dense forest are impassable, ` +
        `so a corridor of them turns a short-looking order into an impossible one. Either open a pass in map_ground_types.tga, ` +
        `or accept that this faction needs ships / a different objective.`,
      evidence: names.join(" · "),
    });
  }
  leads.sort((a, b) => b.severity - a.severity || b.issue.length - a.issue.length);
  return { leads, annotated };
}

module.exports = { regionTerrain, terrainLeads, landComponents, reachabilityVerdicts, GROUND_TYPES, MOVEMENT_KINDS };
