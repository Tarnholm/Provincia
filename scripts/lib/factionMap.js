/**
 * The faction territory map for the wiki, drawn the way Provincia's own faction map mode
 * draws it: every faction in the colour it declares for itself, the subject faction picked
 * out in red, region boundaries as thin dark lines, a settlement dot in every region, and
 * sea in blue.
 *
 * WHY THIS REPLACED THE OLD RENDERER. The old maps painted the subject's regions red and
 * every other land pixel one flat grey, with sea indistinguishable from land. They showed
 * WHERE a faction is and nothing about what is around it — no neighbours, no coastline, no
 * cities. This one answers "who is next to me" as well as "where am I".
 *
 * ONE SCALE, ONE SIZE, FOR ALL OF THEM. Every map is a WINDOW of exactly WIN_W x WIN_H
 * source pixels at 1:1 — no per-faction scaling — so two faction pages are directly
 * comparable and a one-province faction LOOKS small beside Rome. The window is centred on
 * the faction's own territory and clamped inside the map, so each faction sits in the
 * middle of its own picture. WIN_W/WIN_H are sized from the data, not guessed: see the
 * constants below.
 *
 * THE TGA TRAPS, all of which have cost a blank or garbage map before:
 *   - read map_regions.tga as BINARY. Through a latin1 string the decode silently yields
 *     nothing.
 *   - pixels are stored BGR while descr_regions states colours as R G B, so matching in
 *     RGB order finds ZERO pixels.
 *   - rows are stored bottom-up unless bit 5 of the image descriptor is set.
 * All three are handled once, here, at load time; everything downstream is top-down RGB.
 *
 * SETTLEMENT POSITIONS ARE IN THE TGA, not in descr_strat. descr_strat carries CHARACTER
 * coordinates (`x 285, y 404`), not settlement ones; the settlement itself is the single
 * BLACK pixel the region map paints inside each region. There are 1,311 black pixels and
 * 1,311 regions, one each, and Roma's black pixel sits at exactly (285, 404) — the same
 * coordinate descr_strat gives Rome's governor. That is the cross-check that says the two
 * conventions agree: descr_strat's y indexes the TGA storage row directly, because RTW
 * counts y from the bottom and the TGA is stored bottom-up, and the two flips cancel.
 */
const fs = require("fs");
const path = require("path");
const { png } = require("./tgaPng.js");

// ── window size ──────────────────────────────────────────────────────────────
// Established from the data rather than chosen: the widest faction territory at turn 0 is
// the Seleucids' at 484 px across, and the tallest is the Ptolemies' at 359 px down (the
// rebel faction `slave` spans the whole map but gets no wiki page). The window is exactly
// 60% of the 1020x700 map, which preserves the map's aspect ratio exactly and clears the
// widest by 128 px and the tallest by 61 px. Anything smaller would crop the Seleucids;
// anything much larger and centring stops buying anything, because the window would be
// most of the map for everybody.
const WIN_W = 612;
const WIN_H = 420;

// ── palette ──────────────────────────────────────────────────────────────────
const SEA = [36, 80, 126];            // Mediterranean blue
const COAST = [18, 42, 70];           // one dark pixel of sea against the shore
// Region boundaries DARKEN what is under them rather than replacing it. RIS regions are
// small — Rome's 26 provinces are 1,348 map pixels between them and Cyzicus is 9 — so an
// outline painted as a solid colour ate 40% of a small region and turned the subject's red
// into a grey smear. Multiplying keeps the boundary as a thin dark line while the region it
// bounds keeps its colour.
const OUTLINE_MUL = 0.4;
const NO_OWNER = [92, 88, 78];        // land no faction claims in descr_strat
const SUBJECT = [214, 46, 38];        // the faction the page is about
const HALO_IN = [255, 240, 205];      // pale ring immediately outside the subject
const HALO_OUT = [46, 36, 22];        // dark ring outside that, so the pale ring reads
const DOT_RIM = [22, 20, 18];
const DOT_CORE = [244, 238, 222];
const BRACKET = [255, 240, 205];

