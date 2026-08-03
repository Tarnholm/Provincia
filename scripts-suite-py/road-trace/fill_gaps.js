// fill_gaps.js — close the last coverage gaps between the game's own
// ROAD_MANAGER network (master_mgr.json) and the shipped bake (src/risRoads.js).
//
// WHY: the v1383 mask bake reproduces 62,388 of the engine's 62,939 waypoints
// (99.12%). The missing 551 sit in 230 short runs across 138 roads — pieces the
// mask/despike passes clipped away at junctions and chain ends. User wants the
// FULL network, so we emit the missing sub-runs as extra chains.
//
// HOW (replicate, never invent — the geometry comes from the engine's own
// waypoints and its documented render model):
//   • a waypoint is "covered" when a baked point lies within 1.6px of it
//   • each uncovered run is extended by ONE covered waypoint on each side so the
//     new piece physically overlaps the existing network (no dangling ends)
//   • tile -> display pixel = (sx + 0.5, (H-1-sy) + 0.5)   [convention verified
//     against baked chains: they start exactly on these coordinates]
//   • smoothing = the engine's road spline: per-node tangent = normalize(next-prev),
//     cubic Bezier with control arms = tangent * 0.33, 5 subdivisions per segment
//     (aerial_map_roads.cpp; DAT_141df6a00 = 0.33, DAT_141de0a9c = 5)
//   • every emitted point is region-tagged from map_regions (1px neighbourhood so
//     points sitting on black settlement / white port markers still resolve), and
//     consecutive same-region points merge into `s` runs so the app's per-province
//     clipping treats these chains exactly like the rest of the bake.
//
// Run: node scripts-suite-py/road-trace/fill_gaps.js [--write]
// Without --write it only reports. With --write it appends to src/risRoads.js.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MGR = "C:/dev/_research/master_mgr.json";
const BASE = "C:/RIS/RIS/data/world/maps/base";
const ROADS_JS = path.join(ROOT, "src", "risRoads.js");

const dg = require(path.join(ROOT, "src", "descrStratGeneral.js"));
const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(BASE, "descr_regions.txt"), "latin1"));
const rt = dg.tgaToRaw(fs.readFileSync(path.join(BASE, "map_regions.tga")));
const W = rt.W, H = rt.H, raw = rt.raw;

// region colour "r,g,b" at a DISPLAY-space pixel (raster is bottom-up).
const colAtDisplay = (dx, dy) => {
  const x = Math.round(dx), y = H - 1 - Math.round(dy);
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const a = x + ox, b = y + oy;
    if (a < 0 || b < 0 || a >= W || b >= H) continue;
    const o = (b * W + a) * 3;
    const k = raw[o + 2] + "," + raw[o + 1] + "," + raw[o];
    if (rgbToRegion[k]) return k;
  }
  return null;
};

const R = require(ROADS_JS.replace(/\\/g, "/"));
const bake = R.RIS_ROADS;

// spatial hash of baked points for the coverage test
const grid = new Map();
const gkey = (x, y) => ((x | 0) * 4096 + (y | 0));
for (const rd of bake) {
  const p = rd.p || [];
  for (let t = 0; t < p.length / 2; t++) {
    const k = gkey(p[2 * t], p[2 * t + 1]);
    let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
    a.push([p[2 * t], p[2 * t + 1]]);
  }
}
const covered = (x, y, r = 1.6) => { // r=1.6 for waypoints, 0.9 for segment midpoints
  const xi = x | 0, yi = y | 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = grid.get(gkey(xi + dx, yi + dy)); if (!a) continue;
    for (const [px, py] of a) { const ex = px - x, ey = py - y; if (ex * ex + ey * ey <= r * r) return true; }
  }
  return false;
};

const mgr = JSON.parse(fs.readFileSync(MGR, "utf8"));
const roads = mgr.roads || mgr;
const toDisp = (q) => [q[0] + 0.5, (H - 1 - q[1]) + 0.5];

