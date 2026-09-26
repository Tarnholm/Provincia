#!/usr/bin/env node
/**
 * One wiki page per RIS building chain: what each level looks like, what the game says it
 * is, what it does, what it costs, its upgrade path, and what it locks you out of.
 *
 *   node scripts/gen-ris-building-pages.js [--ris <dir>] [--out <dir>] [--only <chain,…>]
 *
 * Read from export_descr_buildings.txt, whose shape is:
 *
 *   building market
 *   {
 *     icon trade
 *     levels trader market forum great_forum curia      <- the upgrade path, in order
 *     {
 *       trader requires factions { all, } and nobuilding and requires_gov
 *       {
 *         capability { trade_base_income_bonus bonus 1 }
 *         construction 2
 *         cost 750
 *         settlement_min town
 *         upgrades { market }
 *       }
 *       …
 *
 * EXCLUSIONS ARE ONE INDIRECTION AWAY, which is why a first pass found none. The 49
 * `not building_present …` clauses do not sit in level requirements at all; they live in
 * `alias` blocks at the top of the file:
 *
 *   alias not_granary
 *   {
 *     requires not building_present food_storage and not building_present food_storage queued
 *   }
 *
 * A level then says `requires … and not_granary`. So the aliases have to be expanded before
 * anything can be read off a level's conditions. Reporting 0 exclusions was not a parser
 * bug - the clauses genuinely are not where they appear to be. Expanding the aliases
 * surfaces 24 of them, which are the cases where building one thing forecloses another:
 * worth knowing before committing 2,500 denarii.
 *
 * EFFECT NAMES ARE TRANSLATED, not printed raw. `taxable_income_bonus bonus 2` means
 * nothing to a player; "+2 taxable income" does. Anything not in the table below is shown
 * verbatim rather than dropped, so an unrecognised effect is visible instead of silently
 * missing.
 *
 * THE GAME'S OWN DESCRIPTIONS come from text/export_buildings.txt, which holds far more
 * than display names. Per level it carries, per CULTURE:
 *     {<level>_<culture>}              display name
 *     {<level>_<culture>_desc}         the full description
 *     {<level>_<culture>_desc_short}   the one-line version
 * The CULTURE-LESS keys ({port_desc}) are all placeholders reading "WARNING! This baseline
 * description should never appear on screen!", so a generator that reads {<level>_desc} and
 * trusts it publishes 272 warnings. The culture-qualified keys are the real text. 267 of the
 * 272 levels have one; the 5 farms levels are placeholders in every culture, and those pages
 * say so rather than carrying invented prose.
 *
 * RECRUITMENT IS 29,894 OF THE ~35,000 EFFECT LINES and was being printed verbatim, one line
 * per faction-condition, which is how military_industrial_complex.md reached 1.4 MB and
 * garrison.md 1.07 MB — 3,000 lines for a single level, each naming internal faction tokens.
 * They are now collapsed to the distinct UNITS a level unlocks, by their display names:
 * `recruit "aor arab levy spearmen"` -> export_descr_unit `dictionary` -> text/export_units.
 * All 1,135 recruit tokens in the mod resolve that way, so nothing is lost to a fallback.
 *
 * THREE KEYWORDS WERE BEING SHOWN RAW — `dummy`, `agent`, `agent_limit_settlement`, 159 lines
 * across the 82 chains — and are now English. What each means comes from the game's own
 * documentation and the game's own strings, not from inference:
 *   `dummy <string> [bonus] <n>`  Rome Remastered's EDB guide: "does nothing, but allows
 *       specifying a string". Vanilla's only use carries the comment "Add trait and retinue
 *       stuff as a dummy string with a positive effect". The string is a text key, so the line
 *       IS its string and the number means nothing: {mine_from_gold_dga} in expanded_bi.txt is
 *       "Mining income from gold: +360 per turn". The mines chain uses 106 of them to put the
 *       income on the building card, because the `mine_resource` grants beside them are
 *       conditioned in a way the card does not render — the mod says so in its own comment.
 *   `agent <type> <n>`  "allows recruiting agents". What the number means is NOT documented;
 *       every line in the mod and in vanilla writes 0, so only that form is translated.
 *   `agent_limit_settlement <type> <n>`  "sets the amount of a given agent type that can be
 *       recruited here (bonus does not work with this)". The `bonus` form is therefore left
 *       raw. Vanilla writes it anyway in four places, so the guide and the files disagree; this
 *       mod never uses that form, and nothing here guesses which of the two is right.
 * Agent type names are the game's: text/shared.txt {ST_SPY} -> "Spy". A type with no such
 * string keeps its line raw rather than showing an internal token.
 *
 * CONDITIONS ARE NOT DROPPED. An effect whose `requires` clause says anything beyond
 * is_player / empire size is listed apart, its condition written out in words (see "conditions,
 * in words" below), instead of being printed as though it always applies — `trade_level_bonus
 * bonus -10 requires hidden_resource UnderSiege1` is a siege penalty, not a permanent -10.
 *
 * LAYOUT. Each LEVEL is its own `## ` section, and the viewer (scripts/serve-ris-wiki.js)
 * gives these pages a column of their own: one full-width card per level, in the order the
 * chain upgrades. It used to distribute the sections into two panes like every other page,
 * which balances heights and therefore reorders — a five-level chain read t1, t2 / t4, t3 / t5.
 * A chain is a sequence, so the order is the content; see SINGLE_COLUMN there. Plain markdown
 * throughout: no inline styles, no CSS, so GitHub Pages renders the same pages correctly.
 */
