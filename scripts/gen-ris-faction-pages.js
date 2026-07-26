#!/usr/bin/env node
/**
 * One wiki page per RIS faction, plus a map image of its starting regions.
 *
 *   node scripts/gen-ris-faction-pages.js [--ris <dir>] [--out <dir>] [--only <faction,…>]
 *
 * Each page carries what Provincia can establish from the mod files:
 *   - the main-menu intro text, verbatim
 *   - starting settlements, with size, population and what is already built
 *   - starting characters and their roles
 *   - recruitable units with the requirements the mod states for each
 *   - a PNG highlighting the faction's starting regions
 *
 * MAPS ARE RENDERED, NOT SCREENSHOTTED. descr_regions gives every region an RGB key and
 * map_regions.tga is painted in those keys, so a faction's territory can be drawn exactly
 * from the same data Provincia's own map reads. Driving the app 236 times would be slower,
 * fragile, and would need redoing by hand whenever its UI changed.
 *
 * RECRUITMENT IS REPORTED, NOT EVALUATED. RIS has ~29,900 `recruit "unit" N requires …`
 * lines whose conditions mix faction lists, building tiers and region-specific hidden
 * resources. Deciding "can this faction actually build this today" needs a settlement and
 * a turn; what a wiki can honestly say is "this unit is available to you, and here is what
 * it requires". So the faction gate IS evaluated (it is a plain list) and everything else
 * is shown verbatim for the reader to judge.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const ONLY = (valOf("--only", "") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const NO_MAPS = argv.includes("--no-maps");

const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));
const tga = require(path.join(__dirname, "..", "src", "tgaCodec.js"));

const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const STRAT = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");


// ── display names ────────────────────────────────────────────────────────────
// text/export_buildings.txt (UTF-16LE) maps a building level token to the name the game
// shows: proconsuls_palace -> "Pro-Consul's Palace", gov4 -> "Homeland", mic_2 ->
// "Basic Armoury". Printing raw tokens made every page read like a data dump.
//
// NOTE units are NOT resolvable this way. Their text keys are not the EDU `type` string
// (`aor arab levy spearmen` has no entry, though `ballistas` does) - the mapping lives in
// each unit's `dictionary` field in export_descr_unit.txt, which is not wired up yet. Same
// for most region tags: resources.txt keys look like SMT_RESOURCE_GOLD and cover only the
// 104 standard goods, so custom tokens such as `rivertrade` have no display name.
function loadDisplayNames(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* fall back to the raw token */ }
  return map;
}
const BUILDING_NAMES = loadDisplayNames("export_buildings.txt");
/** Display name for a building level, or the token itself when there is no entry. */
const bName = (tok) => BUILDING_NAMES[String(tok).toLowerCase()] || null;

const NON_PLAYER = new Set(["slave", "roman_senate", "dummies"]);
const title = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── intro text (UTF-16LE) ────────────────────────────────────────────────────
function loadIntros() {
  const out = {};
  let t = null;
  try { t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le"); } catch { return out; }
  for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) {
    const k = m[1].toLowerCase();
    (out[k] = out[k] || {}).title = m[2].trim();
  }
  // A DESCR block runs from its tag to the next {TAG} or end of file.
  const tags = [...t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_DESCR\}/g)];
  for (let i = 0; i < tags.length; i++) {
    const k = tags[i][1].toLowerCase();
    const from = tags[i].index + tags[i][0].length;
    const nextTag = t.indexOf("{", from);
    const body = t.slice(from, nextTag < 0 ? undefined : nextTag);
    // The localised strings mark paragraph breaks as the two literal characters \ and n,
    // not as real newlines — they render as "\n\n" in the middle of a sentence unless
    // converted. Also strip the U+0013 the game uses before an attribution dash.
    (out[k] = out[k] || {}).descr = body
      .replace(/\r/g, "")
      .replace(/\\n/g, "\n")
      .replace(//g, "—")
      .split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
      .trim();
  }
  return out;
}

// ── starting characters ──────────────────────────────────────────────────────
function loadCharacters() {
  const per = {};
  const lines = (fs.readFileSync(STRAT, "latin1") || "").split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    let m = /^faction\s+([a-z0-9_]+)/i.exec(l);
    if (m) { cur = m[1].toLowerCase(); per[cur] = per[cur] || []; continue; }
    // `character <name>, <role>, age N, x N, y N …`
    m = /^character\s+([^,]+),\s*([a-z ]+)/i.exec(l);
    if (m && cur) {
      const age = /\bage\s+(\d+)/i.exec(l);
      per[cur].push({ name: m[1].trim().replace(/_/g, " "), role: m[2].trim(), age: age ? +age[1] : null });
    }
  }
  return per;
}

