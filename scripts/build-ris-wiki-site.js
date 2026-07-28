#!/usr/bin/env node
/**
 * Export the RIS wiki as a standalone static site: one .html per page, no server, no Node,
 * no install. Double-click index.html and it works.
 *
 *   node scripts/build-ris-wiki-site.js [--wiki <dir>] [--site <dir>] [--without cards,maps]
 *
 * WHY A STATIC EXPORT AND NOT AN APP. Two things fall out of one build. A folder (or a zip of
 * it) opens from `file://` on a machine with nothing installed, which is what "send it to a
 * friend" means; and the same folder is a GitHub Pages site, which is where this wiki is
 * headed anyway. Anything heavier — an Electron shell, a bundled server — buys neither.
 *
 * THE RENDERER IS NOT REIMPLEMENTED HERE. scripts/serve-ris-wiki.js exports its markdown
 * renderer, its section layout and its page shell, and this file requires them. A second
 * renderer would agree with the served one on the day it was written and drift from then on;
 * every layout decision in that file (the two-pane distribution, the dealt-across tables, the
 * scroll containers) would have to be duplicated and kept in step. So this file does exactly
 * one thing the server does not: it turns URLs that only a server can resolve into URLs a
 * plain folder can.
 *
 * WHAT HAS TO CHANGE FOR `file://`, and why each one is not optional:
 *
 *   1. Root-absolute paths. The shell writes `/README.md`, `/art/ris-mark.png` and
 *      `url(/art/ris-rule.png)`. Under `file://` a leading slash means the root of the DRIVE,
 *      so every one of those resolves to C:\README.md and the page loads with no logo, no
 *      rule under the title and a dead nav. They become paths relative to the page.
 *   2. `.md` targets. A browser shows a .md file as plain text — and there are 213,000 of
 *      these links. Rewritten to .html, fragment preserved.
 *   3. Directory indexes. `file://` has no "serve README.md for this folder" behaviour, so
 *      index.html at the root IS the README.
 *   4. Search. The served version searches on the server. There is no server here, so the
 *      title index is written out as a script and search.html filters it in the browser. A
 *      search box that silently does nothing would be worse than no search box.
 *
 * CSS AND THE PAGE SCRIPT ARE LIFTED OUT rather than inlined per page. The shell inlines
 * ~11 KB of stylesheet in every page; across the wiki's pages that is around 48 MB of the
 * same bytes repeated, on a site whose whole problem is its size. They go to wiki.css and
 * wiki.js, linked at the right depth.
 *
 * OUTPUT GOES OUTSIDE BOTH REPOSITORIES by default: C:/dev/ris-wiki-site, beside the
 * Provincia checkout rather than inside it. It is derived — every byte of it can be rebuilt
 * from the markdown in about two minutes — and it is about the same size as the wiki it is
 * built from, so committing it would roughly double the mod repo to store a second copy of
 * what is already in it. Being outside both trees is what makes that a fact rather than an
 * intention: no `git add -A` in either repo can reach it.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const QUIET = argv.includes("--quiet");
const WIKI = path.resolve(valOf("--wiki", "C:/RIS/RIS/wiki"));
const SITE = path.resolve(valOf("--site", "C:/dev/ris-wiki-site"));
// Top-level asset directories to leave out, for a build small enough to send. Named rather
// than inferred: `--without cards` drops the 104 MB of unit cards and nothing else.
const WITHOUT = new Set((valOf("--without", "") || "").split(",").map((s) => s.trim()).filter(Boolean));

const note = (s) => { if (!QUIET) console.log(s); };
const n = (x) => x.toLocaleString("en-US");

if (!fs.existsSync(WIKI)) { console.error(`wiki not found: ${WIKI}`); process.exit(2); }
if (path.resolve(SITE) === WIKI || SITE.startsWith(WIKI + path.sep)) {
  console.error(`refusing to build into the wiki itself: ${SITE}`); process.exit(2);
}

// ── the served renderer, without the server ──────────────────────────────────
// process.argv is swapped before the require. serve-ris-wiki.js parses `--out` off the real
// process.argv at load time to decide which wiki to read, so requiring it from a script that
// was itself given `--site <dir>` would be fine but `--out <dir>` would silently point the
// renderer's index and nav-existence checks at the OUTPUT directory — which does not exist
// yet, so it would exit(2) and take this process with it. Handing it an argv of our own
// making removes the coupling entirely: this script's flags cannot collide with its flags.
const viewer = (() => {
  const real = process.argv;
  process.argv = [real[0], real[1], "--out", WIKI, "--no-open"];
  try { return require("./serve-ris-wiki.js"); } finally { process.argv = real; }
})();
const { renderMarkdown, sectionise, SHELL, CSS, INDEX } = viewer;

// ── the pages ────────────────────────────────────────────────────────────────
const walk = (dir, hit) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hit); else hit(p);
  }
};
const relOf = (abs) => path.relative(WIKI, abs).split(path.sep).join("/");

const mdPages = [];        // wiki-relative posix paths, e.g. "units/hastati.md"
const staticHtml = [];     // .html files that were already in the wiki (the sortable views)
const allFiles = [];
walk(WIKI, (p) => {
  const r = relOf(p);
  allFiles.push(r);
  if (/\.md$/i.test(r)) mdPages.push(r);
  else if (/\.html$/i.test(r)) staticHtml.push(r);
});

// ── name collisions between a page and a pre-existing .html ──────────────────
// units.md and units.html both exist, as do the region and faction pairs: the markdown page
// is the written overview, the .html is the sortable table generated beside it. Exporting
// units.md to units.html would overwrite the sortable view with the overview and nothing
// would look broken — the surviving page is perfectly good on its own — which is precisely
// the failure verify-ris-wiki.js was written after. The markdown keeps the natural name
// because that is what 213,000 links point at; the sortable view moves aside.
const RENAMED = new Map();   // "units.html" -> "units-sortable.html"
for (const h of staticHtml) {
  if (mdPages.includes(h.replace(/\.html$/i, ".md"))) {
    RENAMED.set(h, h.replace(/\.html$/i, "-sortable.html"));
  }
}

// ── url rewriting ────────────────────────────────────────────────────────────
const SKIP_URL = /^(https?:|mailto:|data:|javascript:|#|\/\/)/i;
// An attribute value built by inline JavaScript rather than written as a path: the sortable
// views emit `href="' + v.href + '"` from a template, and search.html the same. These are not
// URLs, and treating them as such reported four files "missing" that were never referenced.
const IS_JS_TEMPLATE = (v) => /['"<>]/.test(v) || v.includes("+ ") || v.includes("${");

// A target as written on `fromRel`'s page, resolved to a wiki-root-relative posix path.
function toRootRel(fromRel, target) {
  if (target.startsWith("/")) return target.slice(1);
  const dir = path.posix.dirname(fromRel);
  return path.posix.normalize(dir === "." ? target : `${dir}/${target}`);
}

// What that path is called in the built site.
function outNameOf(rootRel) {
  if (/\.md$/i.test(rootRel)) return rootRel.replace(/\.md$/i, ".html");
  return RENAMED.get(rootRel) || rootRel;
}

const assetRefs = new Map();   // wiki-relative asset path -> reference count
const missing = new Map();     // referenced path -> [pages that reference it]
const notedMissing = (rootRel, fromRel) => {
  if (!missing.has(rootRel)) missing.set(rootRel, []);
  missing.get(rootRel).push(fromRel);
};

// Rewrite one URL for a page living at `fromRel` (wiki-relative, .md or .html).
function mapUrl(fromRel, raw) {
  if (!raw || SKIP_URL.test(raw) || IS_JS_TEMPLATE(raw)) return raw;
  // The shell's search form posts to a route only the server has.
  if (raw === "/search") raw = "/search.html";
  const hash = raw.indexOf("#");
  const frag = hash >= 0 ? raw.slice(hash) : "";
  const bare = hash >= 0 ? raw.slice(0, hash) : raw;
  if (!bare) return raw;

  const rootRel = toRootRel(fromRel, decodeURIComponent(bare));
  // Produced by this script rather than copied from the wiki, so their absence from the
  // source directory is not a missing reference.
  const produced = ["search.html", "index.html", "search-index.js", "wiki.css", "wiki.js"].includes(rootRel);
  if (!produced && !fs.existsSync(path.join(WIKI, rootRel))) notedMissing(rootRel, fromRel);
  else if (!produced && !/\.(md|html)$/i.test(rootRel)) {
    assetRefs.set(rootRel, (assetRefs.get(rootRel) || 0) + 1);
  }

  const out = outNameOf(rootRel);
  const fromDir = path.posix.dirname(fromRel);
  let rel = path.posix.relative(fromDir === "." ? "" : fromDir, out);
  if (!rel) rel = path.posix.basename(out);
  return encodeURI(rel) + frag;
}

// href/src/action attributes, and url() inside the stylesheet the shell inlines.
// Attribute values only: the pattern is anchored on an attribute name and a quote, so prose
// containing a slash is never touched.
function rewriteHtml(html, fromRel) {
  let out = html.replace(/\b(href|src|action)="([^"]*)"/g,
    (_, a, v) => `${a}="${mapUrl(fromRel, v)}"`);
  out = out.replace(/url\((['"]?)([^)'"]+)\1\)/g,
    (m, q, v) => (SKIP_URL.test(v) ? m : `url(${q}${mapUrl(fromRel, v)}${q})`));
  return out;
}

// ── the shell, taken apart once ──────────────────────────────────────────────
// CSS and the page script are the same bytes on every page, so they are written once and
// linked. Both are located by matching what the shell actually produced rather than by
// assuming its text: if serve-ris-wiki.js changes its script, this still finds it, and if it
// ever stops having one the build says so instead of silently shipping a page with no theme
// toggle. The stylesheet is matched against the exported CSS constant, which is the same
// value the shell interpolates.
const probe = SHELL("probe", "<p>probe</p>", "/README.md");
const styleTag = `<style>${CSS}</style>`;
if (!probe.includes(styleTag)) {
  console.error("the page shell no longer inlines the exported CSS — stylesheet extraction would be wrong");
  process.exit(2);
}
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(probe);
if (!scriptMatch) {
  console.error("the page shell no longer carries an inline script — the theme toggle would be lost");
  process.exit(2);
}
const SHELL_SCRIPT = scriptMatch[0];

// The extra behaviour the static site needs on every page: a search box that goes somewhere,
// and a localStorage that cannot take the theme toggle down with it. Appended to the shell's
// own script so there is one file, not three.
//
// The localStorage guard is not defensive padding. Under `file://` each document is its own
// opaque origin, and a browser is entitled to refuse storage to it — Chromium does when
// started with certain policies, and the shell's script reads localStorage on its FIRST line,
// outside any try. A throw there kills the whole block: no theme toggle, and no "/" to focus
// search. The shim installs a memory-backed stand-in only when the real one is unusable, so
// the page degrades to "theme resets when you navigate" instead of "nothing works".
const EXTRA_JS = `
// ── static-export additions ──────────────────────────────────────────────────
(function(){
  var base = window.RIS_BASE || "";
  var form = document.querySelector(".top form");
  if (form) {
    var input = form.querySelector("input");
    // On a web host the plain GET works: search.html?q=… . Under file:// a form GET does not
    // reliably carry a query string, so the submit is intercepted and the term travels in the
    // hash, which every browser keeps. search.html reads whichever arrived.
    form.addEventListener("submit", function(e){
      var q = (input && input.value || "").trim();
      if (!q) { e.preventDefault(); return; }
      if (location.protocol === "file:") {
        e.preventDefault();
        location.href = base + "search.html#q=" + encodeURIComponent(q);
      }
    });
  }
})();
`;
const STORAGE_SHIM = `<script>
// See build-ris-wiki-site.js: file:// documents may be denied localStorage, and the shell's
// script touches it before any try/catch. A memory stand-in keeps the rest of the page alive.
(function(){try{var k="__ris";localStorage.setItem(k,"1");localStorage.removeItem(k);}catch(e){
var m={};try{Object.defineProperty(window,"localStorage",{value:{getItem:function(k){return k in m?m[k]:null;},
setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];}},configurable:true});}catch(e2){}}})();
</script>`;

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
// The stylesheet gets the same URL rewriting the pages do, and it is written AT THE SITE ROOT,
// so its one url() is resolved from there. Writing the raw constant instead left
// `url(/art/ris-rule.png)` in it, which under file:// asks for C:\art\ris-rule.png — so every
// page in the wiki lost the mod's rule under its title and nothing else looked wrong. A real
// browser found that; no amount of reading the HTML would have, because the HTML was correct.
fs.writeFileSync(path.join(SITE, "wiki.css"), rewriteHtml(CSS, "wiki.css"));
fs.writeFileSync(path.join(SITE, "wiki.js"),
  SHELL_SCRIPT.replace(/^<script>|<\/script>$/g, "") + EXTRA_JS);

const writeOut = (rel, text) => {
  const abs = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};

// Turn one shell-rendered page into a file:// -safe document.
function finish(html, fromRel) {
  const depth = path.posix.dirname(fromRel) === "." ? "" : "../".repeat(fromRel.split("/").length - 1);
  let out = rewriteHtml(html, fromRel);
  // The stylesheet was rewritten in place above (its url() now points at the right depth),
  // so it is matched here in its rewritten form.
  const rewrittenStyle = `<style>${rewriteHtml(CSS, fromRel)}</style>`;
  out = out.replace(rewrittenStyle,
    `<link rel="stylesheet" href="${depth}wiki.css">\n<script>window.RIS_BASE=${JSON.stringify(depth)}</script>`);
  out = out.replace(SHELL_SCRIPT, `${STORAGE_SHIM}\n<script src="${depth}wiki.js"></script>`);
  return out;
}

// ── render every page ────────────────────────────────────────────────────────
let rendered = 0;
for (const rel of mdPages) {
  const md = fs.readFileSync(path.join(WIKI, rel), "utf8");
  const title = (/^#\s+(.+)$/m.exec(md) || [, path.basename(rel)])[1];
  const html = SHELL(title, sectionise(renderMarkdown(md, [])), "/" + rel);
  writeOut(rel.replace(/\.md$/i, ".html"), finish(html, rel));
  rendered++;
}
note(`pages rendered: ${n(rendered)} (from ${n(mdPages.length)} .md files under ${WIKI})`);

// The root README is the entry point. `file://` will not serve a folder's README for you, so
// index.html is a byte copy of it — same directory, so every relative link in it still lands.
if (!fs.existsSync(path.join(SITE, "README.html"))) {
  console.error("no README.md at the wiki root — there would be nothing to double-click");
  process.exit(2);
}
fs.copyFileSync(path.join(SITE, "README.html"), path.join(SITE, "index.html"));

// ── the sortable views ───────────────────────────────────────────────────────
// Hand-generated HTML, not markdown, and they carry their table data inline as JSON with
// `"href":"units/x.md"` in it. Rewriting attributes alone would leave every row in those
// tables pointing at a .md file the browser shows as text, so the embedded data is rewritten
// too. Counted, so a change to how those files are generated shows up as a count of zero
// rather than as three quietly broken pages.
let embeddedRefs = 0;
for (const rel of staticHtml) {
  let html = fs.readFileSync(path.join(WIKI, rel), "utf8");
  html = html.replace(/"(href|img)":"([^"]+)"/g, (m, k, v) => {
    embeddedRefs++;
    return `"${k}":"${mapUrl(rel, v)}"`;
  });
  html = rewriteHtml(html, rel);
  writeOut(outNameOf(rel), html);
}
note(`sortable views: ${n(staticHtml.length)} copied (${n(RENAMED.size)} renamed to avoid a page of the same name), ${n(embeddedRefs)} embedded row links rewritten`);

// ── search ───────────────────────────────────────────────────────────────────
// The served wiki searches on the server. There is no server here, so the same index — title
// and path, which is all the server had — is written out and filtered in the browser. It is
// loaded ONLY by search.html: putting it in the shell would add its whole weight to every one
// of the wiki's pages to serve a box most readers never type in.
const searchRows = INDEX.map((e) => {
  const rootRel = e.rel.replace(/^\//, "");
  return [e.title, outNameOf(rootRel), e.section];
});
fs.writeFileSync(path.join(SITE, "search-index.js"),
  `window.RIS_PAGES=${JSON.stringify(searchRows)};\n`);

const SEARCH_BODY = `<h1>Search</h1>
<p id="q-note">Type in the box above and press Enter.</p>
<ul class="res" id="q-res"></ul>
<script src="search-index.js"></script>
<script>
(function(){
  // Ranked the same way the server ranked: exact title, then prefix, then substring, then
  // path. Same order in, same order out, so a reader who used the preview sees the same list.
  function search(q){
    var needle = q.trim().toLowerCase(), hits = [];
    if (!needle) return hits;
    for (var i = 0; i < window.RIS_PAGES.length; i++){
      var e = window.RIS_PAGES[i], t = e[0].toLowerCase(), s = -1;
      if (t === needle) s = 0;
      else if (t.indexOf(needle) === 0) s = 1;
      else if (t.indexOf(needle) >= 0) s = 2;
      else if (e[1].toLowerCase().indexOf(needle) >= 0) s = 3;
      if (s >= 0) hits.push([s, e]);
    }
    hits.sort(function(a,b){ return a[0]-b[0] || a[1][0].localeCompare(b[1][0]); });
    return hits.slice(0, 200).map(function(h){ return h[1]; });
  }
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function term(){
    // ?q= is what a form GET produces on a web host; #q= is what the file:// path uses.
    var m = /[?&]q=([^&]*)/.exec(location.search) || /[#&]q=([^&]*)/.exec(location.hash);
    return m ? decodeURIComponent(m[1].replace(/\\+/g, " ")) : "";
  }
  function run(){
    var q = term(), note = document.getElementById("q-note"), res = document.getElementById("q-res");
    var box = document.querySelector(".top input");
    if (box) box.value = q;
    if (!q){ note.textContent = "Type in the box above and press Enter."; res.innerHTML = ""; return; }
    var hits = search(q);
    document.title = "Search: " + q + " — RIS wiki";
    note.innerHTML = hits.length
      ? hits.length + (hits.length === 200 ? "+" : "") + " page" + (hits.length === 1 ? "" : "s") + " matching <code>" + esc(q) + "</code>."
      : "Nothing matches <code>" + esc(q) + "</code>.";
    res.innerHTML = hits.map(function(h){
      return '<li><a href="' + h[1] + '">' + esc(h[0]) + '</a> <span class="sec">' + esc(h[2]) + '</span></li>';
    }).join("");
  }
  addEventListener("hashchange", run);
  run();
})();
</script>`;
// Rendered through the same shell as every other page, so the bar, nav, crumbs and theme are
// the page's own rather than a second layout that has to be kept in step.
writeOut("search.html", finish(SHELL("Search", SEARCH_BODY, "/search.html"), "search.html"));
note(`search: client-side over ${n(searchRows.length)} page titles (search-index.js, ${n(fs.statSync(path.join(SITE, "search-index.js")).size)} bytes)`);

// ── assets ───────────────────────────────────────────────────────────────────
// Copied because a page REFERENCES them, not because they are in the folder. The wiki carries
// art nothing points at, and shipping it is pure weight in a build whose size is the whole
// question.
let copied = 0, copiedBytes = 0, skipped = 0, skippedBytes = 0, caseMismatch = 0;
const caseSamples = [];
// Real on-disk names per directory, so a reference whose case differs from the file can be
// caught. Windows does not care; GitHub Pages runs on Linux and serves a 404, so a build that
// looks perfect here would lose images the moment it is published.
const realNames = new Map();
const realNameOf = (rootRel) => {
  const dir = path.posix.dirname(rootRel);
  if (!realNames.has(dir)) {
    let names = new Set();
    try { names = new Set(fs.readdirSync(path.join(WIKI, dir))); } catch { /* missing dir */ }
    realNames.set(dir, names);
  }
  return realNames.get(dir).has(path.posix.basename(rootRel));
};

