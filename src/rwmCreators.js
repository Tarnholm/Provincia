// Re-sync the region creator faction ids stored in map.rwm with descr_sm_factions.
// A port of RIS's _tools/_Tarnholm-tools/rwm-creators/rwm_creators.py (2026-10-06),
// kept byte-for-byte equivalent: the same fields found the same way, the same
// values written.
//
// WHY. map.rwm keeps each region's creator faction as a raw faction INDEX
// (rtw.exe MAP_REGIONS::read_rwm_data reads it straight into region+0xa8). The
// game rebuilds map.rwm only when the file is missing, so once factions are
// added, removed or reordered the stored indexes name other factions. A rebel
// army takes its identity from that field (FACTION::army_create -> region+0xa8
// -> "rebel standard index"), so the rebels show another culture's symbol and
// banner. Sea regions store "no faction" as the faction COUNT at build time,
// which becomes a real faction as soon as one is appended. A new faction does
// both: it shifts every faction after its donor and raises the count.
//
// HOW. Per region the field is an int32 right before 16 bytes and the region's
// colour as B,G,R. The colour is unique per region and anchors the patch; when
// it also occurs elsewhere, the nearest preceding region-name record decides.
// Land colours and creators come from descr_regions.txt, sea colours are the
// map_regions.tga colours that are not land (nor black or white). Only those 4
// bytes per region change.
//
// Pure: buffers and strings in, a patched copy out. No fs.
"use strict";

const BAND = 1024; // a stored faction id is always below this

const factionsOf = (smText) => [...String(smText || "").matchAll(/^\t"([a-z_0-9]+)":/gm)].map((m) => m[1]);

// [{ region, creator, rgb:[r,g,b] }] from descr_regions.txt (7-line records)
function parseRegions(text) {
  const lines = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const l = raw.split(";")[0].trim();
    if (l) lines.push(l);
  }
  const out = [];
  let i = 0;
  while (i + 4 < lines.length) {
    const rgb = lines[i + 4].split(/\s+/);
    if (/^[a-z_0-9]+$/.test(lines[i + 2]) && rgb.length === 3 && rgb.every((x) => /^\d+$/.test(x))) {
      out.push({ region: lines[i], creator: lines[i + 2], rgb: rgb.map(Number) });
      i += 7;
    } else i++;
  }
  return out;
}

