// Sea-lane pathfinding (2026-07-18). The game routes sea trade with A* over the
// strategy-map grid (min-heap open list, heuristic = 0.5 × Euclidean distance
// to goal), so lanes hug coastlines and thread between islands instead of
// running straight. We reproduce that: A* over a sea-passability grid derived
// from the region map (a tile is passable "sea" when it belongs to no land
// region), uniform tile cost (1 orthogonal, √2 diagonal), same 0.5·dist
// heuristic. Grid is downsampled by `down` for tractability; paths scale back
// up for drawing.

// isLand(r,g,b) → true for land/settlement pixels (impassable for sea).
// A cell is "sea" when its CENTRE pixel is sea — so sea routes stay in real
// water and never path through coastal land (an "any sub-pixel" rule let lanes
// cut across peninsulas/islands; 2026-07-18).
export function buildSeaGrid(pixelData, W, H, isLand, down = 2) {
  const w = Math.ceil(W / down), h = Math.ceil(H / down);
  const grid = new Uint8Array(w * h); // 1 = sea (passable)
  const off = down >> 1;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const px = Math.min(W - 1, gx * down + off), py = Math.min(H - 1, gy * down + off);
      const i = (py * W + px) * 4;
      grid[gy * w + gx] = isLand(pixelData[i], pixelData[i + 1], pixelData[i + 2]) ? 0 : 1;
    }
  }
  return { grid, w, h, down };
}

// Nearest passable-sea cell to (x,y) within maxR rings (settlements sit on land;
// their lane must start at the adjacent coast/port tile).
export function nearestSea(sg, x, y, maxR = 60) {
  const { grid, w, h } = sg;
  const inb = (a, b) => a >= 0 && b >= 0 && a < w && b < h;
  if (inb(x, y) && grid[y * w + x]) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const nx = x + dx, ny = y + dy;
        if (inb(nx, ny) && grid[ny * w + nx]) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

// Label connected sea components using the SAME 8-neighbour + no-corner-cutting
// rule aStarSea navigates by, so two cells share a component id iff A* can path
// between them. Returns { comp:Int32Array(-1 for land), sizes:number[] }.
// Used to snap a port out of a tiny sealed pocket (a coastal port whose only
// water is a 1–3 cell diagonal pocket the corner rule walls off) onto real open
// water it can actually be routed from (2026-07-19, Caralis→Hippo Diarrhytus).
export function seaComponents(sg) {
  const { grid, w, h } = sg;
  const N = w * h;
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < N; s++) {
    if (!grid[s] || comp[s] !== -1) continue;
    const id = sizes.length; let cnt = 0;
    comp[s] = id; stack.push(s);
    while (stack.length) {
      const c = stack.pop(); cnt++;
      const cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of NB) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!grid[ni] || comp[ni] !== -1) continue;
        if (dx !== 0 && dy !== 0 && (!grid[cy * w + (cx + dx)] || !grid[(cy + dy) * w + cx])) continue;
        comp[ni] = id; stack.push(ni);
      }
    }
    sizes.push(cnt);
  }
  return { comp, sizes };
}

