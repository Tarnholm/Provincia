// The wiki's side menu, shared by the site (serve-ris-wiki.js) and the GitHub wiki's _Sidebar
// (build-github-wiki.js), so the two cannot drift.
//
// Asked for 2026-10-27 by the team (UX pass): the flat list had grown to 35 links. The menu now
// holds the main systems only; the detailed and niche pages sit under them as child links,
// folded away until the reader is on that system's pages.
//
//   [heading, items]   a menu section
//   [href, label]      a link; href is a wiki path ("/factions.md") or a view ("/units.html")
//   [href, label, kids] a link with child links under it
const NAV = [
  ["Start here", [
    ["/README.md", "Wiki index"],
    ["/guides.md", "Game guides"],
    ["/community-guides.html", "Community guides"],
    ["/changelog.md", "Changelog"],
  ]],
  ["Campaign", [
    ["/factions.md", "Factions", [
      ["/factions.html", "Factions table"],
      ["/cultures.md", "Cultures"],
      ["/religions.md", "Beliefs"],
      ["/reforms.md", "Reforms"],
      ["/revolts.md", "Revolts"],
    ]],
    ["/recruitment.md", "Recruitment", [
      ["/units.md", "All units"],
      ["/units.html", "Unit roster"],
      ["/mercenaries.md", "Mercenary pools"],
      ["/aor.md", "Areas of recruitment"],
      ["/tags/recruitment-zones.md", "Recruitment zones"],
      ["/tags/specialty-recruitment.md", "Specialty recruitment"],
      ["/tags/recruitment-other.md", "Other recruitment tags"],
    ]],
    ["/government.md", "Government", [
      ["/buildings/governmenta.md", "Dependency"],
      ["/buildings/governmentb.md", "Indirect rule"],
      ["/buildings/governmentc.md", "Direct rule"],
      ["/buildings/governmentd.md", "Homeland"],
      ["/buildings/colony.md", "Colonies"],
      ["/buildings/capital_treasury.md", "Treasury"],
    ]],
    ["/buildings.md", "Buildings", [
      ["/sizes.md", "Settlement sizes"],
      ["/wonders.md", "Wonders"],
    ]],
    ["/economy.md", "Economy", [
      ["/trade-goods.md", "Trade goods"],
    ]],
    ["/regions.md", "Regions and settlements", [
      ["/world-map.html", "World map"],
      ["/regions.html", "Regions table"],
      ["/tags/terrain.md", "Terrain"],
      ["/tags/climate.md", "Climate"],
      ["/tags/irrigation.md", "Water sources"],
      ["/tags/ports.md", "Ports"],
      ["/tags/fertility.md", "Fertility"],
      ["/tags/hazards-and-river-trade.md", "River trade"],
      ["/tags/cultural-homeland.md", "Cultural homelands"],
    ]],
    ["/traits.md", "Traits", [
      ["/ancillaries.md", "Retinue"],
    ]],
  ]],
  ["Community", [
    ["/diaries.md", "Developer diaries"],
    ["/community-videos.md", "Community videos"],
  ]],
];

// Made by the site build (build-ris-wiki-site.js), not a generator: never in the wiki folder,
// always listed.
const ALWAYS = new Set(["/community-guides.html"]);

// The page families a link stands for: "/units.md" -> "/units/", so a unit page opens the group
// that holds "All units". "/buildings/colony.md" is a page, not a family, and stands for itself.
// Where an index's pages live elsewhere than its own name, the folders are named here.
const MORE_FAMILIES = { "/regions.md": ["/settlements/"], "/trade-goods.md": ["/goods/"] };
const familiesOf = (href) => (/^\/[^/]+\.md$/.test(href)
  ? [href.replace(/\.md$/, "/"), ...(MORE_FAMILIES[href] || [])] : []);

// How a link relates to the page at rel: 2 it is that page, 1 the page is in its family, 0 neither.
// A campaign variant's page (/v/<id>/factions/rome.md) counts as the main page it stands for.
function match(href, rel) {
  const r = String(rel || "").replace(/^\/v\/[^/]+(?=\/)/, "");
  if (href === r) return 2;
  return familiesOf(href).some((f) => r.startsWith(f)) ? 1 : 0;
}

module.exports = { NAV, ALWAYS, familiesOf, match };
