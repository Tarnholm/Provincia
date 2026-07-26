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

// Not real players: the rebel/slave pool, the Roman senate, the `dummies` test faction, and
// the six rebel-style factions that hold breakaway territory rather than being chosen.
const NON_PLAYER = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
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
    // Area-of-recruitment gate. RIS restricts regional units with a hidden_resource, which
    // is the engine's mechanism for "only in these provinces". Detected from the mechanism
    // rather than the name: 442 units carry both the `aor` naming convention and a
    // hidden_resource on every route, and the two signals disagree on only 5 of 1,135
    // units — 1 named unit with no gate, 4 gated units not named for it. The mechanism is
    // what the game enforces, so that is what is reported.
    rows.push({ unit, pos, neg, hr: /hidden_resource/i.test(expr), conds: [...new Set(conds)] });
  }
  return rows;
}

// Units this faction can raise, split into core and regional. A unit is regional only if
// EVERY route open to THIS faction is hidden_resource-gated: if a faction has one ungated
// route to a unit, that unit is core for them even where others need a resource for it.
function recruitableBy(rows, faction) {
  const out = new Map();
  for (const r of rows) {
    const allowed = r.pos.includes("all") || r.pos.includes(faction);
    if (!allowed || r.neg.includes(faction)) continue;
    const prev = out.get(r.unit);
    if (!prev) { out.set(r.unit, { conds: r.conds, aor: r.hr }); continue; }
    // Several buildings may offer the same unit; keep the shortest requirement set, which
    // is the easiest route to it. An ungated route anywhere makes the unit core.
    if (!r.hr) prev.aor = false;
    if (r.conds.length < prev.conds.length) prev.conds = r.conds;
  }
  const all = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    core: all.filter(([, v]) => !v.aor).map(([u, v]) => [u, v.conds]),
    aor: all.filter(([, v]) => v.aor).map(([u, v]) => [u, v.conds]),
    total: all.length,
  };
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
  const want = new Set(regions.map((r) => regionColours[r.region] || regionColours[r]).filter(Boolean));
  const capitals = new Set(regions.filter((r) => r && r.capital).map((r) => regionColours[r.region]).filter(Boolean));
  const bottomUp = !(desc & 0x20);

  // Read the source pixel at (x, y) as an "r,g,b" key. Stored BGR, rows bottom-up
  // unless bit 5 of the descriptor is set - both traps already cost a blank map once.
  const keyAt = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const sy = bottomUp ? height - 1 - y : y;
    const si = (sy * width + x) * bpp;
    return `${raw[si + 2]},${raw[si + 1]},${raw[si]}`;
  };

  const ow = Math.max(1, Math.floor(width / scale)), oh = Math.max(1, Math.floor(height / scale));
  const out = Buffer.alloc(ow * oh * 3);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= ow || y >= oh) return;
    const o = (y * ow + x) * 3;
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  };

  // Pass 1: land, sea, the faction's own regions, and REGION BOUNDARIES. A pixel whose
  // right or lower neighbour belongs to a different region is an edge, which is what makes
  // individual regions visible inside a faction's territory instead of one red blob.
  let painted = 0;
  const sumX = new Map(), sumY = new Map(), count = new Map();
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(width - 1, x * scale), sy = Math.min(height - 1, y * scale);
      const k = keyAt(sx, sy);
      const isSea = k === "0,0,0";
      const mine = want.has(k);
      const edge = !isSea && (k !== keyAt(sx + scale, sy) || k !== keyAt(sx, sy + scale));

      if (edge) put(x, y, 0x11, 0x11, 0x10);                       // region outline
      else if (mine) { put(x, y, 0xc8, 0x3c, 0x30); painted++; }    // the faction
      else if (isSea) put(x, y, 0x18, 0x25, 0x33);                  // water
      else put(x, y, 0x44, 0x44, 0x3e);                             // other land

      // Centroid accumulation, for settlement markers.
      if (mine) {
        sumX.set(k, (sumX.get(k) || 0) + x);
        sumY.set(k, (sumY.get(k) || 0) + y);
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
  }

  // Pass 2: a MARKER at each owned region's centroid, computed from the region's own
  // pixels so it always lands inside the territory - no coordinates needed from the
  // campaign file. Capitals get a larger ringed marker.
  let markers = 0;
  for (const [k, n] of count) {
    if (n < 4) continue;                                  // too small to mark legibly
    const cx = Math.round(sumX.get(k) / n), cy = Math.round(sumY.get(k) / n);
    const isCap = capitals.has(k);
    const r = isCap ? 3 : 2;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        put(cx + dx, cy + dy, 0xff, 0xf2, 0xd0);          // settlement dot
      }
    }
    if (isCap) {
      // A ring one pixel out, so the capital reads differently at a glance.
      for (let a = 0; a < 360; a += 12) {
        const rad = (a * Math.PI) / 180;
        put(cx + Math.round(Math.cos(rad) * (r + 2)), cy + Math.round(Math.sin(rad) * (r + 2)), 0x20, 0x20, 0x1c);
      }
    }
    markers++;
  }

  return { buf: png(ow, oh, out), width: ow, height: oh, matched: want.size, painted, markers };
}