const fs = require("fs");
const BUILDINGS = require("./ris-wiki-buildings.js");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/_wiki");
const ONLY = (valOf("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const SPLIT_EOL = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));
// Heading -> anchor, so the at-a-glance table can jump down to a level's own section. The
// local viewer and GitHub only agree on the slug for plain alphanumeric headings: the viewer
// turns "Farms+1" into `farms-1`, GitHub into `farms1`. So anything else is left as plain
// text rather than shipping a link that is broken in one of the two places.
const anchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const anchorSafe = (s) => /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(String(s).trim());

// ── display names and text ───────────────────────────────────────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* tokens then */ }
  return map;
}
const NAMES = loadText("export_buildings.txt");
const dName = (tok) => {
  const v = NAMES[String(tok).toLowerCase()];
  return v && !isPlaceholder(v) ? v : null;
};

/**
 * The text files are full of deliberate placeholders. Treating one as content publishes
 * "WARNING! This baseline description should never appear on screen!" or "[WARNING: MISSING
 * TEXT]" as though it were the game's prose.
 */
function isPlaceholder(s) {
  if (!s || !String(s).trim()) return true;
  return /WARNING/i.test(s) || /MISSING TEXT/i.test(s);
}

// Cultures come from the file that defines them, not from a list typed here: every culture
// any faction actually has. The description keys are suffixed with exactly these.
function loadCultures() {
  const txt = rd("descr_sm_factions.txt") || "";
  const out = [];
  for (const m of txt.matchAll(/"culture"\s*:\s*"([a-z_]+)"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
const CULTURES = loadCultures();
// Roman first: it is the most completely written set, and 265 of the 272 levels have Roman
// text. The rest fall through to whichever culture the mod did write.
const DESC_ORDER = ["roman", ...CULTURES.filter((c) => c !== "roman")];

/**
 * The game's own description of a level. `variants` counts the distinct wordings across
 * cultures, so a page can say the text differs elsewhere instead of implying it is universal.
 */
function descFor(level) {
  const l = String(level).toLowerCase();
  const pick = (base) => {
    const full = NAMES[`${base}_desc`], short = NAMES[`${base}_desc_short`];
    if (isPlaceholder(full) && isPlaceholder(short)) return null;
    return { full: isPlaceholder(full) ? null : full, short: isPlaceholder(short) ? null : short };
  };
  let got = null, culture = null;
  for (const c of DESC_ORDER) { got = pick(`${l}_${c}`); if (got) { culture = c; break; } }
  // The culture-less key is the last resort and normally a placeholder; pick() rejects those.
  if (!got) got = pick(l);
  const variants = new Set(CULTURES.map((c) => NAMES[`${l}_${c}_desc`]).filter((v) => !isPlaceholder(v)));
  return { full: got && got.full, short: got && got.short, culture, variants: variants.size };
}

/**
 * Description text into markdown paragraphs. The files carry a literal backslash-n as a hard
 * break; every one of them separates a paragraph in practice, so each becomes a blank line.
 * (Checked: no description in the file contains `*`, `_`, backticks, `|`, angle brackets or a
 * line starting with a markdown marker, so nothing needs escaping.)
 */
function prose(s) {
  return String(s)
    .split(/\\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

// ── unit and religion display names, for the two bulk effect kinds ────────────
// `recruit "aor arab levy spearmen"` names an export_descr_unit TYPE. The player-facing name
// is one hop further on: the type's `dictionary` key indexes text/export_units.txt.
function loadUnitNames() {
  const edu = rd("export_descr_unit.txt") || "";
  const units = loadText("export_units.txt");
  const out = {};
  let type = null;
  for (const raw of edu.split(SPLIT_EOL)) {
    const t = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(t);
    if (m) { type = m[1].trim().toLowerCase(); continue; }
    m = /^dictionary\s+(\S+)/.exec(t);
    if (m && type) {
      const n = units[m[1].toLowerCase()];
      if (!isPlaceholder(n)) out[type] = n;
      type = null;
    }
  }
  return out;
}
const UNIT_NAMES = loadUnitNames();

// expanded_bi.txt is the strings file the mod extends: religion labels, the alias
// `display_string` targets, and the strings named by `dummy` capability lines all live here.
const BI_STRINGS = loadText("expanded_bi.txt");

// `religious_belief aeolian 2` names a religion. Its label lives in expanded_bi.txt as
// {AEOLIAN_LABEL}. 50 of the 51 religions used by buildings have one.
function loadReligionNames() {
  const out = {};
  for (const [k, v] of Object.entries(BI_STRINGS)) {
    const m = /^(.+)_label$/.exec(k);
    if (m && !isPlaceholder(v)) out[m[1]] = v;
  }
  return out;
}
const RELIGION_NAMES = loadReligionNames();

// `agent spy 0` names an agent type. The game's own name for one is text/shared.txt {ST_SPY},
// so the four types the files use (spy, assassin, diplomat, merchant) all resolve; a type with
// no such string has no display name and its lines are left untranslated rather than guessed.
const SHARED = loadText("shared.txt");
const agentName = (type) => {
  const v = SHARED[`st_${String(type).toLowerCase()}`];
  return v && !isPlaceholder(v) ? v : null;
};
// Plural of the display name. Ordinary English rule; the game's own plurals confirm the three
// that matter — {UI_FACTION_SELECT_NUM_SPIES} "SPIES", {..._ASSASSINS}, {..._DIPLOMATS}.
const plural = (s) => (/[^aeiou]y$/i.test(s) ? s.slice(0, -1) + "ies"
  : /(?:s|x|z|ch|sh)$/i.test(s) ? s + "es" : s + "s");

// ── art ─────────────────────────────────────────────────────────────────────
// gen-ris-building-icons.js writes both sizes and records, per level, which culture's and
// which level's art it had to use. Read, never recomputed here: the resolution rules
// (culture fallback chains and level aliases from descr_ui_buildings.txt) live there.
let ART = {};
try { ART = JSON.parse(fs.readFileSync(path.join(OUT, "art", "index.json"), "utf8")); } catch { /* run the icon generator first */ }
let ICONS = {};
try { ICONS = JSON.parse(fs.readFileSync(path.join(OUT, "icons", "index.json"), "utf8")); } catch { /* none yet */ }
const artFor = (level) => ART[String(level).toLowerCase()] || {};
// Fallback for an icon the art index does not know: the region map is keyed "<culture>/<level>"
// and any culture's art will do on a generic page.
const iconFor = (level) => {
  const l = String(level).toLowerCase();
  const rec = artFor(l);
  if (rec.icon) return rec.icon;
  if (ICONS[`roman/${l}`]) return ICONS[`roman/${l}`];
  for (const k of Object.keys(ICONS)) if (k.endsWith(`/${l}`)) return ICONS[k];
  return null;
};

// ── effect translation ───────────────────────────────────────────────────────
const sgn = (n) => (n >= 0 ? "+" + n : String(n));
const EFFECTS = {
  taxable_income_bonus: (n) => `${sgn(n)} taxable income`,
  happiness_bonus: (n) => `${sgn(n)} public order (happiness)`,
  trade_base_income_bonus: (n) => `${sgn(n)} trade income`,
  population_growth_bonus: (n) => `${sgn(n)} population growth`,
  law_bonus: (n) => `${sgn(n)} public order (law)`,
  population_health_bonus: (n) => `${sgn(n)} population health`,
  farming_level: (n) => `${sgn(n)} farming level`,
  recruits_exp_bonus: (n) => `recruits gain ${n} experience`,
  recruits_morale_bonus: (n) => `recruits gain ${n} morale`,
  weapon_simple: (n) => `improves simple weapons (${n})`,
  weapon_missile: (n) => `improves missile weapons (${n})`,
  weapon_bladed: (n) => `improves bladed weapons (${n})`,
  weapon_other: (n) => `improves other weapons (${n})`,
  armour: (n) => `improves armour (${n})`,
  construction_cost_bonus_all: (n) => `${n > 0 ? "-" : "+"}${Math.abs(n)}% construction cost`,
};
// Effects written WITHOUT the word `bonus` are levels and counts, not deltas: `wall_level 1`
// grants walls of level 1, it does not add one. Signing those would misread them, so they get
// their own table and are printed unsigned.
const MEASURES = {
  wall_level: (n) => `walls at level ${n}`,
  tower_level: (n) => `towers at level ${n}`,
  gate_strength: (n) => `gate strength ${n}`,
  gate_defences: (n) => `gate defences ${n}`,
  road_level: (n) => `roads at level ${n}`,
  trade_fleet: (n) => `trade fleet of ${n}`,
  mine_resource: (n) => `mining income ${n}`,
  stage_games: () => "can stage games",
  stage_races: () => "can stage races",
};
// An effect line is `<name> bonus <n>` or `<name> <n>`, optionally followed by
// `requires <condition>`. The condition is not decoration:
//   - `requires not is_player` means the bonus applies to the AI ONLY. Printing it as a
//     player benefit is simply wrong, and the military_industrial_complex has three such
//     +10 bonuses that read as enormous player perks if the condition is dropped.
//   - `requires size1 … size10` means the value scales with settlement size, which is why
//     one level can list the same effect twenty times with different numbers.
//   - ANYTHING ELSE — a resource, a hidden_resource, a faction list, a siege flag — changes
//     when the effect applies at all, and cannot be summarised away. Those lines keep their
//     condition and are listed separately.
// So conditions are parsed, effects grouped, and ranges summarised.
// `requires_gov` is deliberately NOT here. It is a real precondition — the effect needs a
// government building present — and folding it in with the glue words would print a
// conditional effect as an unconditional one.
const TRIVIAL_COND = /^(?:and|or|not|is_player|size\d+)$/;
function parseEffect(line) {
  const t = line.trim();
  const m = /^([a-z_]+)\s+(?:(bonus)\s+)?(-?\d+)(?:\s+requires\s+(.+))?$/.exec(t);
  if (!m) return { raw: t.replace(/\s+/g, " ") };
  const cond = (m[4] || "").toLowerCase();
  const tokens = cond.split(/[^a-z0-9_]+/).filter(Boolean);
  return {
    name: m[1], signed: !!m[2], value: +m[3], cond,
    aiOnly: /not\s+is_player/.test(cond),
    playerOnly: /is_player/.test(cond) && !/not\s+is_player/.test(cond),
    bySize: /size\d+/.test(cond),
    // A condition made only of is_player/size/glue is fully described by the two flags above.
    otherCond: tokens.some((x) => !TRIVIAL_COND.test(x)),
  };
}

// A name with no entry in either table is still shown, humanised: the trailing `_bonus` is
// the file's own noise ("taxable income bonus -7" reads as two things), so it goes.
const humanise = (name) => name.replace(/_bonus$/, "").replace(/_/g, " ");
const label = (name, n, signedShape) => {
  if (!signedShape && MEASURES[name]) return MEASURES[name](n);
  if (EFFECTS[name]) return EFFECTS[name](n);
  return `${humanise(name)} ${signedShape ? sgn(n) : n}`;
};

/**
 * Group a level's effect lines into readable, honest blocks:
 *   effects   — what applies, with AI-only and size-scaling called out
 *   recruits  — the distinct units it unlocks, by display name
 *   beliefs   — religious belief it spreads, by religion name
 *   condition — effects that apply only under some other condition, condition intact
 *   raw       — anything this generator cannot parse, verbatim so it is visible not lost
 */
// The wiki is for players, and the EDB carries a second rulebook for the AI: anything that
// requires `not is_player` never applies to a player, and `is_player` always does. So every
// condition is reduced to what it means for a player BEFORE anything is printed: an `or`
// alternative that needs `not is_player` is dropped, a bare `is_player` clause is dropped, and
// a line with no alternative left is AI-only and is left off the page altogether (it used to
// be printed with its raw condition, ~600 lines across 70 building pages). Conditions have no
// brackets, so splitting on `or` then `and` is the whole grammar.
function forPlayer(cond) {
  const alts = String(cond).trim().split(/\s+or\s+/i);
  const keep = [];
  for (const a of alts) {
    const clauses = a.split(/\s+and\s+/i).map((c) => c.trim()).filter(Boolean);
    if (clauses.some((c) => /^not\s+is_player$/i.test(c))) continue;
    const rest = clauses.filter((c) => !/^is_player$/i.test(c));
    if (!rest.length) return "";          // an alternative that is always true for a player
    keep.push(rest.join(" and "));
  }
  return keep.length ? keep.join(" or ") : null;
}
function playerLines(rawLines) {
  const out = [];
  for (const line of rawLines) {
    const m = /^(.*?)\s+requires\s+(.+)$/i.exec(String(line).trim());
    if (!m) { out.push(line); continue; }
    const c = forPlayer(m[2]);
    if (c === null) continue;
    out.push(c ? `${m[1]} requires ${c}` : m[1]);
  }
  return out;
}

function describeEffects(rawLinesAll) {
  const rawLines = playerLines(rawLinesAll);
  const out = [], conditional = [], raw = [];
  const recruits = new Map();   // display name -> {exp:Set, conditional:bool}
  const beliefs = new Map();    // religion token -> values[]
  const groups = new Map();     // `${name}|${scope}|${shape}` -> {…, values[]}
  const accounted = new Set();  // lines whose condition was dealt with, for the check below
  const grainShown = new Map(); // card label -> true (see below)

  // One place decides whether a translated line is unconditional or conditional, so a
  // condition cannot be lost by a new effect kind forgetting to check for one. Unconditional
  // ones are held back and appended after the numbered effects: the money and public order a
  // level gives are what a reader came for, and should not be pushed down the list by an
  // agent limit just because the game files happen to state it first.
  const spelled = [];
  const conditioned = (text, cond, line) => {
    accounted.add(line);
    // The grain card lines are a readout, one line per possible value, each shown only while
    // the empire's counter has that value ("Current grain points: 7" needs grain_supply_7).
    // Listed value by value they are 33 lines saying one thing, so they collapse to one each.
    const g = /^hidden_resource\s+grain_(?:supply|imports)_(\d+)\s+factionwide$/i.exec(cond);
    const tm = /^(.*?):\s*(\d+)\b/.exec(text);   // "…: 16 (maximum reached)" too
    if (g && tm && +tm[2] === +g[1]) { grainShown.set(tm[1].trim(), true); return; }
    const r = sayCondition(cond, "eff");
    if (r.never) return;                       // can never apply to a player
    if (r.always) { spelled.push(text); return; }
    conditional.push(`${text}, ${effectWhen(r)}`);
  };
  const place = (text, cond, line) => {
    const c = String(cond || "").trim();
    if (c) conditioned(text, c, line); else spelled.push(text);
  };

  for (const line of rawLines) {
    const t = line.trim();

    // `dummy <string> [bonus] <n>` — the Rome Remastered EDB guide states dummy "does nothing,
    // but allows specifying a string", and vanilla's own comment calls its one use "a dummy
    // string with a positive effect". So the line IS its string, and the number carries no
    // meaning. The mod uses it to put mining income on the building card, because the real
    // `mine_resource` grants next to it are conditioned in a way the card does not render.
    let m = /^dummy\s+([A-Za-z0-9_]+)\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?$/.exec(t);
    if (m) {
      const s = BI_STRINGS[m[1].toLowerCase()];
      // A card string's literal "\n" is a line break on the card; in a list item it is a space.
      if (s && !isPlaceholder(s)) { place(s.replace(/\\n/g, " ").replace(/\s+/g, " ").trim(), m[3], line); continue; }
      raw.push(t.replace(/\s+/g, " "));
      continue;
    }

    // `agent <type> <n>` — "allows recruiting agents". What the number means is not documented
    // and every line in the mod writes 0, so only that form is translated; a non-zero one would
    // be a guess and stays verbatim.
    m = /^agent\s+([a-z_]+)\s+0(?:\s+requires\s+(.+))?$/.exec(t);
    if (m && agentName(m[1])) { place(`allows recruiting ${plural(agentName(m[1]))}`, m[2], line); continue; }

    // `agent_limit_settlement <type> <n>` — "sets the amount of a given agent type that can be
    // recruited here (bonus does not work with this)". The `bonus` form therefore is NOT
    // translated: vanilla writes it in four places even so, and what the engine does with a
    // form its own guide says does not work is not established here. The mod uses only the
    // plain form.
    m = /^agent_limit_settlement\s+([a-z_]+)\s+(\d+)(?:\s+requires\s+(.+))?$/.exec(t);
    if (m && agentName(m[1])) {
      const who = +m[2] === 1 ? agentName(m[1]) : plural(agentName(m[1]));
      place(`up to ${m[2]} ${who} can be recruited in this settlement`, m[3], line);
      continue;
    }

    m = /^recruit\s+"([^"]+)"\s+(\d+)(?:\s+requires\s+(.+))?$/.exec(t);
    if (m) {
      const unit = UNIT_NAMES[m[1].toLowerCase()] || null;
      const key = unit || `"${m[1]}"`;
      if (!recruits.has(key)) recruits.set(key, { exp: new Set(), conditional: false });
      recruits.get(key).exp.add(+m[2]);
      if (m[3]) recruits.get(key).conditional = true;
      continue;
    }

    m = /^religious_belief\s+([a-z_]+)\s+(-?\d+)/.exec(t);
    if (m) {
      if (!beliefs.has(m[1])) beliefs.set(m[1], []);
      beliefs.get(m[1]).push(+m[2]);
      continue;
    }

    const p = parseEffect(t);
    if (p.raw) { raw.push(p.raw); continue; }
    if (p.otherCond) { conditioned(label(p.name, p.value, p.signed), p.cond, line); continue; }
    const scope = p.aiOnly ? "ai" : (p.playerOnly ? "player" : "all");
    const k = `${p.name}|${scope}|${p.bySize ? "size" : "flat"}|${p.signed ? "s" : "m"}`;
    if (!groups.has(k)) groups.set(k, { ...p, values: [], lines: [], sizes: new Set() });
    groups.get(k).values.push(p.value);
    groups.get(k).lines.push({ p, line });
    for (const s of p.cond.matchAll(/size(\d+)/g)) groups.get(k).sizes.add(+s[1]);
  }

  // `size1` … `size10` are the mod's empire-size events (major_event "empire_sizeN", labelled
  // SIZE_EFFECT: "related to your empire size"), set from how many settlements you hold — not
  // the size of this settlement. A group only reads as one line when it covers every size;
  // one that stops at some sizes (the Region Information Scroll's +75 is size 1 only) is listed
  // size by size, or the page would claim it holds at every size.
  for (const g of groups.values()) {
    const uniq = [...new Set(g.values)].sort((a, b) => a - b);
    const scopeNote = g.aiOnly ? " _(AI only: does not apply to you)_"
      : (g.playerOnly ? " _(player only)_" : "");
    if (g.bySize && [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some((n) => !g.sizes.has(n))) {
      for (const { p, line } of g.lines) conditioned(label(p.name, p.value, p.signed), p.cond, line);
      continue;
    }
    if (uniq.length === 1) {
      out.push(label(g.name, uniq[0], g.signed) + scopeNote);
    } else {
      const lo = uniq[0], hi = uniq[uniq.length - 1];
      out.push(`${humanise(g.name)} ${g.signed ? `${sgn(lo)} to ${sgn(hi)}` : `${lo} to ${hi}`}` +
        (g.bySize ? ", depending on how many settlements your empire holds" : "") + scopeNote);
    }
  }
  out.push(...spelled);
  for (const lbl of grainShown.keys()) out.push(`${lbl}: the card shows your empire's current figure`);
  // AI-only effects last: they are the least relevant to a reader.
  out.sort((a, b) => (a.includes("AI only") ? 1 : 0) - (b.includes("AI only") ? 1 : 0));

  const recruitList = [...recruits.entries()].map(([name, v]) => {
    const exp = [...v.exp].sort((a, b) => a - b).filter((x) => x > 0);
    return name + (exp.length ? ` (${exp.join(" or ")} experience)` : "");
  }).sort((a, b) => a.localeCompare(b));

  // Sorted by the religion's plain name, then linked to its page where there is one.
  const plainName = (s) => s.replace(/^\[([^\]]*)\]\([^)]*\)$/, "$1");
  const beliefList = [...beliefs.entries()].map(([tok, vs]) => {
    const rel = beliefLabel(tok);
    const u = [...new Set(vs)].sort((a, b) => a - b);
    return { key: plainName(rel), text: u.length === 1 ? `${rel} ${sgn(u[0])}` : `${rel} ${sgn(u[0])} to ${sgn(u[u.length - 1])}` };
  }).sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.text);

  const res = { effects: out, recruits: recruitList, beliefs: beliefList, conditional, raw };
  assertConditionsKept(rawLines, res, accounted);
  return res;
}

/**
 * The worst thing these pages can do is print a qualified effect as though it always applied:
 * a Rhodes-only penalty read as a universal one. So every line whose `requires` clause says
 * more than empire size must have gone through the condition translator (or be shown raw) —
 * checked here rather than trusted to each effect kind.
 *
 * `recruit` and `religious_belief` are excluded because neither is rendered per-line: the page
 * says in prose that recruitment depends on faction, government and region, and that belief
 * spread depends on what the region already believes.
 */
function assertConditionsKept(rawLines, res, accounted) {
  const rawShown = new Set(res.raw);
  for (const line of rawLines) {
    const t = line.trim();
    if (/^(?:recruit|religious_belief)\b/.test(t)) continue;
    const m = /\srequires\s+(.+)$/.exec(t);
    if (!m) continue;
    const cond = m[1].toLowerCase().trim();
    const tokens = cond.split(/[^a-z0-9_]+/).filter(Boolean);
    if (!tokens.some((x) => !TRIVIAL_COND.test(x))) continue;
    if (!accounted.has(line) && !rawShown.has(t.replace(/\s+/g, " "))) {
      throw new Error(`condition dropped from the page: "${t}" — it never reached the condition translator`);
    }
  }
}

// ── alias expansion ─────────────────────────────────────────────────────────
// `alias <name> { requires <expr> }` — a named condition a level can reference.
function parseAliases(edb) {
  const out = {};
  const lines = edb.split(SPLIT_EOL);
  for (let i = 0; i < lines.length; i++) {
    const m = /^alias\s+(\S+)/.exec(lines[i].replace(/;.*$/, "").trim());
    if (!m) continue;
    for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
      const t = lines[k].replace(/;.*$/, "").trim();
      if (t === "}") break;
      const r = /^requires\s+(.+)$/.exec(t);
      if (r) { out[m[1].toLowerCase()] = r[1].trim(); break; }
    }
  }
  return out;
}

/**
 * The player-facing label an alias carries: `display_string REQUIRES_GOVERNMENT` beside the
 * condition, whose text is in text/expanded_bi.txt. This is the string the game's own build
 * browser prints when it tells a player what a building needs, so a requirement quoting it is
 * not the wiki's paraphrase of the condition — it is the game's.
 *
 * `;display_string …` is a COMMENTED OUT label and must not be picked up: no_other_farm carries
 * a commented REQUIRES_TEMPLE_DESTRUCTION, which would have printed "requires the destruction
 * of an existing temple" on every farm level in the mod. The `;` strip below is what stops it.
 */
function parseAliasDisplays(edb) {
  const out = {};
  let name = null;
  for (const raw of edb.split(SPLIT_EOL)) {
    const t = raw.replace(/;.*$/, "").trim();
    let m = /^alias\s+(\S+)/.exec(t);
    if (m) { name = m[1].toLowerCase(); continue; }
    if (!name) continue;
    if (t === "}") { name = null; continue; }
    m = /^display_string\s+(\S+)/.exec(t);
    if (m) { out[name] = m[1].trim().toLowerCase(); name = null; }
  }
  return out;
}

// ── parse the EDB ────────────────────────────────────────────────────────────
function parseChains(edb) {
  const lines = edb.split(SPLIT_EOL);
  const chains = [];
  let chain = null, depth = 0;
  let level = null, inCapability = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/;.*$/, "");
    const t = line.trim();
    if (!t) continue;

    let m = /^building\s+(\S+)/.exec(t);
    if (m) { chain = { chain: m[1], icon: null, order: [], levels: {} }; chains.push(chain); depth = 0; continue; }
    if (!chain) continue;

    // Track brace depth so a level's fields are attributed to that level.
    const opens = (t.match(/\{/g) || []).length, closes = (t.match(/\}/g) || []).length;

    m = /^icon\s+(\S+)/.exec(t);
    if (m) { chain.icon = m[1]; depth += opens - closes; continue; }

    m = /^levels\s+(.+)$/.exec(t);
    if (m) {
      // Hyphens too: the grain chain ends in `grain-1`, and a pattern without `-` silently
      // dropped that level from its page and from the index count.
      chain.order = m[1].split(/\s+/).filter((x) => /^[a-z0-9_+-]+$/i.test(x));
      for (const l of chain.order) chain.levels[l] = { level: l, requires: "", effects: [], cost: null, turns: null, minSize: null, upgradesTo: [] };
      depth += opens - closes;
      continue;
    }

    // `<level> requires <expr>` opens that level's block.
    m = /^([a-z0-9_+-]+)\s+requires\s+(.+)$/.exec(t);
    if (m && chain.levels[m[1]]) { level = chain.levels[m[1]]; level.requires = m[2].trim(); depth += opens - closes; continue; }

    if (level) {
      if (/^capability\s*$/.test(t)) { inCapability = true; depth += opens - closes; continue; }
      if (inCapability) {
        if (t === "}") { inCapability = false; depth += opens - closes; continue; }
        if (t !== "{") level.effects.push(t);   // raw; grouped later by describeEffects
        depth += opens - closes;
        continue;
      }
      // A standalone `requires …` line, i.e. not the `<level> requires …` form. Several
      // levels state their conditions this way, and all 49 of the mod's exclusion clauses
      // were being missed until these were appended too.
      m = /^requires\s+(.+)$/.exec(t);
      if (m) { level.requires += (level.requires ? " and " : "") + m[1].trim(); continue; }
      m = /^construction\s+(\d+)/.exec(t); if (m) { level.turns = +m[1]; continue; }
      m = /^cost\s+(\d+)/.exec(t);         if (m) { level.cost = +m[1]; continue; }
      m = /^settlement_min\s+(\S+)/.exec(t); if (m) { level.minSize = m[1]; continue; }
      if (/^upgrades\s*$/.test(t)) {
        // The next non-brace tokens are the levels this upgrades into.
        for (let k = i + 1; k < Math.min(i + 8, lines.length); k++) {
          const u = lines[k].replace(/;.*$/, "").trim();
          if (u === "{" ) continue;
          if (u === "}" || !u) break;
          // Only the words before a `requires`: `temple requires no_other_temple` upgrades into
          // the Temple, and the condition's tokens are not further upgrades.
          level.upgradesTo.push(...u.split(/\s+requires\s+/i)[0].split(/\s+/).filter((x) => /^[a-z0-9_+-]+$/i.test(x)));
        }
        continue;
      }
    }
    depth += opens - closes;
  }
  return chains;
}