// ── find gaps ─────────────────────────────────────────────────────────────────
// TWO kinds, and the second is the one that produces the "random lines" the user
// sees: (1) a WAYPOINT with no baked point near it, and (2) a SEGMENT whose
// midpoint has none — the two waypoints are present but the stroke between them
// is missing, so a continuous road renders as dashes and short spurs look like
// stubs floating in a province. Waypoint coverage alone cannot see (2): the bake
// hit 100% of waypoints while still breaking 570 segments.
let total = 0, cov = 0, mids = 0, midCov = 0;
const runs = [];
for (let ri = 0; ri < roads.length; ri++) {
  const w = roads[ri].w || [];
  const bad = new Array(w.length).fill(false);
  for (let i = 0; i < w.length; i++) {
    const [x, y] = toDisp(w[i]); total++;
    if (covered(x, y)) cov++; else { bad[i] = true; }
  }
  for (let i = 0; i + 1 < w.length; i++) {
    const [ax, ay] = toDisp(w[i]), [bx, by] = toDisp(w[i + 1]);
    mids++;
    if (covered((ax + bx) / 2, (ay + by) / 2, 0.9)) midCov++;
    else { bad[i] = true; bad[i + 1] = true; } // the STROKE is missing -> re-emit both ends
  }
  // A gap SPAN is the waypoint range that actually needs new geometry. Emitting
  // more than that draws a second line alongside the one already there — the
  // "duplicated roads" the user saw. So a span covers only bad waypoints plus
  // the two waypoints bracketing a bad segment, and its ENDS are later snapped
  // onto existing baked points rather than re-drawing whole covered stretches.
  let run = null;
  for (let i = 0; i < w.length; i++) {
    if (bad[i]) { if (!run) run = { road: ri, from: i, to: i }; else run.to = i; }
    else if (run) { runs.push(run); run = null; }
  }
  if (run) runs.push(run);
}
console.log(`manager waypoints ${total}, covered ${cov} (${(cov / total * 100).toFixed(2)}%)`);
console.log(`segment midpoints ${mids}, covered ${midCov} (${(midCov / mids * 100).toFixed(2)}%) — uncovered midpoints are the visible breaks`);
console.log(`-> ${runs.length} runs to re-emit`);

// ── emit a chain per uncovered run ────────────────────────────────────────────
// Engine spline: tangent_i = normalize(p[i+1] - p[i-1]); section i->i+1 is a
// cubic Bezier P0=p_i, P1=p_i + t_i*0.33, P2=p_{i+1} - t_{i+1}*0.33, P3=p_{i+1},
// evaluated at 5 subdivisions.
const ARM = 0.33, SUB = 5;
function spline(pts) {
  if (pts.length < 2) return pts.slice();
  const tan = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    return [tx / L, ty / L];
  });
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p3 = pts[i + 1];
    const seg = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const p1 = [p0[0] + tan[i][0] * ARM * seg, p0[1] + tan[i][1] * ARM * seg];
    const p2 = [p3[0] - tan[i + 1][0] * ARM * seg, p3[1] - tan[i + 1][1] * ARM * seg];
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// USER RULE: a road may never sit on a sea pixel. The Bezier can bow a coastal
// corner into the water, so clamp any such point to the nearest land pixel.
// PIXEL CONTAINMENT MUST USE floor(), NEVER round(): baked points sit at pixel
// CENTRES (x.5), so round() pushes a coastal point onto the NEIGHBOURING pixel
// and reports open water for a road that is correctly on land. With round() the
// shipped bake "had" 2543 sea points; with floor() it has 0. Getting this wrong
// both invents a defect and drags real geometry off the engine's own waypoints.
const isSeaDisp = (dx, dy) => {
  const x = Math.floor(dx), y = H - 1 - Math.floor(dy);
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const o = (y * W + x) * 3;
  return raw[o + 2] === 41 && raw[o + 1] === 140; // exact sea colour (a RANGE test matches region colours)
};
const toLand = ([dx, dy]) => {
  if (!isSeaDisp(dx, dy)) return [dx, dy];
  for (let r = 1; r <= 6; r++) {
    for (let ox = -r; ox <= r; ox++) for (let oy = -r; oy <= r; oy++) {
      if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
      const nx = dx + ox, ny = dy + oy;
      if (!isSeaDisp(nx, ny)) return [nx, ny];
    }
  }
  return [dx, dy];
};