// Other factions keep their own declared colour, pulled 32% toward its own grey. The hue is
// still theirs and 238 of the 239 declared colours are distinct, but the subject's fully
// saturated red is then the only fully saturated thing on the map — which matters, because
// 15 factions (Rome among them) declare a red-ish primary of their own and would otherwise
// be mistaken for the subject.
// They are also held below a lightness CEILING. Carthage declares pure white (255,255,255)
// and the Ptolemies near-white yellow, and at full strength a white province out-shouted
// both the subject's red and the pale ring drawn round it — the brightest thing on the map
// has to be the highlight, not a bystander. The ceiling scales the whole triple, so the hue
// survives: Carthage becomes a very light grey, still the lightest faction on the map.
// DIMMED HARD, because tone is now the only thing separating the subject from its neighbours —
// the corner brackets that used to do that job are gone. Every other faction keeps enough of
// its own hue to be told apart from the one beside it, but none of them competes with the
// subject: two thirds of the way to grey, then scaled toward a ceiling well below full
// brightness. Before this, at a third of the way to grey and a ceiling of 210, a pale
// neighbour was as loud as the faction the page was about.
const DESAT = 0.66;
const LIGHT_CAP = 150;
const DARKEN = 0.82;
function muted([r, g, b]) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mix = (c) => c + (y - c) * DESAT;
  let [mr, mg, mb] = [mix(r) * DARKEN, mix(g) * DARKEN, mix(b) * DARKEN];
  const top = Math.max(mr, mg, mb);
  if (top > LIGHT_CAP) { const k = LIGHT_CAP / top; mr *= k; mg *= k; mb *= k; }
  return [Math.round(mr), Math.round(mg), Math.round(mb)];
}

/**
 * Read the region map, descr_regions, descr_sm_factions and descr_strat once and return
 * everything the renderer needs, in top-down display coordinates.
 *
 * `dg` is src/descrStratGeneral.js and `parsers` is src/parsers.js, passed in so this file
 * does not reach across the repo for them.
 */
function loadWorld({ risDir, dg, parsers, strat }) {
  const base = path.join(risDir, "world", "maps", "base");
  const t = dg.tgaToRaw(fs.readFileSync(path.join(base, "map_regions.tga")));
  if (!t || !t.W || !t.raw) return null;
  const W = t.W, H = t.H, bottomUp = !(t.desc & 0x20);
  const dr = dg.parseDescrRegions(fs.readFileSync(path.join(base, "descr_regions.txt"), "latin1"));

  const names = [], idxOf = new Map();
  for (const key of Object.keys(dr.rgbToRegion)) {
    const n = dr.rgbToRegion[key];
    if (!idxOf.has(n)) { idxOf.set(n, names.length); names.push(n); }
  }
  const byColour = new Map();
  for (const [key, n] of Object.entries(dr.rgbToRegion)) byColour.set(key, idxOf.get(n));

  // regionAt[y*W+x] = region index, or -1 for anything that is not a region: that is the
  // definition of sea here, and it is the only honest one — the region map paints 9 colours
  // that no region claims (7 shades of the sea blue it uses, plus black settlement pixels
  // and white), so testing for one nominal "sea colour" misses 99% of the water.
  const regionAt = new Int16Array(W * H).fill(-1);
  const settleXY = new Array(names.length).fill(null);
  const bbox = names.map(() => null);
  const black = [];
  for (let sy = 0; sy < H; sy++) {
    const dy = bottomUp ? H - 1 - sy : sy;
    for (let x = 0; x < W; x++) {
      const i = (sy * W + x) * 3;
      const b = t.raw[i], g = t.raw[i + 1], r = t.raw[i + 2];
      if (r === 0 && g === 0 && b === 0) { black.push([x, dy]); continue; }
      const ri = byColour.get(`${r},${g},${b}`);
      if (ri === undefined) continue;
      regionAt[dy * W + x] = ri;
      const e = bbox[ri];
      if (!e) bbox[ri] = { x0: x, x1: x, y0: dy, y1: dy, n: 1 };
      else {
        if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
        if (dy < e.y0) e.y0 = dy; if (dy > e.y1) e.y1 = dy; e.n++;
      }
    }
  }
  // Each black pixel is a settlement; which region it belongs to is decided by a majority
  // vote over its 8 neighbours, because a settlement pixel sitting on a region border would
  // otherwise be handed to the neighbour (the same trap descrStratGeneral.buildRegionCoords
  // documents, where a governor ended up bound to a town 15 tiles away).
  const voteScore = new Array(names.length).fill(0);
  for (const [x, y] of black) {
    const votes = new Map();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ri = regionAt[ny * W + nx];
      if (ri < 0) continue;
      votes.set(ri, (votes.get(ri) || 0) + 1);
    }
    let best = -1, bestN = 0;
    for (const [ri, n] of votes) if (n > bestN) { bestN = n; best = ri; }
    if (best >= 0 && bestN > voteScore[best]) { voteScore[best] = bestN; settleXY[best] = { x, y }; }
  }

  // Ownership at turn 0. growthEval.parseStrat returns faction -> {settlements:[{region,…}]},
  // which is a list of holdings and NOT an ownership map, so it is inverted here.
  const factions = [], facIdx = new Map();
  const ownerOf = new Int16Array(names.length).fill(-1);
  let claimed = 0, doubleClaimed = 0, unknownRegion = 0;
  for (const [f, d] of Object.entries(strat)) {
    if (!facIdx.has(f)) { facIdx.set(f, factions.length); factions.push(f); }
    for (const s of d.settlements || []) {
      const ri = idxOf.get(s.region);
      if (ri === undefined) { unknownRegion++; continue; }
      if (ownerOf[ri] >= 0) { doubleClaimed++; continue; }   // first block wins, as the game reads it
      ownerOf[ri] = facIdx.get(f); claimed++;
    }
  }

  const sm = parsers.parseSmFactions(fs.readFileSync(path.join(risDir, "descr_sm_factions.txt"), "latin1"));
  const colour = new Array(factions.length).fill(null);
  const noColour = [];
  for (let i = 0; i < factions.length; i++) {
    const c = sm[factions[i]] && sm[factions[i]].primary;
    if (c) colour[i] = muted(c); else noColour.push(factions[i]);
  }

  return {
    W, H, regionAt, names, idxOf, bbox, settleXY,
    factions, facIdx, ownerOf, colour, noColour,
    stats: { regions: names.length, settlements: black.length, placed: settleXY.filter(Boolean).length,
      claimed, doubleClaimed, unknownRegion, colours: colour.filter(Boolean).length },
  };
}