/** `not building_present X` / `not building_present_min_level X Y` inside a requires. */
function exclusionsOf(requires, aliases) {
  // Expand any alias the condition names, once - aliases in this file do not nest.
  //
  // Matched on TOKENS, not with a word-boundary regex. The regex version was
  // `new RegExp(`\\b${name}\\b`)` written inside a template literal, where \b is the
  // BACKSPACE character rather than a word boundary — so the pattern was
  // <BS>not_granary<BS> and matched nothing, silently reporting 0 exclusions across the
  // whole mod. Splitting into tokens sidesteps the escaping question entirely, and is
  // exact rather than approximate: `gov` cannot accidentally match `direct_govs`.
  const tokens = new Set(String(requires).toLowerCase().split(/[^a-z0-9_+-]+/).filter(Boolean));
  let expr = String(requires);
  for (const [name, body] of Object.entries(aliases || {})) {
    if (tokens.has(name)) expr += " and " + body;
  }
  requires = expr;
  const out = [];
  // TWO patterns, not one with an optional tail. A single
  //   not building_present(?:_min_level)? (\w+)(?:\s+(\w+))?
  // greedily captured the following word, so `not building_present food_storage and not …`
  // rendered as "food_storage (at AND or above)". The min-level form takes a level; the
  // plain form takes only a chain.
  for (const m of String(requires).matchAll(/not\s+building_present_min_level\s+([a-z0-9_+-]+)\s+([a-z0-9_+-]+)/gi)) {
    out.push({ target: m[1], min: m[2] });
  }
  for (const m of String(requires).matchAll(/not\s+building_present\s+([a-z0-9_+-]+)/gi)) {
    out.push({ target: m[1], min: null });
  }
  const seen = new Set();
  return out.filter((e) => {
    if (/ queued/.test(e.target) || seen.has(e.target + "|" + e.min)) return false;
    seen.add(e.target + "|" + e.min);
    return true;
  });
}

