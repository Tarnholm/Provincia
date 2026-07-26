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
:root{--bg:#14161a;--fg:#e8e6e1;--dim:#9a958c;--line:#2b2f36;--acc:#d9744f}
@media(prefers-color-scheme:light){:root{--bg:#fbfaf8;--fg:#1d1f23;--dim:#5f6672;--line:#dcd8d2;--acc:#b4502c}}
*{box-sizing:border-box}
body{margin:0;padding:1.5rem;background:var(--bg);color:var(--fg);
 font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
h1{margin:0 0 .25rem;font-size:1.5rem}
p.intro{margin:.25rem 0 1rem;color:var(--dim);max-width:70ch}
a{color:var(--acc)}
.bar{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem}
input,select{background:var(--bg);color:var(--fg);border:1px solid var(--line);
 border-radius:6px;padding:.4rem .6rem;font:inherit}
input{min-width:16rem}
#count{color:var(--dim);font-size:.85rem}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{padding:.4rem .6rem;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{position:sticky;top:0;background:var(--bg);cursor:pointer;user-select:none}
th[data-num],td[data-num]{text-align:right}
th:hover{color:var(--acc)}
th.sorted::after{content:" \\25B2";color:var(--acc)}
th.sorted.desc::after{content:" \\25BC"}
tbody tr:hover{background:rgba(217,116,79,.09)}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="intro">${intro} <a href="${backLink}">Back to the wiki index</a>.</p>
<div class="bar">
  <input id="q" type="search" placeholder="Filter…" autocomplete="off">
  <span id="count"></span>
</div>
<div class="wrap"><table><thead><tr>${
  columns.map((c, i) => `<th data-i="${i}"${c.num ? ' data-num=""' : ""}>${esc(c.label)}</th>`).join("")
}</tr></thead><tbody></tbody></table></div>
<script>
const COLS = ${JSON.stringify(columns)};
const ROWS = ${JSON.stringify(rows)};
const tbody = document.querySelector("tbody");
const q = document.getElementById("q");
const countEl = document.getElementById("count");
let sortCol = 0, sortDesc = false;

function cell(v, col) {
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
    "<tr>" + r.map((v, i) => "<td" + (COLS[i].num ? ' data-num=""' : "") + ">" + cell(v, COLS[i]) + "</td>").join("") + "</tr>"
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
    return [
      { text: u.text, href: u.href },
      c[1],
      numOf(c[2]), numOf(c[3]), numOf(c[4]), numOf(c[5]), numOf(c[6]), numOf(c[7]),
      numOf(c[8]) || 1,
    ];
  });
  const columns = [
    { label: "Unit" }, { label: "Class" },
    { label: "Men", num: true }, { label: "Attack", num: true }, { label: "Defence", num: true },
    { label: "Morale", num: true }, { label: "Cost", num: true }, { label: "Upkeep", num: true },
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
// factions.md columns: Faction | Settlements | Characters | Recruitable units
{
  const raw = parseTable("factions.md", 4).filter((c) => /^\[/.test(c[0]));
  const rows = raw.map((c) => {
    const f = linkText(c[0]);
    return [{ text: f.text, href: f.href }, numOf(c[1]), numOf(c[2]), numOf(c[3])];
  });
  const columns = [
    { label: "Faction" }, { label: "Settlements", num: true },
    { label: "Characters", num: true }, { label: "Recruitable units", num: true },
  ];
  fs.writeFileSync(path.join(OUT, "factions.html"),
    PAGE("Factions", "Every playable faction, sortable by how much it starts with.",
      columns, rows, "README.md"), "utf8");
  console.log(`factions.html: ${rows.length.toLocaleString("en-US")} rows`);
}
