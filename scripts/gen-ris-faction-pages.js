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

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
// RIS ships only the files it changed, so art a mod inherits sits in the vanilla install and
// nowhere else. Kept as a second root for that reason; see loadSymbolFiles for what it found.
const VANILLA = valOf("--vanilla", "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data");
const ONLY = (valOf("--only", "") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const NO_MAPS = argv.includes("--no-maps");

const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));
const tga = require(path.join(__dirname, "..", "src", "tgaCodec.js"));
// For parseNamesTxt: names.txt maps a name TOKEN to the name the game displays.
const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
// The one TGA→PNG converter on this project. It handles 32bpp RLE and the alpha channel,
// which every faction symbol is (type 10, 32bpp) — a second decoder shipped 1,132 colour
// stripes here once already.
const { convert: tgaToPng } = require(path.join(__dirname, "lib", "tgaPng.js"));

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

// ── recruitment requirements in the game's own words ─────────────────────────
// The Requires column printed raw tokens: `requires_gov`, `building_present`, `academic`.
// Every layer of that has a real name somewhere, and the mod supplies most of them:
//
//   1. EDB `alias` blocks carry a `display_string` naming the condition as the game shows it.
//      510 aliases, 115 with a display_string, and all 115 resolve — `requires_gov` is
//      "Government Building", `any_transport` is "Roads or Trading Port or River Port or
//      above". This is the authoritative source and is tried first.
//   2. A building LEVEL resolves through text/export_buildings.txt as everywhere else.
//   3. A building CHAIN (`academic`) has no entry of its own; its name comes from the chain
//      page already generated for it ("Small School (Civic)").
//   4. Engine keywords are a short fixed glossary, kept deliberately literal.
//   5. Hidden resources (`aor_*`, `mic_tier_*`) have no display name anywhere in the mod, so
//      they are humanised from the token and nothing is invented for them.
//
// Anything still unrecognised stays a bare token rather than being guessed at, and the raw
// token is always shown alongside the name for anyone reading the files.
const ALIAS_TEXT = (() => {
  const edb = rd("export_descr_buildings.txt") || "";
  // Every text/*.txt is indexed once: display_string keys are spread across them
  // (REQUIRES_GOVERNMENT lives in expanded_bi.txt, not export_buildings.txt).
  const lut = {};
  try {
    const dir = path.join(RIS, "text");
    for (const f of fs.readdirSync(dir).filter((n) => /\.txt$/i.test(n))) {
      try {
        const t = fs.readFileSync(path.join(dir, f), "utf16le");
        for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) {
          const k = m[1].trim().toLowerCase();
          if (!(k in lut)) lut[k] = m[2].trim();
        }
      } catch { /* skip an unreadable text file */ }
    }
  } catch { /* no text dir */ }
  // The alias line may carry a trailing `;` comment — `alias noisland ; currently serving as
  // the core recruitment enabler` — so the name cannot be matched to end-of-line. Requiring
  // that silently skipped those aliases, and `noisland` alone is 18,672 of the tokens on
  // these pages.
  const out = {};
  let matched = 0;
  for (const m of edb.matchAll(/^[ \t]*alias[ \t]+(\S+)[^\r\n]*\r?\n[ \t]*\{([\s\S]*?)\n[ \t]*\}/gm)) {
    matched++;
    const ds = /display_string\s+(\S+)/.exec(m[2]);
    if (!ds) continue;
    const v = lut[ds[1].trim().toLowerCase()];
    if (v) out[m[1].toLowerCase()] = v;
  }
  // Reported so a regex that stops matching cannot pass for "the mod has no aliases".
  console.log(`aliases parsed: ${matched} · with a resolvable display_string: ${Object.keys(out).length}`);
  return out;
})();

// ── names as the game shows them, never the code name ────────────────────────
// RTW's naming mechanic: names.txt maps a UNIQUE token to a DISPLAY name, and many tokens
// share one display via a trailing-letter suffix — {AlexandrosB} and {AlexandrosC} are both
// "Alexandros". descr_strat references characters by token, so printing the token verbatim
// put `AbantidasA`, `AchaiosC`, `AdherbalA` on the pages. A character is `<first> <family>`,
// and each part resolves separately.
const NAME_TEXT = (() => {
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "names.txt"), "utf16le");
    return dg.parseNamesTxt(t).tokenToDisplay;
  } catch { return new Map(); }
})();
let namesResolved = 0, namesRaw = 0;
function displayName(raw) {
  const parts = String(raw).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return raw;
  const out = parts.map((p) => {
    const d = NAME_TEXT.get(p);
    if (d) { namesResolved++; return d; }
    namesRaw++;
    // No entry: strip the trailing variant letter that the token convention adds, and turn
    // an underscored family token into words. Better than the raw token, and it never
    // invents a name that is not already in the token.
    return p.replace(/([a-z])[A-Z]$/, "$1").replace(/_/g, " ");
  });
  return out.join(" ");
}

// Unit display names, read back from the unit pages, whose H1 is already the game's name for
// the unit. The roster tables were printing the EDB `type` instead - `ballistas`,
// `aspidophoroi3`, `akarnanian hoplites`. Reading the generated page keeps the roster and the
// page it links to from ever disagreeing.
const UNIT_NAMES = (() => {
  const out = {};
  try {
    const dir = path.join(OUT, "units");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const m = /^#\s+(.+?)\s*$/m.exec(fs.readFileSync(path.join(dir, f), "utf8").slice(0, 300));
      if (m) out[f.replace(/\.md$/, "").toLowerCase()] = m[1].trim();
    }
  } catch { /* unit pages not generated yet */ }
  return out;
})();

// Chain display names, read back from the chain pages so the two always agree.
const CHAIN_NAMES = (() => {
  const out = {};
  try {
    const dir = path.join(OUT, "buildings");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const head = fs.readFileSync(path.join(dir, f), "utf8").slice(0, 300);
      const m = /^#\s+(.+?)(?:\s+chain)?\s*$/m.exec(head);
      if (m) out[f.replace(/\.md$/, "").toLowerCase()] = m[1].trim();
    }
  } catch { /* chain pages not generated yet */ }
  return out;
})();

// Engine condition keywords. Literal readings only — no interpretation of game effects.
const KEYWORD_TEXT = {
  building_present: "has the building",
  building_present_min_level: "has the building at or above level",
  hidden_resource: "region has the resource",
  resource: "region has the resource",
  is_player: "player-controlled only",
  factions: "faction",
  event_counter: "event counter",
  major_event: "a major event has fired",
  not: "not",
  and: "and",
  or: "or",
};