/**
 * The window for one faction: WIN_W x WIN_H, centred on the bounding box of its territory
 * and clamped inside the map. A faction at the map's edge cannot be centred without the
 * window hanging off, so the window keeps its size and simply stops sliding — `clamped`
 * records that it had to.
 */
function windowFor(world, regionNames) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
  for (const r of regionNames) {
    const ri = world.idxOf.get(r);
    if (ri === undefined) continue;
    const e = world.bbox[ri];
    if (!e) continue;
    if (e.x0 < x0) x0 = e.x0; if (e.x1 > x1) x1 = e.x1;
    if (e.y0 < y0) y0 = e.y0; if (e.y1 > y1) y1 = e.y1;
    n++;
  }
  if (!n) return null;
  const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
  const wantX = cx - Math.floor(WIN_W / 2), wantY = cy - Math.floor(WIN_H / 2);
  const ox = Math.max(0, Math.min(world.W - WIN_W, wantX));
  const oy = Math.max(0, Math.min(world.H - WIN_H, wantY));
  return {
    ox, oy, w: WIN_W, h: WIN_H,
    clamped: ox !== wantX || oy !== wantY,
    fits: (x1 - x0 + 1) <= WIN_W && (y1 - y0 + 1) <= WIN_H,
    terr: { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 },
  };
}

