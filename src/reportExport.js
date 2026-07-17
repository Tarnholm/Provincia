// reportExport.js — shareable single-file HTML report builder (renderer, ESM).
//
// buildHtmlReport(data) → complete self-contained HTML document string.
// The output has NO external references (no http/https URLs, no CDN, no fonts):
// styling is an inline <style>, the map snapshot is an embedded data: URL, and
// table sorting is a tiny inline <script>. Safe to share in chat/GitLab and
// open from disk in any browser. Every user-supplied string is HTML-escaped.
//
// DATA CONTRACT (all sections optional — only what is provided is rendered):
// {
//   meta: {                       // header block (recommended, may be {})
//     title:      string,         // report headline; falls back to "Provincia report"
//     modName:    string,         // e.g. "RIS"
//     campaign:   string,         // e.g. "imperial_campaign"
//     appVersion: string,         // e.g. "0.9.1279"
//     date:       string,         // preformatted date; falls back to today (ISO)
//   },
//   mapPngDataUrl: string,        // "data:image/png;base64,..." campaign-map snapshot
//                                 // (anything not starting with "data:image/" is dropped)
//   factionRows: [{               // per-faction economy table (sortable)
//     name: string,               // display name
//     color: string,              // optional CSS color for the swatch — allow-listed
//                                 // (#hex / plain word / rgb()/rgba()); invalid → omitted
//     settlements: number,
//     income: number,
//     upkeep: number,
//     net: number,                // colored green (>= 0) / red (< 0)
//     verdict: string,            // optional free text, e.g. "OK (+312)" / "OVER by 90"
//   }],
//   settlementRows: [{            // settlement highlights table (sortable)
//     name: string, faction: string, pop: number, income: number, note: string?,
//   }],
//   victoryRows: [{               // victory progress rows (sortable + progress bar)
//     faction: string, pct: number (0–100), held: number, required: number,
//   }],
//   notes: string,                // free text; newlines preserved (rendered in <pre-wrap>)
// }
//
// No DOM, no Electron APIs — pure string building, so it is unit-testable in
// vitest and reusable from any context.

/** Escape a value for safe interpolation into HTML text/attributes. */
export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Number cell: thousands separators for readability. The inline sorter strips
// non-numeric chars before comparing, so separators don't break sorting.
const fmt = (n) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("en-US") : esc(n));

