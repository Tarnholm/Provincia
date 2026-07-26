#!/usr/bin/env node
/**
 * Serve the RIS wiki locally, rendering the markdown so it reads like a site rather than a
 * folder of text files.
 *
 *   node scripts/serve-ris-wiki.js [--out <dir>] [--port 8099]
 *
 * A plain file server is not enough: browsers show a .md file as plain text, and the wiki is
 * mostly tables. So markdown is converted on the fly. No dependencies — nothing is installed
 * in this repo and a preview tool is not worth adding one.
 *
 * The renderer covers what these pages actually use (headings, tables, links, images,
 * blockquotes, lists, bold/italic, inline code, and the raw HTML the generators embed for
 * cards and <details> blocks) rather than all of CommonMark. Anything it does not recognise
 * passes through as text, so an unhandled construct looks plain rather than disappearing.
 *
 * Search is server-side over a title index built at startup: 2,700 pages is small enough to
 * scan in memory, and that avoids shipping a search bundle for a preview tool.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(valOf("--out", "C:/RIS/RIS/wiki"));
const PORT = parseInt(valOf("--port", "8099"), 10);

if (!fs.existsSync(ROOT)) { console.error(`wiki not found: ${ROOT}`); process.exit(2); }

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".json": "application/json",
  ".css": "text/css", ".js": "text/javascript",
};

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── search index ─────────────────────────────────────────────────────────────
// Built once at startup: every .md page with its H1. Cheap enough (~2,700 files) that it is
// not worth watching for changes, and a regenerated wiki is a server restart away.
const INDEX = [];
(function indexPages(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { indexPages(p); continue; }
    if (!/\.md$/i.test(e.name)) continue;
    let title = e.name.replace(/\.md$/i, "");
    try {
      const head = fs.readFileSync(p, "utf8").slice(0, 400);
      const m = /^#\s+(.+)$/m.exec(head);
      if (m) title = m[1].trim();
    } catch { /* keep the filename */ }
    const rel = "/" + path.relative(ROOT, p).split(path.sep).join("/");
    INDEX.push({ title, rel, section: rel.split("/")[1] === path.basename(rel) ? "overview" : rel.split("/")[1] });
  }
})(ROOT);

function search(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const e of INDEX) {
    const t = e.title.toLowerCase();
    if (t === needle) hits.push({ ...e, score: 0 });
    else if (t.startsWith(needle)) hits.push({ ...e, score: 1 });
    else if (t.includes(needle)) hits.push({ ...e, score: 2 });
    else if (e.rel.toLowerCase().includes(needle)) hits.push({ ...e, score: 3 });
  }
  return hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, 200);
}

