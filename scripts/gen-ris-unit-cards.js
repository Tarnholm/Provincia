#!/usr/bin/env node
/**
 * Convert RIS unit card art from TGA to PNG for the wiki.
 *
 *   node scripts/gen-ris-unit-cards.js [--ris <dir>] [--out <dir>] [--scale N] [--limit N]
 *
 * Cards live at `ui/units/<faction>/#<dictionary>.tga` — 7,221 files across 245 faction
 * folders, roughly four copies of each of the ~1,700 units. One copy per unit is enough
 * for a wiki, so the first match wins.
 *
 * The TGAs are RLE-compressed 32-bit (image type 10) at 328x448. descrStratGeneral's
 * decoder handles the RLE and returns BGR; rows are bottom-up unless bit 5 of the
 * descriptor is set, exactly as with map_regions.tga.
 *
 * WHY DOWNSCALE. Full size across ~1,700 cards is tens of megabytes in a repo that other
 * people clone to play a game. Half size is still legible on a wiki page, and the script
 * reports the total so the cost is a decision rather than a surprise.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const SCALE = Math.max(1, parseInt(valOf("--scale", "2"), 10));
const LIMIT = parseInt(valOf("--limit", "0"), 10) || 0;

const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ── PNG writer (no image library needed) ─────────────────────────────────────
// PNG encoding and TGA decoding live in scripts/lib/tgaPng.js — shared with the other
// wiki image generator. They were duplicated here, and both copies carried the same
// 32bpp-source bug that made every icon and card render as colour stripes.
const { png, convert: convertTga } = require(path.join(__dirname, "lib", "tgaPng.js"));
const convert = (file, scale) => convertTga(dg, file, scale);

// ── index every card file once, by its dictionary name ───────────────────────
// Each unit has TWO images and the wiki shows both: the roster card under `ui/units`
// (`#akarnanian_hoplites.tga`, the small portrait in the recruitment panel) and the info
// card under `ui/unit_info` (`akarnanian_hoplites_info.tga`, the larger illustration the
// game shows on the unit's detail panel — no `#`, and an `_info` suffix).
function indexCards(sub, strip) {
  const root = path.join(RIS, "ui", sub);
  const byDict = new Map();
  let files = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return { byDict, files }; }
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, d)); } catch { continue; }
    for (const n of names) {
      if (!/\.tga$/i.test(n)) continue;
      files++;
      const dict = strip(n.replace(/\.tga$/i, "").toLowerCase());
      if (dict && !byDict.has(dict)) byDict.set(dict, path.join(root, d, n));
    }
  }
  return { byDict, files };
}

// ── units, with their dictionary keys ────────────────────────────────────────
function loadUnits() {
  const edu = rd("export_descr_unit.txt") || "";
  const out = [];
  let cur = null;
  for (const raw of edu.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(line);
    if (m) { cur = { type: m[1].trim(), dict: null }; out.push(cur); continue; }
    if (!cur) continue;
    m = /^dictionary\s+(\S+)/.exec(line);
    if (m) cur.dict = m[1].trim().toLowerCase();
  }
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────────
const { byDict, files } = indexCards("units", (n) => n.replace(/^#/, ""));
const info = indexCards("unit_info", (n) => (/_info$/.test(n) ? n.replace(/^#/, "").replace(/_info$/, "") : null));
const units = loadUnits();
console.log(`card files found: ${files.toLocaleString("en-US")} across the ui/units folders · ${byDict.size.toLocaleString("en-US")} distinct card names`);
console.log(`info cards found: ${info.files.toLocaleString("en-US")} across the ui/unit_info folders · ${info.byDict.size.toLocaleString("en-US")} distinct`);
console.log(`units in the EDU: ${units.length.toLocaleString("en-US")} · with a dictionary key: ${units.filter((u) => u.dict).length.toLocaleString("en-US")}`);

fs.mkdirSync(path.join(OUT, "cards"), { recursive: true });
let written = 0, bytes = 0, missing = 0, failed = 0;
let infoWritten = 0, infoMissing = 0, infoFailed = 0;
const missingNames = [];
// One card per DICTIONARY, not per type: `sardinian archers`, `aor sardinian archers`
// and `horde sardinian archers` are one unit and shared one source image, so keying on
// type wrote the same picture three times under different names (~500 duplicates).
const seen = new Set();
const unique = units.filter((u) => {
  if (!u.dict || seen.has(u.dict)) return false;
  seen.add(u.dict); return true;
});
const todo = LIMIT ? unique.slice(0, LIMIT) : unique;

for (const u of todo) {
  if (!u.dict) { missing++; continue; }
  const src = byDict.get(u.dict);
  if (!src) { missing++; if (missingNames.length < 8) missingNames.push(u.dict); continue; }
  try {
    const r = convert(src, SCALE);
    if (!r) { failed++; continue; }
    fs.writeFileSync(path.join(OUT, "cards", `${slug(u.dict)}.png`), r.buf);
    written++; bytes += r.buf.length;
  } catch { failed++; }
  // The info card gets the same downscale as the roster card. Both source images are
  // 328x448, so writing the info cards at full size added 188 MB for pixels nobody asked
  // for — a wiki does not justify that in a repo people clone to play a game.
  const isrc = info.byDict.get(u.dict);
  if (!isrc) { infoMissing++; continue; }
  try {
    const r = convert(isrc, SCALE);
    if (!r) { infoFailed++; continue; }
    fs.writeFileSync(path.join(OUT, "cards", `${slug(u.dict)}_info.png`), r.buf);
    infoWritten++; bytes += r.buf.length;
  } catch { infoFailed++; }
}

console.log(`\ncards written:  ${written.toLocaleString("en-US")}`);
console.log(`  no card found: ${missing.toLocaleString("en-US")}${missingNames.length ? ` (e.g. ${missingNames.join(", ")})` : ""}`);
console.log(`  failed decode: ${failed.toLocaleString("en-US")}`);
console.log(`  info cards:    ${infoWritten.toLocaleString("en-US")} written · ${infoMissing.toLocaleString("en-US")} with no info art · ${infoFailed.toLocaleString("en-US")} failed`);
console.log(`  total size:    ${(bytes / 1048576).toFixed(1)} MB at 1/${SCALE} scale`);
console.log(`  average:       ${written ? Math.round(bytes / written / 1024) : 0} KB each`);
