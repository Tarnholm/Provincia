#!/usr/bin/env node
/**
 * Build a static HTML front end for the wiki, for GitHub Pages.
 *
 *   node scripts/gen-ris-wiki-html.js [--out <dir>]
 *
 * Markdown on Pages gives you documents; this gives the parts of Provincia that need
 * interaction — a roster you can sort and filter, and a region table you can search —
 * with no server and no build step. One self-contained file per view: the data is inlined
 * as JSON and the script is a few dozen lines, so it works from a file:// URL too.
 *
 * The markdown pages remain the source of truth for prose. These are views over the same
 * generated data, not a replacement, and each links back into the markdown.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const OUT = valOf("--out", "C:/RIS/_wiki");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── read the generated markdown back for its data ────────────────────────────
// Parsing our own output keeps this generator independent of the mod files: whatever the
// markdown says, the tables say. If a figure is wrong it is wrong in one place.
function parseTable(file, minCols) {
  let body;
  try { body = fs.readFileSync(path.join(OUT, file), "utf8"); } catch { return []; }
  const rows = [];
  for (const line of body.split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < minCols) continue;
    if (/^[:\- ]+$/.test(cells[0])) continue;          // separator row
    rows.push(cells);
  }
  return rows;
}

// A link cell, "[text](href)" plus anything after it (a capital's star). Link text can carry an
// inline symbol image now (the faction index puts each faction's emblem in its name), which is
// pulled out into `sym` - it printed as raw <img> markup in the Faction column otherwise.
const linkText = (cell) => {
  const m = /^\[(.*)\]\(([^)]*)\)\s*(.*)$/.exec(cell);
  if (!m) return { text: cell.replace(/<img[^>]*>/g, "").trim(), href: null };
  const img = /<img[^>]*src="([^"]+)"/.exec(m[1]);
  return { text: m[1].replace(/<img[^>]*>/g, "").trim(), href: m[2], sym: img ? img[1] : null, mark: m[3].trim() };
};
const numOf = (cell) => {
  const n = parseInt(String(cell).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

// The views are pages of the wiki itself: the same shell (bar, menu, theme, search), the same
// heading, divider and table styling as every other page, built with serve-ris-wiki.js's own
// renderer. They used to be standalone documents with a stylesheet of their own, and a reader
// clicking through from the index landed on what looked like a different site. What is added
// here is only what a static table lacks: a filter box, click-to-sort headings and the bars.
const viewer = require(path.join(__dirname, "serve-ris-wiki.js"));
const PAGE = (title, intro, columns, rows, route, links) => {
  const head = viewer.renderMarkdown(`# ${title}\n\n${links}\n\n${intro}\n`, []);
  const body = `${head}
<style>
.sbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:.4rem 0 .7rem}
.sbar input{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:8px;
 padding:.42rem .65rem;font:inherit;font-size:.9rem;min-width:18rem}
.sbar input:focus{outline:2px solid var(--acc-soft);border-color:var(--acc)}
#count{color:var(--dim);font-size:.84rem;font-variant-numeric:tabular-nums}
.sview th{cursor:pointer;user-select:none}
.sview th:hover,.sview th.sorted{color:var(--acc)}
.sview th.sorted::after{content:" \\25B2"}
.sview th.sorted.desc::after{content:" \\25BC"}
.sview td{white-space:nowrap}
.sview td.thumb{padding:.15rem .4rem;width:2.6rem}
.sview td.thumb img{display:block;width:35px;height:48px;border-radius:4px}
.sview td .sym{width:22px;height:22px;vertical-align:middle;margin-right:.45rem}
.bars{display:inline-block;width:3.4rem;height:.4rem;border-radius:3px;background:var(--line);
 vertical-align:middle;margin-left:.45rem;overflow:hidden}
.bars i{display:block;height:100%;background:var(--acc)}
@media(max-width:700px){.sbar input{min-width:11rem}}
</style>
<div class="sbar"><input id="q" type="search" placeholder="Filter…" autocomplete="off"><span id="count"></span></div>
<div class="tw big sview"><table><thead><tr>${
  columns.map((c, i) => `<th data-i="${i}"${c.num ? ' class="right"' : ""}${c.width ? ` style="width:${c.width}"` : ""}>${esc(c.label)}</th>`).join("")
}</tr></thead><tbody></tbody></table></div>
<script>
(function(){
const COLS = ${JSON.stringify(columns)};
const ROWS = ${JSON.stringify(rows)};
const tbody = document.querySelector(".sview tbody");
const q = document.getElementById("q");
const countEl = document.getElementById("count");
let sortCol = COLS[0].thumb ? 1 : 0, sortDesc = false;

function cell(v, col) {
  // A card thumbnail, lazily loaded with explicit dimensions (no relayout as each arrives).
  if (col && col.thumb) {
    if (!v) return "";
    var i = '<img loading="lazy" decoding="async" width="35" height="48" src="' + v.img + '" alt="">';
    return v.href ? '<a href="' + v.href + '">' + i + '</a>' : i;
  }
  // A number with a bar showing where it sits against the column's maximum.
  if (col && col.bar && typeof v === "number") {
    var pct = Math.max(2, Math.round((v / col.bar) * 100));
    return esc(v.toLocaleString("en-US")) + '<span class="bars"><i style="width:' + Math.min(100, pct) + '%"></i></span>';
  }
  if (typeof v === "number") return esc(v.toLocaleString("en-US"));
  if (v && typeof v === "object") {
    var sym = v.sym ? '<img class="sym" src="' + v.sym + '" alt="">' : "";
    var t = esc(v.text == null || v.text === "" ? "—" : v.text) + (v.mark ? " " + esc(v.mark) : "");
    return sym + (v.href ? '<a href="' + v.href + '">' + t + '</a>' : t);
  }
  return esc(v == null || v === "" ? "—" : v);
}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function valueOf(row, i) {
  const v = row[i];
  if (v && typeof v === "object" && v.key != null) return v.key;
  if (COLS[i].num) return (v == null || v === "") ? -Infinity : Number(v);
  return String((v && typeof v === "object") ? v.text : (v == null ? "" : v)).toLowerCase();
}
function render() {
  const needle = q.value.trim().toLowerCase();
  let rows = ROWS;
  if (needle) {
    rows = rows.filter((r) => r.some((v) => {
      const t = (v && typeof v === "object") ? v.text : v;
      return String(t == null ? "" : t).toLowerCase().includes(needle);
    }));
  }
  rows = rows.slice().sort((a, b) => {
    const x = valueOf(a, sortCol), y = valueOf(b, sortCol);
    if (x < y) return sortDesc ? 1 : -1;
    if (x > y) return sortDesc ? -1 : 1;
    return 0;
  });
  // Built as one string: appending ~1,700 rows node by node is visibly slow on a phone.
  tbody.innerHTML = rows.map((r) =>
    "<tr>" + r.map((v, i) => "<td" + (COLS[i].num ? ' class="right"' : COLS[i].thumb ? ' class="thumb"' : "") + ">" +
      cell(v, COLS[i]) + "</td>").join("") + "</tr>").join("");
  countEl.textContent = rows.length.toLocaleString("en-US") + " of " + ROWS.length.toLocaleString("en-US") +
    (needle ? " matching" : " rows");
  document.querySelectorAll(".sview th").forEach((th, i) => {
    th.classList.toggle("sorted", i === sortCol);
    th.classList.toggle("desc", i === sortCol && sortDesc);
  });
}
document.querySelectorAll(".sview th").forEach((th) => th.addEventListener("click", () => {
  const i = +th.dataset.i;
  if (COLS[i].thumb) return;
  if (i === sortCol) sortDesc = !sortDesc; else { sortCol = i; sortDesc = !!COLS[i].num; }
  render();
}));
q.addEventListener("input", render);
render();
})();
</script>`;
  return viewer.SHELL(title, body, route, []);
};

// ── units ────────────────────────────────────────────────────────────────────
// units.md columns: Unit | Class | Men | Attack | Defence | Morale | Cost | Upkeep | Variants
{
  const raw = parseTable("units.md", 9).filter((c) => /^\[/.test(c[0]));
  const rows = raw.map((c) => {
    const u = linkText(c[0]);
    // The card sits beside the name so the roster is scannable by eye. Derived from the
    // unit's own page link rather than re-slugging the name, so it cannot drift from it.
    const slug = (u.href || "").replace(/^units\//, "").replace(/\.md$/, "");
    const card = slug && fs.existsSync(path.join(OUT, "cards", `${slug}.png`))
      ? { img: `cards/${slug}.png`, href: u.href } : null;
    return [
      card,
      { text: u.text, href: u.href },
      c[1],
      numOf(c[2]), numOf(c[3]), numOf(c[4]), numOf(c[5]), numOf(c[6]), numOf(c[7]),
      numOf(c[8]) || 1,
    ];
  });
  // Bar maxima come from the data, not a guessed ceiling: RIS stats run far above vanilla
  // and a hardcoded scale would peg every bar at full.
  const maxOf = (i) => rows.reduce((m, r) => (typeof r[i] === "number" && r[i] > m ? r[i] : m), 0);
  const columns = [
    { label: "", thumb: true }, { label: "Unit" }, { label: "Class" },
    { label: "Men", num: true }, { label: "Attack", num: true, bar: maxOf(4) },
    { label: "Defence", num: true, bar: maxOf(5) }, { label: "Morale", num: true, bar: maxOf(6) },
    { label: "Cost", num: true }, { label: "Upkeep", num: true },
    { label: "Variants", num: true },
  ];
  fs.writeFileSync(path.join(OUT, "units.html"),
    PAGE("Unit roster, sortable", "Every unit in RIS. Click a column to sort, type to filter. " +
      "Defence skill runs far higher than in vanilla (median 19 against 3), so do not read it against vanilla intuition.",
      columns, rows, "/units.html", "[← wiki index](README.md) · [all units](units.md)"), "utf8");
  console.log(`units.html: ${rows.length.toLocaleString("en-US")} rows`);
}

// ── regions ──────────────────────────────────────────────────────────────────
// regions.md columns: Region | Settlement (★ capital) | Held by | Size | Population | Goods | Buildings
{
  const SIZE_RANK = { village: 1, town: 2, large_town: 3, city: 4, large_city: 5, huge_city: 6 };
  const raw = parseTable("regions.md", 7).filter((c) => /^\[/.test(c[0]));
  const rows = raw.map((c) => {
    const r = linkText(c[0]);
    const s = linkText(c[1]);
    const owner = linkText(c[2]);
    const size = linkText(c[3]);
    const sizeTok = size.href ? size.href.replace(/^sizes\//, "").replace(/\.md$/, "") : null;
    return [
      { text: r.text, href: r.href },
      { text: s.text, href: s.href, mark: s.mark || "" },
      owner.href ? { text: owner.text, href: owner.href } : owner.text.replace(/^_|_$/g, ""),
      size.href ? { text: size.text, href: size.href, key: SIZE_RANK[sizeTok] || 0 } : { text: "—", key: 0 },
      numOf(c[4]), numOf(c[5]), numOf(c[6]),
    ];
  });
  const columns = [
    { label: "Region" }, { label: "Settlement" }, { label: "Held by" }, { label: "Size" },
    { label: "Population", num: true }, { label: "Goods", num: true }, { label: "Buildings", num: true },
  ];
  fs.writeFileSync(path.join(OUT, "regions.html"),
    PAGE("Regions and settlements, sortable",
      "Every region with its settlement, as it stands at the campaign start. Click a heading to sort, type to filter. ★ marks a faction capital; Size sorts from village up.",
      columns, rows, "/regions.html", "[← wiki index](README.md) · [all regions and settlements](regions.md)"), "utf8");
  console.log(`regions.html: ${rows.length.toLocaleString("en-US")} rows`);
  if (rows.length < 1000) { console.error(`  FAILED: regions.html has ${rows.length} rows — regions.md's shape has changed`); process.exitCode = 1; }
}

// ── factions ─────────────────────────────────────────────────────────────────
// factions.md is no longer ONE table. It is a section per culture, each with its own
// four-column table (Faction | Settlements | Characters | Units), and this view read a
// five-column table that stopped existing — so it silently produced a page with a header and
// no rows. A count assertion below now refuses to write an empty one.
//
// Which is a better source anyway: the culture is in the section heading above each table, so
// this view gains a Culture column the flat table never had, and gains it without the markdown
// having to repeat the culture on all 230 rows.
{
  let body = "";
  try { body = fs.readFileSync(path.join(OUT, "factions.md"), "utf8"); } catch { /* stays empty */ }
  const rows = [];
  let culture = null;
  for (const line of body.split(/\r?\n/)) {
    // Two or three hashes: the culture headings are H3 so the viewer renders the page as one
    // list rather than 22 separate cards, and this view must not care which level they are at.
    const h = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    // The heading is "Gallic · 43 factions · 42 hold territory at the start"; the culture is the first part.
    if (h) { culture = h[1].split(" · ")[0].trim(); continue; }
    if (!/^\|/.test(line) || !culture) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length < 4 || !/^\[/.test(c[0])) continue;
    const f = linkText(c[0]);
    rows.push([{ text: f.text, href: f.href, sym: f.sym }, culture, numOf(c[1]), numOf(c[2]), numOf(c[3])]);
  }
  const columns = [
    { label: "Faction" }, { label: "Culture" }, { label: "Provinces", num: true },
    { label: "Characters", num: true }, { label: "Units", num: true },
  ];
  fs.writeFileSync(path.join(OUT, "factions.html"),
    PAGE("Factions, sortable", "Every playable faction, sortable by culture or by how much it starts with. " +
      "Units is the faction's own roster — what it can raise from its own buildings anywhere it holds a " +
      "settlement. It excludes regional units, which are gated on holding the right province rather than on " +
      "being anyone in particular: every faction has between 424 and 443 of those.",
      columns, rows, "/factions.html", "[← wiki index](README.md) · [all factions](factions.md)"), "utf8");
  console.log(`factions.html: ${rows.length.toLocaleString("en-US")} rows across ${new Set(rows.map((r) => r[1])).size} cultures`);
  if (rows.length < 200) {
    console.error(`  FAILED: factions.html has ${rows.length} rows — factions.md's shape has changed again`);
    process.exitCode = 1;
  }
}