// Every resource name the mod declares, hidden or tradeable — used only to decide whether a
// bare word is a resource at all, never to claim what it does.
const DECLARED_RESOURCES = (() => {
  const txt = rd("descr_sm_resources.txt") || "";
  const out = new Set();
  for (const m of txt.matchAll(/"([A-Za-z0-9_\-]+)"\s*:\s*\{/g)) {
    const n = m[1].toLowerCase();
    if (n !== "resources") out.add(n);
  }
  return out;
})();

// descr_strat's role words are engine terms, not what the game calls these people. "named
// character" is the file's way of saying a character with a name of his own — which in play is
// a general. The rest already read correctly and are only capitalised.
const ROLE_LABELS = { "named character": "General" };
const roleLabel = (r) => {
  const k = String(r).trim().toLowerCase();
  if (ROLE_LABELS[k]) return ROLE_LABELS[k];
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : r;
};

const humaniseTok = (t) => {
  const s = String(t).replace(/^(aor|homeland)_/, "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(t);
};

/**
 * A requirement token as the name a reader recognises.
 *
 * The name REPLACES the token rather than sitting beside it: "Tier 2 Military Industrial
 * Complex mic_tier_2" says the same thing twice, and the token is the half nobody reading a
 * wiki needs. The token is still printed when there is no name for it, because then it is the
 * only identifier available — that is information, not clutter.
 */
function condLabel(tok) {
  const k = String(tok).toLowerCase();
  const named = ALIAS_TEXT[k] || bName(k) || KEYWORD_TEXT[k] || null;
  if (named) return named;
  if (CHAIN_NAMES[k]) {
    const label = CHAIN_NAMES[k];
    return buildingPages.has(k) ? `[${label}](../buildings/${k}.md)` : label;
  }
  if (/^(aor|mic|homeland)_/.test(k)) return humaniseTok(k);
  // Hidden resources without a naming convention — `noisland` alone accounts for 18,672 of
  // these. Membership is taken from descr_sm_resources rather than from the token's shape, so
  // a word is only humanised when the mod actually declares it as a resource.
  if (DECLARED_RESOURCES.has(k)) return humaniseTok(k);
  return `\`${tok}\``;
}

// ── a requirement, as a sentence rather than a bag of words ──────────────────
// The Requires column used to be built by splitting the whole expression on whitespace and
// naming each word on its own, which produced "not, region has the resource, Arab, Egyptian,
// `noisland`" — every word true, the sentence meaningless, and the reader left to reassemble
// it. The clause is the unit of meaning: `not hidden_resource aor_arab` is one thing, and
// naming `not`, `hidden_resource` and `aor_arab` separately says none of it.
//
// This is the same split and the same resolution order gen-ris-unit-pages.js uses on the same
// lines, so a condition cannot read one way on a unit page and another way here.
function clausesOf(expr) {
  return expr
    .replace(/(not\s+)?factions\s*\{[^}]*\}/gi, " ")
    .replace(/\bnot\s+is_player\b/gi, " ").replace(/\bis_player\b/gi, " ")
    .split(/\band\b/i).map((s) => s.trim()).filter(Boolean);
}
function clauseLabel(c) {
  const neg = /^not\s+/i.test(c);
  const body = c.replace(/^not\s+/i, "").trim();
  return (neg ? "not " : "") + clauseBody(body);
}
function clauseBody(b) {
  if (/\bor\b/i.test(b)) {
    return b.split(/\bor\b/i).map((s) => clauseBody(s.trim())).filter(Boolean).join(" or ");
  }
  let m = /^hidden_resource\s+(\S+)$/i.exec(b);
  if (m) {
    const t = m[1].toLowerCase();
    return /^aor_/.test(t) ? `${humaniseTok(t)} area of recruitment` : condLabel(t);
  }
  m = /^resource\s+(\S+)$/i.exec(b);
  if (m) return DECLARED_RESOURCES.has(m[1].toLowerCase()) ? humaniseTok(m[1]) : `\`${m[1]}\``;
  m = /^building_present_min_level\s+\S+\s+(\S+)$/i.exec(b); if (m) return bName(m[1]) || condLabel(m[1]);
  m = /^building_present\s+(\S+)$/i.exec(b); if (m) return bName(m[1]) || condLabel(m[1]);
  m = /^(?:major_event|event_counter)\s+"?([A-Za-z0-9_]+)"?/i.exec(b); if (m) return humaniseTok(m[1]);
  return condLabel(b);
}
// A requirement may contain a pipe — the mod writes several of them that way ("Any Government
// | Tier 2 Colony not built") — and an unescaped one splits a markdown table row into extra
// columns, which is what these tables were doing.
const cell = (s) => String(s).replace(/\|/g, "\\|");

// Not real players: the rebel/slave pool, the Roman senate, the `dummies` test faction, and
// the six rebel-style factions that hold breakaway territory rather than being chosen.
//
// They get no page each, but they are not dropped either: they own territory (`slave` alone
// holds 502 of the 1,311 regions at the campaign start) and 74 unit types name one in a
// recruitment gate, so their names appear all over the wiki. Printed as plain text they read
// as broken links. They share ONE reference page, written at the foot of this file, and it is
// never counted as playable.
// MUST match the list in gen-ris-unit-pages.js, which links to that page.
const NON_PLAYER = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
const NON_PLAYABLE_FILE = "non-playable.md";
const title = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── settlements ──────────────────────────────────────────────────────────────
// descr_strat only names the REGION a settlement sits in; the settlement's own name is in
// descr_regions, on the line after the region name. They are almost never the same word —
// 1,293 of 1,311 differ (region Akarnania, settlement Stratos; region Roma, settlement Rome)
// — so a table that showed only the region hid the name the player actually sees on the map,
// and left the settlement with nothing to click.
//
// Settlements get no page of their own: each region has exactly one settlement and the region
// page already documents it (size, population, buildings, owner), so the settlement links
// there. A stub page per settlement would be 1,311 files repeating the region page.
function loadSettlementNames() {
  const txt = rd("world", "maps", "base", "descr_regions.txt") || "";
  const lines = txt.split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;
    const region = lines[i].trim();
    const s = (lines[i + 1] || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*$/.test(s)) continue;
    out[region] = s;
  }
  return out;
}
const SETTLEMENT_OF = loadSettlementNames();
// Region AND settlement tokens both resolve here — `Ager_Gallicus` displays "Ager Gallicus",
// `Sena_Gallica` displays "Sena Gallica". All 1,311 of each resolve, so nothing is humanised
// by guesswork.
const PLACE_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "imperial_campaign_regions_and_settlement_names.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) out[m[1].trim()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return out;
})();
let placesResolved = 0, placesRaw = 0;
const placeName = (tok) => {
  const v = PLACE_NAMES[tok];
  if (v) { placesResolved++; return v; }
  placesRaw++;
  return String(tok).replace(/_/g, " ");
};

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
      per[cur].push({ name: m[1].trim().replace(/_/g, " "), role: roleLabel(m[2].trim()), age: age ? +age[1] : null });
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
    // Everything that is not a faction clause is the requirement a player must meet, kept as
    // whole `and`-clauses so each one can be named as the single condition it is.
    const conds = clausesOf(expr);
    // Area-of-recruitment gate. RIS restricts regional units with a hidden_resource, which
    // is the engine's mechanism for "only in these provinces". Detected from the mechanism
    // rather than the name: 442 units carry both the `aor` naming convention and a
    // hidden_resource on every route, and the two signals disagree on only 5 of 1,135
    // units — 1 named unit with no gate, 4 gated units not named for it. The mechanism is
    // what the game enforces, so that is what is reported.
    // Player and AI recruitment are SEPARATE lines and the AI's are far laxer — most require
    // only `noisland`. A faction page must quote the player's, or it tells a reader that a unit
    // needing a tier-2 military building needs no building at all. The line is tagged rather
    // than dropped, so a unit the AI alone can raise still appears on the roster with the only
    // requirement the mod states for it.
    rows.push({ unit, pos, neg, player: !/\bnot\s+is_player\b/i.test(expr), hr: /hidden_resource/i.test(expr), conds: [...new Set(conds)] });
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
    if (!prev) { out.set(r.unit, { conds: r.conds, aor: r.hr, player: r.player }); continue; }
    // Several buildings may offer the same unit; keep the shortest requirement set, which
    // is the easiest route to it. An ungated route anywhere makes the unit core. A player
    // route always beats an AI one, however long, because the AI's is not the reader's.
    if (!r.hr) prev.aor = false;
    if (r.player && !prev.player) { prev.conds = r.conds; prev.player = true; continue; }
    if (r.player === prev.player && r.conds.length < prev.conds.length) prev.conds = r.conds;
  }
  const all = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    core: all.filter(([, v]) => !v.aor).map(([u, v]) => [u, v.conds]),
    aor: all.filter(([, v]) => v.aor).map(([u, v]) => [u, v.conds]),
    total: all.length,
  };
}

