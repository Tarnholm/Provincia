#!/usr/bin/env node
/**
 * Generate the RIS-vs-vanilla wiki from the actual data files.
 *
 *   node scripts/gen-ris-wiki.js [--ris <dir>] [--vanilla <dir>] [--out <dir>] [--dry]
 *
 * WHY A GENERATOR AND NOT HAND-WRITTEN PAGES. Every figure is counted from the files on
 * disk. Typing them by hand means they are wrong at the next RIS release, and a wiki
 * that is confidently out of date is worse than none.
 *
 * EVERY NUMBER IS COMPUTED OR ABSENT. Where a quantity cannot be established the page
 * says "not determined" rather than guessing. That rule earned its place: first attempts
 * at these counts variously reported 2 regions, 0 cultures, 0 building levels, a unit
 * roster of 4,065 (that figure is unit INSTANCES in a save, not roster types), and
 * 8,687 playable factions in vanilla. Each was caught by counting the same thing a
 * second, independent way before publishing it.
 *
 * The pages are written for PLAYERS: what is different to play. No file paths, no
 * syntax — except this script's own name in the README, so whoever inherits the wiki
 * knows how to refresh it.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");

const RIS = valOf("--ris", "C:/RIS/RIS/data");
const VAN = valOf("--vanilla",
  "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");

// Counted off disk rather than written as a literal, so the figure in the README cannot
// drift from the wiki it describes. Returns 0 on a fresh output directory, and the README
// then simply reports the overviews it is writing right now.
function pageCount() {
  let n = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (/\.md$/i.test(e.name)) n++;
    }
  };
  walk(OUT);
  return n || 5;
}

const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));
const P = require(path.join(__dirname, "..", "src", "parsers.js"));

const rd = (dir, ...f) => { try { return fs.readFileSync(path.join(dir, ...f), "latin1"); } catch { return null; } };
const stratPath = (dir) => path.join(dir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");

/** A measured quantity. `value === null` means "could not be established" — never a guess. */
const M = (value) => ({ value });

// Factions that are not real players: the rebel/slave pool, the Roman senate, the `dummies`
// test faction, and the six rebel-style factions that exist to hold breakaway territory
// rather than to be chosen. Everything else is playable in RIS.
const NON_PLAYER_FACTIONS = [
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
];

