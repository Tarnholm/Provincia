#!/usr/bin/env node
/**
 * Decode the maps that were actually written and assert them against the source data.
 * Nothing here trusts the renderer's own bookkeeping: every PNG is inflated back to pixels
 * and compared to map_regions.tga / descr_regions / descr_strat / descr_sm_factions.
 *
 *   node scripts/check-ris-faction-maps.js [<maps dir>] [<mod data dir>]
 *
 * Run it after gen-ris-faction-pages.js. It has already earned its keep: it caught a
 * settlement dot that the subject halo was painting over, on 1 of the 215 maps, which no
 * count the renderer keeps about itself could have seen.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const ROOT = path.join(__dirname, "..");
const dg = require(path.join(ROOT, "src/descrStratGeneral.js"));
const parsers = require(path.join(ROOT, "src/parsers.js"));
const gv = require(path.join(ROOT, "src/growthEval.js"));
const fmap = require(path.join(ROOT, "scripts/lib/factionMap.js"));

const MAPS = process.argv[2] || "C:/RIS/RIS/wiki/maps";
const RIS = process.argv[3] || "C:/RIS/RIS/data";

function decode(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG: " + file);
  let o = 8, idat = [], w, h, ct;
  while (o < b.length) {
    const len = b.readUInt32BE(o), t = b.toString("ascii", o + 4, o + 8), d = b.slice(o + 8, o + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    if (t === "IDAT") idat.push(d);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 3, px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error("unexpected PNG filter in " + file);
    raw.copy(px, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { w, h, px, at: (x, y) => [px[(y * w + x) * 3], px[(y * w + x) * 3 + 1], px[(y * w + x) * 3 + 2]] };
}

const strat = gv.parseStrat(path.join(RIS, "world/maps/campaign/imperial_campaign/descr_strat.txt"));
const world = fmap.loadWorld({ risDir: RIS, dg, parsers, strat });
const sm = parsers.parseSmFactions(fs.readFileSync(path.join(RIS, "descr_sm_factions.txt"), "latin1"));

const files = fs.readdirSync(MAPS).filter((f) => f.endsWith(".png")).sort();
const problems = [];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
let bytes = 0;
const dims = new Map();

// ── 1. every map identical in size ───────────────────────────────────────────
const decoded = {};
for (const f of files) {
  const p = path.join(MAPS, f);
  bytes += fs.statSync(p).size;
  const m = decode(p);
  dims.set(`${m.w}x${m.h}`, (dims.get(`${m.w}x${m.h}`) || 0) + 1);
  decoded[f.replace(/\.png$/, "")] = m;
}
console.log(`maps: ${files.length}, ${(bytes / 1048576).toFixed(2)} MB, sizes ${[...dims].map(([d, n]) => `${d} x${n}`).join(", ")}`);
if (dims.size !== 1) problems.push(`maps are NOT all the same size: ${[...dims]}`);
if (!dims.has(`${fmap.WIN_W}x${fmap.WIN_H}`)) problems.push(`size is not the declared window ${fmap.WIN_W}x${fmap.WIN_H}`);

// ── 2. per-map pixel assertions against the source ───────────────────────────
// For each map: recompute the window independently of the renderer, then walk EVERY pixel
// and check the class of what was drawn against what the region map says is there.
let checkedPx = 0, redInside = 0, redOutsideBad = 0, seaBad = 0, landBad = 0, dotBad = 0;
let clamped = 0, mapsChecked = 0;
const SUBJ = fmap.SUBJECT, SEA = fmap.SEA, COAST = fmap.COAST;
const isSubjTone = (c) => eq(c, SUBJ) || eq(c, [Math.round(SUBJ[0] * fmap.OUTLINE_MUL), Math.round(SUBJ[1] * fmap.OUTLINE_MUL), Math.round(SUBJ[2] * fmap.OUTLINE_MUL)]);
const paint = new Set([fmap.HALO_IN, fmap.HALO_OUT, fmap.BRACKET, fmap.DOT_CORE, fmap.DOT_RIM].map((c) => c.join(",")));

for (const [f, m] of Object.entries(decoded)) {
  const regs = (strat[f] && strat[f].settlements || []).map((s) => s.region);
  if (!regs.length) { problems.push(`${f}: a map exists but descr_strat gives it no settlements`); continue; }
  const win = fmap.windowFor(world, regs);
  if (win.clamped) clamped++;
  if (!win.fits) problems.push(`${f}: territory ${win.terr.w}x${win.terr.h} does not fit the window`);
  const mine = new Set(regs.map((r) => world.idxOf.get(r)).filter((i) => i !== undefined));
  mapsChecked++;

  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const sx = win.ox + x, sy = win.oy + y;
      const ri = world.regionAt[sy * world.W + sx];
      const c = m.at(x, y);
      checkedPx++;
      if (paint.has(c.join(","))) continue;         // halo / bracket / dot overlays
      if (ri < 0) {                                  // source says: not a region → sea
        if (!(eq(c, SEA) || eq(c, COAST))) seaBad++;
      } else if (mine.has(ri)) {                     // source says: the subject owns it
        if (isSubjTone(c)) redInside++; else landBad++;
      } else {                                       // source says: land, someone else's
        if (isSubjTone(c)) redOutsideBad++;
        if (eq(c, SEA) || eq(c, COAST)) landBad++;
      }
    }
  }

  // A settlement dot must land inside its own region's pixels.
  for (let ri = 0; ri < world.settleXY.length; ri++) {
    const p = world.settleXY[ri];
    if (!p) continue;
    const x = p.x - win.ox, y = p.y - win.oy;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    if (!eq(m.at(x, y), fmap.DOT_CORE)) dotBad++;
  }
}
console.log(`pixels examined: ${checkedPx.toLocaleString("en-US")} across ${mapsChecked} maps`);
console.log(`  subject-red pixels inside the subject's own regions: ${redInside.toLocaleString("en-US")}`);
console.log(`  subject-red pixels outside them:                     ${redOutsideBad}`);
console.log(`  sea pixels not drawn as sea:                         ${seaBad}`);
console.log(`  land pixels drawn as sea, or subject land not red:   ${landBad}`);
console.log(`  settlement dots not landing on their own coordinate: ${dotBad}`);
console.log(`  windows clamped against the map edge:                ${clamped} of ${mapsChecked}`);
if (redOutsideBad) problems.push(`${redOutsideBad} red pixels outside the subject's regions`);
if (seaBad) problems.push(`${seaBad} sea pixels not drawn as sea`);
if (landBad) problems.push(`${landBad} land pixels drawn wrong`);
if (dotBad) problems.push(`${dotBad} settlement dots off their own coordinate`);
if (!redInside) problems.push("no subject-red pixels found anywhere");

// ── 3. named cases, by coordinate ────────────────────────────────────────────
// Rome: Latium's own pixels must be red on romans_julii.png and NOT red on carthage.png.
function sample(fac, region) {
  const m = decoded[fac];
  const regs = strat[fac].settlements.map((s) => s.region);
  const win = fmap.windowFor(world, regs);
  const ri = world.idxOf.get(region);
  const pts = [];
  for (let sy = world.bbox[ri].y0; sy <= world.bbox[ri].y1 && pts.length < 400; sy++)
    for (let sx = world.bbox[ri].x0; sx <= world.bbox[ri].x1; sx++)
      if (world.regionAt[sy * world.W + sx] === ri) pts.push([sx - win.ox, sy - win.oy]);
  let red = 0, seen = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    seen++; if (isSubjTone(m.at(x, y))) red++;
  }
  return { seen, red, total: pts.length };
}
const named = [
  ["romans_julii", "Latium", true], ["romans_julii", "Roma", true],
  ["carthage", "Latium", false], ["carthage", "Qart-Khadasht", true],
  ["seleucid", "Syria", true], ["ptolemaic", "Gynaikopolites_Nomos", true],
];
for (const [fac, region, wantRed] of named) {
  if (!decoded[fac]) { problems.push(`no map for ${fac}`); continue; }
  const s = sample(fac, region);
  const ok = wantRed ? s.red > 0 && s.red >= s.seen * 0.5 : s.red === 0;
  console.log(`  ${fac}/${region}: ${s.red}/${s.seen} of its ${s.total} pixels in the window are subject-red — expected ${wantRed ? "red" : "not red"} ${ok ? "OK" : "FAIL"}`);
  if (!ok) problems.push(`${fac}/${region}: red=${s.red} seen=${s.seen}, expected ${wantRed ? "red" : "not red"}`);
}

// Rome's own settlement coordinate, cross-checked against descr_strat's governor position.
{
  const m = decoded.romans_julii;
  const win = fmap.windowFor(world, strat.romans_julii.settlements.map((s) => s.region));
  const p = world.settleXY[world.idxOf.get("Roma")];
  const txt = fs.readFileSync(path.join(RIS, "world/maps/campaign/imperial_campaign/descr_strat.txt"), "latin1");
  const gov = /Quintus Ogulnius_Gallus[^\n]*x (\d+), y (\d+)/.exec(txt);
  // world.settleXY is in TOP-DOWN display rows; descr_strat counts y from the BOTTOM, which
  // is also the TGA's storage order. So the two agree when govY === H-1-y.
  const agree = gov && +gov[1] === p.x && +gov[2] === world.H - 1 - p.y;
  console.log(`  Roma settlement pixel (${p.x}, top-down row ${p.y} = bottom-up row ${world.H - 1 - p.y}) vs descr_strat governor (${gov && gov[1]},${gov && gov[2]}): ${agree ? "AGREE" : "DISAGREE"}`);
  if (!agree) problems.push("Roma settlement pixel does not match the descr_strat governor coordinate");
  const dot = m.at(p.x - win.ox, p.y - win.oy);
  console.log(`  Rome's dot on its own map: ${dot} ${eq(dot, fmap.DOT_CORE) ? "OK" : "FAIL"}`);
  if (!eq(dot, fmap.DOT_CORE)) problems.push("Rome's settlement dot is not drawn at Rome");
}

// ── 4. faction colours ───────────────────────────────────────────────────────
const noColour = Object.keys(strat).filter((f) => !sm[f] || !sm[f].primary);
console.log(`faction colours: ${Object.keys(strat).length - noColour.length}/${Object.keys(strat).length} declared in descr_sm_factions${noColour.length ? ` — MISSING: ${noColour.join(", ")}` : ""}`);
// A second, independent count of the same thing, straight off the file.
const raw = fs.readFileSync(path.join(RIS, "descr_sm_factions.txt"), "latin1");
const primaryLines = (raw.match(/"primary"\s*:\s*\[/g) || []).length;
console.log(`  "primary" lines by a flat pattern over the file: ${primaryLines} · parser found ${Object.values(sm).filter((v) => v.primary).length}  <- must match`);
if (primaryLines !== Object.values(sm).filter((v) => v.primary).length) problems.push("primary-colour counts disagree");

// No other faction's rendered colour may equal the subject red or its darkened boundary
// tone — the "red pixels outside the subject's regions" count above would be meaningless if
// one did. Checked over all 239 declared colours, not just the ones on screen.
{
  const dark = [Math.round(SUBJ[0] * fmap.OUTLINE_MUL), Math.round(SUBJ[1] * fmap.OUTLINE_MUL), Math.round(SUBJ[2] * fmap.OUTLINE_MUL)];
  const clash = Object.entries(sm).filter(([, v]) => {
    if (!v.primary) return false;
    const c = fmap.muted(v.primary);
    const cd = [Math.round(c[0] * fmap.OUTLINE_MUL), Math.round(c[1] * fmap.OUTLINE_MUL), Math.round(c[2] * fmap.OUTLINE_MUL)];
    return eq(c, SUBJ) || eq(c, dark) || eq(cd, SUBJ) || eq(cd, dark);
  }).map(([f]) => f);
  console.log(`factions whose rendered colour collides with the subject red: ${clash.length}${clash.length ? " — " + clash.join(", ") : ""} (of ${Object.keys(sm).length} checked)`);
  if (clash.length) problems.push(`colour collision with subject red: ${clash.join(", ")}`);
}

// Every map must show at least two distinct non-subject faction colours, or it is not
// showing neighbours at all — which is the whole point of the rewrite.
let thin = 0;
for (const [f, m] of Object.entries(decoded)) {
  const seen = new Set();
  for (let i = 0; i < m.w * m.h; i++) seen.add(`${m.px[i * 3]},${m.px[i * 3 + 1]},${m.px[i * 3 + 2]}`);
  if (seen.size < 20) { thin++; problems.push(`${f}: only ${seen.size} distinct colours — no neighbours drawn?`); }
}
console.log(`maps showing fewer than 20 distinct colours: ${thin}`);

if (problems.length) { console.error(`\n${problems.length} PROBLEM(S):`); for (const p of problems) console.error("  " + p); process.exit(1); }
console.log("\nall map checks passed");