// ── recruitment ──────────────────────────────────────────────────────────────
// A `recruit "unit" N requires <expr>` line. The `factions { … }` clause is a plain list
// and IS evaluated; the rest of the expression is kept verbatim as the stated requirement.
function loadRecruitment() {
  const edb = rd("export_descr_buildings.txt") || "";
  const rows = [];
  for (const m of edb.matchAll(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+([^\r\n]+)/gm)) {
    const unit = m[1].trim();
    const expr = m[3].trim();
    // Positive gate: factions { a, b } — "all" means everyone.
    const pos = [];
    const neg = [];
    for (const fm of expr.matchAll(/(not\s+)?factions\s*\{([^}]*)\}/gi)) {
      const list = fm[2].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      (fm[1] ? neg : pos).push(...list);
    }
    // Everything that is not a faction clause is the requirement a player must meet.
    const conds = expr
      .replace(/(not\s+)?factions\s*\{[^}]*\}/gi, "")
      .replace(/\band\b/gi, " ")
      .split(/\s+/).filter((t) => t && !/^(is_player|or)$/i.test(t));
    rows.push({ unit, pos, neg, conds: [...new Set(conds)] });
  }
  return rows;
}

function recruitableBy(rows, faction) {
  const out = new Map();
  for (const r of rows) {
    const allowed = r.pos.includes("all") || r.pos.includes(faction);
    if (!allowed || r.neg.includes(faction)) continue;
    const prev = out.get(r.unit);
    // Several buildings may offer the same unit; keep the shortest requirement set, which
    // is the easiest route to it.
    if (!prev || r.conds.length < prev.length) out.set(r.unit, r.conds);
  }
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ── map rendering ────────────────────────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;                       // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** region name -> "r,g,b" key, from descr_regions' own colour line. */
function loadRegionColours() {
  const txt = rd("world", "maps", "base", "descr_regions.txt") || "";
  const lines = txt.split(/\r?\n/);
  const byRegion = {};
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;
    const region = lines[i].trim();
    // block: settlement, owner, rebel, "R G B", tags, …
    for (let k = i + 1; k < Math.min(i + 7, lines.length); k++) {
      const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(lines[k]);
      if (m) { byRegion[region] = `${+m[1]},${+m[2]},${+m[3]}`; break; }
    }
  }
  return byRegion;
}

function loadMapPixels() {
  // Read as BINARY. Going through a latin1 string mangles the pixel bytes and the decode
  // silently returns nothing, which is how the first run reported "map unavailable".
  try {
    const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
    const t = dg.tgaToRaw(fs.readFileSync(path.join(RIS, "world", "maps", "base", "map_regions.tga")));
    if (!t || !t.W || !t.raw) return null;
    return { width: t.W, height: t.H, raw: t.raw, bpp: t.raw.length / (t.W * t.H), desc: t.desc };
  } catch { return null; }
}

function renderFactionMap(mapRaw, regionColours, regions, scale) {
  const { width, height, raw, bpp, desc } = mapRaw;
  const want = new Set(regions.map((r) => regionColours[r]).filter(Boolean));
  const ow = Math.max(1, Math.floor(width / scale)), oh = Math.max(1, Math.floor(height / scale));
  const out = Buffer.alloc(ow * oh * 3);
  // TGA rows run bottom-to-top unless bit 5 of the descriptor is set, so the image needs
  // flipping or every map comes out upside down.
  const bottomUp = !(desc & 0x20);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(width - 1, x * scale);
      let sy = Math.min(height - 1, y * scale);
      if (bottomUp) sy = height - 1 - sy;
      const si = (sy * width + sx) * bpp;
      // Stored BGR, while descr_regions states colours as R G B — matching them in the
      // wrong order finds nothing at all, which is what the first attempt did.
      const b = raw[si], g = raw[si + 1], r = raw[si + 2];
      const key = `${r},${g},${b}`;
      const o = (y * ow + x) * 3;
      const isSea = r === 0 && g === 0 && b === 0;
      if (want.has(key)) { out[o] = 0xd9; out[o + 1] = 0x4f; out[o + 2] = 0x3f; }        // the faction
      else if (isSea) { out[o] = 0x1b; out[o + 1] = 0x28; out[o + 2] = 0x38; }           // water
      else { out[o] = 0x3a; out[o + 1] = 0x3a; out[o + 2] = 0x36; }                      // other land
    }
  }
  // How many of the faction's regions actually appear in the image. A region whose colour
  // key is absent from the map would silently not be drawn, so this is counted, and the
  // caller skips the image entirely rather than publishing an empty map.
  let painted = 0;
  for (let i = 0; i < out.length; i += 3) if (out[i] === 0xd9) { painted++; }
  return { buf: png(ow, oh, out), width: ow, height: oh, matched: want.size, painted };
}

// ── build ────────────────────────────────────────────────────────────────────
const strat = gv.parseStrat(STRAT);
if (!strat) { console.error("could not parse descr_strat"); process.exit(2); }
const intros = loadIntros();
const chars = loadCharacters();
const recruitRows = loadRecruitment();
const regionColours = loadRegionColours();
const mapRaw = NO_MAPS ? null : loadMapPixels();
const SCALE = 3;