// ── map rendering ────────────────────────────────────────────────────────────
// The whole renderer lives in scripts/lib/factionMap.js — region pixels, ownership,
// faction colours, settlement positions and the fixed window are all established there,
// together with the TGA traps (BGR order, bottom-up rows, binary read) that a second copy
// of this code would have to re-learn.
const fmap = require(path.join(__dirname, "lib", "factionMap.js"));

// ── faction symbols ──────────────────────────────────────────────────────────
// The symbol beside each map is the faction's own emblem, the same art Provincia's
// FactionIcon shows in the app (src/FactionIcon.js reads <iconsDir>/<faction>.tga out of
// data/ui/faction_icons).
//
// The PATH IS READ FROM THE MOD, not assumed from the faction token: descr_sm_factions.txt
// gives every faction a `"loading screen icon": "data/ui/faction_icons/carthage.tga"` line,
// and that is the only place the mod itself states which file belongs to which faction. All
// 239 faction blocks declare one.
//
// NO FALLBACK. FactionIcon falls back to slave.tga so the app always has something to draw;
// a wiki page must not, because slave.tga is the rebel emblem and printing it under a
// faction's name would be showing a symbol that is not theirs. A faction whose file is
// missing gets no symbol and is named in the run output.
const ICON_SCALE = 3;      // 360px source → 120px, exact; the four 512px files → 170px
const SYMBOL_BOX = 120;    // displayed size, so one large source cannot dwarf the others
function loadSymbolFiles() {
  const txt = rd("descr_sm_factions.txt") || "";
  const out = {};
  let declared = 0, fromVanilla = 0;
  const marks = [...txt.matchAll(/^\t"([a-z0-9_]+)":/gm)];
  for (let i = 0; i < marks.length; i++) {
    const block = txt.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : txt.length);
    const m = /"loading screen icon":\s*"([^"]+)"/.exec(block);
    if (!m) continue;
    declared++;
    // The declared path is relative to the install root and starts with `data/`; both roots
    // ARE that data directory, so the prefix comes off.
    const rel = m[1].replace(/^data[\\/]/, "").replace(/\\/g, "/");
    for (const root of [RIS, VANILLA]) {
      const p = path.join(root, rel);
      if (!fs.existsSync(p)) continue;
      out[marks[i][1].toLowerCase()] = p;
      if (root === VANILLA) fromVanilla++;
      break;
    }
  }
  console.log(`faction symbols declared in descr_sm_factions: ${declared} · files found: ${Object.keys(out).length} (${fromVanilla} only in the vanilla install)`);
  return out;
}
const SYMBOL_FILE = loadSymbolFiles();

// Culture, from the same file, read the same way. This is the axis the game itself organises
// factions on — culture picks the architecture a settlement is drawn with, the government
// levels available, and much of what the roster looks like — so it is the useful way to group
// 230 factions for someone deciding who to play. The non-playable section below parses this
// again for its own nine; both go to descr_sm_factions and neither guesses from the token.
const FACTION_CULTURE = (() => {
  const txt = rd("descr_sm_factions.txt") || "";
  const out = {};
  const marks = [...txt.matchAll(/^\t"([a-z0-9_]+)":/gm)];
  for (let i = 0; i < marks.length; i++) {
    const block = txt.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : txt.length);
    const m = /"culture":\s*"([^"]+)"/.exec(block);
    if (m) out[marks[i][1].toLowerCase()] = m[1].toLowerCase();
  }
  return out;
})();

// The OTHER axis the same file declares for every faction, and which these pages showed
// nowhere: `"default religion": "italic"`. It is not culture — the two are independent in RIS,
// and several cultures spread their factions across half a dozen beliefs — and it is what the
// temples and government levels in export_descr_buildings.txt actually test through their
// `faction_religion_<belief>` aliases. All 239 faction blocks declare one; the count is in the
// run output so a parser that stopped matching cannot pass for a file that stopped declaring.
const FACTION_RELIGION = (() => {
  const txt = rd("descr_sm_factions.txt") || "";
  const out = {};
  const marks = [...txt.matchAll(/^\t"([a-z0-9_]+)":/gm)];
  for (let i = 0; i < marks.length; i++) {
    const block = txt.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : txt.length);
    const m = /"default religion":\s*"([^"]+)"/.exec(block);
    if (m) out[marks[i][1].toLowerCase()] = m[1].toLowerCase();
  }
  return out;
})();
// A second, independent count of the same thing: a flat pattern over the whole file, no block
// structure involved.
const RAW_RELIGION_LINES = ((rd("descr_sm_factions.txt") || "").match(/"default religion"\s*:\s*"[a-z_]+"/g) || []).length;