// Nearest EXISTING baked point, so a gap-fill starts and ends exactly on the
// network instead of running beside it.
const nearestBaked = (x, y, r = 2.5) => {
  const xi = x | 0, yi = y | 0; let best = null, bd = r * r;
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    const a = grid.get(gkey(xi + dx, yi + dy)); if (!a) continue;
    for (const [px, py] of a) { const ex = px - x, ey = py - y; const d = ex * ex + ey * ey; if (d < bd) { bd = d; best = [px, py]; } }
  }
  return best;
};

// Emit ONLY what is actually missing. Build the engine's own curve for each
// affected road, then keep the contiguous stretches of it that no baked point
// covers. Re-emitting whole waypoint runs (the first attempt) redrew stretches
// that already existed, laying a second line beside the first — 27.8% of the
// emitted points were duplicates. Working on the CURVE and filtering by
// coverage takes that to ~0 by construction.
const affected = new Set(runs.map((r) => r.road));
const added = [];
for (const ri of affected) {
  const w = roads[ri].w || [];
  if (w.length < 2) continue;
  const curve = spline(w.map(toDisp)).map(toLand);
  const isCov = curve.map(([x, y]) => covered(x, y, 0.9));
  let i = 0;
  while (i < curve.length) {
    if (isCov[i]) { i++; continue; }
    let j = i; while (j + 1 < curve.length && !isCov[j + 1]) j++;
    // the missing stretch is curve[i..j]; snap both ends onto the network so it
    // joins without overlapping it
    const seg = curve.slice(i, j + 1);
    const a = nearestBaked(seg[0][0], seg[0][1]);
    const b = nearestBaked(seg[seg.length - 1][0], seg[seg.length - 1][1]);
    const pts2 = [];
    if (a) pts2.push(a);
    pts2.push(...seg);
    if (b) pts2.push(b);
    i = j + 1;
    if (pts2.length < 2) continue;
    emitChain(pts2);
  }
}
function emitChain(curve) {
  // region tags per point -> merged `s` runs
  const cols = curve.map(([x, y]) => colAtDisplay(x, y));
  const s = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i] || (s.length ? s[s.length - 1][1] : null);
    if (!s.length || s[s.length - 1][1] !== c) s.push([i, c]);
  }
  const flat = [];
  for (const [x, y] of curve) flat.push(+x.toFixed(2), +y.toFixed(2));
  added.push({
    a: cols.find(Boolean) || null,
    b: [...cols].reverse().find(Boolean) || null,
    s: s.filter((e) => e[1]),
    p: flat,
  });
}
console.log(`emitting ${added.length} gap-fill chains, ${added.reduce((n, e) => n + e.p.length / 2, 0)} points`);

// DUPLICATION GUARD: a gap-fill point that lands on top of geometry that already
// exists means we are drawing a second line over the first — exactly the
// artifact this pass is meant to avoid. Only the two snapped END points of each
// chain are allowed to coincide with the network.
let dup = 0, emitted = 0;
for (const e of added) {
  const n = e.p.length / 2;
  for (let t = 0; t < n; t++) {
    emitted++;
    if (t < 2 || t > n - 3) continue; // the joins are meant to touch
    if (covered(e.p[2 * t], e.p[2 * t + 1], 0.75)) dup++;
  }
}
console.log(`duplication check: ${dup} of ${emitted} new points land on existing road (${(dup / emitted * 100).toFixed(2)}%) — interior points only, joins excluded`);

if (!process.argv.includes("--write")) { console.log("(dry run — pass --write to patch src/risRoads.js)"); process.exit(0); }

const src = fs.readFileSync(ROADS_JS, "utf8");
// NOTE: this repo's files are CRLF — match the terminator with a tolerant regex,
// not a literal "\n];\n" string (that silently fails on \r\n).
const marker = /\r?\n\];\r?\nexport const CAPTURED_MAPS/;
const m = src.match(marker);
if (!m) throw new Error("could not find RIS_ROADS terminator");
const lines = added.map((e) => JSON.stringify(e)).join(",\n");
const patched = src.replace(marker, ",\n" + lines + m[0]);
fs.writeFileSync(ROADS_JS, patched);
console.log(`patched ${ROADS_JS}: +${added.length} chains`);