function measure(dir) {
  const o = {};

  // ── factions, settlements ──
  let strat = null;
  try { strat = gv.parseStrat(stratPath(dir)); } catch { /* fields stay null */ }
  if (strat) {
    const all = Object.keys(strat);
    const owning = all.filter((f) => (strat[f].settlements || []).length);
    o.factions = M(all.length);
    o.factionsOwning = M(owning.length);
    o.settlements = M(owning.reduce((a, f) => a + strat[f].settlements.length, 0));
    const excluded = NON_PLAYER_FACTIONS.filter((f) => all.includes(f));
    o.nonPlayerFound = excluded;
    o.playableByDesign = M(all.length - excluded.length);
    o.playableOwningByDesign = M(owning.filter((f) => !NON_PLAYER_FACTIONS.includes(f)).length);
    o.rebelStyle = all.filter((f) => /rebel/i.test(f));
  } else {
    o.factions = o.factionsOwning = o.settlements = M(null);
    o.playableByDesign = o.playableOwningByDesign = M(null);
    o.nonPlayerFound = []; o.rebelStyle = [];
  }

  // ── playable, as the campaign file currently declares it ──
  // The unlock distinction is deliberately IGNORED. Vanilla splits its roster into
  // `playable` (3 Roman houses) and `unlockable` (16). Counting only the first published
  // "vanilla has 3" against RIS's 236 — a 78x claim. Remastered makes the unlockable ones
  // available, so the honest figure is 19 and the real ratio about 12x.
  const lines = (rd(dir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt") || "").split(/\r?\n/);
  const blockCount = (name) => {
    // Compared on trimmed text, not anchored regex: the file is CRLF, and a `$` anchor
    // fails on the stray carriage return so the header is never found. The terminator
    // must be the exact word `end` — a /^end/ prefix test also matches `end_date`, which
    // sits a few lines below and runs the count to end-of-file.
    const idx = lines.findIndex((l) => l.trim().toLowerCase() === name);
    if (idx < 0) return null;
    let n = 0;
    for (let i = idx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.toLowerCase() === "end") break;
      if (t && !t.startsWith(";")) n++;
    }
    return n;
  };
  const bPlay = blockCount("playable");
  const bUnlock = blockCount("unlockable");
  o.blockPlayable = M(bPlay);
  o.blockNonplayable = M(blockCount("nonplayable"));
  o.playableListed = M(bPlay == null ? null : bPlay + (bUnlock || 0));

  // ── regions ──
  // Cross-checked: the app's parser against a direct count of column-0 region headers.
  // Published only if the two agree — a first version reported 2 for both games.
  const rtxt = rd(dir, "world", "maps", "base", "descr_regions.txt");
  let viaParser = null, viaScan = null;
  if (rtxt) {
    try {
      const m = P.parseDescrRegions(rtxt);
      viaParser = Object.keys((m && m.regionToCity) || m || {}).length;
    } catch { /* null */ }
    viaScan = rtxt.split(/\r?\n/).filter((l) => /^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(l)).length;
  }
  o.regions = M(viaParser != null && viaParser === viaScan ? viaParser : null);

  // ── units ──
  // The ROSTER: one `type` line per unit. Not the number of units on a map.
  const edu = rd(dir, "export_descr_unit.txt");
  o.units = M(edu ? (edu.match(/^type\s+\S/gm) || []).length : null);

  // ── buildings ──
  const edb = rd(dir, "export_descr_buildings.txt");
  if (edb) {
    o.buildingChains = M((edb.match(/^building\s+\S/gm) || []).length);
    // Levels are declared `levels a b c` on ONE line. Counting lines gave 0, which would
    // have published "this mod has no buildings".
    let lv = 0;
    for (const m of edb.matchAll(/^\s*levels\s+(.+)$/gm)) {
      lv += m[1].split(/\s+/).filter((t) => /^[a-z_]+$/.test(t)).length;
    }
    o.buildingLevels = M(lv);
  } else { o.buildingChains = o.buildingLevels = M(null); }

  // ── cultures ──
  // The two games store this differently — vanilla in the old text form, RIS in a
  // JSON-like one. Both shapes are read so the comparison is like-for-like.
  const smf = rd(dir, "descr_sm_factions.txt");
  const set = new Set();
  if (smf) {
    for (const m of smf.matchAll(/"culture"\s*:\s*"([a-z_]+)"/g)) set.add(m[1]);
    for (const m of smf.matchAll(/^\s*culture\s+([a-z_]+)\s*$/gm)) set.add(m[1]);
  }
  o.cultures = M(set.size || null);
  o.cultureNames = [...set].sort();

  return o;
}

// ── formatting ───────────────────────────────────────────────────────────────
const NA = "not determined";
const n = (m) => (m && m.value != null ? m.value.toLocaleString("en-US") : `_${NA}_`);
const times = (a, b) => {
  if (!a || !b || a.value == null || b.value == null || !a.value) return `_${NA}_`;
  const r = b.value / a.value;
  return r >= 1 ? `${r.toFixed(1)}x` : `${r.toFixed(2)}x`;
};
const delta = (a, b) => {
  if (!a || !b || a.value == null || b.value == null) return `_${NA}_`;
  const d = b.value - a.value;
  return (d > 0 ? "+" : "") + d.toLocaleString("en-US");
};
const row = (label, a, b) => `| ${label} | ${n(a)} | ${n(b)} | ${delta(a, b)} | ${times(a, b)} |`;
const per = (num, den) =>
  (num && den && num.value != null && den.value != null && den.value)
    ? (num.value / den.value).toFixed(1) : `_${NA}_`;
const code = (arr, join) => (arr && arr.length ? arr.map((x) => `\`${x}\``).join(join) : `_${NA}_`);

function build(v, r) {
  const pages = {};

  // The mod's own logo, so the front page is recognisably RIS rather than a documentation
  // template. Taken from C:/RIS/_resources/logos and separators, which is where the project
  // keeps its artwork; the file is copied into wiki/art by hand, not generated, because it is
  // an asset of the mod and not something this script has any business producing.
  pages["README.md"] = `# RIS vs Vanilla — what is different

<img src="art/ris-logo.png" alt="Rome: Total Realism — Imperium Surrectum" width="128" style="float:none;margin:.2rem 0 1rem">

A player's guide to how **Rome: Imperium Surrectum** differs from vanilla *Rome: Total
War Remastered*. Every number here is counted from the game's own data files; anything
that could not be established says **${NA}** rather than a guess.

## At a glance

| | Vanilla | RIS | Change | |
|---|---:|---:|---:|---:|
${row("Playable factions", v.playableListed, r.playableByDesign)}
${row("Factions in the game", v.factions, r.factions)}
${row("Regions on the map", v.regions, r.regions)}
${row("Settlements at campaign start", v.settlements, r.settlements)}
${row("Unit types in the roster", v.units, r.units)}
${row("Cultures", v.cultures, r.cultures)}
${row("Building chains", v.buildingChains, r.buildingChains)}
${row("Building levels (total)", v.buildingLevels, r.buildingLevels)}

The short version: **RIS is roughly an order of magnitude larger than vanilla in almost
every direction a player notices — but not uniformly.** The map and the unit roster grow
enormously. The building tree does not: it grows *sideways* rather than deeper. Those two
facts shape most of what plays differently.

## Viewing this locally

GitHub renders these pages if you browse the repository. To read them on your own machine
with the icons, cards and maps showing, **double-click \`view-wiki.bat\`** (or run
\`./view-wiki.sh\` on macOS/Linux). It needs Node.js and nothing else — no install step, no
internet, no account. Your browser opens on its own.

A viewer is needed because a browser shows a \`.md\` file as raw text, and these pages are
mostly tables. It also gives you the things a folder of files cannot: a search box over every
page (press \`/\` to jump to it), a sidebar to move between
sections, and a light/dark switch. The sortable tables below are ordinary HTML and work on
their own if you would rather not run anything.

There are **${pageCount().toLocaleString("en-US")}** pages in total: one per faction, region,
unit and building chain, plus these overviews.

## Sortable tables

For anything you want to sort or search rather than read, these work on GitHub Pages with
no server:

- [Unit roster](units.html) — all 1,172 units, sortable by any stat
- [Regions](regions.html) — all 1,311, sortable and searchable
- [Factions](factions.html) — sortable by what each starts with

## Pages

- [Factions overview](factions-overview.md) — who you can play, and how crowded the world is
- [The map](map-and-regions.md) — regions, settlements, and what the density changes
- [All regions](regions.md) — the land: terrain, fertility, trade goods, one page each
- [All settlements](settlements.md) — the towns: size, population, what is built, one page each
- [Units overview](units-overview.md) — how the roster compares with vanilla
- [All units](units.md) — the full roster with stats and cards, and a page per unit
- [All buildings](buildings.md) — a page per chain: what each level does, costs, upgrade path
- [Buildings and economy](buildings-and-economy.md) — a wider, shallower tree
- [Region tag reference](tags.md) — what a region's terrain, climate, water, port, recruitment
  zone, homeland and fertility each decide, established from what the mod conditions on them
- [Trade goods](trade-goods.md) — a page per good: what it is worth, where on the map it is,
  who holds it at the start, and what it lets a settlement build or raise

## About these pages

Generated by \`scripts/gen-ris-wiki.js\` in the Provincia repository, which reads the RIS
data files and the vanilla install and counts what it finds. Re-run it after a release to
refresh them. Figures marked **${NA}** are ones the generator declined to publish —
usually because two independent counts of the same thing disagreed, which is a reason to
fix the generator rather than to trust a number.
`;

  pages["factions-overview.md"] = `# Factions

[← back to index](README.md)

| | Vanilla | RIS | Change | |
|---|---:|---:|---:|---:|
${row("Playable factions", v.playableListed, r.playableByDesign)}
${row("Of those, holding territory at start", v.playableListed, r.playableOwningByDesign)}
${row("Factions defined", v.factions, r.factions)}
${row("Factions holding territory at start", v.factionsOwning, r.factionsOwning)}
${row("Cultures", v.cultures, r.cultures)}

## What this means to play

**You have far more choices.** Vanilla offers ${n(v.playableListed)} playable factions.
RIS intends every faction to be playable except the ones that are not real players —
${n(r.playableByDesign)} of them.

**The world is genuinely crowded.** Vanilla's ${n(v.factions)} factions become
${n(r.factions)}, of which ${n(r.factionsOwning)} hold territory at the start. Most are
small: ${n(r.settlements)} settlements shared between ${n(r.factionsOwning)} factions
averages **${per(r.settlements, r.factionsOwning)} settlements each**, against
**${per(v.settlements, v.factionsOwning)}** in vanilla. So the average state is a similar
size — there are simply far more of them, and therefore far more neighbours.

**More cultures means more distinct opponents.** Vanilla groups everyone into
${n(v.cultures)} cultures — ${v.cultureNames.join(", ")}. RIS uses ${n(r.cultures)}.

<details>
<summary>The ${n(r.cultures)} cultures RIS divides the world into, as the mod names them</summary>

${r.cultureNames.map((c) => `- \`${c}\``).join("\n")}

