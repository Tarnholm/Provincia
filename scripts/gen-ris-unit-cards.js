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
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function convert(file, scale) {
  const t = dg.tgaToRaw(fs.readFileSync(file));
  if (!t || !t.W || !t.raw) return null;
  const bpp = t.raw.length / (t.W * t.H);
  const bottomUp = !(t.desc & 0x20);
  const ow = Math.max(1, Math.floor(t.W / scale)), oh = Math.max(1, Math.floor(t.H / scale));
  const out = Buffer.alloc(ow * oh * 3);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(t.W - 1, x * scale);
      let sy = Math.min(t.H - 1, y * scale);
      if (bottomUp) sy = t.H - 1 - sy;
      const si = (sy * t.W + sx) * bpp;
      const o = (y * ow + x) * 3;
      // Stored BGR — same order trap as the region map.
      out[o] = t.raw[si + 2]; out[o + 1] = t.raw[si + 1]; out[o + 2] = t.raw[si];
    }
  }
  return { buf: png(ow, oh, out), w: ow, h: oh };
}

// ── index every card file once, by its dictionary name ───────────────────────
function indexCards() {
  const root = path.join(RIS, "ui", "units");
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
      // `#akarnanian_hoplites.tga` -> akarnanian_hoplites
      const dict = n.replace(/^#/, "").replace(/\.tga$/i, "").toLowerCase();
      if (!byDict.has(dict)) byDict.set(dict, path.join(root, d, n));
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
const { byDict, files } = indexCards();
const units = loadUnits();
console.log(`card files found: ${files.toLocaleString("en-US")} across the ui/units folders · ${byDict.size.toLocaleString("en-US")} distinct card names`);
console.log(`units in the EDU: ${units.length.toLocaleString("en-US")} · with a dictionary key: ${units.filter((u) => u.dict).length.toLocaleString("en-US")}`);

fs.mkdirSync(path.join(OUT, "cards"), { recursive: true });
let written = 0, bytes = 0, missing = 0, failed = 0;
const missingNames = [];
const todo = LIMIT ? units.slice(0, LIMIT) : units;

for (const u of todo) {
  if (!u.dict) { missing++; continue; }
  const src = byDict.get(u.dict);
  if (!src) { missing++; if (missingNames.length < 8) missingNames.push(u.dict); continue; }
  try {
    const r = convert(src, SCALE);
    if (!r) { failed++; continue; }
    fs.writeFileSync(path.join(OUT, "cards", `${slug(u.type)}.png`), r.buf);
    written++; bytes += r.buf.length;
  } catch { failed++; }
}

console.log(`\ncards written:  ${written.toLocaleString("en-US")}`);
console.log(`  no card found: ${missing.toLocaleString("en-US")}${missingNames.length ? ` (e.g. ${missingNames.join(", ")})` : ""}`);
console.log(`  failed decode: ${failed.toLocaleString("en-US")}`);
console.log(`  total size:    ${(bytes / 1048576).toFixed(1)} MB at 1/${SCALE} scale`);
console.log(`  average:       ${written ? Math.round(bytes / written / 1024) : 0} KB each`);
