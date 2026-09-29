#!/usr/bin/env node
/**
 * One wiki page per mercenary pool, plus an index of all pools.
 *
 *   node scripts/gen-ris-mercenary-pages.js [--ris <dir>] [--out <dir>]
 *
 * Source: descr_mercenaries.txt (parsed by lib/mercPools.js). Each pool page shows a map of the
 * regions it covers, those regions, and every unit it offers with the line's own numbers.
 *
 * WHAT THE NUMBERS ARE, from the line `unit <type>, exp E cost C replenish A - B max M initial I`:
 *   cost      the price to hire, in denarii
 *   exp       the experience the unit is hired with
 *   initial   how many the pool holds when the campaign starts
 *   max       the most the pool can ever hold
 *   replenish A - B, how many are added to the pool each turn (a figure between A and B)
 *   restrict  the only factions that can hire it (same reading as gen-ris-unit-pages.js)
 * The file has no year, religion or event conditions in RIS; any unit line the parser does not
 * understand is printed at the end of the run rather than dropped silently.
 *
 * Runs after gen-ris-region-pages.js (region pages and the map spec for lib/areaMaps.js) and
 * gen-ris-unit-pages.js (unit pages and their titles, and the cards folder).
 */
const fs = require("fs");
const path = require("path");
const { parseMercPools, poolNames, poolFile } = require("./lib/mercPools.js");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/_wiki");

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const fmt = (n) => Number(n).toLocaleString("en-US");
const readLut = (file) => {
  const m = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const x of t.matchAll(/\{([^}]+)\}(.*)/g)) { const k = x[1].trim(); if (!(k in m)) m[k] = x[2].trim(); }
  } catch { /* token fallback */ }
  return m;
};
const listDir = (d, ext) => { try { return fs.readdirSync(path.join(OUT, d)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)); } catch { return []; } };

// ── pools ────────────────────────────────────────────────────────────────────
const { pools, bad } = parseMercPools(RIS);
if (!pools.length) { console.error("no mercenary pools parsed from descr_mercenaries.txt"); process.exit(2); }
const NAMES = poolNames(pools);

// ── units: EDU type -> dictionary -> unit page ───────────────────────────────
// Unit pages are keyed by the EDU `dictionary` (see gen-ris-unit-pages.js), and the pool lines
// name the EDU `type`, so the unit file is read for that mapping.
const typeToDict = new Map();
{
  let edu = "";
  try { edu = fs.readFileSync(path.join(RIS, "export_descr_unit.txt"), "latin1"); } catch { /* none */ }
  let type = null;
  for (const raw of edu.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(l);
    if (m) { type = m[1].trim().toLowerCase(); continue; }
    m = /^dictionary\s+(\S+)/.exec(l);
    if (m && type) { typeToDict.set(type, m[1].toLowerCase()); type = null; }
  }
}
const unitPages = new Set(listDir("units", ".md"));
const cards = new Set(listDir("cards", ".png"));
const UNIT_TEXT = Object.fromEntries(Object.entries(readLut("export_units.txt")).map(([k, v]) => [k.toLowerCase(), v]));
// The unit page's own title, so a unit is called the same thing here as on its page
// (gen-ris-unit-pages.js adds "Mercenary" where the mod's name does not already say so).
const titleOf = (s) => {
  try { const m = /^# (.+)$/m.exec(fs.readFileSync(path.join(OUT, "units", `${s}.md`), "utf8")); return m ? m[1].trim() : null; } catch { return null; }
};
const missingUnits = new Set();
function unitInfo(type) {
  const d = typeToDict.get(type);
  const s = d ? slug(d) : null;
  const page = s && unitPages.has(s);
  if (!page) missingUnits.add(type);
  const name = (page && titleOf(s)) || (d && UNIT_TEXT[d]) || type.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const img = s && cards.has(s) ? `<img src="../cards/${s}.png" alt="" width="41" height="56" loading="lazy">` : "";
  return {
    name,
    card: img && page ? `[${img}](../units/${s}.md)` : img,
    link: page ? `[${name}](../units/${s}.md)` : name,
  };
}

// ── regions ──────────────────────────────────────────────────────────────────
const regionPages = new Set(listDir("regions", ".md"));
const REGION_NAMES = readLut("imperial_campaign_regions_and_settlement_names.txt");
const regionName = (r) => REGION_NAMES[r] || String(r).replace(/_/g, " ");

// ── factions (same naming and linking as gen-ris-unit-pages.js) ──────────────
const factionPages = new Set(listDir("factions", ".md"));
const NON_PLAYABLE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
const FACTION_NAMES = (() => {
  const out = {};
  const lower = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  const camp = lower(readLut("campaign_descriptions.txt"));
  const exp = lower(readLut("expanded_bi.txt"));
  for (const [k, v] of Object.entries(camp)) {
    const m = /^imperial_campaign_([a-z0-9_]+)_title$/.exec(k);
    if (m && v) out[m[1]] = v;
  }
  for (const [k, v] of Object.entries(exp)) if (v && !(k in out)) out[k] = v;
  return out;
})();
const factionName = (f) => FACTION_NAMES[f] || String(f).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const REBEL_LABELS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(OUT, "revolts", "index.json"), "utf8")).labels || {}; } catch { return {}; }
})();
const unknownFactions = new Set();
const factionLink = (f) => {
  if (NON_PLAYABLE.has(f)) return `[${REBEL_LABELS[f] || factionName(f)}](../factions/non-playable.md)`;
  if (factionPages.has(f)) return `[${factionName(f)}](../factions/${f}.md)`;
  unknownFactions.add(f);
  return factionName(f);
};
const whoCell = (restrict) => restrict.length
  ? `Only ${[...new Set(restrict)].sort((a, b) => factionName(a).localeCompare(factionName(b))).map(factionLink).join(", ")}`
  : "Any faction";

