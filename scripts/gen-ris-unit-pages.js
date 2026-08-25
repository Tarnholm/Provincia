#!/usr/bin/env node
/**
 * One wiki page per RIS unit, plus a roster index with the stats table.
 *
 *   node scripts/gen-ris-unit-pages.js [--ris <dir>] [--out <dir>] [--only <unit,…>]
 *
 * Stats come from export_descr_unit.txt; names and descriptions from
 * text/export_units.txt, keyed by each unit's `dictionary` field.
 *
 * THE `dictionary` FIELD IS THE KEY, and finding that mattered. A unit's `type` string
 * (`aor arab levy spearmen`) has NO entry in the text file, so an earlier pass concluded
 * unit names were unresolvable and left 1,697 raw tokens across the wiki. Each EDU block
 * carries `dictionary arab_levy_spearmen`, and THAT resolves - to the display name, plus
 * `_descr` and `_descr_short` for the prose.
 *
 * PLACEHOLDER DESCRIPTIONS ARE REPORTED AS MISSING, not printed. RIS ships many units with
 * the literal text "This unit needs a long description." Passing that through would fill
 * the wiki with text that looks like content and is not, so it is treated as absent and
 * counted, which also tells the team how much writing is outstanding.
 *
 * MERCENARIES ARE NAMED AS SUCH. A mercenary is identified by its EDU `type` beginning
 * `merc `, NOT by the `mercenary_unit` attribute. Measured on the reference data: 1,697 EDU
 * entries, 770 carry the attribute, and those 770 are exactly the 320 `merc ` types PLUS all
 * 450 `aor ` types — every area-of-recruitment unit carries it too, so the attribute
 * over-matches by 2.4x and would have labelled half the regional roster as hireable.
 *
 * Corroborated independently: descr_mercenaries.txt, the file that actually decides what can
 * be hired, names 258 distinct unit types and every one of them is `merc `-prefixed. Two
 * unrelated files agree on the same 320-type population, so the prefix is the marker.
 *
 * NOT DONE: unit cards. The images live in the mod's UI folders as TGA, and turning ~1,700
 * of them into web-usable PNGs is a separate job - see the note at the foot of units.md.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const ONLY = (valOf("--only", "") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Text the mod ships as a stand-in for writing it later. Treated as absent.
const PLACEHOLDER = /this unit needs a (long|short) description/i;

// ── mercenaries ──────────────────────────────────────────────────────────────
// The marker is the `merc ` prefix on the EDU `type`, for the reasons in the header comment.
// Kept as one named constant so the two places that need it cannot drift apart.
const MERC_TYPE = /^merc\s/i;
// Do not prefix a name the mod already wrote as a mercenary's: 201 of the 319 mercenary
// dictionaries are called "Mercenary Cretan Archers" and the like already, and one
// ("Dravidian Mercenaries") puts the word last.
const ALREADY_MERC = /mercenar/i;

function loadText() {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "export_units.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* tokens then */ }
  return map;
}

/** Split an EDU block into its fields. Values may repeat (two `officer` lines), so arrays. */
function parseBlocks(edu) {
  const out = [];
  let cur = null;
  for (const raw of edu.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "type") { cur = { type: val.trim(), fields: {} }; out.push(cur); continue; }
    if (!cur) continue;
    (cur.fields[key] = cur.fields[key] || []).push(val.trim());
  }
  return out;
}

const first = (b, k) => (b.fields[k] ? b.fields[k][0] : null);
const csv = (b, k) => (first(b, k) || "").split(",").map((s) => s.trim());
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

// Every field the unit file states, not just the headline ones.
//
// TWO FIELDS WERE BEING READ WRONG and both are fixed here:
//   - the size field is `soldiers` (PLURAL) and its men count is index 0, not 1. Read as
//     "soldier"[1] it resolved to nothing, so no unit page has ever shown its unit size.
//   - stat_pri[8] is the SOUND type, not the weapon. Printed as "Weapon" it gave a bow-armed
//     elephant "Weapon: none". The weapon class is [5], its damage type [7].
function statsOf(b) {
  const pri = csv(b, "stat_pri");            // attack, charge, projectile, range, ammo, class, tech, damage, sound, delay
  const sec = csv(b, "stat_sec");
  const armour = csv(b, "stat_pri_armour");  // armour, defence skill, shield, material
  const secArm = csv(b, "stat_sec_armour");  // armour, defence skill, material
  const mental = csv(b, "stat_mental");      // morale, discipline, training
  const cost = csv(b, "stat_cost");          // turns, cost, upkeep, weapon upgrade, armour upgrade, total
  const soldiers = csv(b, "soldiers");       // men, extras, mass
  const health = csv(b, "stat_health");      // man hp, mount/animal hp
  const ground = csv(b, "stat_ground");      // scrub, sand, forest, snow
  const food = csv(b, "stat_food");
  const form = csv(b, "formation");          // close x, close y, loose x, loose y, ranks, style

  const flags = (k) => { const v = csv(b, k).filter((x) => x && x !== "no"); return v.length ? v : null; };
  const pos = (v) => { const n = num(v); return n ? n : null; };
  const word = (v) => (v && v !== "no" ? v : null);

  return {
    men: num(soldiers[0]),
    mass: soldiers[2] ? Number(soldiers[2]) : null,

    attack: num(pri[0]),
    charge: num(pri[1]),
    priProjectile: word(pri[2]),
    priRange: pos(pri[3]),
    priAmmo: pos(pri[4]),
    priClass: word(pri[5]),
    priTech: word(pri[6]),
    priDamage: word(pri[7]),
    priDelay: num(pri[9]),
    priAttr: flags("stat_pri_attr"),

    secAttack: num(sec[0]),
    secCharge: num(sec[1]),
    secProjectile: word(sec[2]),
    secRange: pos(sec[3]),
    secAmmo: pos(sec[4]),
    secClass: word(sec[5]),
    secTech: word(sec[6]),
    secDamage: word(sec[7]),
    secDelay: num(sec[9]),
    secAttr: flags("stat_sec_attr"),

    armour: num(armour[0]),
    defence: num(armour[1]),
    shield: num(armour[2]),
    armourMat: word(armour[3]),
    secArmour: num(secArm[0]),
    secDefence: num(secArm[1]),
    secArmourMat: word(secArm[2]),

    morale: num(mental[0]),
    discipline: mental[1] || null,
    training: mental[2] || null,

    hp: num(health[0]),
    hpMount: num(health[1]),
    heat: num(csv(b, "stat_heat")[0]),
    gScrub: num(ground[0]),
    gSand: num(ground[1]),
    gForest: num(ground[2]),
    gSnow: num(ground[3]),
    chargeDist: num(csv(b, "stat_charge_dist")[0]),
    fireDelay: num(csv(b, "stat_fire_delay")[0]),
    foodLow: num(food[0]),
    foodHigh: num(food[1]),

    mount: first(b, "mount"),
    mountEffect: first(b, "mount_effect"),
    formClose: form[0] && form[1] ? `${form[0]} x ${form[1]}` : null,
    formLoose: form[2] && form[3] ? `${form[2]} x ${form[3]}` : null,
    ranks: num(form[4]),
    formStyle: form[5] || null,

    turns: num(cost[0]),
    cost: num(cost[1]),
    upkeep: num(cost[2]),
    costWeaponUp: pos(cost[3]),
    costArmourUp: pos(cost[4]),
  };
}

// ── the building file, parsed once ───────────────────────────────────────────
const EDB = rd("export_descr_buildings.txt") || "";

