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
 * CONDITIONS ARE NOT DROPPED. An effect whose `requires` clause says anything beyond
 * is_player / settlement size is listed apart, with its condition intact, instead of being
 * printed as though it always applies — `trade_level_bonus bonus -10 requires hidden_resource
 * UnderSiege1` is a siege penalty, not a permanent -10.
 *
 * LAYOUT. The local viewer (scripts/serve-ris-wiki.js) makes every `## ` section a grid item
 * and flows the sections into as many columns as the window allows, giving a section the full
 * row when its table has more than four columns. So each LEVEL is its own `## ` section —
 * they sit side by side on a wide screen instead of stacking down one narrow column — and the
 * at-a-glance table is deliberately wide enough to claim a full row. Plain markdown
 * throughout: no inline styles, no CSS, so GitHub Pages renders the same pages correctly, just
 * stacked.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
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

// `religious_belief aeolian 2` names a religion. Its label lives in expanded_bi.txt as
// {AEOLIAN_LABEL}. 50 of the 51 religions used by buildings have one.
function loadReligionNames() {
  const t = loadText("expanded_bi.txt");
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const m = /^(.+)_label$/.exec(k);
    if (m && !isPlaceholder(v)) out[m[1]] = v;
  }
  return out;
}
const RELIGION_NAMES = loadReligionNames();

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
function describeEffects(rawLines) {
  const out = [], conditional = [], raw = [];
  const recruits = new Map();   // display name -> {exp:Set, conditional:bool}
  const beliefs = new Map();    // religion -> values[]
  const groups = new Map();     // `${name}|${scope}|${shape}` -> {…, values[]}

  for (const line of rawLines) {
    const t = line.trim();

    let m = /^recruit\s+"([^"]+)"\s+(\d+)(?:\s+requires\s+(.+))?$/.exec(t);
    if (m) {
      const unit = UNIT_NAMES[m[1].toLowerCase()] || null;
      const key = unit || `not determined (game files call it "${m[1]}")`;
      if (!recruits.has(key)) recruits.set(key, { exp: new Set(), conditional: false });
      recruits.get(key).exp.add(+m[2]);
      if (m[3]) recruits.get(key).conditional = true;
      continue;
    }

    m = /^religious_belief\s+([a-z_]+)\s+(-?\d+)/.exec(t);
    if (m) {
      const rel = RELIGION_NAMES[m[1]] || `${m[1]} (no name in the text files)`;
      if (!beliefs.has(rel)) beliefs.set(rel, []);
      beliefs.get(rel).push(+m[2]);
      continue;
    }

    const p = parseEffect(t);
    if (p.raw) { raw.push(p.raw); continue; }
    if (p.otherCond) { conditional.push(`${label(p.name, p.value, p.signed)} — only when \`${p.cond}\``); continue; }
    const scope = p.aiOnly ? "ai" : (p.playerOnly ? "player" : "all");
    const k = `${p.name}|${scope}|${p.bySize ? "size" : "flat"}|${p.signed ? "s" : "m"}`;
    if (!groups.has(k)) groups.set(k, { ...p, values: [] });
    groups.get(k).values.push(p.value);
  }

  for (const g of groups.values()) {
    const uniq = [...new Set(g.values)].sort((a, b) => a - b);
    const scopeNote = g.aiOnly ? " _(AI only — does not apply to you)_"
      : (g.playerOnly ? " _(player only)_" : "");
    if (uniq.length === 1) {
      out.push(label(g.name, uniq[0], g.signed) + (g.bySize ? " at every settlement size" : "") + scopeNote);
    } else {
      const lo = uniq[0], hi = uniq[uniq.length - 1];
      out.push(`${humanise(g.name)} ${g.signed ? `${sgn(lo)} to ${sgn(hi)}` : `${lo} to ${hi}`}` +
        (g.bySize ? ", scaling with settlement size" : "") + scopeNote);
    }
  }
  // AI-only effects last: they are the least relevant to a reader.
  out.sort((a, b) => (a.includes("AI only") ? 1 : 0) - (b.includes("AI only") ? 1 : 0));

  const recruitList = [...recruits.entries()].map(([name, v]) => {
    const exp = [...v.exp].sort((a, b) => a - b).filter((x) => x > 0);
    return name + (exp.length ? ` (${exp.join(" or ")} experience)` : "");
  }).sort((a, b) => a.localeCompare(b));

  const beliefList = [...beliefs.entries()].map(([rel, vs]) => {
    const uniq = [...new Set(vs)].sort((a, b) => a - b);
    return uniq.length === 1 ? `${rel} ${sgn(uniq[0])}`
      : `${rel} ${sgn(uniq[0])} to ${sgn(uniq[uniq.length - 1])}`;
  }).sort((a, b) => a.localeCompare(b));

  return { effects: out, recruits: recruitList, beliefs: beliefList, conditional, raw };
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
      chain.order = m[1].split(/\s+/).filter((x) => /^[a-z0-9_+]+$/i.test(x));
      for (const l of chain.order) chain.levels[l] = { level: l, requires: "", effects: [], cost: null, turns: null, minSize: null, upgradesTo: [] };
      depth += opens - closes;
      continue;
    }

    // `<level> requires <expr>` opens that level's block.
    m = /^([a-z0-9_+]+)\s+requires\s+(.+)$/.exec(t);
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
          level.upgradesTo.push(...u.split(/\s+/).filter((x) => /^[a-z0-9_+]+$/i.test(x)));
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
  const tokens = new Set(String(requires).toLowerCase().split(/[^a-z0-9_+]+/).filter(Boolean));
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
  for (const m of String(requires).matchAll(/not\s+building_present_min_level\s+([a-z0-9_+]+)\s+([a-z0-9_+]+)/gi)) {
    out.push({ target: m[1], min: m[2] });
  }
  for (const m of String(requires).matchAll(/not\s+building_present\s+([a-z0-9_+]+)/gi)) {
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
  const shown = name || `\`${e.target}\` (no display name in the text files)`;
  if (!e.min) return shown;
  return `${shown} at ${min || `\`${e.min}\``} or above`;
}

/**
 * The conditions quoted on a page are full of the mod's own shorthands — `disabling_in_winter`,
 * `mic_tier_1_ships`, `not_extreme_cold` — defined once in an `alias` block and reused
 * everywhere. Quoted without explanation they read like noise, and `disabling_in_winter`
 * actually reads BACKWARDS ("only when disabling in winter" when it means the opposite). So
 * each page ends with the definitions of the shorthands it happens to use, verbatim from the
 * game files: no interpretation, just the indirection resolved. Followed transitively, because
 * an alias body names further aliases.
 */
const LONG_ALIAS = 240;
function aliasesUsed(texts) {
  const found = new Map();
  let frontier = texts;
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const t of frontier) {
      for (const tok of String(t).toLowerCase().split(/[^a-z0-9_+]+/)) {
        if (!ALIASES[tok] || found.has(tok)) continue;
        const body = ALIASES[tok];
        found.set(tok, body);
        // Do NOT walk into a list alias. `homeland` is an `or` of 201 per-faction shorthands,
        // and following it appended all 201 definitions to every page that mentioned the word
        // — 200 rows of noise for one condition.
        if (body.length <= LONG_ALIAS) next.push(body);
      }
    }
    frontier = next;
  }
  return [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
/** A shorthand's definition, or an honest count when it is a list too long to quote. */
function aliasBody(body) {
  if (body.length <= LONG_ALIAS) return `\`${body.replace(/\|/g, "\\|")}\``;
  const n = body.split(/\s+or\s+/).length;
  return `any one of ${n.toLocaleString("en-US")} alternatives — too long to quote here`;
}

