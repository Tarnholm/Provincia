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