// distinct colours of a decoded map_regions image (BGR triples, as
// descrStratGeneral.tgaToRaw gives them) that are not land, black or white
function seaColours(rawBGR, landRgbs) {
  const key = (r, g, b) => (r << 16) | (g << 8) | b;
  const skip = new Set(landRgbs.map(([r, g, b]) => key(r, g, b)));
  skip.add(0); skip.add(0xffffff);
  const seen = new Set();
  const out = [];
  for (let o = 0; o + 2 < rawBGR.length; o += 3) {
    const k = key(rawBGR[o + 2], rawBGR[o + 1], rawBGR[o]);
    if (skip.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push([rawBGR[o + 2], rawBGR[o + 1], rawBGR[o]]);
  }
  return out;
}

// One pass over the file for every region at once (map.rwm is ~58 MB on RIS; a
// scan per region took 18 s). Matches follow Python's re.finditer exactly:
// leftmost first and non-overlapping PER PATTERN, so a colour like (7,7,7)
// that could overlap itself is counted the same way the Python tool counts it.

// sorted [[offset, name]] of every region-name record (u16 length incl. NUL, name, NUL)
function nameIndex(rwm, names) {
  const want = new Set(names);
  const lenOk = new Uint8Array(65536);
  for (const nm of want) { const n = Buffer.byteLength(nm, "latin1") + 1; if (n < 65536) lenOk[n] = 1; }
  const lastEnd = new Map();
  const out = [];
  for (let i = 0; i + 2 < rwm.length; i++) {
    const L = rwm[i] | (rwm[i + 1] << 8);
    if (!lenOk[L] || i + 2 + L > rwm.length || rwm[i + 1 + L] !== 0) continue;
    const nm = rwm.toString("latin1", i + 2, i + 1 + L);
    if (!want.has(nm) || i < (lastEnd.get(nm) || 0)) continue;
    lastEnd.set(nm, i + L + 2);
    out.push([i, nm]);
  }
  return out; // already in offset order
}

// colour key (as stored: B,G,R) -> candidate creator-field offsets: an int32 < BAND
// 20 bytes before the colour
const bgrKey = (rgb) => rgb[2] | (rgb[1] << 8) | (rgb[0] << 16);
function colourHits(rwm, rgbs) {
  const want = new Uint8Array(1 << 24);
  const hits = new Map(), lastEnd = new Map();
  for (const rgb of rgbs) { const k = bgrKey(rgb); want[k] = 1; hits.set(k, []); }
  for (let m = 0; m + 2 < rwm.length; m++) {
    const k = rwm[m] | (rwm[m + 1] << 8) | (rwm[m + 2] << 16);
    if (!want[k] || m < (lastEnd.get(k) || 0)) continue;
    lastEnd.set(k, m + 3);
    const p = m - 20;
    if (p >= 0 && rwm.readUInt32LE(p) < BAND) hits.get(k).push(p);
  }
  return hits;
}

function locate(found, rgb, region, names) {
  let hits = found.get(bgrKey(rgb)) || [];
  if (region != null && hits.length > 1) {
    const owner = (p) => {
      let lo = 0, hi = names.length; // bisect_right on offsets
      while (lo < hi) { const mid = (lo + hi) >> 1; if (names[mid][0] <= p) lo = mid + 1; else hi = mid; }
      return lo > 0 ? names[lo - 1][1] : null;
    };
    hits = hits.filter((p) => owner(p) === region);
  }
  return hits;
}

/**
 * rwm           Buffer, the map.rwm bytes
 * smFactions    descr_sm_factions.txt text (the faction list the ids must follow)
 * descrRegions  descr_regions.txt text
 * regionsRaw    map_regions.tga decoded to BGR triples
 *
 * Returns { ok, problems, changes:[{ region, offset, from, to }], buffer, factions, land, seas }.
 * buffer is a patched COPY (null when nothing differs or ok is false); with any
 * problem nothing is patched, as the Python tool refuses.
 */
function planRwmCreators({ rwm, smFactions, descrRegions, regionsRaw }) {
  const facs = factionsOf(smFactions);
  const index = new Map(facs.map((f, i) => [f, i]));
  const none = facs.length;
  const regs = parseRegions(descrRegions);
  const seas = seaColours(regionsRaw, regs.map((r) => r.rgb));
  const names = nameIndex(rwm, [...regs.map((r) => r.region), "the sea"]);
  const found = colourHits(rwm, [...regs.map((r) => r.rgb), ...seas]);
  const plan = [], problems = [];
  for (const r of regs) {
    if (!index.has(r.creator)) { problems.push(`${r.region}: creator '${r.creator}' is not in descr_sm_factions`); continue; }
    const hits = locate(found, r.rgb, r.region, names);
    if (hits.length !== 1) { problems.push(`${r.region}: ${hits.length} candidate fields for colour (${r.rgb.join(", ")})`); continue; }
    plan.push({ region: r.region, offset: hits[0], to: index.get(r.creator) });
  }
  for (const rgb of seas) {
    const hits = locate(found, rgb, "the sea", names);
    if (hits.length === 1) plan.push({ region: `sea (${rgb.join(", ")})`, offset: hits[0], to: none });
    else if (hits.length) problems.push(`sea (${rgb.join(", ")}): ${hits.length} candidate fields`);
  }
  const result = { ok: !problems.length, problems, changes: [], buffer: null, factions: facs.length, land: regs.length, seas: seas.length };
  if (problems.length) return result;
  result.changes = plan.map((p) => ({ ...p, from: rwm.readUInt32LE(p.offset) })).filter((c) => c.from !== c.to);
  if (result.changes.length) {
    const out = Buffer.from(rwm);
    for (const c of result.changes) out.writeUInt32LE(c.to, c.offset);
    result.buffer = out;
  }
  return result;
}

module.exports = { planRwmCreators, parseRegions, seaColours, factionsOf };
