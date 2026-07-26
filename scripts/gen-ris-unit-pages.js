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

function statsOf(b) {
  const pri = csv(b, "stat_pri");          // attack, charge, missile?, range, ammo, type, tech, dmg, weapon, delay, ...
  const armour = csv(b, "stat_pri_armour"); // armour, defence skill, shield, material...
  const mental = csv(b, "stat_mental");     // morale, discipline, training
  const cost = csv(b, "stat_cost");         // turns, cost, upkeep, weapon, armour, total?
  const soldier = csv(b, "soldier");        // model, count, extras, mass
  return {
    men: num(soldier[1]),
    attack: num(pri[0]),
    charge: num(pri[1]),
    weapon: pri[8] || null,
    armour: num(armour[0]),
    defence: num(armour[1]),
    shield: num(armour[2]),
    morale: num(mental[0]),
    discipline: mental[1] || null,
    training: mental[2] || null,
    turns: num(cost[0]),
    cost: num(cost[1]),
    upkeep: num(cost[2]),
  };
}

// ── who can actually recruit each unit ───────────────────────────────────────
// The faction pages answer "what can this faction raise". This is the reverse, which is
// the question a reader on a unit page has. Split the same way, on the hidden_resource gate
// the engine enforces: the core list is short and meaningful, while regional availability
// is usually "everyone, if they take the right province" and so is reported as a count.
function loadAvailability() {
  const edb = rd("export_descr_buildings.txt") || "";
  const byType = new Map();   // unit type -> { core:Set, aor:Set }
  for (const m of edb.matchAll(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+([^\r\n]+)/gm)) {
    const type = m[1].trim().toLowerCase();
    const expr = m[3];
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

// Only link factions that actually have a page — slave, the senate and the dummy factions
// are excluded from the wiki, and linking them was 1,006 broken links once already.
const factionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "factions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
const prettyFaction = (f) => String(f).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

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
    type: b.type, dict, name: name || b.type, hasName: !!name,
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
const merged = [];
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
    merged.push({
      ...head,
      slug: slug(key),
      variants: group.map((g) => g.type),
      statsDiffer: group.some((g) => !cmp(g, head)),
    });
  }
}

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

for (const u of list) {
  const s = u.st;
  const stat = (label, v, suffix, key) => v == null ? "" :
    `| ${label} | ${v.toLocaleString("en-US")}${suffix || ""} | ${key ? bar(key, v) : ""} |\n`;

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
  const coreList = [...avail.core].filter((f) => factionPages.has(f)).sort();
  const aorCount = [...avail.aor].filter((f) => factionPages.has(f)).length;
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

${cardMarkup(u)}${u.hasName ? "" : "> _This unit has no display name in the text files, so its internal name is shown._\n\n"}**Class:** ${u.cls || "unknown"} · **Category:** ${u.category || "unknown"}${s.men != null ? ` · **Men per unit:** ${s.men}` : ""}

## Stats

The bar shows where this unit sits in the whole RIS roster, so a number can be read against
its peers rather than against vanilla — RIS stats run much higher than the base game's.

| | | Rank in roster |
|---|---:|---|
${stat("Attack", s.attack, "", "attack")}${stat("Charge bonus", s.charge, "", "charge")}${s.weapon ? `| Weapon | ${s.weapon} | |\n` : ""}${stat("Armour", s.armour, "", "armour")}${stat("Defence skill", s.defence, "", "defence")}${stat("Shield", s.shield, "", "shield")}${stat("Morale", s.morale, "", "morale")}${s.discipline ? `| Discipline | ${s.discipline} | |\n` : ""}${s.training ? `| Training | ${s.training} | |\n` : ""}${stat("Men per unit", s.men, "", "men")}${stat("Recruitment cost", s.cost, " dn", "cost")}${stat("Upkeep per turn", s.upkeep, " dn", "upkeep")}${stat("Turns to recruit", s.turns)}
${u.attributes.length ? `\n**Attributes:** ${u.attributes.map((a) => `\`${a}\``).join(", ")}\n` : ""}
## Who can recruit it

${avail.allCore
  ? `Every faction can raise this unit from its own buildings — it is open to \`factions { all }\` with no regional gate.`
  : coreList.length
    ? `${coreList.length === 1
        ? `A core roster unit for one faction, which can raise it anywhere it holds the right building:`
        : `A core roster unit for ${coreList.length} factions, each able to raise it anywhere they hold the right building:`}\n\n${coreList.slice(0, 40).map((f) => `[${prettyFaction(f)}](../factions/${f}.md)`).join(" · ")}${coreList.length > 40 ? `\n\n_…and ${coreList.length - 40} more._` : ""}`
    : avail.all || aorCount
      ? `No faction has this as a core unit — it is area-of-recruitment only, so it can be raised solely in provinces carrying the required hidden resource.`
      : `_No recruitment route for this unit was found in the building files._`}
${avail.all && !avail.allCore ? `\nIt is offered to \`factions { all }\` behind a regional gate, so any faction holding the right province can field it.\n` : aorCount ? `\nA further ${aorCount} faction${aorCount === 1 ? "" : "s"} can raise it regionally, in provinces with the required resource.\n` : ""}
> The exact building level and any resource requirement are listed on each faction's page.

${u.long || u.short
  ? `## Description\n\n${sectionise(u.long || u.short)}\n\n`
  : "> This unit has no written description in the mod yet.\n\n"}
${u.variants.length > 1 ? `## Recruitment variants

This unit is defined ${u.variants.length} times in the mod — the same troops reached by
different routes. \`aor …\` entries are area-of-recruitment versions, available in regions
matching that AOR; \`horde …\` versions belong to horde factions.

${u.variants.map((v) => `- \`${v}\``).join("\n")}
${u.statsDiffer ? `\n> **The variants do NOT all share the same stats.** The figures above are taken from\n> \`${u.type}\`; at least one other variant differs, so check in-game if the exact numbers matter.\n` : "\n_All variants share the same stats._\n"}` : `_Internal name: \`${u.type}\`_`}
`;
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
## By class

| Class | Units |
|---|---:|
${Object.entries(byClass).sort((a, b) => b[1].length - a[1].length).map(([c, v]) => `| ${c} | ${v.length.toLocaleString("en-US")} |`).join("\n")}

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
console.log(`  with a display name:      ${named.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}`);
console.log(`  with a real description:  ${described.toLocaleString("en-US")}`);
console.log(`  still on placeholder text:${placeholder.toLocaleString("en-US")}`);
console.log(`  distinct classes:         ${Object.keys(byClass).length}`);