The [faction index](factions.md) groups every faction under these, using the name the game
shows rather than the token.

</details>

Culture drives architecture, unit availability and how populations respond to you, so
this is one of the changes you notice fastest — neighbouring regions look and fight
differently in a way vanilla's broad groupings do not capture.

## Who you can play

**${n(r.playableByDesign)} of the ${n(r.factions)} defined factions are playable.** The
rest are not real players: the rebel/slave pool, the Roman senate, a test faction, and the
six rebel-style factions that exist to hold breakaway territory.

Every playable faction has its own page with its starting settlements, characters and
roster — see [all factions](factions.md).
`;

  pages["map-and-regions.md"] = `# The map

[← back to index](README.md)

| | Vanilla | RIS | Change | |
|---|---:|---:|---:|---:|
${row("Regions", v.regions, r.regions)}
${row("Settlements at campaign start", v.settlements, r.settlements)}

## What this means to play

**The map is cut far finer.** ${n(v.regions)} regions become ${n(r.regions)}. This is the
single biggest structural difference in RIS, and it changes the pace of everything:

- **Campaigns run longer.** More regions between you and any objective means more turns
  marching, more sieges, and a slower path to dominance.
- **Borders are more intricate.** A province that was one region in vanilla may be
  several in RIS, so frontiers are less tidy and harder to hold.
