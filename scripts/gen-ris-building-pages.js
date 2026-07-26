#!/usr/bin/env node
/**
 * One wiki page per RIS building chain: what each level does, what it costs, its upgrade
 * path, and what it locks you out of.
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

// ── display names and icons, reused from the other generators ────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* tokens then */ }
  return map;
}
const NAMES = loadText("export_buildings.txt");
const dName = (tok) => NAMES[String(tok).toLowerCase()] || null;

let ICONS = {};
try { ICONS = JSON.parse(fs.readFileSync(path.join(OUT, "icons", "index.json"), "utf8")); } catch { /* none yet */ }
// The icon map is keyed "<culture>/<level>"; for a generic building page any culture's art
// will do, so take the first that has one, preferring roman as the most complete set.
const iconFor = (level) => {
  const l = String(level).toLowerCase();
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
  weapon_simple: (n) => `improves simple weapons (${n})`,
  weapon_missile: (n) => `improves missile weapons (${n})`,
  armour: (n) => `improves armour (${n})`,
  construction_cost_bonus_all: (n) => `${n > 0 ? "-" : "+"}${Math.abs(n)}% construction cost`,
};
// An effect line is `<name> bonus <n>` optionally followed by `requires <condition>`.
// The condition is not decoration:
//   - `requires not is_player` means the bonus applies to the AI ONLY. Printing it as a
//     player benefit is simply wrong, and the military_industrial_complex has three such
//     +10 bonuses that read as enormous player perks if the condition is dropped.
//   - `requires size1 … size10` means the value scales with settlement size, which is why
//     one level can list the same effect twenty times with different numbers.
// So conditions are parsed, effects grouped, and ranges summarised.
function parseEffect(line) {
  const m = /^([a-z_]+)\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?$/.exec(line.trim());
  if (!m) return { raw: line.replace(/\s+/g, " ").trim() };
  const cond = (m[3] || "").toLowerCase();
  const ct = cond.split(/[^a-z0-9_]+/).filter(Boolean);
  return {
    name: m[1], value: +m[2], cond,
    aiOnly: /not\s+is_player/.test(cond),
    playerOnly: /is_player/.test(cond) && !/not\s+is_player/.test(cond),
    bySize: /size\d+/.test(cond),
  };
}

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const label = (name, n) => (EFFECTS[name] ? EFFECTS[name](n) : `${name.replace(/_/g, " ")} ${signed(n)}`);

/** Group a level's effect lines into readable, honest lines. */
function describeEffects(rawLines) {
  const parsed = rawLines.map(parseEffect);
  const other = parsed.filter((p) => p.raw).map((p) => p.raw);
  const real = parsed.filter((p) => !p.raw);

  const groups = new Map();   // `${name}|${scope}` -> values[]
  for (const p of real) {
    const scope = p.aiOnly ? "ai" : (p.playerOnly ? "player" : "all");
    const k = `${p.name}|${scope}|${p.bySize ? "size" : "flat"}`;
    if (!groups.has(k)) groups.set(k, { ...p, values: [] });
    groups.get(k).values.push(p.value);
  }

  const out = [];
  for (const g of groups.values()) {
    const uniq = [...new Set(g.values)].sort((a, b) => a - b);
    const scopeNote = g.aiOnly ? " _(AI only — does not apply to you)_"
      : (g.playerOnly ? " _(player only)_" : "");
    if (uniq.length === 1) {
      out.push(label(g.name, uniq[0]) + (g.bySize ? " at every settlement size" : "") + scopeNote);
    } else {
      const lo = uniq[0], hi = uniq[uniq.length - 1];
      out.push(`${g.name.replace(/_/g, " ")} ${signed(lo)} to ${signed(hi)}` +
        (g.bySize ? ", scaling with settlement size" : "") + scopeNote);
    }
  }
  // AI-only effects last: they are the least relevant to a reader.
  out.sort((a, b) => (a.includes("AI only") ? 1 : 0) - (b.includes("AI only") ? 1 : 0));
  return out.concat(other);
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
    out.push(`${m[1]} (at ${m[2]} or above)`);
  }
  for (const m of String(requires).matchAll(/not\s+building_present\s+([a-z0-9_+]+)/gi)) {
    out.push(m[1]);
  }
  return [...new Set(out.filter((x) => !/ queued/.test(x)))];
}

// ── build ────────────────────────────────────────────────────────────────────
const edb = rd("export_descr_buildings.txt");
if (!edb) { console.error("export_descr_buildings.txt not found"); process.exit(2); }
const ALIASES = parseAliases(edb);
const chains = parseChains(edb).filter((c) => c.order.length);
if (!chains.length) { console.error("no building chains parsed"); process.exit(2); }