// ── build ────────────────────────────────────────────────────────────────────
const edb = rd("export_descr_buildings.txt");
if (!edb) { console.error("export_descr_buildings.txt not found"); process.exit(2); }
const ALIASES = parseAliases(edb);
const ALIAS_DISPLAY = parseAliasDisplays(edb);
// The game's own UI strings, which is where an alias's display_string points.
const UI_TEXT = loadText("expanded_bi.txt");
const chains = parseChains(edb).filter((c) => c.order.length);
if (!chains.length) { console.error("no building chains parsed"); process.exit(2); }

// An exclusion names a CHAIN (or a chain plus a level). Chains do not have display names of
// their own, so the name shown is the first level's — that is what a player sees in the build
// browser. Only if neither exists does the internal token appear.
const CHAIN_BY_NAME = new Map(chains.map((c) => [c.chain.toLowerCase(), c]));
function targetName(tok) {
  const t = String(tok).toLowerCase();
  const direct = dName(t);
  if (direct) return direct;
  const c = CHAIN_BY_NAME.get(t);
  if (c) { for (const l of c.order) { const n = dName(l); if (n) return n; } }
  return null;
}
function excludeText(e) {
  const name = targetName(e.target);
  const min = e.min ? targetName(e.min) : null;
  // Every exclusion target resolves to a display name today; should one ever not, it is
  // spelled as words rather than shown as a code token.
  const shown = name || e.target.replace(/_/g, " ");
  if (!e.min) return shown;
  return `${shown} at ${min || e.min.replace(/_/g, " ")} or above`;
}

// ── conditions, in words ─────────────────────────────────────────────────────
/**
 * Every condition on these pages — what a level needs, and when a conditional effect applies —
 * is written out in words. The pages are for players, and a line ending in
 * `not port and not hidden_resource inland_trade_centre` tells a player nothing they can use.
 *
 * NOTHING HERE IS A GUESS. Each term is translated only from something the game files state:
 *   - an alias with a `display_string` is the game's own label (requirements only; in an effect
 *     condition the label is a noun, not a sentence, so the alias body is spelled out instead);
 *   - any other alias is expanded to its body, negation pushed through it, so `not
 *     not_slave_supply_built` comes out as the positive it is;
 *   - a hidden resource is read by where it comes from: the region tags documented on the
 *     tags/ pages, the flags the campaign script sets (a supply building's `_supply_built`
 *     flag, `capital`, the siege and blockade flags, the grain counters), and the static
 *     tags on descr_regions' tag line;
 *   - a `factions { … }` list is named culture by culture where it covers a whole culture
 *     (faction and culture keys are interchangeable in this engine), faction by faction where
 *     it does not.
 * A term none of those covers is NOT printed raw: the line says the effect also depends on
 * "other conditions", which is true, and the run log counts what was left out.
 */
const { makeReqLinks } = require("./lib/reqLinks.js");
const readWikiJson = (...f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, ...f), "utf8")); } catch { return {}; } };
const TAG_REFS = readWikiJson("tags", "index.json");
const CULTURE_REFS = readWikiJson("cultures", "index.json");
const RELIGION_REFS = readWikiJson("religions", "index.json");
const REFORM_REFS = (readWikiJson("reforms", "index.json").reforms) || {};
const titleCache = new Map();
const pageTitle = (...f) => {
  const k = f.join("/");
  if (!titleCache.has(k)) {
    let v = null;
    try { const m = /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(OUT, ...f), "utf8")); v = m ? m[1].trim() : null; } catch { /* no page */ }
    titleCache.set(k, v);
  }
  return titleCache.get(k);
};

const uiText = (key) => {
  const v = UI_TEXT[String(key).toLowerCase()];
  return v && !isPlaceholder(v) ? v.replace(/\s+/g, " ").trim() : null;
};

// Chain display names, so a sentence-style alias label ("… you can build Fine Horse Exports …")
// links the building it names; reqLinks does the matching, shared with the unit/faction pages.
const CHAIN_NAMES = {};
for (const c of chains) { const n = BUILDINGS.chainName(c.chain, null); if (n) CHAIN_NAMES[c.chain.toLowerCase()] = n; }
const RL = makeReqLinks({ edb, OUT, bName: dName, chainNames: CHAIN_NAMES });
const CHAIN_OF_LEVEL = new Map();
for (const c of chains) for (const l of c.order) if (!CHAIN_OF_LEVEL.has(l.toLowerCase())) CHAIN_OF_LEVEL.set(l.toLowerCase(), c);