// The pages that say what a culture and a belief decide. Read rather than recomputed — the
// index each generator publishes carries the page name AND the heading it is titled with, so
// the link text here cannot drift from the page it lands on.
let CULTURE_INDEX = {};
try { CULTURE_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "cultures", "index.json"), "utf8")); }
catch { /* run gen-ris-culture-pages.js first; until then the culture is plain text */ }
let RELIGION_INDEX = {};
try { RELIGION_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "religions", "index.json"), "utf8")); }
catch { /* run gen-ris-belief-pages.js first; until then the belief is plain text */ }
let cultureLinked = 0, religionLinked = 0;
const cultureUnlinked = new Set(), religionUnlinked = new Set();
function cultureRef(tok, rel) {
  if (!tok) return null;
  const e = CULTURE_INDEX[String(tok).toLowerCase()];
  if (!e) { if (Object.keys(CULTURE_INDEX).length) cultureUnlinked.add(String(tok).toLowerCase()); return null; }
  cultureLinked++;
  return `[${e.name}](${rel}cultures/${e.page})`;
}
function religionRef(tok, rel) {
  if (!tok) return null;
  const e = RELIGION_INDEX[String(tok).toLowerCase()];
  if (!e) { if (Object.keys(RELIGION_INDEX).length) religionUnlinked.add(String(tok).toLowerCase()); return null; }
  religionLinked++;
  const p = e.icon ? `<img src="${rel}${e.icon}" alt="" width="16" height="16" style="vertical-align:text-bottom"> ` : "";
  return `${p}[${e.name}](${rel}religions/${e.page})`;
}

// What the GAME calls each culture, which is not what the files call it. Three of the twenty-two
// carry a name the token would have got wrong: `barbarian` is **Gallic**, `eastern` is
// **Caucasian**, `carthaginian` is **Phoenician**. Printing the token would have mislabelled
// 44 + 9 + 5 factions.
//
// Two independent keys exist and neither covers everything on its own: a bare `{<culture>}`
// entry (all 22) and a `{<culture>_label}` entry (13). They AGREE on every culture that has
// both, which is what makes the bare key trustworthy where it stands alone; the disagreements
// against menu_english's `{UI_<CULTURE>}` are exactly the three renames above, and the run
// output names them so a future rename cannot slip past unnoticed.
const CULTURE_NAMES = (() => {
  const map = {};
  let files = [];
  try { files = fs.readdirSync(path.join(RIS, "text")).filter((n) => /\.txt$/i.test(n) && !/_mac_/.test(n)); } catch { /* none */ }
  for (const f of files) {
    let t = "";
    try { t = fs.readFileSync(path.join(RIS, "text", f), "utf16le"); } catch { continue; }
    for (const m of t.matchAll(/\{([A-Za-z0-9_]+)\}(.*)/g)) {
      const k = m[1].trim().toLowerCase();
      if (!(k in map)) map[k] = m[2].trim();
    }
  }
  return map;
})();
const cultureNamed = { bare: 0, label: 0, ui: 0, none: [] };
const cultureRenames = [];
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
function cultureName(tok) {
  if (!tok) return null;
  const t = String(tok).toLowerCase();
  const bare = CULTURE_NAMES[t], label = CULTURE_NAMES[`${t}_label`], ui = CULTURE_NAMES[`ui_${t}`];
  if (bare && ui && bare.toLowerCase() !== ui.toLowerCase() && !cultureRenames.some((r) => r[0] === t)) {
    cultureRenames.push([t, bare, ui]);
  }
  if (bare) { cultureNamed.bare++; return bare; }
  if (label) { cultureNamed.label++; return label; }
  if (ui) { cultureNamed.ui++; return titleCase(ui); }
  if (!cultureNamed.none.includes(t)) cultureNamed.none.push(t);
  return null;
}

// ── build ────────────────────────────────────────────────────────────────────
const strat = gv.parseStrat(STRAT);
if (!strat) { console.error("could not parse descr_strat"); process.exit(2); }
const intros = loadIntros();
const chars = loadCharacters();
const recruitRows = loadRecruitment();
const parsers = require(path.join(__dirname, "..", "src", "parsers.js"));
const world = NO_MAPS ? null : fmap.loadWorld({ risDir: RIS, dg, parsers, strat });

console.log(`intro texts ${Object.keys(intros).length} · characters ${Object.values(chars).reduce((a, v) => a + v.length, 0)} · recruit lines ${recruitRows.length}`);
if (world) {
  const s = world.stats;
  console.log(`map ${world.W}x${world.H} · regions ${s.regions} · settlement pixels ${s.settlements} placed ${s.placed} · regions claimed ${s.claimed} (${s.doubleClaimed} claimed twice, first block wins; ${s.regions - s.claimed} unclaimed) · faction colours ${s.colours}/${world.factions.length}${world.noColour.length ? ` · NO COLOUR DECLARED: ${world.noColour.join(", ")}` : ""}`);
  console.log(`window ${fmap.WIN_W}x${fmap.WIN_H} at 1:1, identical for every faction`);
}

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
// The LABEL is the game's name for the region, never the token: the file has to stay
// `Ager_Gallicus.md` but a reader should see "Ager Gallicus".
const regionLink = (name) => (regionPages.has(name)
  ? `[${placeName(name)}](../regions/${encodeURIComponent(name)}.md)` : placeName(name));
const settlementPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "settlements")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
// The settlement, pointed at its OWN page. It used to point at the region page, because a
// settlement had none; now the town — its size, population, what is built and what it can
// raise — is documented in one place of its own and this is that place. The region cell beside
// it still goes to the land.
const settlementLink = (region) => {
  const s = SETTLEMENT_OF[region];
  if (!s) return "_not determined_";
  return settlementPages.has(s)
    ? `[${placeName(s)}](../settlements/${encodeURIComponent(s)}.md)`
    : regionPages.has(region) ? `[${placeName(s)}](../regions/${encodeURIComponent(region)}.md)` : placeName(s);
};
/** "Stratos (Akarnania)", or just the one name where the mod uses the same word for both. */
const settlementAndRegion = (region) => {
  const s = SETTLEMENT_OF[region];
  if (!s) return regionLink(region);
  return placeName(s) === placeName(region)
    ? settlementLink(region) : `${settlementLink(region)}, in ${regionLink(region)}`;
};
const unitLink = (type) => {
  const s = unitSlug.get(String(type).toLowerCase());
  if (!s || !unitPages.has(s)) return UNIT_NAMES[String(type).toLowerCase()] || type;
  // The game's name for the unit, with the EDB type kept for anyone reading the files.
  const label = UNIT_NAMES[s] || type;
  return `[${label}](../units/${s}.md)`;
};
// Building chain pages are named for the chain's internal token, so a built level links
// through to the chain it belongs to — what it does, what it costs, what it upgrades into.
const buildingPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "buildings")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
const buildingLink = (b) => {
  const label = bName(b.level) || `\`${b.level}\``;
  return b.chain && buildingPages.has(String(b.chain)) ? `[${label}](../buildings/${b.chain}.md)` : label;
};

const factions = Object.keys(strat)
  .filter((f) => !NON_PLAYER.has(f))
  .filter((f) => !ONLY.length || ONLY.includes(f))
  .sort();

