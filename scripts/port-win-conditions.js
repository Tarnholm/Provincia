// Port "Classic" RIS victory conditions to the big RIS map.
// Classic regions were SPLIT into multiple big-map regions, so a classic VC
// region must expand to EVERY big-map region inside its area. Both maps share
// the same geographic extent (classic 510x350, big 1020x700 = 2x), so we map
// every big-map region to the classic region it sits inside (sampling the
// classic map under each big pixel), then for each classic VC region include
// all big regions that fall within it.
//
//   node scripts/port-win-conditions.js           # dry run: report mapping
//   node scripts/port-win-conditions.js --write    # write big-map descr_win_conditions (+ backup)
const fs = require("fs");

const CLS_DIR = "for claude/classic files";
const BIG_BASE = "C:/RIS/RIS/data/world/maps/base";
const BIG_WC = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_win_conditions.txt";
const BIG_STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const CLS_REGIONS = `${CLS_DIR}/descr_regions.txt`;
const CLS_WC = `${CLS_DIR}/descr_win_conditions.txt`;
const CLS_TGA = `${CLS_DIR}/map_regions.tga`;
const BIG_REGIONS = `${BIG_BASE}/descr_regions.txt`;
const BIG_TGA = `${BIG_BASE}/map_regions.tga`;
const SKIP_FACTIONS = new Set(["dummies", "roman_rebels_1", "roman_rebels_2", "slave", "rebels"]);

function parseRegions(p) {
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const rgb2region = new Map(), region2city = new Map(), city2region = new Map();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s/.test(l) || /^\s*;/.test(l)) continue;
    const region = l.trim();
    const blk = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) { if (blk.length) break; else continue; }
      if (!/^\s/.test(lines[j])) break;
      blk.push(lines[j].trim());
    }
    const city = blk[0] || region;
    const rgbLine = blk.find((b) => /^\d+\s+\d+\s+\d+$/.test(b));
    if (rgbLine) rgb2region.set(rgbLine.split(/\s+/).join(","), region);
    region2city.set(region, city);
    city2region.set(city.toLowerCase(), region);
  }
  return { rgb2region, region2city, city2region };
}

// Set of big-map region names within a descr_regions section header (;N. NAME).
function bigSectionRegions(p, wantSection) {
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const out = new Set(); let inSec = false;
  for (const l of lines) {
    const sm = l.match(/^;\s*\d+\.\s*([A-Za-z &]+)/);
    if (sm) { inSec = sm[1].trim().toUpperCase() === wantSection.toUpperCase(); continue; }
    if (!l.trim() || /^\s/.test(l) || /^\s*;/.test(l)) continue;
    if (inSec) out.add(l.trim());
  }
  return out;
}

function loadTga(p) {
  const b = fs.readFileSync(p);
  const idLen = b.readUInt8(0);
  const w = b.readUInt16LE(12), h = b.readUInt16LE(14);
  const bypp = b.readUInt8(16) / 8;
  const topDown = (b.readUInt8(17) & 0x20) !== 0;
  const dataOff = 18 + idLen;
  return { b, w, h, bypp, topDown, dataOff,
    rgbAt(stratX, stratY) {
      if (stratX < 0 || stratX >= w || stratY < 0 || stratY >= h) return null;
      const row = topDown ? (h - 1 - stratY) : stratY;
      const i = dataOff + (row * w + stratX) * bypp;
      return this.b[i + 2] + "," + this.b[i + 1] + "," + this.b[i];
    } };
}

const cls = parseRegions(CLS_REGIONS);
const big = parseRegions(BIG_REGIONS);
const clsTga = loadTga(CLS_TGA);
const bigTga = loadTga(BIG_TGA);