// Nearest sea cell to (x,y) that lives in a component of at least `minSize` cells
// — i.e. open water, not a sealed pocket. Falls back to null if none within maxR.
export function nearestSeaBig(sg, comp, sizes, x, y, minSize = 30, maxR = 80) {
  const { grid, w, h } = sg;
  const ok = (a, b) => a >= 0 && b >= 0 && a < w && b < h && grid[b * w + a] && sizes[comp[b * w + a]] >= minSize;
  if (ok(x, y)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        if (ok(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

// Land-passability grid (roads travel over land): a cell is passable when its
// CENTRE pixel is land (region or settlement). Sea is impassable — centre-pixel
// keeps roads on solid land instead of straying into coastal water.
export function buildLandGrid(pixelData, W, H, isLand, down = 2) {
  const w = Math.ceil(W / down), h = Math.ceil(H / down);
  const grid = new Uint8Array(w * h); // 1 = land (passable)
  const off = down >> 1;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const px = Math.min(W - 1, gx * down + off), py = Math.min(H - 1, gy * down + off);
      const i = (py * W + px) * 4;
      grid[gy * w + gx] = isLand(pixelData[i], pixelData[i + 1], pixelData[i + 2]) ? 1 : 0;
    }
  }
  return { grid, w, h, down };
}

// A* over a passability grid. Returns an array of {x,y} grid cells (start→goal)
// or null if unreachable within the cost cutoff. Optional `costArr`
// (Float32Array, length w*h) gives a per-cell traversal-cost multiplier — used
// for roads to make mountains expensive so paths thread through valleys/passes;
// omit (or all-1) for uniform cost (sea).
// Reusable scratch buffers keyed by grid size, with a per-call generation stamp
// so we never re-allocate or O(N)-clear between the hundreds of A* calls — this
// makes full-resolution (DOWN=1) routing tractable.
// JUMP offsets + cost for strait bridging (see `bridge` param below). Mirrors the
// game's own sea pathfinder (seaPortDistDepth), which hops a single land cell to
// cross a narrow strait (Gibraltar, the Dardanelles, the Kerch strait).
const JUMP = [[2, 0], [-2, 0], [0, 2], [0, -2]];
const BRIDGE_COST = 6;
let _scr = null;
// `bridge` (default off): when true, also allow a 2-cell orthogonal hop across a
// SINGLE non-sea cell at BRIDGE_COST — for narrow straits the grid pinches shut.
// Used only as a last-resort fallback so normal routes are never altered.
export function aStarSea(sg, start, goal, cutoff = 1700, costArr = null, bridge = false) {
  const { grid, w, h } = sg;
  const N = w * h;
  const si = start.y * w + start.x, gi = goal.y * w + goal.x;
  if (si < 0 || gi < 0 || si >= N || gi >= N || !grid[si] || !grid[gi]) return null;
  if (!_scr || _scr.N !== N) _scr = { N, g: new Float32Array(N), came: new Int32Array(N), seen: new Int32Array(N), closed: new Int32Array(N), gen: 0 };
  const gen = ++_scr.gen;
  const gScore = _scr.g, came = _scr.came, seen = _scr.seen, closed = _scr.closed;
  const gAt = (i) => (seen[i] === gen ? gScore[i] : Infinity); // Infinity when untouched this call
  gScore[si] = 0; seen[si] = gen; came[si] = -1;
  const heapF = []; const heapI = []; // parallel arrays: f-score, node index
  const push = (f, idx) => {
    heapF.push(f); heapI.push(idx); let c = heapF.length - 1;
    while (c > 0) { const p = (c - 1) >> 1; if (heapF[p] <= heapF[c]) break; [heapF[p], heapF[c]] = [heapF[c], heapF[p]]; [heapI[p], heapI[c]] = [heapI[c], heapI[p]]; c = p; }
  };
  const pop = () => {
    const idx = heapI[0]; const lf = heapF.pop(); const li = heapI.pop();
    if (heapF.length) {
      heapF[0] = lf; heapI[0] = li; let c = 0;
      for (;;) { let l = 2 * c + 1, r = l + 1, s = c; if (l < heapF.length && heapF[l] < heapF[s]) s = l; if (r < heapF.length && heapF[r] < heapF[s]) s = r; if (s === c) break; [heapF[s], heapF[c]] = [heapF[c], heapF[s]]; [heapI[s], heapI[c]] = [heapI[c], heapI[s]]; c = s; }
    }
    return idx;
  };
  const hOf = (x, y) => 0.5 * Math.hypot(goal.x - x, goal.y - y);
  push(hOf(start.x, start.y), si);
  while (heapF.length) {
    const ci = pop();
    if (closed[ci] === gen) continue;
    closed[ci] = gen;
    if (ci === gi) break;
    const cg = gScore[ci];
    if (cg > cutoff) continue;
    const cx = ci % w, cy = (ci / w) | 0;
    for (const [dx, dy, cost] of NB) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!grid[ni] || closed[ni] === gen) continue;
      // No corner-cutting: a diagonal step is only allowed when BOTH shared
      // orthogonal cells are passable — otherwise the path clips a land corner.
      if (dx !== 0 && dy !== 0 && (!grid[cy * w + (cx + dx)] || !grid[(cy + dy) * w + cx])) continue;
      const ng = cg + cost * (costArr ? costArr[ni] : 1);
      if (ng < gAt(ni)) { gScore[ni] = ng; seen[ni] = gen; came[ni] = ci; push(ng + hOf(nx, ny), ni); }
    }
    if (bridge) {
      // Hop 2 cells across a single blocked (land) cell to cross a pinched strait.
      for (const [dx, dy] of JUMP) {
        const mx = cx + (dx >> 1), my = cy + (dy >> 1), nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const mi = my * w + mx, ni = ny * w + nx;
        if (grid[mi] || !grid[ni] || closed[ni] === gen) continue; // middle must be land, landing must be sea
        const ng = cg + BRIDGE_COST;
        if (ng < gAt(ni)) { gScore[ni] = ng; seen[ni] = gen; came[ni] = ci; push(ng + hOf(nx, ny), ni); }
      }
    }
  }
  if (gi !== si && seen[gi] !== gen) return null; // goal never reached this call
  const path = []; let c = gi;
  while (c !== -1) { path.push({ x: c % w, y: (c / w) | 0 }); if (c === si) break; c = came[c]; }
  path.reverse();
  return path;
}