// ── markdown ─────────────────────────────────────────────────────────────────
// Inline spans. Images before links, since ![]() also matches []().
function inline(s) {
  let t = esc(s);
  // Restore the raw HTML the generators embed: <img> on region and unit pages, and the <a>
  // that wraps a unit's roster card so a click shows its info card.
  t = t.replace(/&lt;img([^&]*?)&gt;/g, "<img$1>");
  t = t.replace(/&lt;a\s([^&]*?)&gt;/g, "<a $1>").replace(/&lt;\/a&gt;/g, "</a>");
  t = t.replace(/&lt;(\/?)(strong|em|code|br|sub|sup)&gt;/g, "<$1$2>");
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, src) => `<img src="${src}" alt="${a}">`);
  t = t.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_, txt, href) => `<a href="${href}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|\s)_([^_]+)_/g, "$1<em>$2</em>");
  return t;
}

// Block-level raw HTML the pages use for collapsible sections. Emitted verbatim, with the
// markdown inside still processed — the faction pages put tables inside <details>, and
// escaping these printed a literal "<details>" above every folded block.
// Matches a bare open/close tag on its own line AND a complete one-line <summary>…</summary>,
// which is how the faction pages write their fold labels. Without the second form the label
// rendered as a literal "&lt;summary&gt;…" line above every collapsible table.
const RAW_BLOCK = /^\s*(<\/?(?:details|summary|div|p|br|hr)\b[^>]*>|<summary[^>]*>.*<\/summary>)\s*$/i;

function slugId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Each `## ` section becomes its own grid item so that on a wide screen they sit side by side
// instead of stacking down a 62rem column with the rest of the monitor empty. The number of
// columns is decided by CSS from the viewport, so it adapts to whatever resolution and aspect
// ratio the reader has rather than being fixed here. Everything before the first `## ` is the
// lede and spans the full width.
function sectionise(html) {
  const parts = html.split(/(?=<h2 )/);
  if (parts.length < 2) return html;
  const lede = parts[0].trim();
  const secs = parts.slice(1).map((s) => {
    // A table with more than four columns does not fit half a screen, so give that section the
    // whole row instead of forcing it to scroll sideways inside a narrow column.
    const firstRow = /<thead><tr>(.*?)<\/tr>/.exec(s);
    const cols = firstRow ? (firstRow[1].match(/<th/g) || []).length : 0;
    return `<section class="sec${cols > 4 ? " wide" : ""}">${s.trim()}</section>`;
  }).join("");
  return `${lede ? `<div class="lede">${lede}</div>` : ""}<div class="cols">${secs}</div>`;
}

