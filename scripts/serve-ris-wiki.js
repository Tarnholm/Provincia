#!/usr/bin/env node
/**
 * Serve the RIS wiki locally, rendering the markdown so it looks roughly like GitHub Pages.
 *
 *   node scripts/serve-ris-wiki.js [--out <dir>] [--port 8099]
 *
 * A plain file server is not enough: browsers show a .md file as plain text, and the wiki
 * is mostly tables. So markdown is converted on the fly. No dependencies — nothing is
 * installed in this repo and a preview tool is not worth adding one.
 *
 * The renderer covers what these pages actually use (headings, tables, links, images,
 * blockquotes, lists, bold/italic, inline code) rather than all of CommonMark. Anything it
 * does not recognise passes through as text, so an unhandled construct looks plain rather
 * than disappearing.
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

// Inline spans. Images before links, since ![]() also matches []().
function inline(s) {
  let t = esc(s);
  // Restore <img …> tags the pages embed directly — the region and unit pages use them.
  t = t.replace(/&lt;img([^&]*?)&gt;/g, "<img$1>");
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, src) => `<img src="${src}" alt="${a}">`);
  t = t.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_, txt, href) => `<a href="${href}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|\s)_([^_]+)_/g, "$1<em>$2</em>");
  return t;
}

function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Table: a header row followed by a separator row of dashes/colons.
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push("<table><thead><tr>" + head.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>" +
        body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>");
      continue;
    }

    let m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }

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
           !/^\s*>/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i])) { buf.push(lines[i]); i++; }
    if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const SHELL = (title, body, rel) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — RIS wiki (local preview)</title>
<style>
:root{--bg:#14161a;--fg:#e8e6e1;--dim:#9a958c;--line:#2b2f36;--acc:#d9744f}
@media(prefers-color-scheme:light){:root{--bg:#fbfaf8;--fg:#1d1f23;--dim:#5f6672;--line:#dcd8d2;--acc:#b4502c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
 font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.top{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);
 padding:.6rem 1.2rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:center;font-size:.85rem}
.top a{color:var(--acc);text-decoration:none}
.top .tag{color:var(--dim)}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1.2rem 4rem}
h1{font-size:1.7rem;margin:.2rem 0 1rem}
h2{font-size:1.25rem;margin:1.8rem 0 .6rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
h3{font-size:1.05rem;margin:1.4rem 0 .5rem}
a{color:var(--acc)}
code{background:rgba(150,150,150,.16);padding:.1rem .35rem;border-radius:4px;font-size:.87em}
blockquote{margin:.9rem 0;padding:.6rem .9rem;border-left:3px solid var(--acc);
 background:rgba(217,116,79,.08);color:var(--fg)}
blockquote p{margin:.3rem 0}
table{border-collapse:collapse;width:100%;margin:.8rem 0;font-size:.9rem;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:.35rem .6rem;text-align:left;vertical-align:middle}
th{background:rgba(150,150,150,.1)}
img{max-width:100%;vertical-align:middle}
ul{margin:.5rem 0 .5rem 1.2rem;padding:0}
li{margin:.15rem 0}
</style></head><body>
<div class="top">
  <a href="/README.md">Index</a>
  <a href="/factions.md">Factions</a>
  <a href="/regions.md">Regions</a>
  <a href="/units.md">Units</a>
  <a href="/buildings.md">Buildings</a>
  <span class="tag">|</span>
  <a href="/units.html">Units (sortable)</a>
  <a href="/regions.html">Regions (sortable)</a>
  <a href="/factions.html">Factions (sortable)</a>
  <span class="tag">local preview · ${esc(rel)}</span>
</div>
<main>${body}</main>
</body></html>
`;

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/README.md";
  // Keep every request inside the wiki directory.
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("outside the wiki"); return; }

  let st = null;
  try { st = fs.statSync(file); } catch { /* missing */ }
  if (st && st.isDirectory()) { res.writeHead(302, { Location: path.posix.join(rel, "README.md") }); res.end(); return; }
  if (!st) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SHELL("Not found", `<h1>Not found</h1><p>No file at <code>${esc(rel)}</code>.</p>` +
      `<p>The verifier reports 0 broken links, so this is probably a hand-typed URL. ` +
      `<a href="/README.md">Back to the index</a>.</p>`, rel));
    return;
  }

  const ext = path.extname(file).toLowerCase();
  if (ext === ".md") {
    const md = fs.readFileSync(file, "utf8");
    const title = (/^#\s+(.+)$/m.exec(md) || [, path.basename(file)])[1];
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SHELL(title, renderMarkdown(md), rel));
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
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && PORT < 8199) {
    console.log(`  port ${PORT} is in use, trying ${PORT + 1}`);
    setTimeout(() => server.listen(PORT + 1, "127.0.0.1"), 50);
    return;
  }
  console.error(e.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/README.md`;
  console.log(`RIS wiki preview: ${url}`);
  console.log(`  serving ${ROOT}`);
  console.log(`  markdown is rendered on the fly; the .html views are served as-is`);
  console.log(`  Ctrl+C to stop`);
  openBrowser(url);
});
