/**
 * Mercenary pools, from descr_mercenaries.txt. Shared by gen-ris-mercenary-pages.js (one page
 * per pool) and gen-ris-unit-pages.js (which links a mercenary to the pools that sell it), so the
 * two agree on a pool's name and file.
 *
 * The file's shape, per pool:
 *   pool <token>
 *   regions <Region> <Region> ...
 *   unit <edu type>, exp N cost N replenish A - B max N initial N [restrict f1, f2, ...]
 *
 * The mod gives a pool no display name; the token is the only name it has. It is shown with
 * underscores as spaces and each word capitalised. `_merc_center` marks a pool centred on one
 * city (`athens_merc_center`) and is dropped from the name, unless that would make two pools
 * read the same, in which case the name keeps "City".
 */
const fs = require("fs");
const path = require("path");

const CENTER = /_merc_center$/i;
const titleCase = (s) => s.split(/([_\s-]+)/).map((p) => (/^[_\s]+$/.test(p) ? " " : p.charAt(0).toUpperCase() + p.slice(1))).join("");

/** Parse descr_mercenaries.txt. Returns { pools: [{ token, regions, units: [...] }], bad: [lines not understood] }. */
function parseMercPools(risData) {
  const file = path.join(risData, "world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt");
  let txt = "";
  try { txt = fs.readFileSync(file, "latin1"); } catch { return { pools: [], bad: [] }; }
  const pools = [], bad = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    if (!l) continue;
    let m = /^pool\s+(\S+)$/.exec(l);
    if (m) { cur = { token: m[1], regions: [], units: [] }; pools.push(cur); continue; }
    m = /^regions\s+(.+)$/.exec(l);
    if (m && cur) { cur.regions.push(...m[1].trim().split(/\s+/).filter(Boolean)); continue; }
    m = /^unit\s+([^,]+),\s*exp\s+(\d+)\s+cost\s+(\d+)\s+replenish\s+([\d.]+)\s*-\s*([\d.]+)\s+max\s+(\d+)\s+initial\s+(\d+)(?:\s+restrict\s+(.+))?$/.exec(l);
    if (m && cur) {
      cur.units.push({
        type: m[1].trim().toLowerCase(),
        exp: +m[2], cost: +m[3],
        replenishMin: m[4], replenishMax: m[5],   // kept as written, so no digit is lost or invented
        max: +m[6], initial: +m[7],
        restrict: m[8] ? m[8].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [],
      });
      continue;
    }
    bad.push(l);
  }
  return { pools, bad };
}

/** token -> display name, for every pool in the list. */
function poolNames(pools) {
  const base = (t) => titleCase(t.replace(CENTER, ""));
  const count = {};
  for (const p of pools) count[base(p.token)] = (count[base(p.token)] || 0) + 1;
  const out = {};
  for (const p of pools) {
    const b = base(p.token);
    out[p.token] = CENTER.test(p.token) && count[b] > 1 ? `${b} City` : b;
  }
  return out;
}

/** The page file for a pool, relative to the wiki root. */
const poolFile = (token) => `mercenaries/${String(token).toLowerCase().replace(/[^a-z0-9-]+/g, "_")}.md`;

module.exports = { parseMercPools, poolNames, poolFile };