// A `recruit "<unit>" N requires <expr>` line sits inside a building LEVEL's capability block
// and does not name that level itself, so the file has to be WALKED rather than scanned with
// one regex. The enclosing level is the building the unit needs, which is exactly what a
// reader on a unit page is asking for.
//
// PLAYER AND AI ROUTES ARE SEPARATE LINES and the wiki must report the player's. Measured on
// the reference data: 29,894 recruit lines — 8,665 gated `is_player`, 21,201 `not is_player`,
// 28 neither. The AI's lines carry a far simpler gate (most require only `noisland`), so
// printing those as "what it takes" would have told the reader that a unit needing a tier-3
// military building needs no building at all.
function parseRecruitLines() {
  const out = [];
  let levels = [], level = null, orphan = 0;
  for (const raw of EDB.split(/\r?\n/)) {
    const t = raw.replace(/;.*$/, "").trim();
    if (!t) continue;
    if (/^building\s+\S/.test(t)) { levels = []; level = null; continue; }
    let m = /^levels\s+(.+)$/.exec(t);
    if (m) { levels = m[1].trim().split(/\s+/).filter(Boolean); continue; }
    m = /^recruit\s+"([^"]+)"\s+\d+\s+requires\s+(.+)$/.exec(t);
    if (m) {
      if (level) out.push({ unit: m[1].trim().toLowerCase(), level, expr: m[2].trim() });
      else orphan++;
      continue;
    }
    // A level is `<name> requires <expr>` where <name> is on this chain's own `levels` line.
    // Matching any `<word> requires` would also catch the recruit lines themselves.
    m = /^(\S+)\s+requires\s+/.exec(t);
    if (m && levels.includes(m[1])) level = m[1];
  }
  // Reported so a format change that stops the walk matching cannot pass for "this mod has no
  // recruitment requirements".
  console.log(`recruit lines parsed: ${out.length.toLocaleString("en-US")}${orphan ? ` · OUTSIDE ANY BUILDING LEVEL: ${orphan}` : " · every one inside a building level"}`);
  return out;
}
const RECRUIT_LINES = parseRecruitLines();

// ── who can actually recruit each unit ───────────────────────────────────────
// The faction pages answer "what can this faction raise". This is the reverse, which is
// the question a reader on a unit page has. Split the same way, on the hidden_resource gate
// the engine enforces: the core list is short and meaningful, while regional availability
// is usually "everyone, if they take the right province" and so is reported as a count.
function loadAvailability() {
  const byType = new Map();   // unit type -> { core:Set, aor:Set }
  for (const line of RECRUIT_LINES) {
    const type = line.unit;
    const expr = line.expr;
    const hr = /hidden_resource/i.test(expr);
    const pos = [], neg = [];
    for (const fm of expr.matchAll(/(not\s+)?factions\s*\{([^}]*)\}/gi)) {
      const list = fm[2].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      (fm[1] ? neg : pos).push(...list);
    }
    let e = byType.get(type);
    if (!e) { e = { core: new Set(), aor: new Set(), all: false, allCore: false, neg: new Set() }; byType.set(type, e); }
    for (const n of neg) e.neg.add(n);
    if (pos.includes("all")) { e.all = true; if (!hr) e.allCore = true; continue; }
    for (const f of pos) (hr ? e.aor : e.core).add(f);
  }
  return byType;
}
const availability = loadAvailability();

// ── recruitment routes open to the player ────────────────────────────────────
const isPlayerLine = (e) => /\bis_player\b/i.test(e) && !/\bnot\s+is_player\b/i.test(e);
const anyRecruitLine = new Set(RECRUIT_LINES.map((r) => r.unit));
const playerRoutes = (() => {
  const by = new Map();
  for (const r of RECRUIT_LINES) {
    if (!isPlayerLine(r.expr)) continue;
    if (!by.has(r.unit)) by.set(r.unit, []);
    by.get(r.unit).push(r);
  }
  return by;
})();

/**
 * The clauses of a `requires` expression that a player has to satisfy.
 *
 * The faction gate is dropped — the page names those factions above — and so is `is_player`,
 * which decides whose route this line is, not what the player must build. What is left is
 * split on `and` only: there are no brackets anywhere in a recruit condition, so an `or`
 * stays inside the clause it belongs to and is labelled as alternatives.
 */
function clausesOf(expr) {
  return expr
    .replace(/(not\s+)?factions\s*\{[^}]*\}/gi, " ")
    .replace(/\bnot\s+is_player\b/gi, " ").replace(/\bis_player\b/gi, " ")
    .split(/\band\b/i).map((s) => s.trim()).filter(Boolean);
}

/** Hidden resources a route REQUIRES (not the ones it excludes) — the areas of recruitment. */
function zonesOf(expr) {
  const out = [];
  for (const c of clausesOf(expr)) {
    if (/^not\s/i.test(c)) continue;
    for (const m of c.matchAll(/(^|\bor\s+)hidden_resource\s+(\S+)/gi)) out.push(m[2].toLowerCase());
  }
  return out;
}

// ── requirements in the game's own words ─────────────────────────────────────
// The same resolution order the faction pages use, so the two never give one condition two
// different names:
//   1. an EDB `alias` block's `display_string` — the mod's own player-facing wording for a
//      condition (`requires_gov` is "Government Building"). Those keys are spread across
//      text/*.txt, not just export_buildings.txt, so every text file is indexed. Files are
//      read in sorted order and the first entry for a key wins, which picks `expanded_bi.txt`
//      over its `expanded_bi_mac_*.txt` translations.
//   2. a building LEVEL through text/export_buildings.txt.
//   3. a short, deliberately literal glossary of the engine's own condition keywords.
//   4. a resource the mod declares in descr_sm_resources.txt, humanised from its token.
// Anything still unrecognised is printed as the bare token in code font — that is then the
// only identifier it has, and a plausible-looking name for it would be worse than none.
const TEXT_LUT = (() => {
  const lut = {};
  try {
    const dir = path.join(RIS, "text");
    for (const f of fs.readdirSync(dir).filter((n) => /\.txt$/i.test(n)).sort()) {
      try {
        const t = fs.readFileSync(path.join(dir, f), "utf16le");
        for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) {
          const k = m[1].trim().toLowerCase();
          if (!(k in lut)) lut[k] = m[2].trim();
        }
      } catch { /* skip an unreadable text file */ }
    }
  } catch { /* no text dir */ }
  return lut;
})();

const ALIAS_TEXT = (() => {
  const out = {};
  let matched = 0;
  // The alias line may carry a trailing `;` comment, so the name cannot be matched to
  // end-of-line.
  for (const m of EDB.matchAll(/^[ \t]*alias[ \t]+(\S+)[^\r\n]*\r?\n[ \t]*\{([\s\S]*?)\n[ \t]*\}/gm)) {
    matched++;
    const ds = /display_string\s+(\S+)/.exec(m[2]);
    if (!ds) continue;
    // The text entries wrap their value in quotes: "Tier 2 Military Industrial Complex".
    const v = (TEXT_LUT[ds[1].trim().toLowerCase()] || "").replace(/^"(.*)"$/, "$1").trim();
    if (v) out[m[1].toLowerCase()] = v;
  }
  console.log(`aliases parsed: ${matched} · with a resolvable display_string: ${Object.keys(out).length}`);
  return out;
})();

const BUILDING_LEVEL_NAMES = (() => {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "export_buildings.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) {
      const k = m[1].trim().toLowerCase();
      if (!(k in map)) map[k] = m[2].trim().replace(/^"(.*)"$/, "$1");
    }
  } catch { /* fall back to the token */ }
  return map;
})();
const bName = (tok) => BUILDING_LEVEL_NAMES[String(tok).toLowerCase()] || null;