fs.mkdirSync(path.join(OUT, "factions"), { recursive: true });
if (world) fs.mkdirSync(path.join(OUT, "maps"), { recursive: true });
fs.mkdirSync(path.join(OUT, "symbols"), { recursive: true });

const index = [];
let mapsWritten = 0, introsFound = 0;
let symbolsWritten = 0, symbolBytes = 0;
const noSymbol = [];
// Map bookkeeping, reported at the end: the window is fixed, so what varies per faction is
// only whether it had to be clamped against the map edge and how much red ends up in it.
const mapStat = { bytes: 0, clamped: [], overflowed: [], dims: new Map(), minSubject: null, maxSubject: null };

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
  // Culture and belief lead the line, because they are what the faction IS rather than what it
  // happens to hold at turn 0, and because both were previously on the page nowhere at all —
  // the belief in particular, which every one of the 239 faction blocks declares and which
  // decides what its temples and governments generate. Where the reference page for one of them
  // has not been generated, the value is still stated, in the mod's own words, unlinked.
  const cultureTok = FACTION_CULTURE[f] || null;
  const religionTok = FACTION_RELIGION[f] || null;
  const cultureCell = cultureRef(cultureTok, "../") || (cultureTok ? `\`${cultureTok}\`` : null);
  const religionCell = religionRef(religionTok, "../") || (religionTok ? `\`${religionTok}\`` : null);
  const glance = [
    cultureCell ? `**${cultureCell}** culture` : "culture _not determined_",
    religionCell ? `believes ${religionCell}` : "belief _not determined_",
    `**${setts.length}** settlement${setts.length === 1 ? "" : "s"}`,
    // The capital is a city, so name the city — "capital Stratos", not "capital Akarnania".
    capital ? `capital **${SETTLEMENT_OF[capital.region] ? placeName(SETTLEMENT_OF[capital.region]) : placeName(capital.region)}**` : null,
    totalPop ? `**${totalPop.toLocaleString("en-US")}** people` : null,
    `**${cs.length}** character${cs.length === 1 ? "" : "s"}`,
    `**${units.core.length}** faction unit${units.core.length === 1 ? "" : "s"}`,
    units.aor.length ? `**${units.aor.length}** regional` : null,
  ].filter(Boolean).join(" · ");

  // The symbol, converted from the mod's TGA. Width AND height are stated on the tag: an
  // <img> without them has no size until the bytes arrive, and 230 of those relaying their
  // dimensions mid-layout pegged a CPU on this wiki earlier. Both are written from the PNG
  // that was actually produced, scaled to one box so a 512px source and a 360px one match.
  let symImg = "";
  if (SYMBOL_FILE[f]) {
    const s = tgaToPng(dg, SYMBOL_FILE[f], ICON_SCALE);
    if (s) {
      fs.writeFileSync(path.join(OUT, "symbols", `${f}.png`), s.buf);
      symbolsWritten++; symbolBytes += s.buf.length;
      const w = SYMBOL_BOX, h = Math.max(1, Math.round((s.h / s.w) * SYMBOL_BOX));
      // & and " would break the viewer's un-escaping of embedded HTML.
      const alt = display.replace(/[&"<>]/g, "").trim();
      // vertical-align is for the renderers that do NOT float these — GitHub lays the symbol
      // and the map out as two inline images, and inline images sit on the text baseline, so
      // without this the symbol hangs off the BOTTOM edge of a 700px map. The viewer centres
      // them itself (p.imgrow), where this attribute is simply inert.
      symImg = `<img src="../symbols/${f}.png" alt="${alt}" width="${w}" height="${h}" style="vertical-align:middle">`;
    } else noSymbol.push(`${f} (TGA would not decode)`);
  } else noSymbol.push(`${f} (no symbol file)`);

  // Symbol and map are ONE paragraph, so the viewer floats them side by side out of the same
  // lede block and the campaign brief wraps to the right of both. The map keeps the markdown
  // form: the viewer caps a floated image at 42% of the column, and an <img> whose width is
  // capped while a height attribute holds it at its full height squashes on any renderer
  // that does not also set height:auto. The symbol is 120px and never gets capped.
  let mapLine = "";
  if (world && setts.length) {
    const m = fmap.render(world, f, setts.map((s) => s.region));
    if (m && m.counts.subjectPx > 0) {
      fs.writeFileSync(path.join(OUT, "maps", `${f}.png`), m.buf);
      mapsWritten++;
      mapStat.bytes += m.buf.length;
      mapStat.dims.set(`${m.w}x${m.h}`, (mapStat.dims.get(`${m.w}x${m.h}`) || 0) + 1);
      if (m.win.clamped) mapStat.clamped.push(f);
      if (!m.win.fits) mapStat.overflowed.push(`${f} (${m.win.terr.w}x${m.win.terr.h})`);
      const sp = m.counts.subjectPx;
      if (!mapStat.minSubject || sp < mapStat.minSubject[1]) mapStat.minSubject = [f, sp];
      if (!mapStat.maxSubject || sp > mapStat.maxSubject[1]) mapStat.maxSubject = [f, sp];
      // The caption has to say what the reader is looking at, because the map now shows the
      // neighbours too and the fixed zoom is the whole point: without it, "small" reads as a
      // rendering accident rather than as the fact it is.
      mapLine = `${symImg}${symImg ? " " : ""}![Starting territory of ${display}, with its neighbours](../maps/${f}.png)\n\n_${display} in red, picked out by a pale outline and corner marks. Every other faction is in the colour it flies. Thin dark lines are region boundaries; each dot is a settlement. **Every faction map on this wiki is drawn at the same scale and the same size**, centred on that faction — so a small faction looks small._\n\n`;
    }
  }
  if (!mapLine && symImg) mapLine = `${symImg}\n\n`;

  const body = `# ${display}

[← all factions](../factions.md) · [wiki index](../README.md)

${glance}

${mapLine}${intro.descr ? `## The campaign brief\n\n> ${intro.descr.split("\n").filter((l) => l.trim()).join("\n>\n> ")}\n\n` : `> _The main-menu text for this faction was not found._\n\n`}## Starting settlements

${setts.length ? `${display} begins with **${setts.length} settlement${setts.length === 1 ? "" : "s"}** and **${totalPop.toLocaleString("en-US")}** people.

| Settlement | Region | Size | Population | Already built |
|---|---|---|---:|---|
${setts.map((s) => `| ${settlementLink(s.region)}${s.capital ? " **(capital)**" : ""} | ${regionLink(s.region)} | ${String(s.level || "").replace(/_/g, " ")} | ${s.pop != null ? s.pop.toLocaleString("en-US") : "?"} | ${(s.buildings || []).length} building${(s.buildings || []).length === 1 ? "" : "s"} |`).join("\n")}

<details>
<summary>What is already built in each settlement</summary>

${setts.map((s) => `**${settlementAndRegion(s.region)}** — ${(s.buildings || []).length ? (s.buildings || []).map((b) => buildingLink(b)).join(", ") : "_nothing built_"}`).join("\n\n")}

</details>
` : "_This faction holds no settlements at the campaign start._"}

## Starting characters

${cs.length ? `| Name | Role | Age |
|---|---|---:|
${cs.map((c) => `| ${displayName(c.name)} | ${c.role} | ${c.age != null ? c.age : "?"} |`).join("\n")}` : "_No starting characters are defined for this faction._"}

## Units you can recruit

${units.total ? `${units.total} unit type${units.total === 1 ? "" : "s"} are available to ${display}: ${units.core.length} faction unit${units.core.length === 1 ? "" : "s"} and ${units.aor.length} regional. The requirement column is what the mod states for the easiest route to that unit.

### Faction units

${units.core.length ? `| Unit | Requires |
|---|---|
${units.core.map(([u, conds]) => `| ${unitLink(u)} | ${conds.length ? conds.map((c) => cell(clauseLabel(c))).join(" · ") : "_no further requirement_"} |`).join("\n")}` : `_${display} has no ungated units: every unit on its roster needs a regional resource._`}

### Regional units (AOR)

${units.aor.length ? `<details>
<summary><strong>Show all ${units.aor.length} regional units</strong></summary>

| Unit | Requires |
|---|---|
${units.aor.map(([u, conds]) => `| ${unitLink(u)} | ${conds.length ? conds.map((c) => cell(clauseLabel(c))).join(" · ") : "_no further requirement_"} |`).join("\n")}

</details>` : `_No area-of-recruitment units are open to ${display}._`}
` : "_No recruitable units resolved for this faction._"}
`;

  fs.writeFileSync(path.join(OUT, "factions", `${f}.md`), body, "utf8");
  index.push({ f, display, setts: setts.length, chars: cs.length, units: units.total, aor: units.aor.length, hasIntro: !!intro.descr, culture: FACTION_CULTURE[f] || null, symbol: !!symImg });
}

// ── the nine that are not playable ───────────────────────────────────────────
// One page for all of them. Everything on it is read from the mod: the display name the game
// shows, the mod's OWN description verbatim where it wrote one, the culture from
// descr_sm_factions, what it holds at the campaign start from descr_strat, and whether a
// spawn script exists for it. Nothing about their purpose is inferred beyond what those files
// say — where the mod is silent the page says so.
{
  const EXPANDED = loadDisplayNames("expanded_bi.txt");
  // The faction-select blurb is "Name\nroster summary", the two joined by a literal \ and n.
  const blurb = (f) => {
    const v = EXPANDED[`${f}_descr`];
    if (!v) return null;
    const parts = v.replace(/\\n/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || null;
  };
  const npName = (f) => (intros[f] && intros[f].title) || EXPANDED[f] || title(f);

  // Culture, from the file that assigns it.
  const CULTURE = (() => {
    const txt = rd("descr_sm_factions.txt") || "";
    const out = {};
    const marks = [...txt.matchAll(/^\t"([a-z0-9_]+)":/gm)];
    for (let i = 0; i < marks.length; i++) {
      const block = txt.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : txt.length);
      const m = /"culture":\s*"([^"]+)"/.exec(block);
      if (m) out[marks[i][1]] = m[1];
    }
    return out;
  })();

  // A spawn script is hard evidence that a faction is placed on the map by the campaign
  // script rather than chosen — `seleucid_revolt1.txt` waits on a hidden resource and then
  // funds seleucid_rebels. Read from the directory, not assumed from the name.
  const SPAWN = (() => {
    const dir = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "spawn_scripts");
    const out = {};
    let files = [];
    try { files = fs.readdirSync(dir).filter((n) => /\.txt$/i.test(n)); } catch { return out; }
    for (const n of files) {
      let t = ""; try { t = fs.readFileSync(path.join(dir, n), "latin1"); } catch { continue; }
      for (const f of NON_PLAYER) if (new RegExp(`\\b${f}\\b`).test(t)) (out[f] = out[f] || []).push(n);
    }
    return out;
  })();

  // How many UNIT TYPES name each of them in a recruitment gate — the reason their names leak
  // onto unit pages in the first place. Counted as distinct units, not as `recruit` lines: one
  // unit is offered by several building levels, so the line count is 5-10x higher and would
  // read as far more of the roster than it is.
  const gateUnits = {};
  for (const r of recruitRows) for (const f of r.pos) if (NON_PLAYER.has(f)) (gateUnits[f] = gateUnits[f] || new Set()).add(r.unit.toLowerCase());
  const gateCount = {};
  for (const [f, s] of Object.entries(gateUnits)) gateCount[f] = s.size;

  const nine = [...NON_PLAYER].sort((a, b) => npName(a).localeCompare(npName(b)));
  // `seleucid_rebels` and `seleucid_rebels2` are both displayed "Seleucid Rebels", so the
  // heading has to carry the token or the page has two sections with the same name.
  const nameCount = {};
  for (const f of nine) nameCount[npName(f)] = (nameCount[npName(f)] || 0) + 1;
  const heading = (f) => (nameCount[npName(f)] > 1 ? `${npName(f)} (\`${f}\`)` : npName(f));
  const heldBy = (f) => ((strat[f] && strat[f].settlements) || []);

  const rowsMd = nine.map((f) => {
    const held = heldBy(f);
    const cu = cultureRef(CULTURE[f], "../") || (CULTURE[f] ? `\`${CULTURE[f]}\`` : "_not determined_");
    const re = religionRef(FACTION_RELIGION[f], "../") || (FACTION_RELIGION[f] ? `\`${FACTION_RELIGION[f]}\`` : "_not determined_");
    return `| **${npName(f)}** | \`${f}\` | ${cu} | ${re} | ${held.length ? `${held.length} region${held.length === 1 ? "" : "s"}` : "none" } | ${gateCount[f] ? `${gateCount[f]} unit type${gateCount[f] === 1 ? "" : "s"}` : "—"} |`;
  }).join("\n");

  const sections = nine.map((f) => {
    const held = heldBy(f);
    const own = intros[f] && intros[f].descr ? intros[f].descr : null;
    const b = blurb(f);
    const spawn = SPAWN[f];
    // 502 links in one place is a lot; the region list is folded away and capped, with the
    // remainder counted rather than dropped in silence.
    const CAP = 60;
    const list = held.map((s) => s.region);
    return `### ${heading(f)}

\`${f}\` · culture ${cultureRef(CULTURE[f], "../") || `\`${CULTURE[f] || "not determined"}\``} · believes ${religionRef(FACTION_RELIGION[f], "../") || `\`${FACTION_RELIGION[f] || "not determined"}\``}${b ? ` · ${b}` : ""}

${own ? `The mod's own text for this faction, verbatim:\n\n> ${own.split("\n").filter((l) => l.trim()).join("\n>\n> ")}\n` : `_The mod ships no campaign description for this faction._\n`}
${spawn ? `Placed on the map by the campaign script, not chosen: \`${spawn.join("`, `")}\` in \`spawn_scripts/\` names it.\n` : `_No spawn script in \`spawn_scripts/\` names it._\n`}
${held.length ? `**Holds ${held.length} region${held.length === 1 ? "" : "s"} at the campaign start.**

<details>
<summary>Which regions</summary>

${list.slice(0, CAP).map((r) => `${settlementAndRegion(r)}`).join(" · ")}${list.length > CAP ? `\n\n_…and ${list.length - CAP} more._` : ""}

</details>
` : `**Holds no territory at the campaign start.**
`}${gateCount[f] ? `\n\`${f}\` is named in the recruitment gate of **${gateCount[f]} unit type${gateCount[f] === 1 ? "" : "s"}**, which is why its name turns up on unit pages.\n` : ""}`;
  }).join("\n");

  const npBody = `# Factions you cannot play

[← all factions](../factions.md) · [wiki index](../README.md)

> ## ⛔ None of these nine can be selected
>
> They are not in the ${index.length} playable factions and are not counted among them anywhere
> in this wiki. They exist because the engine needs somewhere to put rebels, the senate and
> scripted breakaways, and they are documented here only because their names appear on region
> and unit pages — a name with nowhere to go reads as a broken link.

The nine below are excluded on what they are FOR, established from the mod's own text, its
spawn scripts and what it gives them at the campaign start.

| Faction | Internal token | Culture | Default belief | Holds at start | Named in recruitment |
|---|---|---|---|---|---|
${rowsMd}

## What each one is

${sections}
## What still is not established

The reason \`roman_senate\`, \`roman_rebels_1\` and \`roman_rebels_2\` are kept in the mod at all
is **not determined** from the data files. They hold nothing, no spawn script places them, and
the campaign script touches them only a few times. Their campaign text is inherited Roman
history that says nothing about their role.
`;
  fs.writeFileSync(path.join(OUT, "factions", NON_PLAYABLE_FILE), npBody, "utf8");
  console.log(`  non-playable reference page: ${nine.length} factions, ${nine.filter((f) => heldBy(f).length).length} of them holding territory at the start`);
}

// index page
index.sort((a, b) => b.setts - a.setts || a.display.localeCompare(b.display));

// ── choose by culture ────────────────────────────────────────────────────────
// A flat 230-row table sorted by size answers "who is biggest" and nothing else. The question
// someone opening this page actually has is "who can I play, and who is like whom", and the
// game's own answer to that is culture: it decides the architecture a settlement is drawn
// with, which government levels can be installed, and much of the roster. So the cultures come
// first, as rows of emblems, and the size table stays underneath for the other question.
//
// The emblem is the same art the faction's own page shows, at 34px. It is not decoration: 230
// names in a list are unreadable, and the emblem is what a player recognises on the campaign
// map. A faction with no emblem file still appears, by name — it is not dropped for lacking art.
const byCulture = new Map();
for (const e of index) {
  const key = e.culture || "";
  if (!byCulture.has(key)) byCulture.set(key, []);
  byCulture.get(key).push(e);
}
const cultureGroups = [...byCulture.entries()]
  .map(([tok, list]) => ({
    tok,
    name: cultureName(tok),
    list: list.slice().sort((a, b) => b.setts - a.setts || a.display.localeCompare(b.display)),
  }))
  .sort((a, b) => b.list.length - a.list.length || String(a.name || a.tok).localeCompare(String(b.name || b.tok)));
// 24px, not 34. The emblem is the widest thing in the Faction column and the column is what
// decides how many of these tables fit across the page: at 34 a group measures 447px and three
// of them overrun a 1,380px content column by 15px, so they ran two to a row. At 24 the group
// is 437 and three fit with room to spare. The emblem is still the thing you recognise first.
const tile = (e) => `[${e.symbol ? `<img src="symbols/${e.f}.png" alt="" width="24" height="24" style="vertical-align:middle"> ` : ""}${e.display}](factions/${e.f}.md)`;
// Each culture is its own H2, not an H3 inside one, so the viewer treats them as separate
// sections and lays them two to a row instead of stacking 22 down one side of the screen. The
// numbers that were in a single 230-row table live in these instead: a table of 44 rows or
// fewer sizes itself to its content, where a 230-row one is laid out fixed and full width and
// spreads five short columns across the whole page.
// The heading carries its own counts, on one line, instead of spending a second line on a
// sentence of two numbers. Twenty-two sections meant twenty-two wasted lines.
//
// Deliberately PLAIN TEXT, no bold. The anchor a heading gets is slugged from its text, and the
// viewer, GitHub and verify-ris-wiki.js do not agree on what markdown emphasis inside a heading
// slugs to — `**44**` is "-44-" to one and "44" to another. The jump bar below has to land on
// these, so the heading is written with nothing in it that the three could read differently, and
// the anchor is computed from the same string rather than rebuilt from the name.
const headingSlug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cultureHead = (g) => {
  const withLand = g.list.filter((e) => e.setts).length;
  const n = g.list.length;
  if (!g.tok) return `Culture not determined · ${n} faction${n === 1 ? "" : "s"} whose culture no line in descr_sm_factions states`;
  return `${g.name} · ${n} faction${n === 1 ? "" : "s"} · ${withLand} hold${withLand === 1 ? "s" : ""} territory at the start`;
};
const cultureSection = cultureGroups.map((g) => {
  // ### and not ##, which is a layout decision made in the markdown for a reason worth writing
  // down. The viewer builds a page out of its H2s: each one becomes a bordered card, and cards
  // are right when a page's sections are different KINDS of thing — a settlement table beside a
  // character table. Here all 22 sections are the same shape, one heading and one roster, and
  // boxing each of them separately turned a single list into 22 windows stacked down the page.
  // With no H2 on the page the viewer leaves the content alone, so this reads as one list with
  // the culture name as a divider — which is what it is. The anchors are unaffected: a heading
  // gets its id at any level.
  const heading = `### ${cultureHead(g)}`;
  // The link to the culture's own page goes UNDER the heading, not in it. A heading's anchor is
  // slugged from its text, and the jump bar below has to land on these — GitHub, the local
  // viewer and verify-ris-wiki.js do not agree on what markdown link syntax inside a heading
  // slugs to, so nothing goes in one that the three could read differently.
  const sub = g.tok && CULTURE_INDEX[g.tok]
    ? `[What being ${CULTURE_INDEX[g.tok].name} decides](cultures/${CULTURE_INDEX[g.tok].page})`
    : null;
  // No token beside the heading, and no paragraph explaining that the shown name is not the
  // token. A player reading "Gallic" does not need to be told the file says `barbarian`; that
  // the two differ is the GENERATOR's problem and is reported in its run output instead.
  // No Regional column. Measured across all 230 factions it runs 424 to 443 — a 4.5% spread,
  // every single faction inside 5% of the median — so it is a constant wearing the costume of a
  // statistic. It cost a column's width on every table and told a reader nothing they could use
  // to tell two factions apart. The count is still on each faction's own page, where it is about
  // that faction rather than a comparison.
  const rows = g.list.map((e) =>
    `| ${tile(e)} | ${e.setts} | ${e.chars} | ${e.units - e.aor} |`).join("\n");
  // "Provinces", not "Settlements". The number is the count of settlements a faction holds,
  // and since every region has exactly one settlement that is also the count of REGIONS it
  // holds — which is what a reader comparing two factions is actually asking. It also stops
  // the column reading as a link to the settlement pages, which it is not.
  return `${heading}\n${sub ? `\n${sub}\n` : ""}\n| Faction | Provinces | Characters | Units |\n|---|---:|---:|---:|\n${rows}`;
}).join("\n\n");

// A jump bar, so 22 cultures do not have to be scrolled past to reach the one you want. Ordered
// as the sections are, with each one's size, because "Gallic 44" is also the answer to a
// question someone might have come here with.
// Slugged from the SAME string the heading is built from, not rebuilt from the culture name:
// the heading now carries its counts, so a link derived from the name alone would miss it.
const cultureJump = cultureGroups
  .map((g) => `[${g.name || "Culture not determined"}](#${headingSlug(cultureHead(g))}) ${g.list.length}`)
  .join(" · ");

const idx = `# All factions

[← wiki index](README.md) · [factions overview](factions-overview.md) · [cultures](cultures.md) · [beliefs](religions.md)

${index.length} playable factions, each with its own page, in ${cultureGroups.filter((g) => g.tok).length} cultures.

Nine further factions in the mod files are **not** playable and are not part of that ${index.length}
— the rebel pool, the Roman senate, a test faction and the scripted breakaways. They hold
territory and appear in recruitment gates, so they are documented together on
[factions you cannot play](factions/${NON_PLAYABLE_FILE}).

Culture is the game's own grouping, and it is not cosmetic: it settles which architecture a
settlement is drawn with, which government levels the faction can install, and much of what
the roster looks like. Factions in the same culture play more like each other than two
neighbours in different ones do. Largest first within each.

**Units** is the faction's own roster — what it can raise from its own buildings anywhere it
holds a settlement. It does not count regional units, which are gated on holding the right
province rather than on being anyone in particular: every faction has between 424 and 443 of
those, so the number tells you nothing about the faction. Each faction's page lists its own.

**Jump to:** ${cultureJump}

${cultureSection}
`;
fs.writeFileSync(path.join(OUT, "factions.md"), idx, "utf8");

console.log(`\n${index.length} faction pages written`);
console.log(`  with main-menu intro text: ${introsFound}`);
console.log(`  maps rendered:             ${mapsWritten} (${(mapStat.bytes / 1048576).toFixed(1)} MB)`);
if (mapsWritten) {
  console.log(`  map sizes:                 ${[...mapStat.dims].map(([d, n]) => `${d} x${n}`).join(", ")}`);
  console.log(`  windows clamped to edge:   ${mapStat.clamped.length}${mapStat.clamped.length ? ` — ${mapStat.clamped.join(", ")}` : ""}`);
  // A faction whose territory is WIDER than the window would be cropped, which is the one
  // thing the fixed window is not allowed to do. Named, never silently accepted.
  console.log(`  territory bigger than window: ${mapStat.overflowed.length}${mapStat.overflowed.length ? ` — ${mapStat.overflowed.join(", ")}` : ""}`);
  console.log(`  smallest subject:          ${mapStat.minSubject[0]} at ${mapStat.minSubject[1].toLocaleString("en-US")} px · largest ${mapStat.maxSubject[0]} at ${mapStat.maxSubject[1].toLocaleString("en-US")} px`);
}
console.log(`  symbols written:           ${symbolsWritten} of ${index.length} (${(symbolBytes / 1048576).toFixed(1)} MB)`);
if (noSymbol.length) console.log(`  WITHOUT a symbol:          ${noSymbol.length} — ${noSymbol.join(", ")}`);
console.log(`  no settlements:            ${index.filter((e) => !e.setts).length}`);
console.log(`  character name tokens: ${namesResolved.toLocaleString("en-US")} resolved via names.txt, ${namesRaw.toLocaleString("en-US")} had no entry`);
console.log(`  place name tokens:     ${placesResolved.toLocaleString("en-US")} resolved via the regions-and-settlements text, ${placesRaw.toLocaleString("en-US")} had no entry`);
console.log(`  settlement names read from descr_regions: ${Object.keys(SETTLEMENT_OF).length.toLocaleString("en-US")}`);
console.log(`  no units resolved:         ${index.filter((e) => !e.units).length}`);
console.log(`  default religions: ${Object.keys(FACTION_RELIGION).length} faction blocks declare one, ${RAW_RELIGION_LINES} "default religion" lines by a flat pattern over the same file  <- must match`);
console.log(`    ${Object.keys(FACTION_RELIGION).length === RAW_RELIGION_LINES ? "the two counts AGREE" : "THE TWO COUNTS DISAGREE — a faction block is being lost"} · distinct beliefs used: ${new Set(Object.values(FACTION_RELIGION)).size}`);
console.log(`  culture links: ${cultureLinked.toLocaleString("en-US")} into cultures/ (${Object.keys(CULTURE_INDEX).length} in cultures/index.json)${cultureUnlinked.size ? `, ${cultureUnlinked.size} with no entry (${[...cultureUnlinked].join(", ")})` : ""}${Object.keys(CULTURE_INDEX).length ? "" : "  <- run gen-ris-culture-pages.js, then this generator again"}`);
console.log(`  belief links:  ${religionLinked.toLocaleString("en-US")} into religions/ (${Object.keys(RELIGION_INDEX).length} in religions/index.json)${religionUnlinked.size ? `, ${religionUnlinked.size} with no entry (${[...religionUnlinked].join(", ")})` : ""}${Object.keys(RELIGION_INDEX).length ? "" : "  <- run gen-ris-belief-pages.js, then this generator again"}`);
console.log(`  cultures: ${cultureGroups.filter((g) => g.tok).length} named across ${index.length} factions, ${index.filter((e) => !e.culture).length} faction(s) with no culture line`);
console.log(`    display names: ${cultureNamed.bare} via the bare {<culture>} entry, ${cultureNamed.label} via {<culture>_label}, ${cultureNamed.ui} via {UI_<CULTURE>}${cultureNamed.none.length ? `, ${cultureNamed.none.length} unresolved (${cultureNamed.none.join(", ")})` : ", 0 unresolved"}`);
for (const [tok, bare, ui] of cultureRenames) console.log(`    the game renames \`${tok}\`: shown as "${bare}", menu string says "${ui}"`);