// ── English lists ──
const orList = (xs) => (xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const andList = (xs) => (xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const neither = (xs) => (xs.length === 1 ? xs[0] : xs.length === 2 ? `neither ${xs[0]} nor ${xs[1]}` : `none of ${orList(xs)}`);
const uniq = (xs) => [...new Set(xs)];
const capFirst = (s) => String(s).replace(/^(\[?)([a-z])/, (x, b, c) => b + c.toUpperCase());

// ── factions and cultures ──
// Culture per faction, from the file that defines factions.
function loadFactionCultures() {
  const out = {};
  let cur = null;
  for (const l of (rd("descr_sm_factions.txt") || "").replace(/;.*$/gm, "").split(SPLIT_EOL)) {
    let m = /^\s*"([A-Za-z0-9_]+)":\s*$/.exec(l);
    if (m) { cur = m[1].toLowerCase(); continue; }
    m = /"culture"\s*:\s*"([a-z_]+)"/.exec(l);
    if (m && cur && !out[cur]) out[cur] = m[1];
  }
  return out;
}
const FACTION_CULTURE = loadFactionCultures();
// `dummies` is a placeholder faction parked on a hidden region and `slave` is the rebels: nobody
// plays either, so neither decides whether a list covers a whole culture, and a level only they
// may build is one no player can build.
const NOT_PLAYED = new Set(["dummies", "slave", "non-playable"]);
const CULTURE_MEMBERS = {};
// The `*_rebels` splinters (Roman civil-war sides, Hellenistic/Ptolemaic/Seleucid rebels) only
// ever appear mid-campaign under the AI, so a list that leaves them out still covers the culture
// for anyone playing it.
for (const [f, c] of Object.entries(FACTION_CULTURE)) if (!NOT_PLAYED.has(f) && !/_rebels/.test(f)) (CULTURE_MEMBERS[c] = CULTURE_MEMBERS[c] || []).push(f);
const factionLabel = (tok) => {
  const t = String(tok).toLowerCase();
  const n = pageTitle("factions", `${t}.md`);
  if (n) return `[${n}](../factions/${t}.md)`;
  const s = BI_STRINGS[t];
  return s && !isPlaceholder(s) ? s.trim() : null;
};
const cultureLabel = (tok) => {
  const r = CULTURE_REFS[tok];
  return r ? `[${r.name}](../cultures/${r.page})` : null;
};
/**
 * A faction list, grouped the way a player thinks of it: whole cultures by name, a culture
 * missing a faction or three as "Greek (other than …)", anything else faction by faction.
 * "all" and "none" (only placeholders) come back as those words.
 */
function factionsPhrase(list) {
  const toks = uniq(list.map((s) => String(s).toLowerCase()));
  if (toks.includes("all")) return "all";
  const whole = toks.filter((t) => CULTURE_REFS[t]);
  const partial = [], singles = [], byCulture = {};
  for (const f of toks.filter((t) => !CULTURE_REFS[t] && !NOT_PLAYED.has(t))) {
    const c = FACTION_CULTURE[f];
    if (!c) { if (!factionLabel(f)) return null; singles.push(f); continue; }
    (byCulture[c] = byCulture[c] || []).push(f);
  }
  for (const [c, fs_] of Object.entries(byCulture)) {
    if (whole.includes(c)) continue;
    const missing = (CULTURE_MEMBERS[c] || []).filter((m) => !fs_.includes(m));
    if (CULTURE_REFS[c] && !missing.length) whole.push(c);
    // "Greek (other than A and B)" when that is the shorter way to say it: the exceptions few
    // and the culture mostly in.
    else if (CULTURE_REFS[c] && fs_.length >= 4 && missing.length < fs_.length / 2 && missing.length <= 6 && missing.every(factionLabel)) partial.push({ c, missing });
    else singles.push(...fs_);
  }
  const cultures = [...whole.map(cultureLabel), ...partial.map((p) => `${cultureLabel(p.c)} (other than ${andList(p.missing.map(factionLabel))})`)];
  // Deduplicated by the name a player sees: the Roman civil-war factions are all called "Rome".
  const byName = new Map();
  for (const lbl of singles.map(factionLabel)) {
    if (!lbl) return null;
    const k = lbl.replace(/^\[([^\]]*)\].*$/, "$1");
    if (!byName.has(k) || /^\[/.test(lbl)) byName.set(k, lbl);
  }
  const names = [...byName.values()];
  if (names.some((n) => !n)) return null;
  if (!cultures.length && !names.length) return "none";
  return { cultures, names };
}
function playPhrase(list, neg) {
  const p = factionsPhrase(list);
  if (p === "all") return neg ? "no faction" : "any faction";
  if (p === "none" || !p) return null;
  const art = /^\[?[AEIOU]/i.test(p.cultures[0] || "") ? "an" : "a";
  const c = p.cultures.length ? `${art} ${orList(p.cultures)} faction` : "";
  const n = orList(p.names);
  if (!neg) return `you play ${[c, n].filter(Boolean).join(", or ")}`;
  return `you do not play ${[c, n].filter(Boolean).join(", nor ")}`;
}

// ── resources and region tags ──
const HIDDEN_KIND = new Set();
for (const m of (rd("descr_sm_resources.txt") || "").matchAll(/"([A-Za-z0-9_]+)"\s*:\s*\{\s*"subtype"\s*:\s*"hidden"/g)) HIDDEN_KIND.add(m[1].toLowerCase());
const resourceLabel = (tok) => {
  const t = String(tok).toLowerCase();
  const n = pageTitle("goods", `${t}.md`);
  return n ? `[${n}](../goods/${t}.md)` : t.replace(/_/g, " ");
};
// The tag line of every region (the 6th line of its block in descr_regions.txt), so a static
// region tag can be recognised, and one no region carries and no script sets can be known to be
// always false rather than described as if it could happen.
function loadRegionTags() {
  const out = new Map();
  let name = null, body = [];
  const flush = () => {
    if (name && body[4]) for (const t of body[4].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      if (!out.has(t)) out.set(t, []);
      out.get(t).push(name);
    }
  };
  for (const raw of (rd("world", "maps", "base", "descr_regions.txt") || "").split(SPLIT_EOL)) {
    const line = raw.replace(/;.*$/, "");
    if (!line.trim()) continue;
    if (/^\S/.test(line)) { flush(); name = line.trim(); body = []; continue; }
    body.push(line.trim());
  }
  flush();
  return out;
}
const REGION_TAGS = loadRegionTags();
// Every campaign script, for what it adds and when. A supply building's flag is set on the
// settlement that has it ("if SettlementBuildingExists = tin_supply / add_hidden_resource local
// tin_supply_built"), which is what lets `hidden_resource tin_supply_built factionwide` be read
// as "a Tin Exports is built somewhere in your empire".
function loadScriptFlags() {
  const set = new Set(), fromLevel = {};
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.txt$/i.test(e.name)) continue;
      const txt = fs.readFileSync(p, "latin1").split(SPLIT_EOL).map((l) => l.replace(/;.*$/, "")).join("\n");
      for (const m of txt.matchAll(/add_hidden_resource\s+\S+\s+(\S+)/gi)) set.add(m[1].toLowerCase());
      for (const m of txt.matchAll(/\bif\s+SettlementBuildingExists\s*=\s*(\S+)\s*\n\s*add_hidden_resource\s+local\s+(\S+)/gi)) {
        fromLevel[m[2].toLowerCase()] = m[1].toLowerCase();
      }
    }
  };
  walk(path.join(RIS, "world", "maps", "campaign"));
  return { set, fromLevel };
}
const SCRIPT_FLAGS = loadScriptFlags();
const neverSet = (h) => !REGION_TAGS.has(h) && !SCRIPT_FLAGS.set.has(h) && !TAG_REFS[h];
// Empire size N is a major event whose trigger script counts your settlements
// (major_event_scripts/sizeN_true.txt: `NumOfSet > 1 && NumOfSet < 5`).
function empireSize(n) {
  const s = rd("major_event_scripts", `size${n}_true.txt`);
  if (!s) return null;
  const body = s.split(SPLIT_EOL).map((l) => l.replace(/;.*$/, "")).join("\n");
  const gt = /NumOfSet\s*>\s*(\d+)/.exec(body), lt = /NumOfSet\s*<\s*(\d+)/.exec(body);
  const lo = gt ? +gt[1] + 1 : 1, hi = lt ? +lt[1] - 1 : null;
  if (hi === null) return `${lo} or more settlements`;
  if (lo === hi) return `${lo} settlement${lo === 1 ? "" : "s"}`;
  return lo === 1 ? `at most ${hi} settlement${hi === 1 ? "" : "s"}` : `${lo} to ${hi} settlements`;
}
// The siege flags, from the campaign script's SettlementTurnStart monitor: UnderSiege1 on the
// first turn of a siege, 2 on the third, 3 on the fifth, then 4/5/6 on turns 7/8/9. They are
// taken off gradually after the siege ends, a few turns later.
const SIEGE_TURN = { 1: 1, 2: 3, 3: 5, 4: 7, 5: 8, 6: 9 };
// The mod's no_building_tagged categories, by what the tagged chains are (the `tag` lines in
// the building file): food = the farming and pastoralism chains, metals = the four metal
// industries, and so on.
const TAG_WORDS = {
  temple: "temple", government: "government", food: "farming", food_trade: "grain supply",
  port: "port", rural_exploits: "rural industry", urban_exploits: "urban industry",
  heavy_ind: "heavy industry", sanitation: "sanitation", civic: "civic",
  entertainment: "entertainment", metals: "metal industry",
};
const tagLink = (h) => {
  const r = TAG_REFS[h];
  return r && r.page && r.anchor ? `[${r.name}](../tags/${r.page}#${r.anchor})` : null;
};

const UNKNOWN_TERMS = new Map();   // for the run log
const unknown = (tok) => ({ unknown: true, tok: String(tok).trim() });

/**
 * One term of a condition, as a mergeable phrase: `key` groups terms that can share one
 * sentence ("the region has Gold, Silver or Copper"), `yes`/`no` word a list of `obj`s.
 * Returns true/false for a term that is constant for a player.
 */
function atomInfo(t, mode) {
  let m;
  const one = (s) => ({ key: null, obj: null, yes: () => s[0], no: () => s[1] });

  if ((m = /^factions\s*\{([^}]*)\}$/i.exec(t))) {
    const list = m[1].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const p = factionsPhrase(list);
    if (p === "all") return true;
    if (p === "none") return false;
    if (!p) return unknown(t);
    return { key: "factions", obj: list, yes: (o) => playPhrase(o.flat(), false), no: (o) => playPhrase(o.flat(), true) };
  }

  if ((m = /^building_present(?:_min_level\s+(\S+)\s+(\S+)|\s+(\S+))(\s+queued)?$/i.exec(t))) {
    const tok = (m[1] || m[3]).toLowerCase(), min = m[2] ? m[2].toLowerCase() : null;
    const chain = CHAIN_BY_NAME.get(tok) || CHAIN_OF_LEVEL.get(tok);
    if (!chain) return unknown(t);
    const href = `${slug(chain.chain)}.md`;
    let b;
    if (min) { const n = dName(min); if (!n) return unknown(t); b = `[${n}](${href}) or a higher level`; }
    else if (!CHAIN_BY_NAME.get(tok)) { const n = dName(tok); if (!n) return unknown(t); b = `[${n}](${href})`; }
    else if (chain.order.length === 1) { const n = dName(chain.order[0]); if (!n) return unknown(t); b = `[${n}](${href})`; }
    else { const n = BUILDINGS.chainName(chain.chain, targetName(chain.chain)); if (!n) return unknown(t); b = `any level of [${n}](${href})`; }
    const where = m[4] ? "built or being built here" : "built here";
    return { key: `bp|${where}`, obj: b, yes: (o) => `${orList(o)} is ${where}`, no: (o) => (o.length > 1 ? `${neither(o)} is ${where}` : /^any level of /.test(o[0]) ? `${o[0].replace(/^any/, "no")} is ${where}` : `${o[0]} is not ${where}`) };
  }

  if ((m = /^no_building_tagged\s+(\S+)(\s+queued)?$/i.exec(t))) {
    const w = TAG_WORDS[m[1].toLowerCase()];
    if (!w) return unknown(t);
    const q = m[2] ? " or being built" : "";
    return one([
      mode === "req" ? `only one ${w} building per settlement: no other may already be built${q} here` : `no ${w} building is built${q} here`,
      `a ${w} building is built${q} here`,
    ]);
  }

  if ((m = /^resource\s+(\S+)$/i.exec(t))) {
    const r = m[1].toLowerCase();
    if (HIDDEN_KIND.has(r)) return unknown(t);
    return { key: "res", obj: resourceLabel(r), yes: (o) => `the region has ${orList(o)}`, no: (o) => `the region has ${o.length === 1 ? `no ${o[0]}` : neither(o)}` };
  }

  if ((m = /^hidden_resource\s+(\S+)(\s+factionwide)?$/i.exec(t))) {
    const h = m[1].toLowerCase(), fw = !!m[2];
    // Set in 13 regions to stop building there at all. It is on nearly every level and true
    // nearly everywhere, so as a requirement line it only ever read as noise.
    if (h === "nobuild") return false;
    if (neverSet(h)) return false;   // no region carries it and no script sets it
    if (h === "capital" && !fw) return one(["this settlement is your capital", "this settlement is not your capital"]);
    if ((m = /^undersiege(\d)$/.exec(h)) && !fw && SIEGE_TURN[m[1]]) {
      const n = SIEGE_TURN[m[1]];
      const s = n === 1 ? "the settlement is under siege" : `the settlement has been under siege for ${n} turns or more`;
      return one([`${s} (this lingers for a few turns after a siege is lifted)`, `${s.replace(/\bis under siege\b/, "is not under siege").replace(/\bhas been\b/, "has not been")}`]);
    }
    if (h === "blockaded" && !fw) return one(["the settlement is blockaded", "the settlement is not blockaded"]);
    // Re-set on the capital every turn by the grain script while supply exceeds imports and
    // imports are still below 16 (points_count = grain_supply_count - grain_imports_count > 0).
    if (h === "can_build_grain_imports" && fw) {
      return one(["your empire has grain points not yet spent on imports (and fewer than 16 already are)",
        "your empire has no grain points left over for imports"]);
    }
    if ((m = /^grain_(supply|imports)_(\d+)$/.exec(h)) && fw) {
      const n = +m[2];
      const v = m[1] === "supply" ? (n <= 1 ? "1 or fewer" : n >= 16 ? "16 or more" : n) : (n >= 16 ? "16 or more" : n);
      return m[1] === "supply"
        ? one([`your empire has ${v} grain points`, `your empire does not have ${v} grain points`])
        : one([`${v} of your empire's grain points go to imports`, `it is not ${v} of your empire's grain points that go to imports`]);
    }
    if ((m = /^qty_([a-z]+)_(\d+)$/.exec(h)) && !fw) {
      return one([`the region's ${resourceLabel(m[1])} quantity is ${m[2]}`, `the region's ${resourceLabel(m[1])} quantity is not ${m[2]}`]);
    }
    const lvl = SCRIPT_FLAGS.fromLevel[h];
    if (lvl && dName(lvl)) {
      const c = CHAIN_OF_LEVEL.get(lvl);
      const b = c ? `[${dName(lvl)}](${slug(c.chain)}.md)` : dName(lvl);
      return {
        key: `supply|${fw}`, obj: b,
        yes: (o) => `${orList(o)} is built ${fw ? "somewhere in your empire" : "here"}`,
        no: (o) => `${o.length === 1 ? `no ${o[0]}` : neither(o)} is built ${fw ? "anywhere in your empire" : "here"}`,
      };
    }
    if (h === "harbour_constructed" && !fw && dName("harbour")) {
      // The script's BuildingCompleted monitor: finishing a `harbour` removes it and sets this.
      const c = CHAIN_OF_LEVEL.get("harbour");
      const b = c ? `[${dName("harbour")}](${slug(c.chain)}.md)` : dName("harbour");
      return one([`a ${b} has been completed here`, `no ${b} has been completed here`]);
    }
    // Static region tags without a reference page. The wording is the tag's own name, as the
    // region pages list it under "Geography and gating"; the inland one is the game's own
    // wording ({market_inlandcentre}: "an important inland trade centre").
    const STATIC = {
      inland_trade_centre: ["the region is an important inland trade centre", "the region is not an important inland trade centre"],
      iron_trade_centre: ["the region is an iron trade centre", "the region is not an iron trade centre"],
      tin_trade_centre: ["the region is a tin trade centre", "the region is not a tin trade centre"],
      island_settlement: ["the settlement is on an island", "the settlement is not on an island"],
    };
    if (STATIC[h] && !fw) return one(STATIC[h]);
    const ref = TAG_REFS[h];
    if (ref && !fw) {
      const L = tagLink(h);
      const kinds = {
        "terrain.md": ["the region's terrain is", "the region's terrain is not"],
        "climate.md": ["the region's climate is", "the region's climate is not"],
        "fertility.md": ["the region's fertility is", "the region's fertility is not"],
        "recruitment-other.md": ["the region is a", "the region is not a"],
      };
      if (kinds[ref.page]) {
        const [y, n] = kinds[ref.page];
        const tail = ref.page === "recruitment-other.md" ? " region" : "";
        return { key: `tag|${ref.page}`, obj: L, yes: (o) => `${y} ${orList(o)}${tail}`, no: (o) => `${n} ${orList(o)}${tail}` };
      }
      if (ref.page === "ports.md") {
        // The harbour tags are named as a phrase ("No natural harbour", "Natural harbour up to
        // Shipwright"), so they read as what the region has.
        const w = `[${ref.name.replace(/^\w/, (c) => c.toLowerCase())}](../tags/${ref.page}#${ref.anchor})`;
        return { key: "tag|harbour", obj: w, yes: (o) => `the region has ${orList(o)}`, no: (o) => `the region does not have ${orList(o)}` };
      }
      if (ref.page === "irrigation.md") {
        const w = `[${ref.name.replace(/^Irrigation\s+/i, "").replace(/^\w/, (c) => c.toUpperCase())}](../tags/${ref.page}#${ref.anchor})`;
        return { key: "tag|water", obj: w, yes: (o) => `the region's water source is ${orList(o)}`, no: (o) => `the region's water source is not ${orList(o)}` };
      }
      if (ref.page === "recruitment-zones.md") {
        return { key: "tag|aor", obj: `[${ref.name}](../tags/${ref.page}#${ref.anchor})`, yes: (o) => `the region is in the ${orList(o)} area${o.length > 1 ? "s" : ""} of recruitment`, no: (o) => `the region is not in the ${orList(o)} area${o.length > 1 ? "s" : ""} of recruitment` };
      }
      if (ref.page === "cultural-homeland.md") {
        return { key: "tag|home", obj: `[${ref.name}](../tags/${ref.page}#${ref.anchor})`, yes: (o) => `the region is in the ${orList(o)} homeland${o.length > 1 ? "s" : ""}`, no: (o) => `the region is not in the ${orList(o)} homeland${o.length > 1 ? "s" : ""}` };
      }
      if (h === "rivertrade") return one([`the region has a ${L}`, `the region has no ${L}`]);
      if (ref.page === "hazards-and-river-trade.md") return one([`the region has the ${L} hazard`, `the region does not have the ${L} hazard`]);
      return unknown(t);
    }
    // Any other static tag is said by naming the regions that carry it — exact, and a short
    // enough list for the effect folds these appear in.
    const regs = REGION_TAGS.get(h);
    if (regs && regs.length <= 15 && !SCRIPT_FLAGS.set.has(h)) {
      const names = regs.map((r) => {
        const n = pageTitle("regions", `${r}.md`);
        return n ? `[${n}](../regions/${r}.md)` : r.replace(/_/g, " ");
      });
      return fw ? one([`you hold ${orList(names)}`, `you do not hold ${orList(names)}`])
        : one([`the region is ${orList(names)}`, `the region is not ${orList(names)}`]);
    }
    return unknown(t);
  }

  if ((m = /^is_toggled\s+"([^"]+)"$/i.exec(t))) {
    const s = m[1].replace(/^\w/, (c) => c.toUpperCase());
    return one([`the "${s}" campaign setting is on`, `the "${s}" campaign setting is off`]);
  }

  if ((m = /^major_event\s+"([^"]+)"$/i.exec(t))) {
    const e = m[1].toLowerCase();
    if (e === "winter") return one(["it is winter", "it is not winter"]);
    const sz = /^empire_size(\d+)$/.exec(e);
    if (sz) { const r = empireSize(sz[1]); return r ? one([`your empire has ${r}`, `your empire does not have ${r}`]) : unknown(t); }
    const ref = REFORM_REFS[e];
    if (ref && ref.page && ref.title) return one([`the [${ref.title}](../reforms/${ref.page}) event has happened`, `the [${ref.title}](../reforms/${ref.page}) event has not happened`]);
    return unknown(t);
  }

  if ((m = /^majority_religion\s+(\S+)$/i.exec(t))) {
    const r = m[1].toLowerCase();
    return { key: "maj", obj: beliefLabel(r), yes: (o) => `the region's majority religion is ${orList(o)}`, no: (o) => `the region's majority religion is not ${orList(o)}` };
  }

  // `port`: the game's own card line for `not port` is "Additional trade bonus due to this
  // being an inland region" ({market_no_port}), so `port` is the coastal/inland distinction —
  // worded that way, not "is a port", which reads as a port building (the Trade Port itself
  // requires it).
  if (/^port$/i.test(t)) return one(["the settlement is coastal", "the settlement is inland"]);

  return unknown(t);
}