const list = ONLY.length ? chains.filter((c) => ONLY.includes(c.chain)) : chains;
fs.mkdirSync(path.join(OUT, "buildings"), { recursive: true });

let withIcon = 0, withEffects = 0, totalLevels = 0, totalExclusions = 0;
const index = [];

for (const c of list) {
  const levels = c.order.map((l) => c.levels[l]).filter(Boolean);
  totalLevels += levels.length;

  const path_ = levels.map((l) => dName(l.level) || l.level).join(" → ");
  const rows = levels.map((l) => {
    const ic = iconFor(l.level);
    if (ic) withIcon++;
    if (l.effects.length) withEffects++;
    const ex = exclusionsOf(l.requires, ALIASES);
    totalExclusions += ex.length;
    return { l, ic, ex };
  });

  const body = `# ${dName(c.order[0]) ? `${dName(c.order[0])} chain` : c.chain.replace(/_/g, " ")}

[← all buildings](../buildings.md) · [wiki index](../README.md)

**Internal name:** \`${c.chain}\`${c.icon ? ` · **Icon group:** \`${c.icon}\`` : ""}

## Upgrade path

${levels.length > 1 ? `${path_}\n\nEach level replaces the one before it — you upgrade in place rather than building alongside.` : "_This building has a single level._"}

## Levels

${rows.map(({ l, ic, ex }) => `### ${ic ? `<img src="../${ic}" alt="" width="32" align="left"> ` : ""}${dName(l.level) || l.level}

${l.effects.length ? `**What it does:**\n\n${describeEffects(l.effects).map((e) => `- ${e}`).join("\n")}\n` : "_No effects are declared for this level._\n"}
| | |
|---|---|
${l.cost != null ? `| Cost | ${l.cost.toLocaleString("en-US")} denarii |\n` : ""}${l.turns != null ? `| Build time | ${l.turns} turn${l.turns === 1 ? "" : "s"} |\n` : ""}${l.minSize ? `| Minimum settlement | ${l.minSize.replace(/_/g, " ")} |\n` : ""}${l.upgradesTo.length ? `| Upgrades to | ${l.upgradesTo.map((u) => dName(u) || u).join(", ")} |\n` : ""}
${ex.length ? `> **Excludes:** building this rules out ${ex.map((e) => `\`${e}\``).join(", ")}. Choose deliberately — this is not reversible by demolition in every case.\n` : ""}
_Internal name: \`${l.level}\`_
`).join("\n")}
`;

  fs.writeFileSync(path.join(OUT, "buildings", `${slug(c.chain)}.md`), body, "utf8");
  index.push({
    chain: c.chain, name: dName(c.order[0]) ? `${dName(c.order[0])} chain` : c.chain.replace(/_/g, " "),
    levels: levels.length, slug: slug(c.chain),
    exclusions: rows.reduce((a, r) => a + r.ex.length, 0),
    firstIcon: rows.find((r) => r.ic) ? rows.find((r) => r.ic).ic : null,
  });
}

index.sort((a, b) => b.levels - a.levels || a.name.localeCompare(b.name));
const idx = `# Buildings

[← wiki index](README.md)

${index.length} building chains, ${totalLevels.toLocaleString("en-US")} levels between them.
Each page lists what every level does, what it costs, how long it takes, the minimum
settlement size, and its upgrade path.

${totalExclusions ? `**${totalExclusions} levels exclude another building** — building one forecloses
the other. Those are marked on the pages, because a commitment that quietly locks out an
alternative is worth knowing about first.
` : ""}
| | Chain | Levels | Exclusions |
|:-:|---|---:|---:|
${index.map((e) => `| ${e.firstIcon ? `<img src="${e.firstIcon}" alt="" width="24">` : ""} | [${e.name}](buildings/${e.slug}.md) | ${e.levels} | ${e.exclusions || ""} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "buildings.md"), idx, "utf8");

console.log(`${list.length} building pages written`);
console.log(`  levels described:      ${totalLevels.toLocaleString("en-US")}`);
console.log(`  levels with an icon:   ${withIcon.toLocaleString("en-US")}`);
console.log(`  levels with effects:   ${withEffects.toLocaleString("en-US")}`);
console.log(`  exclusion rules found: ${totalExclusions.toLocaleString("en-US")} (via ${Object.keys(ALIASES).length} aliases)`);