// Faction color swatch: only allow obviously-safe CSS color forms — a color
// string is interpolated into a style attribute, so it must never carry markup.
const safeColor = (c) => {
  const s = String(c || "").trim();
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/.test(s) ? s : null;
};

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #171310; color: #e8e4de;
         font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .report { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 2px; color: #e8c873; }
  h2 { font-size: 1.05rem; margin: 28px 0 8px; color: #cf8f6a;
       border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 4px; }
  .meta { color: #9a938a; font-size: 0.82rem; margin-bottom: 4px; }
  .meta b { color: #c5beb4; font-weight: 600; }
  .mapwrap { margin-top: 10px; }
  .mapwrap img { max-width: 100%; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { padding: 5px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.08); }
  th { color: #b8a878; font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; }
  th:hover { color: #e8c873; }
  th.s-asc::after { content: " \\25B4"; } th.s-desc::after { content: " \\25BE"; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: rgba(255,255,255,0.03); }
  .pos { color: #9ed6ad; } .neg { color: #e08a7a; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px;
        margin-right: 6px; vertical-align: baseline; border: 1px solid rgba(255,255,255,0.25); }
  .bar { background: rgba(255,255,255,0.08); border-radius: 4px; height: 10px; width: 140px;
         display: inline-block; vertical-align: middle; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #8fb46e; }
  .notes { white-space: pre-wrap; background: rgba(255,255,255,0.04);
           border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 12px 14px; }
  .foot { margin-top: 32px; color: #6f685f; font-size: 0.72rem;
          border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
  @media print {
    body { background: #fff; color: #1a1a1a; padding: 0; }
    h1 { color: #7a5a20; } h2 { color: #8a4a2a; border-color: #ccc; }
    .meta { color: #555; } .meta b { color: #222; }
    th { color: #6a5a2a; } th, td { border-color: #ddd; }
    .pos { color: #1a7a3a; } .neg { color: #b03020; }
    .notes { background: #f6f4f0; border-color: #ddd; }
    .bar { background: #e4e0da; } .foot { color: #888; border-color: #ccc; }
    tr, img { break-inside: avoid; }
  }
`;

// Click-a-header table sort — numeric-aware, toggles direction. Static script,
// no user data flows into it.
const SORT_SCRIPT = `
  document.querySelectorAll("table.sortable").forEach(function (t) {
    var ths = t.querySelectorAll("thead th");
    ths.forEach(function (th, i) {
      th.addEventListener("click", function () {
        var tb = t.tBodies[0];
        var rows = Array.prototype.slice.call(tb.rows);
        var dir = th.classList.contains("s-asc") ? -1 : 1;
        ths.forEach(function (h) { h.classList.remove("s-asc", "s-desc"); });
        th.classList.add(dir === 1 ? "s-asc" : "s-desc");
        rows.sort(function (a, b) {
          var x = a.cells[i].textContent.trim(), y = b.cells[i].textContent.trim();
          var nx = parseFloat(x.replace(/[^0-9.\\-]/g, "")), ny = parseFloat(y.replace(/[^0-9.\\-]/g, ""));
          if (isFinite(nx) && isFinite(ny)) return (nx - ny) * dir;
          return x.localeCompare(y) * dir;
        });
        rows.forEach(function (r) { tb.appendChild(r); });
      });
    });
  });
`;

const netCell = (n) => `<td class="num ${typeof n === "number" && n < 0 ? "neg" : "pos"}">${fmt(n)}</td>`;

function sectionFactions(rows) {
  const body = rows.map((r) => {
    const col = safeColor(r.color);
    const sw = col ? `<span class="sw" style="background:${esc(col)}"></span>` : "";
    return `<tr><td>${sw}${esc(r.name)}</td><td class="num">${fmt(r.settlements)}</td>` +
      `<td class="num">${fmt(r.income)}</td><td class="num">${fmt(r.upkeep)}</td>` +
      netCell(r.net) + `<td>${esc(r.verdict ?? "")}</td></tr>`;
  }).join("\n");
  return `<h2>Faction economy</h2>
<table class="sortable"><thead><tr><th>Faction</th><th class="num">Settlements</th><th class="num">Income</th><th class="num">Upkeep</th><th class="num">Net</th><th>Verdict</th></tr></thead>
<tbody>
${body}
</tbody></table>`;
}

function sectionSettlements(rows) {
  const body = rows.map((r) =>
    `<tr><td>${esc(r.name)}</td><td>${esc(r.faction)}</td><td class="num">${fmt(r.pop)}</td>` +
    `<td class="num">${fmt(r.income)}</td><td>${esc(r.note ?? "")}</td></tr>`
  ).join("\n");
  return `<h2>Settlement highlights</h2>
<table class="sortable"><thead><tr><th>Settlement</th><th>Faction</th><th class="num">Population</th><th class="num">Income</th><th>Note</th></tr></thead>
<tbody>
${body}
</tbody></table>`;
}

function sectionVictory(rows) {
  const body = rows.map((r) => {
    const pct = Math.max(0, Math.min(100, typeof r.pct === "number" ? r.pct : 0));
    return `<tr><td>${esc(r.faction)}</td>` +
      `<td><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span> ${pct.toFixed(0)}%</td>` +
      `<td class="num">${fmt(r.held)}</td><td class="num">${fmt(r.required)}</td></tr>`;
  }).join("\n");
  return `<h2>Victory progress</h2>
<table class="sortable"><thead><tr><th>Faction</th><th>Progress</th><th class="num">Held</th><th class="num">Required</th></tr></thead>
<tbody>
${body}
</tbody></table>`;
}

/**
 * Build the complete, self-contained HTML report document.
 * @param {object} data — see DATA CONTRACT above.
 * @returns {string} full HTML document, starting with <!DOCTYPE html>.
 */
export function buildHtmlReport(data) {
  const d = data || {};
  const meta = d.meta || {};
  const title = meta.title || "Provincia report";
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const metaBits = [
    meta.modName ? `Mod: <b>${esc(meta.modName)}</b>` : "",
    meta.campaign ? `Campaign: <b>${esc(meta.campaign)}</b>` : "",
    `Date: <b>${esc(date)}</b>`,
    meta.appVersion ? `Provincia v${esc(meta.appVersion)}` : "",
  ].filter(Boolean).join(" &middot; ");

  const sections = [];
  const mapUrl = typeof d.mapPngDataUrl === "string" && d.mapPngDataUrl.startsWith("data:image/")
    ? d.mapPngDataUrl : null;
  if (mapUrl) sections.push(`<h2>Map snapshot</h2>\n<div class="mapwrap"><img alt="Campaign map snapshot" src="${esc(mapUrl)}"></div>`);
  if (Array.isArray(d.factionRows) && d.factionRows.length) sections.push(sectionFactions(d.factionRows));
  if (Array.isArray(d.settlementRows) && d.settlementRows.length) sections.push(sectionSettlements(d.settlementRows));
  if (Array.isArray(d.victoryRows) && d.victoryRows.length) sections.push(sectionVictory(d.victoryRows));
  if (typeof d.notes === "string" && d.notes.trim()) sections.push(`<h2>Notes</h2>\n<div class="notes">${esc(d.notes)}</div>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="report">
<h1>${esc(title)}</h1>
<div class="meta">${metaBits}</div>
${sections.join("\n\n")}
<div class="foot">Generated by Provincia${meta.appVersion ? " v" + esc(meta.appVersion) : ""} &middot; ${esc(date)} &middot; single-file report, safe to share</div>
</div>
<script>${SORT_SCRIPT}</script>
</body>
</html>
`;
}

export default buildHtmlReport;
