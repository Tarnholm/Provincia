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
export function aStarSea(sg, start, goal, cutoff = 1700, costArr = null) {
  const { grid, w, h } = sg;
  const N = w * h;
  const si = start.y * w + start.x, gi = goal.y * w + goal.x;
  if (si < 0 || gi < 0 || si >= N || gi >= N || !grid[si] || !grid[gi]) return null;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  gScore[si] = 0;
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
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (ci === gi) break;
    const cg = gScore[ci];
    if (cg > cutoff) continue;
    const cx = ci % w, cy = (ci / w) | 0;
    for (const [dx, dy, cost] of NB) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!grid[ni] || closed[ni]) continue;
      // No corner-cutting: a diagonal step is only allowed when BOTH shared
      // orthogonal cells are passable — otherwise the path clips a land corner
      // (that was the "sea route over land" near coasts; 2026-07-18).
      if (dx !== 0 && dy !== 0 && (!grid[cy * w + (cx + dx)] || !grid[(cy + dy) * w + cx])) continue;
      const ng = cg + cost * (costArr ? costArr[ni] : 1);
      if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = ci; push(ng + hOf(nx, ny), ni); }
    }
  }
  if (gi !== si && came[gi] === -1) return null;
  const path = []; let c = gi;
  while (c !== -1) { path.push({ x: c % w, y: (c / w) | 0 }); if (c === si) break; c = came[c]; }
  path.reverse();
  return path;
}