const DECLARED_RESOURCES = (() => {
  const txt = rd("descr_sm_resources.txt") || "";
  const out = new Set();
  for (const m of txt.matchAll(/"([A-Za-z0-9_\-]+)"\s*:\s*\{/g)) {
    const n = m[1].toLowerCase();
    if (n !== "resources") out.add(n);
  }
  return out;
})();

// Kept literal. These say what the engine checks, not what it means for play.
const KEYWORD_TEXT = {
  is_player: "player-controlled only",
  factionwide: "anywhere in the faction",
  queued: "queued for construction",
};

// ── unit attributes, in the game's own words ─────────────────────────────────
// An EDU `attributes` line is a list of engine flags: `sea_faring, hide_forest, can_sap,
// very_hardy`. Printed raw they are noise — `sea_faring` is on all 1,697 entries and
// `hide_forest` on 1,673, so neither tells one unit from another — but several of them are
// exactly what the game shows a player in the unit panel.
//
// The wording is NEVER written here. Each token is mapped to the text-file key that carries
// the game's own sentence for it, and the sentence is looked up at run time, so the page says
// what the mod says. A token is only in this table where the key's words ARE the token's
// words: `can_sap`/UA_CAN_SAP, `power_charge`/UA_POWERFULL_CHARGE ("Powerful charge",
// misspelled key), `frighten_foot`/UA_FRIGHTENS_ENEMY_FOOT, `can_run_amok`/
// UA_ANIMALS_MAY_RUN_AMOK. Where no key matches on its words the token is left out and shown
// raw in the fold: `sea_faring`, `hide_forest`, `extremely_hardy`, `frighten_mounted`,
// `is_peasant`, `no_custom` and `mercenary_unit` have no wording anywhere in text/, and
// guessing at one would be worse than showing the token. `hide_forest` is the sharpest case:
// shared.txt has "Expert at hiding in woods" and "Can hide anywhere", but nothing in the files
// says which of them this token drives, so it stays unresolved.
const ATTRIBUTE_KEYS = {
  can_sap: "ua_can_sap",
  can_swim: "ua_can_swim",
  can_horde: "ua_can_horde",
  hardy: "ua_hardy",
  very_hardy: "ua_very_hardy",
  cantabrian_circle: "ua_cantabrian_circle",
  warcry: "ua_warcry",
  hide_long_grass: "ua_hide_long_grass",
  power_charge: "ua_powerfull_charge",
  frighten_foot: "ua_frightens_enemy_foot",
  can_run_amok: "ua_animals_may_run_amok",
  general_unit: "smt_unit_is_general",
  command: "smt_unit_is_command",
};
const attrStats = { resolved: new Map(), unresolved: new Map(), missingKey: new Set() };
/** The game's own sentence for an attribute token, or null if the files establish none. */
function attributeText(tok) {
  const k = ATTRIBUTE_KEYS[String(tok).toLowerCase()];
  if (!k) return null;
  const v = (TEXT_LUT[k] || "").replace(/^"(.*)"$/, "$1").trim();
  if (!v) { attrStats.missingKey.add(`${tok} -> {${k.toUpperCase()}}`); return null; }
  return v;
}

const humaniseTok = (t) => {
  const s = String(t).replace(/^(aor|homeland)_/, "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(t);
};
// A hidden resource on a recruit line marks an area of recruitment (the mod's own `aor_`
// prefix) or a faction homeland. Nothing in the mod gives these a display name, so the zone
// is called after its token and the provinces carrying it are LISTED rather than described.
const zoneShort = (t) => /^homeland_/.test(t) ? `${humaniseTok(t)} homeland`
  : /^aor_/.test(t) ? humaniseTok(t)
  : DECLARED_RESOURCES.has(t) ? humaniseTok(t) : `\`${t}\``;
const zoneLabel = (t) => /^aor_/.test(t) ? `${humaniseTok(t)} area of recruitment` : zoneShort(t);

/** One `and`-clause of a requirement, as a name a player recognises. */
function clauseLabel(c) {
  const neg = /^not\s+/i.test(c);
  const body = c.replace(/^not\s+/i, "").trim();
  return (neg ? "not " : "") + clauseBody(body);
}
function clauseBody(b) {
  if (/\bor\b/i.test(b)) {
    return b.split(/\bor\b/i).map((s) => clauseBody(s.trim())).filter(Boolean).join(" or ");
  }
  let m = /^hidden_resource\s+(\S+)$/i.exec(b); if (m) return zoneLabel(m[1].toLowerCase());
  m = /^resource\s+(\S+)$/i.exec(b);
  if (m) return DECLARED_RESOURCES.has(m[1].toLowerCase()) ? humaniseTok(m[1]) : `\`${m[1]}\``;
  m = /^building_present_min_level\s+\S+\s+(\S+)$/i.exec(b); if (m) return bName(m[1]) || `\`${m[1]}\``;
  m = /^building_present\s+(\S+)$/i.exec(b); if (m) return bName(m[1]) || `\`${m[1]}\``;
  m = /^(?:major_event|event_counter)\s+"?([A-Za-z0-9_]+)"?/i.exec(b); if (m) return humaniseTok(m[1]);
  const k = b.toLowerCase();
  return ALIAS_TEXT[k] || bName(k) || KEYWORD_TEXT[k] || `\`${b}\``;
}
// A requirement string may contain a pipe — the mod writes several of them that way ("Any
// Government | Tier 2 Colony not built") — and an unescaped one splits a markdown table row
// into extra columns.
const cell = (s) => String(s).replace(/\|/g, "\\|");

// ── which provinces carry an area of recruitment ─────────────────────────────
// descr_regions is a fixed block per region: name, settlement, owner, rebels, RGB colour,
// then the tag list. The colour line is found structurally (three integers) rather than by
// counting lines, so a block with an extra line cannot silently shift the tags.
const REGIONS_BY_TAG = (() => {
  const txt = rd("world", "maps", "base", "descr_regions.txt") || "";
  const lines = txt.split(/\r?\n/);
  const by = new Map();
  let blocks = 0, tagged = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;   // region names start at column 0
    const region = lines[i].trim();
    blocks++;
    let ci = -1;
    for (let k = i + 1; k < Math.min(i + 8, lines.length); k++) {
      if (/^\s*\d+\s+\d+\s+\d+\s*$/.test(lines[k])) { ci = k; break; }
    }
    if (ci < 0) continue;
    const tags = (lines[ci + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!tags.length) continue;
    tagged++;
    for (const t of tags) {
      const k = t.toLowerCase();
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(region);
    }
  }
  console.log(`region blocks in descr_regions: ${blocks.toLocaleString("en-US")} · with a tag list: ${tagged.toLocaleString("en-US")} · distinct tags: ${by.size}`);
  return by;
})();

// The region-tag reference pages document every zone once, with its units AND every region in
// it, and publish tags/index.json mapping a tag to the page and anchor that covers it. Where a
// zone is in there this page links to it rather than repeating a list that runs to 263
// provinces; where it is not — the reference has not been generated yet, or does not cover the
// tag — the provinces are listed here instead, so the answer is never missing.
const TAG_INDEX = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, "tags", "index.json"), "utf8")); }
  catch { return {}; }
})();
console.log(`region-tag reference: ${Object.keys(TAG_INDEX).length ? `${Object.keys(TAG_INDEX).length} tags indexed, zones will be linked` : "not present, zones will be listed in full here"}`);