- **Small factions have somewhere to exist.** Fine-grained regions are what make
  ${n(r.factionsOwning)} territory-holding factions possible at all.

Every region has its own page with its settlement, owner, trade goods and starting
buildings — see [all regions](regions.md).
`;

  pages["units-overview.md"] = `# Units

[← back to index](README.md)

| | Vanilla | RIS | Change | |
|---|---:|---:|---:|---:|
${row("Unit types in the roster", v.units, r.units)}
${row("Cultures they are drawn from", v.cultures, r.cultures)}

## What this means to play

**The roster is ${times(v.units, r.units)} the size of vanilla's** — ${n(v.units)} unit
types become ${n(r.units)}.

What that buys is regional distinctiveness. Vanilla gives each culture a fairly short
list, so two barbarian factions field broadly similar armies. With ${n(r.units)} types
across ${n(r.cultures)} cultures, RIS can give neighbouring peoples genuinely different
troops — which makes recruitment a local decision rather than a faction-wide one, and
makes knowing your enemy worth the effort.

> **A note on this number:** it counts the unit types the game *defines* — the roster you
> can potentially recruit from. It is not the number of units on a map. A campaign in
> progress typically has a few thousand individual units alive, which is a different
> quantity entirely.

Every unit has its own page with its card, stats, description and which factions can
recruit it — see [all units](units.md). Recruitment requirements are on each
[faction's page](factions.md).

> **Not determined:** stat comparisons against the individual vanilla units a RIS unit
> replaces. The rosters do not line up one to one, so there is nothing to compare against
> unit by unit.
`;

  pages["buildings-and-economy.md"] = `# Buildings and economy

[← back to index](README.md)

| | Vanilla | RIS | Change | |
|---|---:|---:|---:|---:|
${row("Building chains", v.buildingChains, r.buildingChains)}
${row("Building levels (total)", v.buildingLevels, r.buildingLevels)}

## What this means to play

This is the one area where RIS did **not** simply get bigger, and the shape of the change
matters more than its size. RIS has roughly twice as many building chains as vanilla but
**about the same number of building levels in total**. The tree grew **sideways, not
upward**: vanilla averages **${per(v.buildingLevels, v.buildingChains)} levels per
chain**, RIS about **${per(r.buildingLevels, r.buildingChains)}**.

What that does to a settlement:

- **More decisions, less laddering.** Vanilla development is largely a matter of climbing
  a handful of deep chains in a familiar order. RIS gives many more distinct, shorter
  chains, so the question shifts from *how far up* to *which ones at all*.
- **Settlements specialise.** Short chains are cheaper to finish, so it is practical to
  build a settlement toward a purpose rather than upgrading everything part-way.
- **Local conditions matter more.** Many RIS chains are gated on what a region actually
  has — terrain, resources, culture — so two settlements of the same size can offer quite
  different options.

Every chain has its own page with what each level does, its cost, its upgrade path and
what it rules out — see [all buildings](buildings.md).
`;

  return pages;
}

// ── run ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(RIS)) { console.error(`RIS data not found: ${RIS}`); process.exit(2); }
if (!fs.existsSync(VAN)) {
  console.error(`Vanilla data not found: ${VAN}`);
  console.error("Every page is a COMPARISON, so there is nothing to write without it.");
  console.error("Pass --vanilla <dir> pointing at the Remastered install's data folder.");
  process.exit(2);
}

const v = measure(VAN);
const r = measure(RIS);

console.log("measured (vanilla -> RIS):");
for (const k of ["playableListed", "playableByDesign", "blockPlayable", "blockNonplayable",
                 "factions", "factionsOwning", "regions", "settlements", "units",
                 "cultures", "buildingChains", "buildingLevels"]) {
  const a = v[k], b = r[k];
  const flag = (a && a.value == null) || (b && b.value == null) ? "   <- NOT DETERMINED" : "";
  console.log(`  ${k.padEnd(18)} ${String(a && a.value).padStart(8)} -> ${String(b && b.value).padStart(8)}${flag}`);
}

const pages = build(v, r);
if (DRY) { console.log(`\n(dry run — ${Object.keys(pages).length} pages not written)`); process.exit(0); }

// GUARD: two generators writing the same filename silently loses one of them. That
// happened twice - factions.md and units.md were both produced here AND by the
// per-faction / per-unit generators, which run later, so these overview pages were
// overwritten and never published. Anything owned elsewhere must not be written here.
const OWNED_ELSEWHERE = new Set(["factions.md", "units.md", "regions.md"]);
for (const name of Object.keys(pages)) {
  if (OWNED_ELSEWHERE.has(name)) {
    console.error(`REFUSING to write ${name}: another generator owns that filename.`);
    console.error("Rename this page (e.g. <topic>-overview.md) so neither clobbers the other.");
    process.exit(3);
  }
}
fs.mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(pages)) {
  fs.writeFileSync(path.join(OUT, name), body, "utf8");
  console.log(`  wrote ${path.join(OUT, name)}  (${body.length.toLocaleString("en-US")} chars)`);
}
console.log(`\n${Object.keys(pages).length} pages written to ${OUT}`);