// ── build ────────────────────────────────────────────────────────────────────
const strat = gv.parseStrat(STRAT);
if (!strat) { console.error("could not parse descr_strat"); process.exit(2); }
const intros = loadIntros();
const chars = loadCharacters();
const recruitRows = loadRecruitment();
const regionColours = loadRegionColours();
const mapRaw = NO_MAPS ? null : loadMapPixels();
const SCALE = 1;   // full 1020x700; boundaries and markers need the detail

console.log(`intro texts ${Object.keys(intros).length} · characters ${Object.values(chars).reduce((a, v) => a + v.length, 0)} · recruit lines ${recruitRows.length} · region colours ${Object.keys(regionColours).length} · map ${mapRaw ? mapRaw.width + "x" + mapRaw.height : "unavailable"}`);

// ── cross-links ──────────────────────────────────────────────────────────────
// The tables listed settlement and unit names as plain text, which made the wiki a set of
// dead ends: a reader looking at a roster could not get to the unit, and a reader looking at
// a province list could not get to the province. Unit pages are keyed by the EDU dictionary
// (AOR variants share one page), so the EDB unit type has to be mapped through it.
// Must match gen-ris-unit-pages.js exactly, or every unit link 404s.
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const unitSlug = (() => {
  const edu = rd("export_descr_unit.txt") || "";
  const byType = new Map();
  let cur = null;
  for (const raw of edu.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(line);
    if (m) { cur = m[1].trim().toLowerCase(); continue; }
    if (!cur) continue;
    m = /^dictionary\s+(\S+)/.exec(line);
    if (m) { byType.set(cur, slugify(m[1].trim().toLowerCase())); cur = null; }
  }
  return byType;
})();
const unitPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "units")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
const regionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "regions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
// Region files are named for the region itself, spaces and all, so the target needs encoding.
const regionLink = (name) => (regionPages.has(name)
  ? `[${name}](../regions/${encodeURIComponent(name)}.md)` : name);
const unitLink = (type) => {
  const s = unitSlug.get(String(type).toLowerCase());
  return s && unitPages.has(s) ? `[${type}](../units/${s}.md)` : type;
};

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

  // A one-line summary under the title, so the shape of a faction is readable before any
  // scrolling. 236 faction pages all opened with a map and then a wall of tables.
  const totalPop = setts.reduce((a, s) => a + (s.pop || 0), 0);
  const capital = setts.find((s) => s.capital);
  const glance = [
    `**${setts.length}** settlement${setts.length === 1 ? "" : "s"}`,
    capital ? `capital **${capital.region}**` : null,
    totalPop ? `**${totalPop.toLocaleString("en-US")}** people` : null,
    `**${cs.length}** character${cs.length === 1 ? "" : "s"}`,
    `**${units.core.length}** faction unit${units.core.length === 1 ? "" : "s"}`,
    units.aor.length ? `**${units.aor.length}** regional` : null,
  ].filter(Boolean).join(" · ");

  let mapLine = "";
  if (mapRaw && setts.length) {
    const m = renderFactionMap(mapRaw, regionColours, setts, SCALE);
    if (m && m.painted > 0) {
      fs.writeFileSync(path.join(OUT, "maps", `${f}.png`), m.buf);
      mapsWritten++;
      mapLine = `![Starting regions of ${display}](../maps/${f}.png)\n\n_Starting regions shown in red._\n\n`;
    }
  }

  const body = `# ${display}

[← all factions](../factions.md) · [wiki index](../README.md)

${glance}

${mapLine}${intro.descr ? `## The campaign brief\n\n> ${intro.descr.split("\n").filter((l) => l.trim()).join("\n>\n> ")}\n\n` : `> _The main-menu text for this faction was not found._\n\n`}## Starting settlements