for (const rootRel of assetRefs.keys()) {
  const top = rootRel.split("/")[0];
  const src = path.join(WIKI, rootRel);
  const size = fs.statSync(src).size;
  if (!realNameOf(rootRel)) {
    caseMismatch++;
    if (caseSamples.length < 5) caseSamples.push(rootRel);
  }
  if (WITHOUT.has(top)) { skipped++; skippedBytes += size; continue; }
  const dst = path.join(SITE, rootRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++; copiedBytes += size;
}

// Present but unreferenced: in the wiki, pointed at by nothing, so not shipped.
const referenced = new Set([...assetRefs.keys()]);
const isPage = (r) => /\.(md|html)$/i.test(r);
const unreferenced = allFiles.filter((r) => !isPage(r) && !referenced.has(r));
const byDir = new Map();
for (const r of unreferenced) {
  const top = r.includes("/") ? r.split("/")[0] : "(root)";
  byDir.set(top, (byDir.get(top) || 0) + 1);
}

note(`assets referenced: ${n(assetRefs.size)} distinct files, ${n([...assetRefs.values()].reduce((a, b) => a + b, 0))} references`);
note(`assets copied:     ${n(copied)} (${(copiedBytes / 1048576).toFixed(1)} MB)`);
if (WITHOUT.size) note(`assets left out:   ${n(skipped)} (${(skippedBytes / 1048576).toFixed(1)} MB) by --without ${[...WITHOUT].join(",")}`);
note(`referenced but missing: ${n(missing.size)}${missing.size ? " — e.g. " + [...missing.keys()].slice(0, 5).join(", ") : ""}`);
note(`present but unreferenced: ${n(unreferenced.length)}${unreferenced.length ? " — " + [...byDir].sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} ${n(c)}`).join(", ") : ""}`);
note(`case-mismatched references: ${caseMismatch}${caseSamples.length ? " — e.g. " + caseSamples.join(", ") : ""} (would 404 on GitHub Pages, which is case-sensitive)`);

// ── how to open it ───────────────────────────────────────────────────────────
fs.writeFileSync(path.join(SITE, "OPEN-ME.txt"),
  [
    "RIS wiki — offline copy",
    "",
    "Open index.html. That is all: double-click it and it opens in your browser.",
    "Nothing to install, no internet needed. Everything works offline, including search.",
    "",
    "If you were sent a .zip, unzip the WHOLE folder first and then open index.html inside it.",
    "Opening index.html from inside the zip will show the page with no pictures.",
    "",
    "Built from the RIS wiki markdown by scripts/build-ris-wiki-site.js.",
    "",
  ].join("\r\n"));

// ── totals ───────────────────────────────────────────────────────────────────
let files = 0, bytes = 0;
walk(SITE, (p) => { files++; bytes += fs.statSync(p).size; });
note(`\nsite: ${n(files)} files, ${(bytes / 1048576).toFixed(1)} MB at ${SITE}`);
note(`open ${path.join(SITE, "index.html")}`);

if (missing.size) {
  console.error(`\n${missing.size} referenced file(s) do not exist in the wiki:`);
  for (const [t, from] of [...missing].slice(0, 20)) console.error(`  ${t}  <- ${from[0]}${from.length > 1 ? ` (+${from.length - 1} more)` : ""}`);
  process.exit(1);
}