/** A religion's name, linked to its page. Names come from the game's {X_LABEL} strings first. */
function beliefLabel(tok) {
  const t = String(tok).toLowerCase();
  const ref = RELIGION_REFS[t];
  const name = RELIGION_NAMES[t] || (ref && ref.name) ||
    t.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
  return ref && ref.page ? `[${name}](../religions/${ref.page})` : name;
}

/**
 * Two shorthands too long to spell out, checked for their exact shape before being summarised:
 * `homeland` is one alternative per homeland tag, each "these factions (usually one; the
 * Macedonian homeland has six), in this homeland tag"; `own_religion_majority` is one per
 * religion, each "the region's majority is X and your faction is one of X's". If either ever
 * changes shape, it falls through to the ordinary expansion.
 */
function specialAlias(name) {
  if (name === "homeland") {
    const body = forPlayer(ALIASES.homeland || "");
    const ok = body && body.split(/\s+or\s+/i).every((a) => {
      const b = ALIASES[a.trim().toLowerCase()];
      return b && /^factions\s*\{[a-z0-9_,\s]+\}\s+and\s+hidden_resource\s+homeland_[a-z0-9_]+$/i.test(b.trim());
    });
    if (ok) return { key: null, yes: () => "the region is your faction's own [homeland](../tags/cultural-homeland.md)", no: () => "the region is not your faction's own [homeland](../tags/cultural-homeland.md)" };
  }
  if (name === "own_religion_majority") {
    const body = forPlayer(ALIASES.own_religion_majority || "");
    const alts = body ? body.split(/\s+or\s+/i) : [];
    const ok = alts.length && alts.every((a) => {
      const m = /^majority_religion\s+([a-z0-9_]+)\s+and\s+faction_religion_([a-z0-9_]+)$/i.exec(a.trim());
      return m && m[1].toLowerCase() === m[2].toLowerCase();
    });
    if (ok) return { key: null, yes: () => "the region's majority religion is your faction's own", no: () => "the region's majority religion is not your faction's own" };
  }
  return null;
}

// ── the condition tree ──
// Conditions have no brackets: `or` binds loosest, then `and` (the same reading forPlayer uses).
const T = { k: "T" }, F = { k: "F" };
function mk(op, kids) {
  const out = [];
  for (const c of kids) {
    if (c.k === op) { out.push(...c.c); continue; }
    if (c.k === (op === "and" ? "T" : "F")) continue;
    if (c.k === (op === "and" ? "F" : "T")) return c;
    out.push(c);
  }
  if (!out.length) return op === "and" ? T : F;
  return out.length === 1 ? out[0] : { k: op, c: out };
}
function condTree(expr, neg, mode, depth = 0) {
  const alts = String(expr).trim().split(/\s+or\s+/i).map((a) => a.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean));
  // Negation is pushed inward (De Morgan), so `not <alias>` reads as the plain opposite.
  if (!neg) return mk("or", alts.map((a) => mk("and", a.map((x) => termTree(x, false, mode, depth)))));
  return mk("and", alts.map((a) => mk("or", a.map((x) => termTree(x, true, mode, depth)))));
}
function termTree(term, neg, mode, depth) {
  let t = String(term).trim(), m;
  while ((m = /^not\s+(.+)$/i.exec(t))) { neg = !neg; t = m[1].trim(); }
  const low = t.toLowerCase();
  if (low === "is_player") return neg ? F : T;
  if (Object.prototype.hasOwnProperty.call(ALIASES, low)) {
    const sp = specialAlias(low);
    if (sp) return { k: "atom", a: sp, neg };
    // In a requirement the game's own label is the best wording there is — except the
    // "requires the destruction of …" ones, which say what to do when the check FAILS, and the
    // empire-size one, which says nothing about which size.
    const label = ALIAS_DISPLAY[low] && uiText(ALIAS_DISPLAY[low]);
    if (mode === "req" && !neg && label && !/destruction of/i.test(label) && ALIAS_DISPLAY[low] !== "size_effect") {
      return { k: "atom", a: { key: null, yes: () => RL.linkAlias(low, label) }, neg: false };
    }
    if (depth > 6) return { k: "atom", a: unknown(t), neg };
    const body = forPlayer(ALIASES[low]);
    if (body === null) return neg ? T : F;
    if (body === "") return neg ? F : T;
    return condTree(body, neg, mode, depth + 1);
  }
  const a = atomInfo(t, mode);
  if (a === true) return neg ? F : T;
  if (a === false) return neg ? T : F;
  return { k: "atom", a, neg };
}
const negate = (n) => (n.k === "atom" ? { ...n, neg: !n.neg }
  : n.k === "T" ? F : n.k === "F" ? T
    : { k: n.k === "and" ? "or" : "and", c: n.c.map(negate) });
const isNegative = (n) => (n.k === "atom" ? n.neg : n.k === "and" && n.c.every((x) => x.k === "atom" && x.neg));

/**
 * The parts of an and/or node, each already a phrase. Terms sharing a `key` are merged: in an
 * `or` the positives ("the region has Gold or Silver"), in an `and` the negatives ("the region
 * has neither Gold nor Silver"). Inside an `and`, an `or` of negatives is kept apart as an
 * exception ("… but not when it is winter and …"), which is what it means and far easier to
 * read than a chain of "is not … or is not …". `lost` says an untranslatable term was left out.
 */