// One pass over the big map: tally, per big region, which classic region sits
// under each of its pixels (scaled to classic coords). Each big region is then
// assigned to the classic region it most overlaps.
const histo = new Map(); // bigRegion -> Map(classicRegion -> count)
const bigCent = new Map(); // bigRegion -> {sx, sy, n} (for distance ordering)
for (let row = 0; row < bigTga.h; row++) {
  for (let x = 0; x < bigTga.w; x++) {
    const i = bigTga.dataOff + (row * bigTga.w + x) * bigTga.bypp;
    const rgb = bigTga.b[i + 2] + "," + bigTga.b[i + 1] + "," + bigTga.b[i];
    const bigRegion = big.rgb2region.get(rgb);
    if (!bigRegion) continue; // sea / settlement-black / border
    const stratY = bigTga.topDown ? (bigTga.h - 1 - row) : row;
    let ce = bigCent.get(bigRegion); if (!ce) { ce = { sx: 0, sy: 0, n: 0 }; bigCent.set(bigRegion, ce); }
    ce.sx += x; ce.sy += stratY; ce.n++;
    const clsRgb = clsTga.rgbAt(Math.floor(x / 2), Math.floor(stratY / 2));
    const clsRegion = clsRgb && cls.rgb2region.get(clsRgb);
    if (!clsRegion) continue;
    let m = histo.get(bigRegion); if (!m) { m = new Map(); histo.set(bigRegion, m); }
    m.set(clsRegion, (m.get(clsRegion) || 0) + 1);
  }
}
const bigCentroid = new Map();
for (const [r, c] of bigCent) bigCentroid.set(r, { x: c.sx / c.n, y: c.sy / c.n });
// Faction → ordered owned regions (from descr_strat settlement blocks). The
// first settlement is treated as the capital (no `capital` keyword in this mod).
function parseOwnership(p) {
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const owned = new Map(); let cur = null;
  for (const l of lines) {
    const fm = l.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (fm) { cur = fm[1].toLowerCase(); if (!owned.has(cur)) owned.set(cur, []); continue; }
    const rm = l.match(/^\s*region\s+(\S+)/i);
    if (rm && cur) owned.get(cur).push(rm[1]);
  }
  return owned;
}
const factionOwned = parseOwnership(BIG_STRAT);
const bigToClassic = new Map(); // bigRegion -> classicRegion
const classicToBig = new Map(); // classicRegion -> [bigRegion...]
for (const [bigRegion, m] of histo) {
  let best = null, bd = 0;
  for (const [cr, n] of m) if (n > bd) { bd = n; best = cr; }
  if (!best) continue;
  bigToClassic.set(bigRegion, best);
  let arr = classicToBig.get(best); if (!arr) { arr = []; classicToBig.set(best, arr); }
  arr.push(bigRegion);
}

function parseWC(p) {
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const f = {}; let cur = null;
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith(";")) continue;
    if (/^[a-z_0-9]+$/.test(t)) { cur = t; f[cur] = f[cur] || { hold: [] }; continue; }
    const m = t.match(/^hold_regions\s+(.+)/);
    if (m && cur) f[cur].hold = m[1].split(/[\s,]+/).filter((x) => x && x !== "and");
  }
  return f;
}
const clsWC = parseWC(CLS_WC), bigWC = parseWC(BIG_WC);
// ALL classic factions that have hold_regions (minus pseudo), regardless of
// whether the big map already had a block — existing blocks are replaced.
const candidates = Object.keys(clsWC).filter((f) => clsWC[f].hold.length && !SKIP_FACTIONS.has(f));
// Rome special-case: the big map has ONE Rome, but Classic split the conquest
// across romans_julii (Gaul/N-Italy), roman_senate (Rome), roman_rebels_1
// (Greece/S-Italy/Adriatic = Brutii) and roman_rebels_2 (Sicily/Africa/S-Italy =
// Scipii). Combine ALL of them into romans_julii, and add the whole Italian
// peninsula so Rome always holds its home ground.
const romanCombinedHold = [...new Set(
  Object.keys(clsWC).filter((f) => /^roman/.test(f)).flatMap((f) => clsWC[f].hold)
)];
const italyRegions = bigSectionRegions(BIG_REGIONS, "ITALY");