console.log(`intro texts ${Object.keys(intros).length} · characters ${Object.values(chars).reduce((a, v) => a + v.length, 0)} · recruit lines ${recruitRows.length} · region colours ${Object.keys(regionColours).length} · map ${mapRaw ? mapRaw.width + "x" + mapRaw.height : "unavailable"}`);

const factions = Object.keys(strat)
  .filter((f) => !NON_PLAYER.has(f))
  .filter((f) => !ONLY.length || ONLY.includes(f))
  .sort();

fs.mkdirSync(path.join(OUT, "factions"), { recursive: true });
if (mapRaw) fs.mkdirSync(path.join(OUT, "maps"), { recursive: true });

const index = [];
let mapsWritten = 0, introsFound = 0;

for (const f of factions) {
  const setts = (strat[f].settlements || []);
  const intro = intros[f] || {};
  const display = intro.title || title(f);
  if (intro.descr) introsFound++;
  const cs = chars[f] || [];
  const units = recruitableBy(recruitRows, f);

  let mapLine = "";
  if (mapRaw && setts.length) {
    const m = renderFactionMap(mapRaw, regionColours, setts.map((s) => s.region), SCALE);
    if (m && m.painted > 0) {
      fs.writeFileSync(path.join(OUT, "maps", `${f}.png`), m.buf);
      mapsWritten++;
      mapLine = `![Starting regions of ${display}](../maps/${f}.png)\n\n_Starting regions shown in red._\n\n`;
    }
  }

  const body = `# ${display}

[← all factions](../factions.md) · [wiki index](../README.md)

${mapLine}${intro.descr ? `## The campaign brief\n\n> ${intro.descr.split("\n").filter((l) => l.trim()).join("\n>\n> ")}\n\n` : `> _The main-menu text for this faction was not found._\n\n`}## Starting settlements

${setts.length ? `${display} begins with **${setts.length} settlement${setts.length === 1 ? "" : "s"}**.

| Settlement | Size | Population | Already built |
|---|---|---:|---|
${setts.map((s) => `| ${s.region}${s.capital ? " **(capital)**" : ""} | ${String(s.level || "").replace(/_/g, " ")} | ${s.pop != null ? s.pop.toLocaleString("en-US") : "?"} | ${(s.buildings || []).length} building${(s.buildings || []).length === 1 ? "" : "s"} |`).join("\n")}

${setts.map((s) => `**${s.region}** — ${(s.buildings || []).length ? (s.buildings || []).map((b) => bName(b.level) || `\`${b.level}\``).join(", ") : "_nothing built_"}`).join("\n\n")}
` : "_This faction holds no settlements at the campaign start._"}

## Starting characters

${cs.length ? `| Name | Role | Age |
|---|---|---:|
${cs.map((c) => `| ${c.name} | ${c.role} | ${c.age != null ? c.age : "?"} |`).join("\n")}` : "_No starting characters are defined for this faction._"}

## Units you can recruit

${units.length ? `${units.length} unit type${units.length === 1 ? "" : "s"} are available to ${display}. The requirement column is what the mod states for the easiest route to that unit — a building level, a regional resource, or a technology.

| Unit | Requires |
|---|---|
${units.map(([u, conds]) => `| ${u} | ${conds.length ? conds.map((c) => `\`${c}\``).join(", ") : "_no further requirement_"} |`).join("\n")}

> Availability also depends on the settlement: many of these need a specific building
> level, and some need a resource only certain regions have. This list is what is open to
> the faction, not what any one town can raise today.` : "_No recruitable units resolved for this faction._"}
`;

  fs.writeFileSync(path.join(OUT, "factions", `${f}.md`), body, "utf8");
  index.push({ f, display, setts: setts.length, chars: cs.length, units: units.length, hasIntro: !!intro.descr });
}

// index page
index.sort((a, b) => b.setts - a.setts || a.display.localeCompare(b.display));
const idx = `# All factions

[← wiki index](README.md) · [factions overview](factions-overview.md)

${index.length} playable factions, each with its own page. Sorted by how much territory they
start with.

| Faction | Settlements | Characters | Recruitable units |
|---|---:|---:|---:|
${index.map((e) => `| [${e.display}](factions/${e.f}.md) | ${e.setts} | ${e.chars} | ${e.units} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "factions.md"), idx, "utf8");

console.log(`\n${index.length} faction pages written`);
console.log(`  with main-menu intro text: ${introsFound}`);
console.log(`  maps rendered:             ${mapsWritten}`);
console.log(`  no settlements:            ${index.filter((e) => !e.setts).length}`);
console.log(`  no units resolved:         ${index.filter((e) => !e.units).length}`);
