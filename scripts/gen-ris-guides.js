#!/usr/bin/env node
// guides.md: the mod's in-game guides, as the game shows them when a player presses the
// advisor's "?" in the campaign (asked for 2026-09-26 by the team: "these (?) info panes are
// really nice ways to communicate with new players"). Read by lib/risGuides.js from the campaign
// script's own trigger block, so only texts the game actually shows appear; the other entries
// under expanded_bi's GUIDES AND ADVICES heading are left out.
//
// Each faction's own "Faction mechanics" pop-up goes on its faction page
// (gen-ris-faction-pages.js); this page lists which factions have one. Run after the faction
// pages, whose headings give the names.
//
//   node scripts/gen-ris-guides.js [--ris C:/RIS/RIS/data] [--out C:/RIS/_wiki]
const fs = require("fs");
const path = require("path");

const valOf = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/_wiki");
const { loadGuides, toMarkdown } = require(path.join(__dirname, "lib", "risGuides.js"));

const g = loadGuides(RIS);
// Buildings, units, factions, goods and places the guides name, linked to their pages.
const LINK = require(path.join(__dirname, "lib", "wikiLinker.js")).makeLinker(OUT, { root: "" });
if (!g.general.length) { console.error("no guides found in the campaign script"); process.exit(2); }

const nameOf = (f) => {
  try { return fs.readFileSync(path.join(OUT, "factions", `${f}.md`), "utf8").split("\n")[0].replace(/^#\s*/, "").trim(); }
  catch { return null; }
};
const withPage = [...g.byFaction.keys()].filter((f) => nameOf(f)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
const emblem = (f) => (fs.existsSync(path.join(OUT, "symbols", `${f}.png`))
  ? `<img src="symbols/${f}.png" alt="" width="24" height="24" style="vertical-align:middle"> ` : "");

const body = `# Game guides

[← wiki index](README.md)

These are the guides the game itself shows during a campaign. Press the **?** button beside
your advisor to bring them up.

${g.general.map((x) => `## ${x.title}\n\n${LINK(toMarkdown(x.body, 3))}\n`).join("\n")}
## Faction mechanics

These factions also have a guide of their own, on the faction's page.

<div class="nodeal cols">

${withPage.map((f) => `- [${emblem(f)}${nameOf(f)}](factions/${f}.md#faction-mechanics)`).join("\n")}

</div>
`;
fs.writeFileSync(path.join(OUT, "guides.md"), body, "utf8");
console.log(`guides.md: ${g.general.length} guides, ${withPage.length} faction mechanics linked`);

// ── aor.md: areas of recruitment ─────────────────────────────────────────────
// Asked for 2026-09-28, with the guides linking to it (wikiLinker maps "AOR" and "Area of
// Recruitment" here). What each government allows is the game's own guide, word for word (the
// "Dependency - …" lines of the recruitment guide); the areas, their units and maps are the
// recruitment zones page, counted from it.
{
  const rec = g.general.find((x) => /recruit/i.test(x.title));
  const lines = rec ? String(rec.body).replace(/\\n/g, "\n").split("\n").map((l) => l.trim()) : [];
  const GOV = ["Dependency", "Indirect Rule", "Direct Rule", "Homeland"];
  const govRows = GOV.map((gv) => {
    const l = lines.find((x) => x.indexOf(gv + " -") === 0);
    return l ? [gv, l.slice(gv.length + 2).trim()] : null;
  }).filter(Boolean);
  const micLine = lines.find((x) => /Area of Recruitment \(AOR\) units/.test(x));
  let zones = 0, units = 0, listing = "";
  try {
    const z = fs.readFileSync(path.join(OUT, "tags", "recruitment-zones.md"), "utf8");
    // The whole zone listing (index table, then each area with its map and units), shown here
    // too (the team, 2026-09-28: "should show all the recruitment zones with their images").
    // It is written from tags/, so its "../" paths are made relative to the wiki root.
    const at = z.indexOf("| Zone | Units | Regions |");
    if (at >= 0) listing = z.slice(at).replace(/\]\(\.\.\//g, "](").replace(/src="\.\.\//g, 'src="');
    const table = z.split(/\| Zone \| Units \| Regions \|/)[1] || "";
    // Only the index table's own rows: it ends at the first line that is not a table row.
    const rows = table.split("\n").slice(2);
    const end = rows.findIndex((l) => !/^\|/.test(l));
    zones = (end < 0 ? rows : rows.slice(0, end)).length;
    units = new Set([...z.matchAll(/\]\(\.\.\/units\/([a-z0-9_]+)\.md\)/g)].map((m) => m[1])).size;
  } catch { /* no zone page yet */ }
  const aor = `# Areas of recruitment (AOR)

[← wiki index](README.md) · [game guides](guides.md) · [recruitment zones](tags/recruitment-zones.md)

An area of recruitment is a group of regions with troops of their own. Any faction that holds a
region in the area can raise them there, alongside its own faction units. RIS has
**${zones.toLocaleString("en-US")}** areas and **${units.toLocaleString("en-US")}** AOR units.

## What each government allows

| Government | Recruitment |
|---|---|
${govRows.map(([gv, t]) => `| ${gv} | ${t} |`).join("\n")}

${micLine ? `${micLine}\n\n` : ""}Where areas overlap, the broader one steps aside: a unit of a general area is barred from regions
that also belong to a more specific one, so the local speciality is raised there instead.
`;
  const linkHere = require(path.join(__dirname, "lib", "wikiLinker.js")).makeLinker(OUT, { root: "", self: "aor.md" });
  fs.writeFileSync(path.join(OUT, "aor.md"), linkHere(aor) + (listing ? `\n## The areas\n\n${listing}` : ""), "utf8");
  console.log(`aor.md: ${zones} areas, ${units} AOR units, ${govRows.length} government rows`);
}