${setts.length ? `${display} begins with **${setts.length} settlement${setts.length === 1 ? "" : "s"}** and about **${totalPop.toLocaleString("en-US")}** people.

| Settlement | Size | Population | Already built |
|---|---|---:|---|
${setts.map((s) => `| ${regionLink(s.region)}${s.capital ? " **(capital)**" : ""} | ${String(s.level || "").replace(/_/g, " ")} | ${s.pop != null ? s.pop.toLocaleString("en-US") : "?"} | ${(s.buildings || []).length} building${(s.buildings || []).length === 1 ? "" : "s"} |`).join("\n")}

<details>
<summary>What is already built in each settlement</summary>

${setts.map((s) => `**${regionLink(s.region)}** — ${(s.buildings || []).length ? (s.buildings || []).map((b) => bName(b.level) || `\`${b.level}\``).join(", ") : "_nothing built_"}`).join("\n\n")}

</details>
` : "_This faction holds no settlements at the campaign start._"}

## Starting characters

${cs.length ? `| Name | Role | Age |
|---|---|---:|
${cs.map((c) => `| ${c.name} | ${c.role} | ${c.age != null ? c.age : "?"} |`).join("\n")}` : "_No starting characters are defined for this faction._"}

## Units you can recruit

${units.total ? `${units.total} unit type${units.total === 1 ? "" : "s"} are available to ${display}: ${units.core.length} faction unit${units.core.length === 1 ? "" : "s"} and ${units.aor.length} regional. The requirement column is what the mod states for the easiest route to that unit.

### Faction units

${units.core.length ? `These are the backbone of the roster — available wherever ${display} holds a settlement with the right building.

| Unit | Requires |
|---|---|
${units.core.map(([u, conds]) => `| ${unitLink(u)} | ${conds.length ? conds.map((c) => `\`${c}\``).join(", ") : "_no further requirement_"} |`).join("\n")}` : `_${display} has no ungated units: every unit on its roster needs a regional resource._`}

### Regional units (AOR)

${units.aor.length ? `Area-of-recruitment units. Every route to these is gated on a hidden resource, so they can only be raised in the provinces that carry it — taking the right ground is the only way to field them. Most are open to every faction on paper, which is why the list is long and folded away.

<details>
<summary><strong>Show all ${units.aor.length} regional units</strong></summary>

| Unit | Requires |
|---|---|
${units.aor.map(([u, conds]) => `| ${unitLink(u)} | ${conds.length ? conds.map((c) => `\`${c}\``).join(", ") : "_no further requirement_"} |`).join("\n")}

</details>` : `_No area-of-recruitment units are open to ${display}._`}

> Availability also depends on the settlement: many of these need a specific building
> level, and some need a resource only certain regions have. This list is what is open to
> the faction, not what any one town can raise today.` : "_No recruitable units resolved for this faction._"}
`;

  fs.writeFileSync(path.join(OUT, "factions", `${f}.md`), body, "utf8");
  index.push({ f, display, setts: setts.length, chars: cs.length, units: units.total, aor: units.aor.length, hasIntro: !!intro.descr });
}

// index page
index.sort((a, b) => b.setts - a.setts || a.display.localeCompare(b.display));
const idx = `# All factions

[← wiki index](README.md) · [factions overview](factions-overview.md)

${index.length} playable factions, each with its own page. Sorted by how much territory they
start with.

The two unit columns are worth reading separately. "Faction units" are what a faction can
raise from its own buildings anywhere it holds a settlement — that is its actual roster.
"Regional" units are area-of-recruitment: gated on a hidden resource, so they need the
right province before they can be fielded at all. Most regional units are open to every
faction on paper, which is why the combined figure flatters a small faction badly.

| Faction | Settlements | Characters | Faction units | Regional (AOR) |
|---|---:|---:|---:|---:|
${index.map((e) => `| [${e.display}](factions/${e.f}.md) | ${e.setts} | ${e.chars} | ${e.units - e.aor} | ${e.aor} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "factions.md"), idx, "utf8");

console.log(`\n${index.length} faction pages written`);
console.log(`  with main-menu intro text: ${introsFound}`);
console.log(`  maps rendered:             ${mapsWritten}`);
console.log(`  no settlements:            ${index.filter((e) => !e.setts).length}`);
console.log(`  no units resolved:         ${index.filter((e) => !e.units).length}`);