function renderMarkdown(md, toc) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (RAW_BLOCK.test(line)) {
      // <summary> holds inline markdown worth rendering rather than dumping raw.
      const sm = /^\s*<summary([^>]*)>(.*)<\/summary>\s*$/i.exec(line);
      out.push(sm ? `<summary${sm[1]}>${inline(sm[2])}</summary>` : line.trim());
      i++; continue;
    }

    // Table: a header row followed by a separator row of dashes/colons.
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
      const head = cells(line);
      // Alignment from the separator row, so numeric columns stay right-aligned.
      const align = cells(lines[i + 1]).map((c) => (/^-+:$/.test(c) ? "right" : /^:-+:$/.test(c) ? "center" : ""));
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      const th = head.map((h, k) => `<th${align[k] ? ` class="${align[k]}"` : ""}>${inline(h)}</th>`).join("");
      const tr = body.map((r) => "<tr>" + r.map((c, k) =>
        `<td${align[k] ? ` class="${align[k]}"` : ""}>${inline(c)}</td>`).join("") + "</tr>").join("");
      out.push(`<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    let m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length, text = inline(m[2]), id = slugId(m[2]);
      if (level === 2 && toc) toc.push({ id, text });
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push("<ul>" + buf.map((b) => `<li>${inline(b)}</li>`).join("") + "</ul>");
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }

    // Paragraph: consume until a blank line or a construct that starts a new block.
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^#{1,6}\s/.test(lines[i]) && !/^\|/.test(lines[i]) &&
           !/^\s*>/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i]) &&
           !RAW_BLOCK.test(lines[i])) { buf.push(lines[i]); i++; }
    if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

// ── shell ────────────────────────────────────────────────────────────────────
const CSS = `
:root{
  --bg:#12141a; --panel:#181b22; --fg:#e9e6e0; --dim:#9a958c; --line:#2a2e37;
  --acc:#d9744f; --acc-soft:rgba(217,116,79,.12); --shadow:0 1px 3px rgba(0,0,0,.4);
}
@media(prefers-color-scheme:light){
  :root{--bg:#faf9f7; --panel:#fff; --fg:#1c1e22; --dim:#5f6672; --line:#e2ded7;
        --acc:#b4502c; --acc-soft:rgba(180,80,44,.09); --shadow:0 1px 3px rgba(0,0,0,.07)}
}
:root[data-theme="light"]{--bg:#faf9f7;--panel:#fff;--fg:#1c1e22;--dim:#5f6672;--line:#e2ded7;
  --acc:#b4502c;--acc-soft:rgba(180,80,44,.09);--shadow:0 1px 3px rgba(0,0,0,.07)}
:root[data-theme="dark"]{--bg:#12141a;--panel:#181b22;--fg:#e9e6e0;--dim:#9a958c;--line:#2a2e37;
  --acc:#d9744f;--acc-soft:rgba(217,116,79,.12);--shadow:0 1px 3px rgba(0,0,0,.4)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}

/* top bar */
.top{position:sticky;top:0;z-index:20;background:var(--panel);border-bottom:1px solid var(--line);
  display:flex;gap:1rem;align-items:center;padding:.55rem 1rem;box-shadow:var(--shadow)}
.brand{font-weight:650;letter-spacing:.01em;color:var(--fg);text-decoration:none;white-space:nowrap}
.brand span{color:var(--acc)}
.top form{flex:1;display:flex;max-width:34rem}
.top input{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--line);
  border-radius:8px;padding:.42rem .7rem;font:inherit;font-size:.9rem}
.top input:focus{outline:2px solid var(--acc-soft);border-color:var(--acc)}
.top .right{display:flex;gap:.9rem;align-items:center;font-size:.82rem;color:var(--dim)}
.top .right a{color:var(--dim);text-decoration:none}
.top .right a:hover{color:var(--acc)}
#theme{background:none;border:1px solid var(--line);border-radius:6px;color:var(--dim);
  cursor:pointer;font:inherit;font-size:.78rem;padding:.2rem .5rem}

/* layout */
.wrap{display:grid;grid-template-columns:15rem minmax(0,1fr);gap:0;align-items:start}
nav.side{position:sticky;top:3.1rem;height:calc(100vh - 3.1rem);overflow-y:auto;
  border-right:1px solid var(--line);padding:1.1rem .9rem 3rem;font-size:.88rem;background:var(--bg)}
nav.side h4{margin:1.1rem 0 .35rem;font-size:.7rem;text-transform:uppercase;
  letter-spacing:.09em;color:var(--dim);font-weight:600}
nav.side h4:first-child{margin-top:0}
nav.side a{display:block;color:var(--fg);text-decoration:none;padding:.2rem .45rem;
  border-radius:6px;line-height:1.4}
nav.side a:hover{background:var(--acc-soft);color:var(--acc)}
nav.side a.on{background:var(--acc-soft);color:var(--acc);font-weight:600}
/* Use the width that is there. The cap is generous rather than absent so a 4K monitor does
   not produce one absurdly wide column on a page that has only a single section. */
main{min-width:0;padding:1.6rem 2.2rem 5rem;max-width:132rem;margin:0 auto;width:100%}

/* Sections flow into as many columns as the viewport can take at a readable width. The
   browser decides the count from minmax(), so this responds to the reader's own resolution
   and aspect ratio: one column on a laptop in portrait, two on 1080p, three or more on a
   wide desktop. align-items:start keeps a short section from stretching to match a tall one. */
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(31rem,1fr));
  gap:0 2.8rem;align-items:start}
.sec{min-width:0}
.sec>h2:first-child{margin-top:1.2rem}
.lede{max-width:74ch}
/* A section holding a wide table is allowed to take the whole row rather than being squeezed
   — the roster and building tables have more columns than a half-width column can show. */
.sec.wide{grid-column:1/-1}

