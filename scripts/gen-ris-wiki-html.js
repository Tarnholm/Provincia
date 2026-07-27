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
const OUT = valOf("--out", "C:/RIS/RIS/wiki");

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

const linkText = (cell) => {
  const m = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(cell);
  return m ? { text: m[1], href: m[2] } : { text: cell, href: null };
};
const numOf = (cell) => {
  const n = parseInt(String(cell).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

const PAGE = (title, intro, columns, rows, backLink) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — RIS wiki</title>
<style>
:root{--bg:#12141a;--panel:#181b22;--fg:#e9e6e0;--dim:#9a958c;--line:#2a2e37;
 --acc:#d9744f;--acc-soft:rgba(217,116,79,.12);--shadow:0 1px 3px rgba(0,0,0,.4)}
@media(prefers-color-scheme:light){:root{--bg:#faf9f7;--panel:#fff;--fg:#1c1e22;--dim:#5f6672;
 --line:#e2ded7;--acc:#b4502c;--acc-soft:rgba(180,80,44,.09);--shadow:0 1px 3px rgba(0,0,0,.07)}}
:root[data-theme="light"]{--bg:#faf9f7;--panel:#fff;--fg:#1c1e22;--dim:#5f6672;--line:#e2ded7;
 --acc:#b4502c;--acc-soft:rgba(180,80,44,.09);--shadow:0 1px 3px rgba(0,0,0,.07)}
:root[data-theme="dark"]{--bg:#12141a;--panel:#181b22;--fg:#e9e6e0;--dim:#9a958c;--line:#2a2e37;
 --acc:#d9744f;--acc-soft:rgba(217,116,79,.12);--shadow:0 1px 3px rgba(0,0,0,.4)}
*{box-sizing:border-box}
body{margin:0;padding:1.5rem 1.6rem 4rem;background:var(--bg);color:var(--fg);
 font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap}
h1{margin:0 0 .25rem;font-size:1.6rem;letter-spacing:-.01em}
p.intro{margin:.25rem 0 1.1rem;color:var(--dim);max-width:78ch;font-size:.92rem}
a{color:var(--acc)}
#theme{background:none;border:1px solid var(--line);border-radius:6px;color:var(--dim);
 cursor:pointer;font:inherit;font-size:.78rem;padding:.25rem .55rem}
.bar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:.8rem;
 position:sticky;top:0;background:var(--bg);padding:.5rem 0;z-index:5}
input,select{background:var(--panel);color:var(--fg);border:1px solid var(--line);
 border-radius:8px;padding:.42rem .65rem;font:inherit;font-size:.9rem}
input{min-width:18rem}
input:focus,select:focus{outline:2px solid var(--acc-soft);border-color:var(--acc)}
#count{color:var(--dim);font-size:.84rem;font-variant-numeric:tabular-nums}
/* Sized to content, not stretched, but with FIXED layout: these tables run to over a thousand
   rows, and content-based column sizing makes the browser measure every row — that pegged a
   CPU core and made the pointer stutter on the unit roster. Fixed layout takes the widths from
   the header row. Wide tables still scroll inside the wrapper. */
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel);
 box-shadow:var(--shadow);max-width:100%}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.89rem}
td{overflow:hidden;text-overflow:ellipsis}
th,td{padding:.38rem .7rem;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{position:sticky;top:0;background:var(--bg);cursor:pointer;user-select:none;
 font-size:.76rem;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);font-weight:600}
th[data-num],td[data-num]{text-align:right;font-variant-numeric:tabular-nums}
th:hover{color:var(--acc)}
th.sorted{color:var(--acc)}
th.sorted::after{content:" \\25B2"}
th.sorted.desc::after{content:" \\25BC"}
tbody tr:hover{background:var(--acc-soft)}
tbody tr:last-child td{border-bottom:none}
/* Rows off-screen are skipped until scrolled to. With 1,172 rows and a hover rule, moving the
   pointer restyled and repainted rows nobody was looking at, which made the cursor stutter.
   contain-intrinsic-size keeps the scrollbar length honest for the skipped rows. */
tbody tr{content-visibility:auto;contain-intrinsic-size:auto 2.05rem}
.wrap{contain:paint}
td.thumb{padding:.15rem .4rem;width:2.6rem}
td.thumb img{display:block;width:35px;height:48px;border-radius:4px;background:var(--bg)}
.bars{display:inline-block;width:3.4rem;height:.4rem;border-radius:3px;background:var(--line);
 vertical-align:middle;margin-left:.45rem;overflow:hidden}
.bars i{display:block;height:100%;background:var(--acc)}
@media(max-width:700px){body{padding:1rem .8rem 3rem}input{min-width:11rem}}
</style></head><body>
<div class="head">
  <div>
    <h1>${esc(title)}</h1>
    <p class="intro">${intro} <a href="${backLink}">Back to the wiki index</a>.</p>
  </div>
  <button id="theme" type="button" title="Switch theme">theme</button>
</div>
<div class="bar">
  <input id="q" type="search" placeholder="Filter…" autocomplete="off">
  <span id="count"></span>
</div>
<div class="wrap"><table><thead><tr>${
  columns.map((c, i) => `<th data-i="${i}"${c.num ? ' data-num=""' : ""}>${esc(c.label)}</th>`).join("")
}</tr></thead><tbody></tbody></table></div>
<script>
(function(){
  var k="ris-wiki-theme", s=localStorage.getItem(k);
  if(s) document.documentElement.setAttribute("data-theme", s);
  document.getElementById("theme").addEventListener("click", function(){
    var cur = document.documentElement.getAttribute("data-theme");
    if(!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(k, next);
  });
})();
const COLS = ${JSON.stringify(columns)};
const ROWS = ${JSON.stringify(rows)};
const tbody = document.querySelector("tbody");
const q = document.getElementById("q");
const countEl = document.getElementById("count");
let sortCol = 0, sortDesc = false;

function cell(v, col) {
  // A card thumbnail, lazily loaded: 1,172 of them would otherwise all be fetched at once.
  if (col && col.thumb) {
    if (!v) return "";
    // Explicit dimensions: without them every lazy image that arrives changes its row's
    // height and reflows the table, so 1,132 loads meant 1,132 relayouts of a 1,172-row
    // table. The cards are 164x224, so 35x48 keeps the aspect ratio.
    var i = '<img loading="lazy" decoding="async" width="35" height="48" src="' + v.img + '" alt="">';
    return v.href ? '<a href="' + v.href + '">' + i + '</a>' : i;
  }
  // A number with a bar showing where it sits against the column's maximum, so a roster
  // sorted by attack reads as a shape and not just digits.
  if (col && col.bar && typeof v === "number") {
    var pct = Math.max(2, Math.round((v / col.bar) * 100));
    return esc(v.toLocaleString("en-US")) +
      '<span class="bars"><i style="width:' + Math.min(100, pct) + '%"></i></span>';
  }
  if (v && typeof v === "object" && v.href) return '<a href="' + v.href + '">' + esc(v.text) + '</a>';
  const t = (v && typeof v === "object") ? v.text : v;
  return esc(t == null || t === "" ? "—" : t);
}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function valueOf(row, i) {
  const v = row[i];
  if (COLS[i].num) return (v == null || v === "") ? -Infinity : Number(v);
  return String((v && typeof v === "object") ? v.text : (v ?? "")).toLowerCase();
}
function render() {
  const needle = q.value.trim().toLowerCase();
  let rows = ROWS;
  if (needle) {
    rows = rows.filter((r) => r.some((v) => {
      const t = (v && typeof v === "object") ? v.text : v;
      return String(t ?? "").toLowerCase().includes(needle);
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
    "<tr>" + r.map((v, i) => "<td" + (COLS[i].num ? ' data-num=""' : "") +
      (COLS[i].thumb ? ' class="thumb"' : "") + ">" + cell(v, COLS[i]) + "</td>").join("") + "</tr>"
  ).join("");
  countEl.textContent = rows.length.toLocaleString("en-US") + " of " + ROWS.length.toLocaleString("en-US") +
    (needle ? " matching" : " rows");
  document.querySelectorAll("th").forEach((th, i) => {
    th.classList.toggle("sorted", i === sortCol);
    th.classList.toggle("desc", i === sortCol && sortDesc);
  });
}
document.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
  const i = +th.dataset.i;
  if (i === sortCol) sortDesc = !sortDesc; else { sortCol = i; sortDesc = !!COLS[i].num; }
  render();
}));
q.addEventListener("input", render);
render();
</script>
</body></html>
`;

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
    PAGE("Unit roster", "Every unit in RIS. Click a column to sort, type to filter. " +
      "Defence skill runs far higher than in vanilla (median 19 against 3), so do not read it against vanilla intuition.",
      columns, rows, "README.md"), "utf8");
  console.log(`units.html: ${rows.length.toLocaleString("en-US")} rows`);
}

// ── regions ──────────────────────────────────────────────────────────────────
// regions.md columns: Region | Settlement | Held by | Trade resources | Buildings
{
  const raw = parseTable("regions.md", 5).filter((c) => /^\[/.test(c[0]));
  const rows = raw.map((c) => {
    const r = linkText(c[0]);
    const owner = linkText(c[2]);
    return [
      { text: r.text, href: r.href },
      c[1],
      owner.href ? { text: owner.text, href: owner.href } : owner.text.replace(/^_|_$/g, ""),
      numOf(c[3]), numOf(c[4]),
    ];
  });
  const columns = [
    { label: "Region" }, { label: "Settlement" }, { label: "Held by" },
    { label: "Trade resources", num: true }, { label: "Buildings", num: true },
  ];
  fs.writeFileSync(path.join(OUT, "regions.html"),
    PAGE("Regions", "All RIS regions and who holds them at the campaign start. Click a column to sort, type to filter.",
      columns, rows, "README.md"), "utf8");
  console.log(`regions.html: ${rows.length.toLocaleString("en-US")} rows`);
}

// ── factions ─────────────────────────────────────────────────────────────────
// factions.md columns: Faction | Settlements | Characters | Faction units | Regional (AOR)
// The unit count used to be one column. Splitting it in the markdown without splitting it
// here would have left this view reading the AOR count as the whole roster.
{
  const raw = parseTable("factions.md", 5).filter((c) => /^\[/.test(c[0]));
  const rows = raw.map((c) => {
    const f = linkText(c[0]);
    return [{ text: f.text, href: f.href }, numOf(c[1]), numOf(c[2]), numOf(c[3]), numOf(c[4])];
  });
  const columns = [
    { label: "Faction" }, { label: "Settlements", num: true },
    { label: "Characters", num: true }, { label: "Faction units", num: true },
    { label: "Regional (AOR)", num: true },
  ];
  fs.writeFileSync(path.join(OUT, "factions.html"),
    PAGE("Factions", "Every playable faction, sortable by how much it starts with. " +
      "Faction units are the roster a faction can raise anywhere it holds a settlement; regional (AOR) units " +
      "need a province carrying the right hidden resource, and are mostly open to everyone on paper.",
      columns, rows, "README.md"), "utf8");
  console.log(`factions.html: ${rows.length.toLocaleString("en-US")} rows`);
}