// ── pages ────────────────────────────────────────────────────────────────────
const M = require("./lib/areaMaps.js").areaMaps(OUT, "merc-maps");
const dir = path.join(OUT, "mercenaries");
fs.mkdirSync(dir, { recursive: true });
const written = new Set();
const allRegions = new Set(), allTypes = new Set(), regionsNoPage = new Set();

for (const p of pools) {
  const name = NAMES[p.token];
  const regs = [...new Set(p.regions)];
  regs.forEach((r) => allRegions.add(r));
  const onMap = regs.filter((r) => regionPages.has(r)).sort((a, b) => regionName(a).localeCompare(regionName(b)));
  regs.filter((r) => !regionPages.has(r)).forEach((r) => regionsNoPage.add(r));
  const types = new Set(p.units.map((u) => u.type));
  types.forEach((t) => allTypes.add(t));

  const map = M.add(onMap, `Regions of the ${name} mercenary pool`, "../");
  const rows = p.units.map((u) => {
    const i = unitInfo(u.type);
    return `| ${i.card} | ${i.link} | ${fmt(u.cost)} | ${u.exp} | ${u.initial} | ${u.max} | ${u.replenishMin}–${u.replenishMax} | ${whoCell(u.restrict)} |`;
  });
  const missing = regs.length - onMap.length;
  const body = `# ${name}

[← all mercenary pools](../mercenaries.md) · [wiki index](../README.md)

Mercenary pool: **${types.size} unit${types.size === 1 ? "" : "s"}** for hire in **${regs.length} region${regs.length === 1 ? "" : "s"}**.

${map ? `${map}\n\n` : ""}## Mercenaries

| | Unit | Cost (dn) | Experience | At start | Most in pool | Added per turn | Who can hire |
|:-:|---|---:|---:|---:|---:|---|---|
${rows.join("\n")}

## Regions (${regs.length})

${onMap.map((r) => `[${regionName(r)}](../regions/${encodeURIComponent(r)}.md)`).join(" · ")}${missing ? `\n\n_${missing} more region${missing === 1 ? "" : "s"} in this pool ${missing === 1 ? "is" : "are"} not on the map and ${missing === 1 ? "has" : "have"} no page: ${regs.filter((r) => !regionPages.has(r)).map(regionName).join(", ")}._` : ""}
`;
  const f = poolFile(p.token);
  if (written.has(f)) { console.error(`two pools write ${f}`); process.exitCode = 2; }
  written.add(f);
  fs.writeFileSync(path.join(OUT, f), body);
}

// Pages left over from a pool the mod no longer has.
for (const f of fs.readdirSync(dir)) if (f.endsWith(".md") && !written.has(`mercenaries/${f}`)) fs.unlinkSync(path.join(dir, f));

const sorted = [...pools].sort((a, b) => NAMES[a.token].localeCompare(NAMES[b.token]));
const idx = `# Mercenary pools

[wiki index](README.md)

${pools.length} pools. Each covers a set of regions and offers its own mercenaries.

| Pool | Regions | Units |
|---|---:|---:|
${sorted.map((p) => `| [${NAMES[p.token]}](${poolFile(p.token)}) | ${new Set(p.regions).size} | ${new Set(p.units.map((u) => u.type)).size} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "mercenaries.md"), idx);

const maps = M.render();
console.log(`mercenary pools: ${pools.length} pages · unit offers: ${pools.reduce((t, p) => t + p.units.length, 0)} · distinct units: ${allTypes.size} · distinct regions: ${allRegions.size} (${regionsNoPage.size} without a page) · maps: ${maps}`);
if (bad.length) console.log(`  LINES NOT UNDERSTOOD (${bad.length}): ${bad.slice(0, 5).join(" | ")}`);
if (missingUnits.size) console.log(`  units with no unit page (${missingUnits.size}): ${[...missingUnits].join(", ")}`);
if (unknownFactions.size) console.log(`  restricted to factions with no page: ${[...unknownFactions].join(", ")}`);