/* content */
.crumb{font-size:.8rem;color:var(--dim);margin-bottom:.5rem}
.crumb a{color:var(--dim);text-decoration:none}
.crumb a:hover{color:var(--acc)}
h1{font-size:1.85rem;line-height:1.25;margin:.1rem 0 .9rem;letter-spacing:-.01em}
h2{font-size:1.28rem;margin:2.1rem 0 .6rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
h3{font-size:1.06rem;margin:1.5rem 0 .45rem;color:var(--fg)}
a{color:var(--acc)}
p{margin:.7rem 0}
code{background:var(--acc-soft);color:var(--fg);padding:.08rem .32rem;border-radius:4px;
  font-size:.85em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
blockquote{margin:1rem 0;padding:.65rem .95rem;border-left:3px solid var(--acc);
  background:var(--acc-soft);border-radius:0 6px 6px 0}
blockquote p{margin:.25rem 0}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:8px;margin:.9rem 0;
  background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{padding:.42rem .7rem;text-align:left;vertical-align:middle;border-bottom:1px solid var(--line)}
th{background:var(--bg);position:sticky;top:0;font-weight:600;font-size:.82rem;
  text-transform:uppercase;letter-spacing:.04em;color:var(--dim);white-space:nowrap}
td.right,th.right{text-align:right;font-variant-numeric:tabular-nums}
td.center,th.center{text-align:center}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--acc-soft)}
img{max-width:100%;height:auto;vertical-align:middle}
img[align="right"]{margin:0 0 1rem 1.4rem;border-radius:8px;box-shadow:var(--shadow)}
a:has(img){display:inline-block}
ul{margin:.5rem 0 .5rem 1.3rem;padding:0}
li{margin:.16rem 0}
details{margin:.9rem 0;border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:.1rem .9rem}
details[open]{padding-bottom:.6rem}
summary{cursor:pointer;padding:.55rem 0;font-size:.92rem;color:var(--acc)}
summary:hover{color:var(--fg)}
details .tw{border:none;background:none}
hr{border:none;border-top:1px solid var(--line);margin:2rem 0}

/* search results */
.res{list-style:none;margin:0;padding:0}
.res li{border-bottom:1px solid var(--line);padding:.5rem .2rem}
.res .sec{color:var(--dim);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}