// ── where a mercenary is hired ────────────────────────────────────────────────
// descr_mercenaries.txt is the file that decides this, and it has nothing to do with
// buildings: a `pool` covers a list of regions and offers units at a price, optionally
// `restrict`ed to named factions. Only 6 of the 320 mercenary types have an EDB recruit line
// at all, so without this file 314 mercenary pages said "no recruitment route for this unit
// was found in the building files" — which reads as missing data when the truth is that
// mercenaries are hired, not built.
function loadMercPools() {
  const txt = rd("world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt") || "";
  const byType = new Map();   // unit type -> { pools:Set, regions:Set, restrict:Set, openToAll:bool, cost:[], exp:[] }
  let pool = null, regions = [];
  let poolCount = 0, lineCount = 0;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    if (!l) continue;
    let m = /^pool\s+(.+)$/.exec(l);
    if (m) { pool = m[1].trim(); regions = []; poolCount++; continue; }
    m = /^regions\s+(.+)$/.exec(l);
    if (m) { regions = m[1].trim().split(/\s+/).filter(Boolean); continue; }
    // `unit merc cretan archers, exp 3 cost 5683 replenish … max 1 initial 1 restrict achaea`
    m = /^unit\s+([^,]+),(.*)$/.exec(l);
    if (!m || !pool) continue;
    lineCount++;
    const type = m[1].trim().toLowerCase();
    const rest = m[2];
    let e = byType.get(type);
    if (!e) { e = { pools: new Set(), regions: new Set(), restrict: new Set(), openToAll: false, cost: [], exp: [] }; byType.set(type, e); }
    e.pools.add(pool);
    for (const r of regions) e.regions.add(r);
    const rs = /restrict\s+(.+)$/.exec(rest);
    if (rs) for (const f of rs[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) e.restrict.add(f);
    else e.openToAll = true;   // this pool sells to anyone who owns the ground
    const c = /\bcost\s+(\d+)/.exec(rest); if (c) e.cost.push(+c[1]);
    const x = /\bexp\s+(\d+)/.exec(rest); if (x) e.exp.push(+x[1]);
  }
  // Reported so a format change that stops the parse matching cannot pass for "this mod has
  // no mercenary pools".
  console.log(`mercenary pools parsed: ${poolCount} · unit offers: ${lineCount} · distinct types offered: ${byType.size}`);
  return byType;
}
const mercPools = loadMercPools();

// Only link factions that actually have a page — slave, the senate and the dummy factions
// are excluded from the wiki, and linking them was 1,006 broken links once already.
const factionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "factions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();

// The nine factions that are not choosable. They still appear in recruitment gates — 74 unit
// types name one — and dropping them silently made a unit recruitable only by the senate read
// as recruitable by nobody. They share one reference page instead of having pages of their own.
// MUST match the list in gen-ris-faction-pages.js, which writes that page.
const NON_PLAYABLE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
// Written by gen-ris-faction-pages.js, which the documented build order runs after this one.
const NON_PLAYABLE_PAGE = "../factions/non-playable.md";

// Region pages, so a mercenary pool's provinces can be reached from the unit that is sold
// there. Files are named for the region token, spaces and underscores as the mod writes them.
const regionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "regions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
// The region token is not the region's name: `Ager_Gallicus` is displayed "Ager Gallicus",
// and the mod ships the mapping for all 1,311 of them.
const REGION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "imperial_campaign_regions_and_settlement_names.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) out[m[1].trim()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return out;
})();
const regionName = (r) => REGION_NAMES[r] || String(r).replace(/_/g, " ");

const prettyFaction = (f) => String(f).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// Faction display names, from the same source the faction pages use for their own titles, so
// the two never disagree: campaign_descriptions.txt names the faction as the campaign-select
// screen shows it ("Rome", not "Romans Julii"). expanded_bi.txt covers the factions with no
// campaign entry — `slave` is "Free Peoples" there and has no campaign title at all.
const FACTION_NAMES = (() => {
  const out = {};
  const readLut = (file) => {
    const m = {};
    try {
      const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
      for (const x of t.matchAll(/\{([^}]+)\}(.*)/g)) { const k = x[1].trim().toLowerCase(); if (!(k in m)) m[k] = x[2].trim(); }
    } catch { /* fall back to the token */ }
    return m;
  };
  const camp = readLut("campaign_descriptions.txt");
  const exp = readLut("expanded_bi.txt");
  for (const [k, v] of Object.entries(camp)) {
    const m = /^imperial_campaign_([a-z0-9_]+)_title$/.exec(k);
    if (m && v) out[m[1]] = v;
  }
  for (const [k, v] of Object.entries(exp)) if (v && !(k in out)) out[k] = v;
  return out;
})();
const factionName = (f) => FACTION_NAMES[String(f).toLowerCase()] || prettyFaction(f);
// `seleucid_rebels` and `seleucid_rebels2` are both displayed "Seleucid Rebels", and a unit
// gated on both listed the same name twice with no way to tell which was which. Where a
// display name is shared, the token goes with it.
const NP_NAME_SHARED = (() => {
  const n = {};
  for (const f of NON_PLAYABLE) n[factionName(f)] = (n[factionName(f)] || 0) + 1;
  return n;
})();
const factionLink = (f) => {
  const label = factionName(f);
  if (NON_PLAYABLE.has(f)) {
    const tag = NP_NAME_SHARED[label] > 1 ? ` \`${f}\`` : "";
    return `[${label}${tag}](${NON_PLAYABLE_PAGE}) _(not playable)_`;
  }
  return factionPages.has(f) ? `[${label}](../factions/${f}.md)` : label;
};

// ── build ────────────────────────────────────────────────────────────────────
const edu = rd("export_descr_unit.txt");
if (!edu) { console.error("export_descr_unit.txt not found"); process.exit(2); }
const T = loadText();
const blocks = parseBlocks(edu).filter((b) => b.type);
if (!blocks.length) { console.error("no unit blocks parsed"); process.exit(2); }

let named = 0, described = 0, placeholder = 0;
const rows = [];