const plain = (s) => String(s).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
function groupParts(n) {
  const isAnd = n.k === "and";
  const groups = new Map(), parts = [];
  for (const c of n.c) {
    if (c.k === "atom" && !c.a.unknown && c.a.key && c.neg === isAnd) {
      const g = groups.get(c.a.key);
      if (g) { g.objs.push(c.a.obj); continue; }
      const ng = { a: c.a, neg: c.neg, objs: [c.a.obj] };
      groups.set(c.a.key, ng);
      parts.push(ng);
      continue;
    }
    parts.push(c);
  }
  // `not building_present X and not building_present X queued` (the not_granary shape): the
  // queued form already says "not built", so saying both is one requirement twice.
  const plainG = groups.get("bp|built here"), queuedG = groups.get("bp|built or being built here");
  if (plainG && queuedG) {
    plainG.objs = plainG.objs.filter((o) => !queuedG.objs.includes(o));
    if (!plainG.objs.length) return parts.filter((p) => p !== plainG);
  }
  return parts;
}
function renderParts(n, ctx) {
  const isAnd = n.k === "and";
  const parts = groupParts(n);
  const items = [], seen = new Set();
  let lost = false;
  for (const p of parts) {
    if (isAnd && p.k === "or" && p.c.every(isNegative)) {
      const s = renderNode(negate(p), ctx);
      if (s == null) { lost = true; continue; }
      if (!seen.has(`!${s}`)) { seen.add(`!${s}`); items.push({ s, except: true, node: p }); }
      continue;
    }
    const s = p.objs ? (p.neg ? p.a.no : p.a.yes)(uniq(p.objs)) : renderNode(p, ctx);
    if (s == null) { lost = true; continue; }
    if (seen.has(s)) continue;             // the same term twice ("has Gold … and has Gold")
    seen.add(s);
    items.push({ s, node: p.objs ? null : p });
  }
  return { items, lost };
}
// How much structure a phrase already carries decides how it can be listed beside others: one
// with its own "and" needs the heavy "; or " separator, one with its own "or" a comma.
const hasAnd = (s) => / and /.test(plain(s));
const hasOr = (s) => / or /.test(plain(s));
function renderNode(n, ctx) {
  if (n.k === "atom") {
    if (n.a.unknown) { ctx.unknown.push(n.a.tok); return null; }
    return (n.neg ? n.a.no : n.a.yes)([n.a.obj]);
  }
  const { items, lost } = renderParts(n, ctx);
  const pos = items.filter((x) => !x.except), exc = items.filter((x) => x.except);
  if (!pos.length && !exc.length) return null;
  if (n.k === "and") {
    // An `or` of several phrases inside an `and` is introduced with "either", or bracketed when
    // its alternatives are themselves compound, so the reader can see where it ends.
    const strs = pos.map((x) => {
      if (!x.node || x.node.k !== "or") return x.s;
      if (/; or /.test(x.s)) return `(${x.s})`;
      // One merged phrase ("the region has Gold or Silver") needs no "either"; alternatives do.
      const one = x.node.c.every((c) => c.k === "atom" && !c.neg && c.a.key && c.a.key === x.node.c[0].a.key);
      return one ? x.s : `either ${x.s}`;
    });
    // A part carrying its own ", or" (a faction list with extra names, an "either …") would run
    // into the next part without the comma.
    let s = strs.length > 1 && strs.some((x) => /^(?:either |\()/.test(x) || /, or /.test(plain(x))) ? strs.join(", and ") : andList(strs);
    if (exc.length) s = s ? `${s}, but not when ${exc.map((x) => x.s).join(", nor when ")}` : `not when ${exc.map((x) => x.s).join(", nor when ")}`;
    return s + (lost ? " (among other conditions)" : "");
  }
  const strs = pos.map((x) => x.s);
  const joined = strs.some(hasAnd) ? strs.join("; or ") : strs.some(hasOr) ? strs.join(", or ") : orList(strs);
  return joined + (lost ? ", or under other conditions" : "");
}
function noteUnknown(ctx) {
  for (const u of ctx.unknown) UNKNOWN_TERMS.set(u, (UNKNOWN_TERMS.get(u) || 0) + 1);
}
/**
 * A condition in words: { always } / { never } for a condition that is constant for a player,
 * else { text, except } — `except` when it reads best as the exception ("except when it is
 * winter and …"), which is how an `or` of negatives is meant.
 */
function sayCondition(expr, mode) {
  const tree = condTree(expr, false, mode);
  if (tree.k === "T") return { always: true };
  if (tree.k === "F") return { never: true };
  const ctx = { unknown: [] };
  let res;
  if (tree.k === "or" && tree.c.every(isNegative)) {
    const s = renderNode(negate(tree), ctx);
    if (s) res = { text: `except when ${s}`, except: true };
  }
  if (!res) {
    const s = renderNode(tree, ctx);
    res = s && /^not when /.test(s) ? { text: s.replace(/^not when /, "except when "), except: true } : { text: s };
  }
  noteUnknown(ctx);
  return res;
}
/** ", only when …" for an effect line. */
function effectWhen(res) {
  if (!res.text) return "only under certain conditions";
  return res.except ? res.text : `only when ${res.text}`;
}

/**
 * A condition as nested bullets — "All of these:" / "Any one of these:" — for the few that are
 * too long to read as a sentence (the farm chains' terrain rules run to thousands of characters).
 * Same grouping and wording as the sentence form, only laid out.
 */
function outline(n, depth = 0) {
  const pad = "  ".repeat(depth);
  const s = renderNode(n, { unknown: [] });
  if (n.k === "atom" || (s && plain(s).length <= 200)) return [`${pad}- ${s ? capFirst(s) : "Further conditions the game checks"}`];
  const out = [`${pad}- ${n.k === "and" ? "All of these:" : "Any one of these:"}`];
  for (const p of groupParts(n)) {
    if (p.objs) { out.push(`${pad}  - ${capFirst((p.neg ? p.a.no : p.a.yes)(uniq(p.objs)))}`); continue; }
    if (n.k === "and" && p.k === "or" && p.c.every(isNegative)) {
      out.push(`${pad}  - Not when:`, ...outline(negate(p), depth + 2));
      continue;
    }
    out.push(...outline(p, depth + 1));
  }
  return out;
}
// What a long condition is about, for the one-line summary that stands in for it.
// Region topics are listed under one "the region's …"; the rest follow.
const TOPIC_OF_KEY = [
  [/terrain\.md$/, "terrain", true], [/climate\.md$/, "climate", true], [/^tag\|water$/, "water source", true],
  [/^res$/, "resources", true], [/^tag\|harbour$/, "harbour", true], [/fertility\.md$/, "fertility", true],
  [/^tag\|(?:aor|home)$/, "location", true], [/^maj$/, "religion", true],
  [/^factions$/, "your faction", false], [/^bp\|/, "what is built here", false],
  [/^supply\|true$/, "what is built elsewhere in your empire", false],
];
function topicsOf(n, acc = new Set()) {
  if (n.k === "atom") {
    const k = n.a && n.a.key;
    for (const t of TOPIC_OF_KEY) if (k && t[0].test(k)) acc.add(t);
  } else if (n.c) for (const c of n.c) topicsOf(c, acc);
  return acc;
}
function topicPhrase(n) {
  const ts = TOPIC_OF_KEY.filter((t) => topicsOf(n).has(t));
  const region = ts.filter((t) => t[2]).map((t) => t[1]), other = ts.filter((t) => !t[2]).map((t) => t[1]);
  const parts = [...(region.length ? [`the region's ${andList(region)}`] : []), ...other];
  return parts.length ? `Depends on ${parts.length > 1 && region.length > 1 ? parts.join("; and on ") : andList(parts)}` : "A further condition";
}

/**
 * A level's requirement: { lines, long }. One line per `and`-term; a term too long to read as a
 * sentence is summarised by what it is about, and given in full as an outline in `long`, which
 * the page folds. null when no faction a player can pick is able to build the level (every
 * route needs the AI, or only a placeholder faction may build it).
 */
const LONG_REQUIREMENT = 500;
function requirementLines(requires) {
  const tree = condTree(requires, false, "req");
  if (tree.k === "T") return { lines: [], long: [] };
  if (tree.k === "F") return null;
  const ctx = { unknown: [] };
  const terms = tree.k === "and" ? tree : { k: "and", c: [tree] };
  const { items, lost } = renderParts(terms, ctx);
  const lines = [], long = [];
  for (const x of items) {
    // Each bullet stands alone, so an exception becomes "Not when …" and an `or` term needs no
    // "either" or brackets around it.
    const text = x.except ? `Not when ${x.s}` : capFirst(x.s);
    if (plain(text).length <= LONG_REQUIREMENT || !x.node) { lines.push(text); continue; }
    lines.push(`${topicPhrase(x.node)} (see the full conditions below)`);
    long.push(...(x.except ? ["- Not when:", ...outline(negate(x.node), 1)] : outline(x.node, 0)));
  }
  if (lost) lines.push("Further conditions the game checks");
  noteUnknown(ctx);
  return { lines, long };
}

const list = ONLY.length ? chains.filter((c) => ONLY.includes(c.chain)) : chains;
fs.mkdirSync(path.join(OUT, "buildings"), { recursive: true });

let withIcon = 0, withArt = 0, withEffects = 0, totalLevels = 0, totalExclusions = 0;
// Untranslated effect lines, and the keywords they start with, so a run says out loud what is
// still being shown raw instead of leaving it to be discovered on a page.
let untranslated = 0;
const untranslatedKeywords = new Map();
let withDesc = 0, withoutDesc = 0, descVaries = 0, artSubstituted = 0;
let recruitLevels = 0, recruitEntries = 0;
const noDesc = [];
const index = [];

for (const c of list) {
  const levels = c.order.map((l) => c.levels[l]).filter(Boolean);
  totalLevels += levels.length;

  const rows = levels.map((l) => {
    const name = dName(l.level) || l.level;
    const ic = iconFor(l.level);
    const art = artFor(l.level);
    const d = descFor(l.level);
    const eff = describeEffects(l.effects);
    const ex = exclusionsOf(l.requires, ALIASES);
    if (ic) withIcon++;
    if (art.art) withArt++;
    if (art.art && art.artLevel && art.artLevel !== l.level.toLowerCase()) artSubstituted++;
    if (l.effects.length) withEffects++;
    if (d.full || d.short) withDesc++; else { withoutDesc++; noDesc.push(l.level); }
    if (d.variants > 1) descVaries++;
    if (eff.recruits.length) { recruitLevels++; recruitEntries += eff.recruits.length; }
    totalExclusions += ex.length;
    untranslated += eff.raw.length;
    for (const r of eff.raw) {
      const kw = r.split(/\s+/)[0];
      untranslatedKeywords.set(kw, (untranslatedKeywords.get(kw) || 0) + 1);
    }
    return { l, name, ic, art, d, eff, ex };
  });

  // The team's name for the chain, not the first level's. Falls back to the old behaviour
  // for any chain the table does not cover, so a new chain still gets a page.
  const chainName = BUILDINGS.chainName(c.chain, rows[0].name);
  const pathLine = rows.map((r) => r.name).join(" → ");

  // ── the lede: everything before the first `## ` spans the full page width ──
  const lede = [
    `# ${chainName}`,
    "",
    "[← all buildings](../buildings.md) · [wiki index](../README.md)",
    "",
    rows.length > 1
      ? `${rows.length} levels, each replacing the one before it: you upgrade in place rather than building alongside.\n\n**${pathLine}**`
      : "A single-level building: there is nothing to upgrade it into.",
    "",
    "",   // a blank line before the first `## `, or a single-level page runs the two together
  ].join("\n");

  // ── at a glance: six columns, so the viewer gives it a full row ──
  const anyEx = rows.some((r) => r.ex.length);
  const glance = rows.length > 1 ? `
## Levels at a glance

| | Level | Cost | Build time | Minimum settlement | Upgrades to |${anyEx ? " Excludes |" : ""}
|:-:|---|---:|---:|---|---|${anyEx ? "---|" : ""}
${rows.map((r) => `| ${r.ic ? `<img src="../${r.ic}" alt="" width="56">` : ""} | ${anchorSafe(r.name) ? `[${r.name}](#${anchor(r.name)})` : r.name} | ${r.l.cost != null ? r.l.cost.toLocaleString("en-US") : "not stated"} | ${r.l.turns != null ? r.l.turns : "not stated"} | ${r.l.minSize ? r.l.minSize.replace(/_/g, " ") : "any"} | ${r.l.upgradesTo.length ? r.l.upgradesTo.map((u) => dName(u) || u).join(", ") : "—"} |${anyEx ? ` ${r.ex.length ? r.ex.map(excludeText).join("; ") : "—"} |` : ""}`).join("\n")}

Costs in denarii, build time in turns.
` : "";

  // ── one `## ` section per level, so they flow into columns ──
  const sections = rows.map(({ l, name, ic, art, d, eff, ex }) => {
    const parts = [`## ${name}`, ""];

    if (art.art) {
      parts.push(`![${name}](../${art.art})`, "");
      if (art.artLevel && art.artLevel !== l.level.toLowerCase()) {
        const borrowed = dName(art.artLevel);
        parts.push(`_The game ships no picture of its own for this level and shows ${borrowed ? `the ${borrowed} picture` : "another building's picture"} instead._`, "");
      }
    } else if (ic) {
      parts.push(`<img src="../${ic}" alt="${name}" width="64">`, "");
    }

    if (d.short && !(d.full && d.full.startsWith(d.short.slice(0, 40)))) {
      parts.push(`**${prose(d.short)}**`, "");
    }
    // A level with no real description simply has none on the page: a note that the files carry
    // only placeholders, or that other cultures word it differently, is about the files, not
    // the game.
    if (d.full) parts.push(prose(d.full), "");

    parts.push("| | |", "|---|---|");
    if (l.cost != null) parts.push(`| Cost | ${l.cost.toLocaleString("en-US")} denarii |`);
    if (l.turns != null) parts.push(`| Build time | ${l.turns} turn${l.turns === 1 ? "" : "s"} |`);
    if (l.minSize) parts.push(`| Minimum settlement | ${l.minSize.replace(/_/g, " ")} |`);
    if (l.upgradesTo.length) parts.push(`| Upgrades to | ${l.upgradesTo.map((u) => dName(u) || u).join(", ")} |`);
    if (l.cost == null && l.turns == null && !l.minSize && !l.upgradesTo.length) parts.push("| Cost and build time | not stated in the game files |");
    parts.push("");

    // Before "What it does", because a reader asks whether they CAN build it before they ask
    // what it would give them. The minimum settlement size is in the table above rather than
    // repeated here — it is a field of its own in the game files, not part of the condition.
    // Reduced to the player's condition first (forPlayer): the AI's alternative routes are not
    // something a player can use, and a level whose every route needs `not is_player` is
    // simply not buildable by a player.
    // A level no player can build — every route needs the AI, or only the placeholder faction
    // may build it — says so instead of listing conditions nobody can meet.
    const playerReq = l.requires ? forPlayer(l.requires) : l.requires;
    const req = playerReq === null ? null : playerReq ? requirementLines(playerReq) : { lines: [], long: [] };
    if (l.requires && req === null) {
      parts.push(`**Requirements:** _no faction you can play is able to build this level._`, "");
    } else if (req.lines.length) {
      parts.push(`**Requirements:** all of these must hold before this level can be built.`, "");
      parts.push(...req.lines.map((r) => `- ${r}`), "");
      if (req.long.length) parts.push("<details>", "<summary>Show the full conditions</summary>", "", ...req.long, "", "</details>", "");
    }

    // One "What it does" heading over both lists. Split into two labelled blocks, a level whose
    // every effect is conditional (every port level, for one) looked as though it did nothing.
    if (eff.effects.length || eff.conditional.length) {
      parts.push("**What it does**", "");
      // A mine value shows on the in-game card under the mod's relabelled engine string
      // (SMT_CAPABILITY_MINE_RESOURCE, "True income is below | IGNORE:"). Players asked what it
      // means, so the page says, on every level that has one.
      if ((l.effects || []).some((e) => /^\s*mine_resource\b/i.test(String(e)))) {
        parts.push(`> **"True income is below \\| IGNORE:" on the building card.** The number the game prints after that label is this level's mining value (listed below as *mining income*, or as a *mine resource* bonus added to the mine's), and it is a multiplier, not money. Each turn the settlement earns 5 × that value × the worth of the region's minerals (each mineral's trade value times how much of it the region holds). The card labels the raw number IGNORE because the money you actually get is written out on the card lines underneath it: *Mining income from …: +N per turn*.`, "");
      }
      if (eff.effects.length) parts.push(...eff.effects.map((e) => `- ${e}`), "");
      if (eff.conditional.length) {
        // Always folded, however few: each line carries its condition in words, which is what a
        // reader checking a particular region wants, and more than a first look needs.
        parts.push(...fold(`${eff.conditional.length} effect${eff.conditional.length === 1 ? "" : "s"} that apply only in some circumstances`,
          eff.conditional, 0));
      }
    }

    if (eff.beliefs.length) {
      parts.push(`**Religious belief:** spreads ${eff.beliefs.length} belief${eff.beliefs.length === 1 ? "" : "s"}, by how much depending on what the region already believes.`, "");
      parts.push(...fold(`the ${eff.beliefs.length} beliefs`, eff.beliefs, 6));
    }

    if (eff.recruits.length) {
      parts.push(`**Recruitment:** unlocks ${eff.recruits.length} unit${eff.recruits.length === 1 ? "" : "s"}. Which of them you can actually raise depends on your faction, your government and the region.`, "");
      parts.push(...fold(`the ${eff.recruits.length} units`, eff.recruits, 8));
    }

    if (eff.raw.length) {
      parts.push(...fold(`${eff.raw.length} effect line${eff.raw.length === 1 ? "" : "s"} this wiki does not translate yet, shown as the game files write them`, eff.raw.map((r) => `\`${r}\``), 0));
    }
    if (!eff.effects.length && !eff.recruits.length && !eff.beliefs.length && !eff.conditional.length && !eff.raw.length) {
      parts.push("No direct effects.", "");
    }

    if (ex.length) {
      parts.push(`> **Excludes:** building this rules out ${ex.map(excludeText).join(", ")}. Choose deliberately: this is not reversible by demolition in every case.`, "");
    }
    return parts.join("\n");
  });

  // No glossary of shorthands any more: every condition is written out in words where it is
  // used, so there is nothing left on the page for one to decode.
  const body = [lede, glance, ...sections].filter(Boolean).join("\n") + "\n";
  fs.writeFileSync(path.join(OUT, "buildings", `${slug(c.chain)}.md`), body, "utf8");

  const firstDesc = rows.map((r) => r.d).find((d) => d.short || d.full);
  index.push({
    chain: c.chain, name: chainName,
    levels: levels.length, slug: slug(c.chain),
    exclusions: rows.reduce((a, r) => a + r.ex.length, 0),
    firstIcon: (rows.find((r) => r.ic) || {}).ic || null,
    blurb: firstDesc ? oneLine(firstDesc.short || firstDesc.full) : null,
  });
}

/**
 * A `<details>` fold, so a 1,000-unit recruitment list does not bury the page. Short lists
 * are printed plain — folding three items away helps nobody. `threshold` 0 always folds.
 * <details> is HTML but it is the one construct GitHub renders and the local viewer already
 * handles; no styling, so both agree on what it looks like.
 */
function fold(summary, items, threshold) {
  if (threshold && items.length <= threshold) return [...items.map((i) => `- ${i}`), ""];
  return ["<details>", `<summary>Show ${summary}</summary>`, "", ...items.map((i) => `- ${i}`), "", "</details>", ""];
}

/** First sentence, for the index table. Table cells cannot hold paragraphs. */
function oneLine(s) {
  const t = prose(s).split(/\n\n/)[0];
  const m = /^(.{0,150}?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t.slice(0, 150)).trim();
}

index.sort((a, b) => b.levels - a.levels || a.name.localeCompare(b.name));
// The chains grouped as the team orders them: one list per subsection, subsections in the
// order the table gives, chains in their given order inside each. The old listing was one
// flat table sorted by level count, which put Walls between two farming chains.
const shown = index.filter((e) => !BUILDINGS.isExcluded(e.chain));
const bySub = new Map();
for (const e of shown) {
  const sub = BUILDINGS.chainSubsection(e.chain) || "Other";
  if (!bySub.has(sub)) bySub.set(sub, []);
  bySub.get(sub).push(e);
}
const subOrder = BUILDINGS.SUBSECTIONS.filter((x) => bySub.has(x))
  .concat([...bySub.keys()].filter((x) => !BUILDINGS.SUBSECTIONS.includes(x)));
// 48px, not 24. The icons are the only picture on the index and the game draws them at
// 156x124, so at 24 they were a thumbnail of a thumbnail — half the chain art unreadable
// and the rows too tight to scan. Nothing sets the row height; the icon is what sets it,
// so doubling the icon doubles the row.
const chainRow = (e) => `| ${e.firstIcon ? `<img src="${e.firstIcon}" alt="" width="48">` : ""} | [${e.name}](buildings/${e.slug}.md) | ${e.levels} | ${e.exclusions || ""} | ${e.blurb || "—"} |`;
const chainSections = subOrder.map((sub) => [
  `## ${sub}`,
  "",
  // One layout for every category (btab: full width, fixed columns, never dealt into copies),
  // so a one-row section like Walls lines up with the rest instead of stretching oddly.
  '<div class="btab nodeal">',
  "",
  "| | Chain | Levels | Excl. | What it is |",
  "|---|---|---:|---:|---|",
  bySub.get(sub).slice().sort((a, b) => BUILDINGS.chainOrder(a.chain) - BUILDINGS.chainOrder(b.chain)).map(chainRow).join("\n"),
  "",
  "</div>",
  "",
].join("\n")).join("\n");

const idx = `# Buildings

[← wiki index](README.md)

${index.length} building chains, ${totalLevels.toLocaleString("en-US")} levels in all. Each page follows a chain level by
level: what it looks like, what it does, what it costs and needs, and what it upgrades into.

${totalExclusions ? `**Some buildings rule others out:** once one is built, the other cannot be built in
that settlement. The *Excl.* column counts the levels in a chain that do this, and each page
marks them.
` : ""}
${chainSections}
`;
fs.writeFileSync(path.join(OUT, "buildings.md"), idx, "utf8");

console.log(`${list.length} building pages written`);
console.log(`  levels described:      ${totalLevels.toLocaleString("en-US")}`);
console.log(`  with a game description: ${withDesc.toLocaleString("en-US")} (of which ${descVaries.toLocaleString("en-US")} are worded differently for other cultures)`);
console.log(`  with NO description:     ${withoutDesc.toLocaleString("en-US")}${noDesc.length ? ` — ${noDesc.join(", ")}` : ""}`);
console.log(`  levels with an icon:   ${withIcon.toLocaleString("en-US")}`);
console.log(`  levels with a picture: ${withArt.toLocaleString("en-US")} (${artSubstituted.toLocaleString("en-US")} borrowed from another level, as the game does)`);
console.log(`  levels with effects:   ${withEffects.toLocaleString("en-US")}`);
console.log(`  levels unlocking units: ${recruitLevels.toLocaleString("en-US")} (${recruitEntries.toLocaleString("en-US")} unit entries, named not tokenised)`);
console.log(`  exclusion rules found: ${totalExclusions.toLocaleString("en-US")} (via ${Object.keys(ALIASES).length} aliases)`);
console.log(`  effect lines still shown raw: ${untranslated.toLocaleString("en-US")}` +
  (untranslated ? ` — ${[...untranslatedKeywords.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ")}` : ""));
// Condition terms no rule translates. They never reach a page raw — the line says "other
// conditions" instead — but a run should say what they are so the vocabulary can grow.
console.log(`  condition terms left untranslated: ${UNKNOWN_TERMS.size}` +
  (UNKNOWN_TERMS.size ? ` — ${[...UNKNOWN_TERMS.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ")}` : ""));