const list = ONLY.length ? chains.filter((c) => ONLY.includes(c.chain)) : chains;
fs.mkdirSync(path.join(OUT, "buildings"), { recursive: true });

let withIcon = 0, withArt = 0, withEffects = 0, totalLevels = 0, totalExclusions = 0;
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
    return { l, name, ic, art, d, eff, ex };
  });

  const chainName = rows[0].name;
  const pathLine = rows.map((r) => r.name).join(" → ");

  // ── the lede: everything before the first `## ` spans the full page width ──
  const lede = [
    `# ${rows.length > 1 ? `${chainName} chain` : chainName}`,
    "",
    "[← all buildings](../buildings.md) · [wiki index](../README.md)",
    "",
    rows.length > 1
      ? `${rows.length} levels, each replacing the one before it — you upgrade in place rather than building alongside.\n\n**${pathLine}**`
      : "A single-level building: there is nothing to upgrade it into.",
    "",
    "Pictures are the game's own building art. Where a culture ships none of its own, the game falls back to another culture's, and that is what is shown here.",
    "",   // a blank line before the first `## `, or a single-level page runs the two together
  ].join("\n");

  // ── at a glance: six columns, so the viewer gives it a full row ──
  const anyEx = rows.some((r) => r.ex.length);
  const glance = rows.length > 1 ? `
## Levels at a glance

| | Level | Cost | Build time | Minimum settlement | Upgrades to |${anyEx ? " Excludes |" : ""}
|:-:|---|---:|---:|---|---|${anyEx ? "---|" : ""}
${rows.map((r) => `| ${r.ic ? `<img src="../${r.ic}" alt="" width="28">` : ""} | ${anchorSafe(r.name) ? `[${r.name}](#${anchor(r.name)})` : r.name} | ${r.l.cost != null ? r.l.cost.toLocaleString("en-US") : "not stated"} | ${r.l.turns != null ? r.l.turns : "not stated"} | ${r.l.minSize ? r.l.minSize.replace(/_/g, " ") : "any"} | ${r.l.upgradesTo.length ? r.l.upgradesTo.map((u) => dName(u) || u).join(", ") : "—"} |${anyEx ? ` ${r.ex.length ? r.ex.map(excludeText).join("; ") : "—"} |` : ""}`).join("\n")}

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
    if (d.full) parts.push(prose(d.full), "");
    else if (!d.short) parts.push("_The game files carry no description for this level — every culture's entry is a placeholder, so there is nothing to quote._", "");
    if (d.variants > 1) parts.push(`_Wording varies by culture: ${d.variants} versions of this description exist in the game files._`, "");

    parts.push("| | |", "|---|---|");
    if (l.cost != null) parts.push(`| Cost | ${l.cost.toLocaleString("en-US")} denarii |`);
    if (l.turns != null) parts.push(`| Build time | ${l.turns} turn${l.turns === 1 ? "" : "s"} |`);
    if (l.minSize) parts.push(`| Minimum settlement | ${l.minSize.replace(/_/g, " ")} |`);
    if (l.upgradesTo.length) parts.push(`| Upgrades to | ${l.upgradesTo.map((u) => dName(u) || u).join(", ")} |`);
    if (l.cost == null && l.turns == null && !l.minSize && !l.upgradesTo.length) parts.push("| Cost and build time | not stated in the game files |");
    parts.push("");

    // One "What it does" heading over both lists. Split into two labelled blocks, a level whose
    // every effect is conditional (every port level, for one) looked as though it did nothing.
    if (eff.effects.length || eff.conditional.length) {
      parts.push("**What it does**", "");
      if (eff.effects.length) parts.push(...eff.effects.map((e) => `- ${e}`), "");
      if (eff.conditional.length) {
        parts.push(...fold(`${eff.conditional.length} effect${eff.conditional.length === 1 ? "" : "s"} that apply only in the circumstances shown`,
          eff.conditional, 6));
      }
    }

    if (eff.beliefs.length) {
      parts.push(`**Religious belief** — spreads ${eff.beliefs.length} belief${eff.beliefs.length === 1 ? "" : "s"}, by how much depending on what the region already believes.`, "");
      parts.push(...fold(`the ${eff.beliefs.length} beliefs`, eff.beliefs, 6));
    }

    if (eff.recruits.length) {
      parts.push(`**Recruitment** — unlocks ${eff.recruits.length} unit${eff.recruits.length === 1 ? "" : "s"}. Which of them you can actually raise depends on your faction, your government and the region, exactly as the game files state it.`, "");
      parts.push(...fold(`the ${eff.recruits.length} units`, eff.recruits, 8));
    }

    if (eff.raw.length) {
      parts.push(...fold(`${eff.raw.length} effect line${eff.raw.length === 1 ? "" : "s"} this wiki does not translate yet — shown as the game files write them`, eff.raw.map((r) => `\`${r}\``), 0));
    }
    if (!eff.effects.length && !eff.recruits.length && !eff.beliefs.length && !eff.conditional.length && !eff.raw.length) {
      parts.push("_No effects are declared for this level._", "");
    }

    if (ex.length) {
      parts.push(`> **Excludes:** building this rules out ${ex.map(excludeText).join(", ")}. Choose deliberately — this is not reversible by demolition in every case.`, "");
    }
    return parts.join("\n");
  });

  const glossary = aliasesUsed(rows.flatMap((r) => [...r.eff.conditional, ...r.eff.raw]));
  const glossarySection = glossary.length ? `
## What the conditions mean

These are the mod's own shorthands, quoted from the game files unchanged.

| Shorthand | Stands for |
|---|---|
${glossary.map(([k, v]) => `| \`${k}\` | ${aliasBody(v)} |`).join("\n")}
` : "";

  const body = [lede, glance, ...sections, glossarySection].filter(Boolean).join("\n") + "\n";
  fs.writeFileSync(path.join(OUT, "buildings", `${slug(c.chain)}.md`), body, "utf8");

  const firstDesc = rows.map((r) => r.d).find((d) => d.short || d.full);
  index.push({
    chain: c.chain, name: rows.length > 1 ? `${chainName} chain` : chainName,
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
const idx = `# Buildings

[← wiki index](README.md)

${index.length} building chains, ${totalLevels.toLocaleString("en-US")} levels between them.
Each page shows the game's own picture and description for every level, what it does, what it
costs, how long it takes, the minimum settlement size, and its upgrade path.

${totalExclusions ? `**${totalExclusions} levels exclude another building** — building one forecloses
the other. Those are marked on the pages, because a commitment that quietly locks out an
alternative is worth knowing about first.
` : ""}
## Every chain

| | Chain | Levels | Excl. | What it is |
|:-:|---|---:|---:|---|
${index.map((e) => `| ${e.firstIcon ? `<img src="${e.firstIcon}" alt="" width="24">` : ""} | [${e.name}](buildings/${e.slug}.md) | ${e.levels} | ${e.exclusions || ""} | ${e.blurb || "no description in the game files"} |`).join("\n")}
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