console.log(`big regions mapped to a classic region: ${bigToClassic.size}/${big.region2city.size}`);
const splitSample = [...classicToBig.entries()].filter(([, a]) => a.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
console.log("biggest splits:", splitSample.map(([c, a]) => `${cls.region2city.get(c)}→${a.length}`).join(", "));
console.log(`candidates: ${candidates.length}`);

// Compute expanded hold_regions per ported faction.
const ported = new Map(); // faction -> { cities, unresolved }
const report = [];
for (const fac of candidates) {
  const unresolved = [];
  // big regions inside the faction's classic VC region areas, IN CLASSIC ORDER
  // (so the expansion list preserves the hand-made Classic ordering — only the
  // starting block below is reordered).
  const orderedBig = []; const seenR = new Set();
  const holdList = (fac === "romans_julii") ? romanCombinedHold : clsWC[fac].hold;
  for (const holdCity of holdList) {
    const clsRegion = cls.city2region.get(holdCity.toLowerCase());
    if (!clsRegion) { unresolved.push(holdCity); continue; }
    const bigs = classicToBig.get(clsRegion) || [];
    if (!bigs.length) { unresolved.push(holdCity); continue; }
    for (const br of bigs) if (!seenR.has(br)) { seenR.add(br); orderedBig.push(br); }
  }
  // Rome holds the whole Italian peninsula regardless of which Classic faction
  // listed each piece.
  if (fac === "romans_julii") for (const r of italyRegions) if (!seenR.has(r)) { seenR.add(r); orderedBig.push(r); }
  // Starting regions (owned at campaign start), capital = first settlement.
  // ONLY these are reordered: capital first, then nearest-to-capital.
  const owned = (factionOwned.get(fac) || []).filter((r, i, a) => a.indexOf(r) === i);
  const capital = owned[0] || null;
  const cap = capital && bigCentroid.get(capital);
  const dist = (r) => { const c = bigCentroid.get(r); return (c && cap) ? (c.x - cap.x) ** 2 + (c.y - cap.y) ** 2 : Infinity; };
  const ownedSet = new Set(owned);
  const startingOrdered = capital
    ? [capital, ...owned.slice(1).sort((a, b) => dist(a) - dist(b))]
    : [...owned].sort((a, b) => dist(a) - dist(b));
  // Expansion = classic-VC order, minus the starting regions already listed.
  const expansionOrdered = orderedBig.filter((r) => !ownedSet.has(r));
  const cities = [], seen = new Set();
  for (const r of [...startingOrdered, ...expansionOrdered]) {
    const c = big.region2city.get(r);
    if (!c || seen.has(c)) continue;
    if (/_rebels?_settlement$/i.test(c) || /rebels?_settlement$/i.test(r)) continue;
    seen.add(c); cities.push(c);
  }
  if (!cities.length) { report.push(`${fac}: SKIP (nothing mapped)`); continue; }
  ported.set(fac, { cities, unresolved });
  report.push(`${fac}: cap=${capital ? big.region2city.get(capital) : "?"} · ${owned.length} start + ${cities.length - owned.filter((r)=>seen.has(big.region2city.get(r))).length} exp = ${cities.length}${bigWC[fac] ? " (repl)" : " (new)"}${unresolved.length ? ` [skip: ${unresolved.join(",")}]` : ""}`);
}
// Minor factions: own land at campaign start but have NO Classic VC. Give them
// just their starting regions (capital first, then nearest-to-capital) plus a
// take_regions = (#starting + 20), so winning requires conquering 20 more
// settlements — this prevents an instant turn-1 victory.
const MINOR_EXTRA = 20;
let minorCount = 0;
for (const [fac, regions] of factionOwned) {
  if (ported.has(fac) || fac === "romans_julii") continue;
  if (SKIP_FACTIONS.has(fac) || /_rebels(_?\d+)?$/.test(fac) || fac === "slaves") continue;
  const owned = regions.filter((r, i, a) => a.indexOf(r) === i);
  if (!owned.length) continue; // pure respawn markers — no land, no VC
  const capital = owned[0];
  const cap = bigCentroid.get(capital);
  const dist = (r) => { const c = bigCentroid.get(r); return (c && cap) ? (c.x - cap.x) ** 2 + (c.y - cap.y) ** 2 : Infinity; };
  const startingOrdered = [capital, ...owned.slice(1).sort((a, b) => dist(a) - dist(b))];
  const cities = [], seen = new Set();
  for (const r of startingOrdered) {
    const c = big.region2city.get(r);
    if (!c || seen.has(c)) continue;
    if (/_rebels?_settlement$/i.test(c) || /rebels?_settlement$/i.test(r)) continue;
    seen.add(c); cities.push(c);
  }
  if (!cities.length) continue;
  ported.set(fac, { cities, unresolved: [], take: cities.length + MINOR_EXTRA });
  report.push(`${fac}: cap=${big.region2city.get(capital)} · ${cities.length} start, take=${cities.length + MINOR_EXTRA} (minor)${bigWC[fac] ? " (repl)" : " (new)"}`);
  minorCount++;
}
console.log("\n=== PER-FACTION ===\n" + report.join("\n"));
console.log(`\nminor (starting-only, +${MINOR_EXTRA}) factions: ${minorCount}`);
console.log(`ported ${ported.size} factions`);

// Parse the big WC into ordered raw blocks so we can replace in place and keep
// any short_campaign / outlive lines the big map already had.
function parseBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = []; let cur = null; let prevBlank = true;
  for (const l of lines) {
    const t = l.trim();
    // A faction header is a bare token at column 0 that follows a blank line —
    // this avoids mistaking a single-faction `outlive_factions` list (which sits
    // right under `short_campaign`, no blank before it) for a new block.
    const isHeader = prevBlank && t === l && /^[a-z_0-9]+$/.test(t);
    if (isHeader) { cur = { faction: t, lines: [l] }; blocks.push(cur); }
    else if (cur) cur.lines.push(l);
    else blocks.push({ faction: null, lines: [l] });
    prevBlank = (t === "");
  }
  return blocks;
}
function rebuild(fac, origLines) {
  const { cities, take } = ported.get(fac);
  const takeN = take != null ? take : cities.length;
  // Preserve every original line except the faction header, hold_regions and
  // take_regions (so short_campaign + outlive_factions survive).
  const extras = (origLines || []).slice(1).filter((l) => {
    const t = l.trim();
    return t && !/^hold_regions\b/.test(t) && !/^take_regions\b/.test(t);
  });
  return [fac, `hold_regions ${cities.join(", ")}`, `take_regions ${takeN}`, ...extras, ""].join("\n");
}

if (process.argv.includes("--write")) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(BIG_WC, `${BIG_WC}.${stamp}.bak`);
  const blocks = parseBlocks(fs.readFileSync(BIG_WC, "utf8"));
  const handled = new Set();
  const out = [];
  for (const blk of blocks) {
    if (blk.faction && ported.has(blk.faction)) { out.push(rebuild(blk.faction, blk.lines)); handled.add(blk.faction); }
    else out.push(blk.lines.join("\n"));
  }
  // Append ported factions that had no block in the big WC.
  const appended = [];
  for (const fac of ported.keys()) if (!handled.has(fac)) appended.push(rebuild(fac, null));
  let text = out.join("\n").replace(/\s*$/, "");
  if (appended.length) text += "\n\n; --- ported from Classic (new factions, " + stamp + ") ---\n\n" + appended.join("\n");
  fs.writeFileSync(BIG_WC, text + "\n", "utf8");
  console.log(`\nWROTE: replaced ${handled.size}, appended ${appended.length} (backup .${stamp}.bak)`);
} else {
  console.log(`\n(dry run — re-run with --write to apply)`);
}