@media(max-width:900px){
  .wrap{grid-template-columns:1fr}
  nav.side{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line);
    max-height:12rem}
  main{padding:1.2rem 1.1rem 4rem}
  .top .right{display:none}
}
`;

const NAV = [
  ["Start here", [["/README.md", "Wiki index"], ["/factions.md", "All factions"],
    ["/regions.md", "All regions"], ["/units.md", "All units"], ["/buildings.md", "All buildings"]]],
  ["Overviews", [["/factions-overview.md", "Factions vs vanilla"], ["/map-and-regions.md", "The map"],
    ["/units-overview.md", "Roster vs vanilla"]]],
  ["Sortable views", [["/units.html", "Unit roster"], ["/regions.html", "Regions"],
    ["/factions.html", "Factions"]]],
];

function navHtml(rel) {
  const parts = [];
  for (const [heading, items] of NAV) {
    const links = items.filter(([href]) => fs.existsSync(path.join(ROOT, href.slice(1))));
    if (!links.length) continue;
    parts.push(`<h4>${esc(heading)}</h4>` + links
      .map(([href, label]) => `<a href="${href}"${href === rel ? ' class="on"' : ""}>${esc(label)}</a>`)
      .join(""));
  }
  return parts.join("");
}

// A page deep in factions/ or units/ gets a trail back up, which the flat "Index ·" bar
// never gave: 2,700 pages and no sense of where you are.
function crumbs(rel) {
  const segs = rel.replace(/^\//, "").split("/");
  const out = [`<a href="/README.md">RIS wiki</a>`];
  if (segs.length > 1) {
    const section = segs[0];
    const overview = ["factions", "regions", "units", "buildings"].includes(section)
      ? `/${section}.md` : null;
    out.push(overview && fs.existsSync(path.join(ROOT, overview.slice(1)))
      ? `<a href="${overview}">${esc(section)}</a>` : esc(section));
  }
  return `<div class="crumb">${out.join(" › ")}</div>`;
}

const SHELL = (title, body, rel, toc) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — RIS wiki</title>
<style>${CSS}</style></head><body>
<div class="top">
  <a class="brand" href="/README.md">RIS <span>wiki</span></a>
  <form action="/search" method="get" role="search">
    <input name="q" type="search" placeholder="Search ${INDEX.length.toLocaleString("en-US")} pages — a faction, region or unit…" autocomplete="off">
  </form>
  <div class="right">
    <button id="theme" type="button" title="Switch theme">theme</button>
    <span>local preview</span>
  </div>
</div>
<div class="wrap">
  <nav class="side">${navHtml(rel)}</nav>
  <main>${crumbs(rel)}${body}</main>
</div>
<script>
// Theme choice persists across pages; the OS preference is the default.
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
  // "/" focuses search, as on every docs site.
  document.addEventListener("keydown", function(e){
    if(e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)){
      e.preventDefault(); document.querySelector('.top input').focus();
    }
  });
})();
</script>
</body></html>
`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let rel = decodeURIComponent(url.pathname);

  if (rel === "/search") {
    const q = url.searchParams.get("q") || "";
    const hits = search(q);
    const body = `<h1>Search</h1><p>${hits.length
      ? `${hits.length}${hits.length === 200 ? "+" : ""} page${hits.length === 1 ? "" : "s"} matching <code>${esc(q)}</code>.`
      : `Nothing matches <code>${esc(q)}</code>.`}</p>` +
      (hits.length ? `<ul class="res">${hits.map((h) =>
        `<li><a href="${h.rel}">${esc(h.title)}</a> <span class="sec">${esc(h.section)}</span></li>`).join("")}</ul>` : "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SHELL(`Search: ${q}`, body, "/search"));
    return;
  }

  if (rel === "/" || rel === "") rel = "/README.md";
  // Keep every request inside the wiki directory.
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("outside the wiki"); return; }

  let st = null;
  try { st = fs.statSync(file); } catch { /* missing */ }
  if (st && st.isDirectory()) { res.writeHead(302, { Location: path.posix.join(rel, "README.md") }); res.end(); return; }
  if (!st) {
    const near = search(path.basename(rel).replace(/\.md$/i, "")).slice(0, 10);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SHELL("Not found", `<h1>Not found</h1><p>No file at <code>${esc(rel)}</code>.</p>` +
      (near.length ? `<p>Did you mean:</p><ul class="res">${near.map((h) =>
        `<li><a href="${h.rel}">${esc(h.title)}</a> <span class="sec">${esc(h.section)}</span></li>`).join("")}</ul>`
        : `<p><a href="/README.md">Back to the index</a>.</p>`), rel));
    return;
  }

  const ext = path.extname(file).toLowerCase();
  if (ext === ".md") {
    const md = fs.readFileSync(file, "utf8");
    const title = (/^#\s+(.+)$/m.exec(md) || [, path.basename(file)])[1];
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SHELL(title, sectionise(renderMarkdown(md, [])), rel));
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

// Open the default browser unless --no-open. This is what makes the launcher scripts a
// one-click affair for someone who does not live in a terminal.
function openBrowser(url) {
  if (argv.includes("--no-open")) return;
  const { spawn } = require("child_process");
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try { spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref(); } catch { /* print the URL instead */ }
}

// If the chosen port is busy, step up rather than dying - a team member may already have
// a copy running, or something else may own 8099.
// The attempt has to advance. Retrying PORT + 1 every time meant that if that port was
// also busy the handler retried the same number forever, printing the same line on a loop.
let attempt = PORT;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && attempt < PORT + 40) {
    attempt += 1;
    console.log(`  port ${attempt - 1} is in use, trying ${attempt}`);
    setTimeout(() => server.listen(attempt, "127.0.0.1"), 50);
    return;
  }
  console.error(e.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/README.md`;
  console.log(`RIS wiki preview: ${url}`);
  console.log(`  serving ${ROOT}`);
  console.log(`  ${INDEX.length.toLocaleString("en-US")} pages indexed for search`);
  console.log(`  Ctrl+C to stop`);
  openBrowser(url);
});