/** Render one faction's map. Returns { buf, w, h, counts } or null. */
function render(world, faction, regionNames) {
  const win = windowFor(world, regionNames);
  if (!win) return null;
  const { W, H, regionAt, ownerOf, colour } = world;
  const { ox, oy, w, h } = win;
  const fi = world.facIdx.has(faction) ? world.facIdx.get(faction) : -1;

  const mine = new Set();
  for (const r of regionNames) { const ri = world.idxOf.get(r); if (ri !== undefined) mine.add(ri); }

  const out = Buffer.alloc(w * h * 3);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 3;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  };
  const regAt = (sx, sy) => (sx < 0 || sy < 0 || sx >= W || sy >= H ? -1 : regionAt[sy * W + sx]);

  // Pass 1 — sea, land, ownership, boundaries, coastline.
  let seaPx = 0, subjectPx = 0, ownedPx = 0, edgePx = 0, coastPx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = ox + x, sy = oy + y;
      const ri = regAt(sx, sy);
      if (ri < 0) {
        // Sea. A sea pixel touching land is drawn darker, which is what gives the map a
        // readable coastline without drawing one.
        const touchesLand = regAt(sx + 1, sy) >= 0 || regAt(sx - 1, sy) >= 0 ||
                            regAt(sx, sy + 1) >= 0 || regAt(sx, sy - 1) >= 0;
        if (touchesLand) { put(x, y, COAST); coastPx++; } else { put(x, y, SEA); seaPx++; }
        continue;
      }
      let c;
      if (mine.has(ri)) { c = SUBJECT; subjectPx++; }
      else {
        const o = ownerOf[ri];
        c = (o >= 0 && colour[o]) || NO_OWNER;
        if (o >= 0 && colour[o]) ownedPx++;
      }
      const right = regAt(sx + 1, sy), down = regAt(sx, sy + 1);
      if ((right >= 0 && right !== ri) || (down >= 0 && down !== ri)) {
        c = [Math.round(c[0] * OUTLINE_MUL), Math.round(c[1] * OUTLINE_MUL), Math.round(c[2] * OUTLINE_MUL)];
        edgePx++;
      }
      put(x, y, c);
    }
  }

  // Pass 2 — a two-pixel halo around the subject's territory, so a one-province faction is
  // still findable at a zoom that has to fit the Seleucids. Drawn OUTSIDE the territory so
  // it never eats the red.
  const isMine = (sx, sy) => { const ri = regAt(sx, sy); return ri >= 0 && mine.has(ri); };
  let haloPx = 0;
  for (const [ring, col] of [[1, HALO_IN], [2, HALO_OUT]]) {
    const hits = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = ox + x, sy = oy + y;
        if (isMine(sx, sy)) continue;
        let near = false;
        for (let dy = -ring; dy <= ring && !near; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            if (isMine(sx + dx, sy + dy)) { near = true; break; }
          }
        }
        if (!near) continue;
        // Ring 2 must not overwrite ring 1.
        if (ring === 2) {
          let inner = false;
          for (let dy = -1; dy <= 1 && !inner; dy++) for (let dx = -1; dx <= 1; dx++) if (isMine(sx + dx, sy + dy)) inner = true;
          if (inner) continue;
        }
        hits.push([x, y]);
      }
    }
    for (const [x, y] of hits) { put(x, y, col); haloPx++; }
  }

  // No corner brackets. They were drawn on every map to make a one-province faction findable,
  // and they did that — but a box floating over the Mediterranean is a diagram annotation, not
  // part of the map, and on a large faction it fenced off territory for no reason. The subject
  // is now separated from its surroundings by TONE instead: everything that is not the subject
  // is pushed well down (see DESAT/LIGHT_CAP above), so the only saturated thing on the map is
  // the faction the page is about, and its pale halo is the only bright edge.
  const bracketPx = 0;

  // Pass 4 — a settlement dot in every region the window shows, from the region map's own
  // black pixels. FIVE PIXELS, a pale centre with four dark arms, and the same size for the
  // subject as for everyone else. A larger dot for the subject was tried and had to go: RIS
  // regions are tiny (Rome's 26 provinces are 1,348 map pixels between them), so a 25-pixel
  // dot per town spent 650 of Rome's 1,348 red pixels on its own city markers and the
  // territory read as speckle. The subject is already told apart by its red, its halo and
  // its corner marks; its cities do not also have to be bigger.
  //
  // DRAWN LAST, on purpose. Drawn before the halo, a town in a neighbouring region hard up
  // against the subject's border had its dot painted over by the halo ring — one of the 215
  // maps lost a dot that way, which the decode-and-assert check caught.
  let dots = 0, myDots = 0;
  for (let ri = 0; ri < world.settleXY.length; ri++) {
    const p = world.settleXY[ri];
    if (!p) continue;
    const x = p.x - ox, y = p.y - oy;
    if (x < -1 || y < -1 || x > w || y > h) continue;
    put(x - 1, y, DOT_RIM); put(x + 1, y, DOT_RIM); put(x, y - 1, DOT_RIM); put(x, y + 1, DOT_RIM);
    put(x, y, DOT_CORE);
    dots++; if (mine.has(ri)) myDots++;
  }

  return {
    buf: png(w, h, out), w, h, win,
    counts: { subjectPx, ownedPx, seaPx, coastPx, edgePx, haloPx, dots, myDots, bracketPx, factionColour: fi >= 0 && colour[fi] ? colour[fi] : null },
  };
}

module.exports = { loadWorld, render, windowFor, WIN_W, WIN_H, SEA, COAST, SUBJECT, OUTLINE_MUL, NO_OWNER, HALO_IN, HALO_OUT, DOT_CORE, DOT_RIM, BRACKET, muted };