for (const b of blocks) {
  const dict = (first(b, "dictionary") || "").toLowerCase();
  const name = (dict && T[dict]) || null;
  if (name) named++;
  const longD = dict ? T[dict + "_descr"] : null;
  const shortD = dict ? T[dict + "_descr_short"] : null;
  const clean = (s) => {
    if (!s) return null;
    if (PLACEHOLDER.test(s)) { return null; }
    // The text files encode paragraph breaks as the literal two chars \ and n.
    return s.replace(/\\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n\n").trim() || null;
  };
  const isPh = (s) => !!s && PLACEHOLDER.test(s);
  if (isPh(longD) || isPh(shortD)) placeholder++;
  const L = clean(longD), S = clean(shortD);
  if (L || S) described++;

  rows.push({
    type: b.type, dict, name: name || b.type, rawName: name, hasName: !!name,
    isMercType: MERC_TYPE.test(b.type),
    category: first(b, "category"), cls: first(b, "class"),
    ownership: first(b, "ownership"),
    attributes: (first(b, "attributes") || "").split(",").map((s) => s.trim()).filter(Boolean),
    st: statsOf(b), long: L, short: S,
    slug: slug(b.type),
  });
}

// ── MERGE AOR / HORDE VARIANTS ───────────────────────────────────────────────
// Many "units" are the same unit reached a different way. `sardinian archers`,
// `aor sardinian archers` and `horde sardinian archers` are one troop type with three
// recruitment routes, and all three share the dictionary key `sardinian_archers`.
// Keying pages on `type` produced 1,697 pages for 1,172 actual units, and saved ~500
// cards that were byte-identical images under different names.
//
// So the DICTIONARY is the identity and `type` is a variant of it. On the reference data:
// 1,697 types -> 1,172 dictionaries, 454 of which hold more than one type, covering 979
// types. 450 types begin "aor ".
//
// Stats are taken from the first variant and the others are checked against it; where they
// disagree the page says so rather than quietly presenting one variant's numbers as the
// unit's.
//
// MERCENARY STATUS IS DECIDED PER DICTIONARY, and a dictionary that mixed mercenary and
// non-mercenary types would be genuinely ambiguous: the page would be claiming a unit is
// hired when it can also be built, or the reverse. Measured on the reference data there are
// NONE — 1,172 dictionaries split 319 entirely mercenary / 853 entirely not, zero mixed — so
// the case is handled explicitly rather than assumed away: a mixed dictionary is NOT
// prefixed (the unit is obtainable without hiring it, so calling it a mercenary would be
// wrong), it says on its own page that it is reachable both ways, and the count is printed.
// If that count ever moves off zero, the run says so instead of quietly picking a side.
const merged = [];
let mercUnits = 0, mercAlreadyNamed = 0, mercPrefixed = 0, mixedDicts = [];
{
  const byDict = new Map();
  for (const r of rows) {
    const key = r.dict || `__notype_${r.slug}`;
    if (!byDict.has(key)) byDict.set(key, []);
    byDict.get(key).push(r);
  }
  for (const [key, group] of byDict) {
    const head = group[0];
    const cmp = (a, b) => a.st.attack === b.st.attack && a.st.defence === b.st.defence
      && a.st.armour === b.st.armour && a.st.morale === b.st.morale && a.st.cost === b.st.cost;
    const nMerc = group.filter((g) => g.isMercType).length;
    const mercKind = nMerc === 0 ? "none" : nMerc === group.length ? "all" : "mixed";
    if (mercKind === "mixed") mixedDicts.push(key);
    let name = head.name;
    if (mercKind === "all") {
      mercUnits++;
      // Only prefix a real display name. Where the mod ships no name the fallback is the
      // internal type, which already begins "merc " — prefixing that would read as nonsense.
      if (head.hasName) {
        if (ALREADY_MERC.test(head.rawName)) mercAlreadyNamed++;
        else { name = `Mercenary ${head.rawName}`; mercPrefixed++; }
      }
    }
    merged.push({
      ...head,
      name,
      slug: slug(key),
      merc: mercKind,
      variants: group.map((g) => g.type),
      statsDiffer: group.some((g) => !cmp(g, head)),
    });
  }
}

// Counted rather than assumed: how much of the recruitment answer the files actually give.
let unitsWithBuilding = 0, unitsWithNamedBuilding = 0, unitsAiRouteOnly = 0;
const zonesSeen = new Set(), zonesWithNoRegion = new Set();
let zonesLinked = 0, zonesListed = 0;

const list = ONLY.length
  ? merged.filter((r) => ONLY.includes(r.type.toLowerCase()) || ONLY.includes(r.dict))
  : merged;
fs.mkdirSync(path.join(OUT, "units"), { recursive: true });

// ── where a stat sits in the roster ──────────────────────────────────────────
// A bare "Defence skill 33" means nothing without the roster to compare against, and RIS
// stats run far above vanilla, so borrowed intuition misleads. Each stat therefore also
// shows its rank among all units that have that stat. Drawn with block characters rather
// than a styled <span>: GitHub strips style attributes when it renders markdown, so a CSS
// bar would work in the local viewer and silently vanish on the site.
const SORTED = {};
for (const k of ["attack", "charge", "armour", "defence", "shield", "morale", "cost", "upkeep", "men"]) {
  SORTED[k] = merged.map((u) => u.st[k]).filter((v) => v != null).sort((a, b) => a - b);
}
function percentile(key, v) {
  const arr = SORTED[key];
  if (!arr || !arr.length || v == null) return null;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return Math.round((lo / arr.length) * 100);
}
const BAR_CELLS = 10;
function bar(key, v) {
  const p = percentile(key, v);
  if (p == null) return "";
  const filled = Math.max(1, Math.round((p / 100) * BAR_CELLS));
  return `\`${"█".repeat(filled)}${"·".repeat(BAR_CELLS - filled)}\` ${p}%`;
}

// The mod's descriptions embed their own section headers as bare ALL-CAPS lines
// ("HISTORICAL BACKGROUND" on 428 units, "GENERAL DESCRIPTION" on 2). Left as-is they read
// as a shouted line in the middle of a wall of prose; promoted to real headings they give
// the page a structure and a table of contents entry.
function sectionise(text) {
  if (!text) return text;
  return text.replace(/^([A-Z][A-Z0-9 '\-]{5,})$/gm, (_, h) => {
    const t = h.trim().toLowerCase();
    return `### ${t.charAt(0).toUpperCase() + t.slice(1)}`;
  });
}

// ── the rest of the unit file, primary set against secondary ─────────────────
// The table above carries the headline numbers, which for many units are not the ones that
// decide a fight: 1,388 units have a real secondary attack and on 241 of them it is the
// STRONGER of the two. A lithobolos reads as attack 6 — that is the crew's sidearm; the
// machine itself throws at 30. An elephant reads as attack 6 and defence skill 1 — those are
// the rider's; the animal attacks at 25 and defends at 24. Showing one and hiding the other
// is not a shorter description, it is a wrong one, so both are printed side by side.
const dash = (v) => (v == null || v === "" || (typeof v === "number" && !Number.isFinite(v)) ? "—" : v);
const dashList = (a) => (a && a.length ? a.join(" · ") : "—");


function detailTables(s) {
  const hasSec = s.secAttack != null && s.secAttack > 0;
  const out = [];

  const kind = (cls, tech) => (cls ? (tech && tech !== cls ? `${cls} · ${tech}` : cls) : "—");

  out.push("### Weapons", "");
  if (hasSec && s.secAttack > s.attack) {
    out.push(`> Its **secondary** attack is the stronger one — ${s.secAttack} against ${s.attack}.`, "");
  }
  out.push("| | Primary | Secondary |", "|---|---|---|");
  out.push(`| Attack | ${dash(s.attack)} | ${hasSec ? dash(s.secAttack) : "—"} |`);
  out.push(`| Charge bonus | ${dash(s.charge)} | ${hasSec ? dash(s.secCharge) : "—"} |`);
  out.push(`| Type | ${kind(s.priClass, s.priTech)} | ${hasSec ? kind(s.secClass, s.secTech) : "—"} |`);
  out.push(`| Damage | ${dash(s.priDamage)} | ${hasSec ? dash(s.secDamage) : "—"} |`);
  if (s.priProjectile || s.secProjectile) out.push(`| Projectile | ${dash(s.priProjectile)} | ${hasSec ? dash(s.secProjectile) : "—"} |`);
  if (s.priRange || s.secRange) out.push(`| Range | ${dash(s.priRange)} | ${hasSec ? dash(s.secRange) : "—"} |`);
  if (s.priAmmo || s.secAmmo) out.push(`| Ammunition | ${dash(s.priAmmo)} | ${hasSec ? dash(s.secAmmo) : "—"} |`);
  out.push(`| Attributes | ${dashList(s.priAttr)} | ${hasSec ? dashList(s.secAttr) : "—"} |`);
  out.push(`| Min delay between blows | ${dash(s.priDelay)} | ${hasSec ? dash(s.secDelay) : "—"} |`);
  out.push("");

  // stat_sec_armour is present on every unit, but on one with nothing to wear it it reads
  // 0, 0 — that is the absence of a second body, not a second body with no armour.
  const hasSecArm = (s.secArmour || 0) > 0 || (s.secDefence || 0) > 0;
  out.push("### Defence", "");
  out.push("| | Primary | Secondary |", "|---|---|---|");
  out.push(`| Armour | ${dash(s.armour)} | ${hasSecArm ? dash(s.secArmour) : "—"} |`);
  out.push(`| Defence skill | ${dash(s.defence)} | ${hasSecArm ? dash(s.secDefence) : "—"} |`);
  out.push(`| Shield | ${dash(s.shield)} | — |`);
  out.push(`| Material | ${dash(s.armourMat)} | ${hasSecArm ? dash(s.secArmourMat) : "—"} |`);
  out.push("");

  out.push("### Condition, terrain and upkeep", "");
  out.push("| | |", "|---|---|");
  out.push(`| Hit points | ${dash(s.hp)}${s.hpMount ? ` · mount ${s.hpMount}` : ""} |`);
  if (s.mount) out.push(`| Mount | ${s.mount} |`);
  if (s.mountEffect) out.push(`| Bonus against mounts | ${s.mountEffect} |`);
  out.push(`| Ground: scrub / sand / forest / snow | ${dash(s.gScrub)} / ${dash(s.gSand)} / ${dash(s.gForest)} / ${dash(s.gSnow)} |`);
  out.push(`| Heat penalty | ${dash(s.heat)} |`);
  out.push(`| Charge distance | ${dash(s.chargeDist)} |`);
  out.push(`| Fire delay | ${dash(s.fireDelay)} |`);
  out.push(`| Food consumed (low / high) | ${dash(s.foodLow)} / ${dash(s.foodHigh)} |`);
  if (s.mass != null) out.push(`| Mass per man | ${s.mass} |`);
  out.push(`| Formation: close / loose | ${dash(s.formClose)} / ${dash(s.formLoose)}${s.ranks ? ` · ${s.ranks} ranks` : ""}${s.formStyle ? ` · ${s.formStyle}` : ""} |`);
  // stat_cost fields 4 and 5 are NOT printed. They are commonly documented as weapon and
  // armour upgrade costs, but field 4 is 0 or 1 on 1,702 of the 1,731 units, which is a flag
  // and not a price. Rather than publish a label the data contradicts, they are left out —
  // the same rule the rest of this wiki follows for anything it cannot establish.
  out.push("");

  return out.join("\n");
}

for (const u of list) {
  const s = u.st;
  const stat = (label, v, suffix, key) => v == null ? "" :
    `| ${label} | ${v.toLocaleString("en-US")}${suffix || ""} | ${key ? bar(key, v) : ""} |\n`;

  // What the unit does in a fight, said the way the game says it, with the flag list itself
  // kept but folded. A reader wants "Can sap · Very good stamina", not four engine tokens
  // three of which nearly every unit carries.
  const attrNamed = [], attrRaw = [];
  for (const a of u.attributes) {
    const t = attributeText(a);
    if (t) { attrNamed.push(t); attrStats.resolved.set(a, (attrStats.resolved.get(a) || 0) + 1); }
    else attrStats.unresolved.set(a, (attrStats.unresolved.get(a) || 0) + 1);
    attrRaw.push(a);
  }
  // The <details> opening tag and its <summary> MUST be on separate lines with a blank line
  // after the summary — the viewer only treats it as a block that way, and a one-line
  // `<details><summary>…</summary>` prints as literal text on the page.
  const attrBlock = !attrRaw.length ? "" : "\n"
    + (attrNamed.length ? `**In battle:** ${[...new Set(attrNamed)].join(" · ")}\n\n` : "")
    + [
      "<details>",
      `<summary>The full attribute list, as the unit file writes it (${attrRaw.length})</summary>`,
      "",
      attrRaw.map((a) => `\`${a}\``).join(", "),
      "",
      "The names above are the game's own wording for these flags. A flag the mod's text never",
      "puts into words is left as the file writes it rather than given a meaning it never states.",
      "",
      "</details>",
      "",
    ].join("\n");

  // Availability, unioned across every variant of this unit: an AOR variant and its parent
  // are one page here, so the page must answer for all of them.
  const avail = { core: new Set(), aor: new Set(), all: false, allCore: false };
  for (const v of u.variants) {
    const e = availability.get(String(v).toLowerCase());
    if (!e) continue;
    for (const f of e.core) if (!e.neg.has(f)) avail.core.add(f);
    for (const f of e.aor) if (!e.neg.has(f)) avail.aor.add(f);
    if (e.all) avail.all = true;
    if (e.allCore) avail.allCore = true;
  }
  // A faction is listed if the wiki can take the reader somewhere for it: its own page, or
  // the shared non-playable page. Names sort by what the game calls them, not by the token.
  const known = (f) => factionPages.has(f) || NON_PLAYABLE.has(f);
  const coreList = [...avail.core].filter(known).sort((a, b) => factionName(a).localeCompare(factionName(b)));
  const aorCount = [...avail.aor].filter(known).length;

  // What it takes to raise it: the building level hosting each of the player's recruit lines
  // and the conditions on that line. Unioned across the unit's variants and deduplicated —
  // several buildings offer the same unit on identical terms.
  const routes = new Map();
  const zonesNeeded = new Set();
  let hasAnyLine = false;
  for (const v of u.variants) {
    const k = String(v).toLowerCase();
    if (anyRecruitLine.has(k)) hasAnyLine = true;
    for (const r of playerRoutes.get(k) || []) {
      const reqs = clausesOf(r.expr);
      for (const z of zonesOf(r.expr)) zonesNeeded.add(z);
      const key = `${r.level}|${reqs.join("&")}`;
      if (!routes.has(key)) routes.set(key, { level: r.level, reqs });
    }
  }
  if (routes.size) { unitsWithBuilding++; if ([...routes.values()].every((r) => bName(r.level))) unitsWithNamedBuilding++; }
  else if (hasAnyLine) unitsAiRouteOnly++;
  const reqRows = [...routes.values()].map((r) =>
    `| ${cell(bName(r.level) || `\`${r.level}\``)} | ${r.reqs.length ? r.reqs.map((c) => cell(clauseLabel(c))).join(" · ") : "—"} |`);
  const reqTable = routes.size ? `| Building | Also requires |
|---|---|
${reqRows.join("\n")}` : "";
  // Always folded, however short. The prose above it already answers the question a player
  // asks — who can raise this, and where — and the table answers a different one: the exact
  // government-and-colony combination each recruit line tests, in the mod's own alias wording
  // ("Any Government | Tier 2 Colony not built"). That is worth keeping and worth having to
  // ask for.
  const reqBlock = !routes.size
    ? (hasAnyLine ? `_The mod states no player recruitment route for this unit._` : "")
    : `<details>\n<summary>Exactly what a settlement must have, route by route (${reqRows.length})</summary>\n\n${reqTable}\n\n</details>`;

  // The provinces behind a regional gate, named rather than described. A zone can cover 263 of
  // the 1,311 regions, so where the region-tag reference covers it the zone is linked there
  // with its province count; otherwise the provinces are listed here, folded with the count
  // showing.
  const zoneRows = [], zoneLists = [];
  for (const t of [...zonesNeeded].sort()) {
    const regs = (REGIONS_BY_TAG.get(t) || []).filter((r) => regionPages.has(r))
      .sort((a, b) => regionName(a).localeCompare(regionName(b)));
    zonesSeen.add(t);
    if (!regs.length) zonesWithNoRegion.add(t);
    const ref = TAG_INDEX[t];
    if (ref && ref.page && ref.anchor) {
      zonesLinked++;
      zoneRows.push(`| [${zoneShort(t)}](../tags/${ref.page}#${ref.anchor}) | ${regs.length} |`);
      continue;
    }
    zonesListed++;
    if (!regs.length) { zoneLists.push(`_No province on the map carries **${zoneShort(t)}**._`); continue; }
    zoneLists.push(`<details>\n<summary><strong>${zoneShort(t)}</strong> — ${regs.length} province${regs.length === 1 ? "" : "s"}</summary>\n\n`
      + `${regs.map((r) => `[${regionName(r)}](../regions/${encodeURIComponent(r)}.md)`).join(" · ")}\n\n</details>`);
  }
  const zoneBlocks = [
    ...(zoneRows.length ? [`| Zone | Provinces |\n|---|---:|\n${zoneRows.join("\n")}`] : []),
    ...zoneLists,
  ];

  // Mercenary pools, unioned across every variant of this unit, same as availability above.
  const hire = { pools: new Set(), regions: new Set(), restrict: new Set(), openToAll: false, cost: [], exp: [] };
  for (const v of u.variants) {
    const e = mercPools.get(String(v).toLowerCase());
    if (!e) continue;
    for (const p of e.pools) hire.pools.add(p);
    for (const r of e.regions) hire.regions.add(r);
    for (const f of e.restrict) hire.restrict.add(f);
    if (e.openToAll) hire.openToAll = true;
    hire.cost.push(...e.cost); hire.exp.push(...e.exp);
  }
  const rng = (a) => (a.length ? (Math.min(...a) === Math.max(...a) ? Math.min(...a).toLocaleString("en-US") : `${Math.min(...a).toLocaleString("en-US")}–${Math.max(...a).toLocaleString("en-US")}`) : null);
  const hireRegions = [...hire.regions].filter((r) => regionPages.has(r)).sort();
  // A pool can cover 200 provinces; the first 40 make the point and the rest are counted.
  const REGION_CAP = 40;
  const hireSection = u.merc === "none" ? "" : `## Where to hire it

${hire.pools.size ? `Mercenaries are **hired from a regional pool, not recruited from a building**. This unit is
offered by **${hire.pools.size} pool${hire.pools.size === 1 ? "" : "s"}** covering **${hire.regions.size} region${hire.regions.size === 1 ? "" : "s"}**${rng(hire.cost) ? `, at **${rng(hire.cost)} dn** to hire` : ""}${rng(hire.exp) ? ` and **${rng(hire.exp)} experience**` : ""}.

${hire.openToAll
  ? `At least one of those pools sells to **any faction** that has an army in range — no faction restriction.`
  : hire.restrict.size
    ? `Every pool offering it is restricted. Only these factions can hire it:\n\n${[...hire.restrict].sort((a, b) => factionName(a).localeCompare(factionName(b))).map(factionLink).join(" · ")}`
    : `_The pool lines carry no faction restriction the parser recognised._`}
${hire.restrict.size && hire.openToAll ? `\nSome pools additionally restrict it to ${[...hire.restrict].sort((a, b) => factionName(a).localeCompare(factionName(b))).map(factionLink).join(" · ")}.\n` : ""}
<details>
<summary>The ${hire.regions.size} region${hire.regions.size === 1 ? "" : "s"} where this unit appears in a mercenary pool</summary>

${hireRegions.slice(0, REGION_CAP).map((r) => `[${regionName(r)}](../regions/${encodeURIComponent(r)}.md)`).join(" · ")}${hireRegions.length > REGION_CAP ? `\n\n_…and ${hireRegions.length - REGION_CAP} more._` : ""}${hire.regions.size !== hireRegions.length ? `\n\n_${hire.regions.size - hireRegions.length} more region${hire.regions.size - hireRegions.length === 1 ? "" : "s"} the pool names ${hire.regions.size - hireRegions.length === 1 ? "is" : "are"} not on this map, so ${hire.regions.size - hireRegions.length === 1 ? "it has" : "they have"} no page here._` : ""}

</details>

> The **Recruitment cost** in the stats table above is the EDU figure the engine uses for
> building-recruited units. What you actually pay for this unit is the pool price above.`
  : `This unit is defined as a mercenary but **no mercenary pool anywhere on the map offers
it**, so there is nowhere on the campaign map to hire it as the mod ships today.${coreList.length || avail.all ? " It is reachable only through the building route below." : ""}`}

`;
  // Every unit has two pieces of art: the roster card shown in the recruitment panel and
  // the info card from the unit's detail panel. Both are shipped, and the inline one links
  // to the other so a click swaps between them. A plain link rather than a script, because
  // GitHub Pages serves these as static markdown and JS in a .md file would not run.
  function cardMarkup(u) {
    const has = (n) => fs.existsSync(path.join(OUT, "cards", n));
    const card = `${u.slug}.png`, info = `${u.slug}_info.png`;
    if (!has(card)) return has(info) ? `<img src="../cards/${info}" alt="${u.name}" width="164" align="right">\n\n` : "";
    const img = `<img src="../cards/${card}" alt="${u.name} unit card" width="164" align="right">`;
    if (!has(info)) return `${img}\n\n`;
    return `<a href="../cards/${info}" title="Click for the info card">${img}</a>\n\n`;
  }

  const body = `# ${u.name}

[← all units](../units.md) · [wiki index](../README.md)

${cardMarkup(u)}${u.hasName ? "" : "> _This unit has no display name in the text files, so its internal name is shown._\n\n"}${u.merc === "all" ? `> **Mercenary.** Hired from a regional pool, not recruited from a building.${u.hasName && ALREADY_MERC.test(u.rawName) ? " The mod already names it as one." : ` The mod calls it "${u.rawName || u.type}"; this wiki prefixes "Mercenary" so the roster reads unambiguously.`}\n\n` : ""}${u.merc === "mixed" ? `> **Reachable both ways.** Some entries for this unit are mercenary (\`merc …\`) and some are\n> not, so it can be hired from a pool *or* raised from a building. It is not prefixed\n> "Mercenary", because calling it a mercenary outright would be wrong.\n\n` : ""}**Class:** ${u.cls || "unknown"} · **Category:** ${u.category || "unknown"}${s.men != null ? ` · **Men per unit:** ${s.men}` : ""}

## Stats

| | | Rank in roster |
|---|---:|---|
${stat("Men per unit", s.men, "", "men")}${stat("Attack", s.attack, "", "attack")}${stat("Charge bonus", s.charge, "", "charge")}${stat("Armour", s.armour, "", "armour")}${stat("Defence skill", s.defence, "", "defence")}${stat("Shield", s.shield, "", "shield")}${stat("Morale", s.morale, "", "morale")}${s.discipline ? `| Discipline | ${s.discipline} | |\n` : ""}${s.training ? `| Training | ${s.training} | |\n` : ""}${stat("Recruitment cost", s.cost, " dn", "cost")}${stat("Upkeep per turn", s.upkeep, " dn", "upkeep")}${stat("Turns to recruit", s.turns)}
${detailTables(s)}
${attrBlock}${u.statsDiffer ? `\n> **The mod gives this unit more than one set of numbers.** The figures above are one of\n> them, so check in-game if the exact values matter.\n` : ""}
${hireSection}${
  // A mercenary with no building route at all has nothing to say here, and printing "no
  // recruitment route was found" under a heading about recruitment reads as missing data
  // rather than as the truth — that it is hired instead. 314 of the 320 mercenary types are
  // in exactly that position, so the section is omitted for them.
  u.merc === "all" && !avail.allCore && !avail.all && !coreList.length && !aorCount ? "" : `## Who can recruit it

${avail.allCore
  ? `Every faction, from its own buildings, with no regional gate.`
  : coreList.length
    ? `${coreList.length === 1
        ? `A core roster unit for one faction, which can raise it anywhere it holds the right building:`
        : `A core roster unit for ${coreList.length} factions, each able to raise it anywhere they hold the right building:`}\n\n${coreList.slice(0, 40).map(factionLink).join(" · ")}${coreList.length > 40 ? `\n\n_…and ${coreList.length - 40} more._` : ""}`
    : avail.all || aorCount
      ? `No faction has this on its core roster: it can be raised only in the provinces below.`
      : `_No recruitment route for this unit was found in the building files._`}
${avail.all && !avail.allCore ? `\nAny faction holding one of the provinces below can field it.\n` : aorCount ? `\nA further ${aorCount} faction${aorCount === 1 ? "" : "s"} can raise it in the provinces below.\n` : ""}${reqBlock ? `\n${reqBlock}\n` : ""}${zoneBlocks.length ? `\n### Areas of recruitment\n\n${zoneBlocks.join("\n\n")}\n` : ""}
`}${u.long || u.short
  ? `## Description\n\n${sectionise(u.long || u.short)}\n\n`
  : "> This unit has no written description in the mod yet.\n\n"}`;
  fs.writeFileSync(path.join(OUT, "units", `${u.slug}.md`), body, "utf8");
}

// ── index ────────────────────────────────────────────────────────────────────
const byClass = {};
for (const u of merged) (byClass[u.cls || "unknown"] = byClass[u.cls || "unknown"] || []).push(u);

const idx = `# Units

[← wiki index](README.md)

${merged.length.toLocaleString("en-US")} distinct units, against vanilla's 261. (The mod defines ${rows.length.toLocaleString("en-US")} entries; ${(rows.length - merged.length).toLocaleString("en-US")} of those are area-of-recruitment or horde variants of a unit already listed, merged here onto one page each.) ${named.toLocaleString("en-US")} have a
display name in the text files; ${described.toLocaleString("en-US")} have a written description.

${placeholder ? `> **${placeholder.toLocaleString("en-US")} units still carry RIS's placeholder text** ("this unit needs a
> description"). Those are shown as having no description rather than printing the
> placeholder, since text that looks like content but is not is worse than an honest gap.\n` : ""}
## Mercenaries

**${mercUnits.toLocaleString("en-US")} of these units are mercenaries** — hired from a regional pool on
the map, not recruited from a building. Every one of them is named
"Mercenary …" here so a roster cannot be misread, which groups them together in the table
below. ${mercAlreadyNamed.toLocaleString("en-US")} were already named that way by the mod; the
prefix was added to the other ${mercPrefixed.toLocaleString("en-US")}.

<details>
<summary>How this wiki tells a mercenary from a regional unit</summary>

A mercenary is identified by its internal type beginning \`merc \`, not by the
\`mercenary_unit\` attribute — that attribute is also on all 450 area-of-recruitment entries,
so it labels 770 entries where only 320 are for hire.

</details>
${mixedDicts.length ? `\n> **${mixedDicts.length} unit${mixedDicts.length === 1 ? " is" : "s are"} defined both ways** (some entries mercenary, some not) and\n> ${mixedDicts.length === 1 ? "is" : "are"} deliberately left unprefixed: ${mixedDicts.slice(0, 20).map((d) => `\`${d}\``).join(", ")}${mixedDicts.length > 20 ? `, and ${mixedDicts.length - 20} more` : ""}.\n` : ""}
## By class

| Class | Units | of which mercenary |
|---|---:|---:|
${Object.entries(byClass).sort((a, b) => b[1].length - a[1].length).map(([c, v]) => `| ${c} | ${v.length.toLocaleString("en-US")} | ${v.filter((u) => u.merc === "all").length.toLocaleString("en-US")} |`).join("\n")}

## Full roster

| Unit | Class | Men | Attack | Defence | Morale | Cost | Upkeep | Variants |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${merged.slice().sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
  const s = u.st;
  const n = (v) => (v == null ? "—" : v.toLocaleString("en-US"));
  return `| [${u.name}](units/${u.slug}.md) | ${u.cls || "—"} | ${n(s.men)} | ${n(s.attack)} | ${n(s.defence)} | ${n(s.morale)} | ${n(s.cost)} | ${n(s.upkeep)} | ${u.variants.length > 1 ? u.variants.length : ""} |`;
}).join("\n")}

## A note on the numbers

RIS rescales unit stats well above vanilla, and unevenly. Measured across both games:
attack median 8 -> 11, armour 3 -> 7, but **defence skill 3 -> 19** (p95 7 -> 30). So a
defence figure near 20 is ordinary here, not exceptional - do not read these against
vanilla intuition.

## Not here yet

**Unit cards** are on the pages where the mod ships one. 42 units have no card file
(mostly legion variants); those pages simply omit it.

**Stat comparisons against vanilla.** Worth doing, and the vanilla EDU is available to
diff against.
`;
fs.writeFileSync(path.join(OUT, "units.md"), idx, "utf8");

console.log(`${list.length.toLocaleString("en-US")} unit pages written (from ${rows.length.toLocaleString("en-US")} EDU entries)`);
console.log(`  merged away as variants: ${(rows.length - merged.length).toLocaleString("en-US")}`);
console.log(`  units whose variants disagree on stats: ${merged.filter((m) => m.statsDiffer).length.toLocaleString("en-US")}`);
console.log(`  mercenary units:          ${mercUnits.toLocaleString("en-US")} (from ${rows.filter((r) => r.isMercType).length} \`merc \` EDU entries; ${mercAlreadyNamed} already named "Mercenary…", ${mercPrefixed} prefixed here)`);
console.log(`  mixed merc/non-merc dictionaries: ${mixedDicts.length}${mixedDicts.length ? ` — LEFT UNPREFIXED: ${mixedDicts.slice(0, 20).join(", ")}${mixedDicts.length > 20 ? `, +${mixedDicts.length - 20} more` : ""}` : " (none — the prefix is unambiguous)"}`);
console.log(`  mercenary units with no pool offering them: ${merged.filter((u) => u.merc === "all" && !u.variants.some((v) => mercPools.has(String(v).toLowerCase()))).length}`);
console.log(`  with a player recruitment route: ${unitsWithBuilding.toLocaleString("en-US")} of ${list.length.toLocaleString("en-US")} (every route's building level named: ${unitsWithNamedBuilding.toLocaleString("en-US")})`);
console.log(`  with recruit lines but none for the player: ${unitsAiRouteOnly.toLocaleString("en-US")}`);
console.log(`  with no recruit line at all: ${(list.length - unitsWithBuilding - unitsAiRouteOnly).toLocaleString("en-US")}`);
console.log(`  areas of recruitment named: ${zonesSeen.size}${zonesWithNoRegion.size ? ` · WITH NO PROVINCE CARRYING THE TAG: ${zonesWithNoRegion.size} (${[...zonesWithNoRegion].join(", ")})` : " · every one has at least one province"}`);
console.log(`  zone references: ${zonesLinked.toLocaleString("en-US")} linked to the region-tag reference · ${zonesListed.toLocaleString("en-US")} listed in full here`);
console.log(`  with a display name:      ${named.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}`);
console.log(`  with a real description:  ${described.toLocaleString("en-US")}`);
console.log(`  still on placeholder text:${placeholder.toLocaleString("en-US")}`);
console.log(`  distinct classes:         ${Object.keys(byClass).length}`);

// Attributes: what the mod's own text could name, and what it could not. Reported as counts so
// a token that quietly stops resolving — a renamed text key, a new attribute in a future
// release — shows up here rather than silently vanishing from every unit page.
{
  const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(", ") || "none";
  console.log(`  attributes named from the mod's own text: ${attrStats.resolved.size} distinct — ${fmt(attrStats.resolved)}`);
  console.log(`  attributes with no wording in text/, shown raw: ${attrStats.unresolved.size} distinct — ${fmt(attrStats.unresolved)}`);
  if (attrStats.missingKey.size) console.log(`  MAPPED TO A TEXT KEY THAT NO LONGER EXISTS: ${[...attrStats.missingKey].join(", ")}`);
}
