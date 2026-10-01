#!/usr/bin/env node
// Put each campaign variant's DIFFERING pages into the main wiki, under v/<id>/ (asked for
// 2026-09-30: "each page affected by them should be toggled with buttons in those pages").
//
// For every variant built by gen-ris-wiki-variants.js (C:/RIS/_wiki-variants/<id>):
//   - a page (.md, or a generated .html view) is the variant's own when its text differs from
//     the main wiki's page, or the main wiki has no such page (a region only RIS Light has);
//   - it is written to C:/RIS/_wiki/v/<id>/<same path>, with every link pointing at the
//     variant's own page where there is one and at the main page otherwise (as a root path,
//     "/v/light/factions/rome.md" or "/units/hastati.md", which the site build resolves);
//   - a picture it shows that differs from the main wiki's (a Light region map) is copied
//     beside it; an identical one is left pointing at the main copy;
//   - v/variants.json lists, per main page, which variants have their own version, and per
//     variant, the pages that exist only there. The site build draws the campaign buttons
//     from it.
// _wiki/v/ is generated and excluded from git (C:/RIS/.git/info/exclude).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { VARIANTS } = require("./lib/risVariants.js");

const MAIN = "C:/RIS/_wiki";
const V_ROOT = path.join(MAIN, "v");
const posix = (p) => p.split(path.sep).join("/");
const walk = (dir, base = dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc); else acc.push(posix(path.relative(base, p)));
  }
  return acc;
};
const hash = (f) => { try { return crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } };
const isPage = (r) => /\.md$/i.test(r) || /^[^/]+\.html$/i.test(r);   // pages and the top-level views
// The same in every campaign: the changelog (its text only links differently when a faction is
// renamed, as Rome is in Four Romans), the Discord diaries and videos, the home page.
const SHARED = /^(?:changelog|diaries)(?:\/|\.md$)|^community-videos\.md$|^README\.md$/i;

// A large section that reads exactly as on the main page (a faction's "Units you can recruit",
// ~300 KB of HTML, the same in 9 of 10 variant faction pages) links to the main page's section
// instead of being published again: the whole wiki has to fit GitHub Pages' 1 GB.
const SHARE_MIN = 20000;
const slugId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");   // serve-ris-wiki.js
const sections = (text) => {
  const out = [];
  for (const part of text.split(/^(?=## )/m)) out.push({ head: (/^## (.+)$/m.exec(part) || [])[1] || null, text: part });
  return out;
};
let sharedBytes = 0;
function shareSections(mine, theirs, rel) {
  const main = new Map(sections(theirs).filter((s) => s.head).map((s) => [s.head, s.text]));
  let shared = false;
  const text = sections(mine).map((s) => {
    if (!s.head || s.text.length < SHARE_MIN || main.get(s.head) !== s.text) return s.text;
    sharedBytes += s.text.length;
    shared = true;
    return `## ${s.head}\n\nThe same as in the [main campaign](/${rel}#${slugId(s.head)}).\n\n`;
  }).join("");
  if (!shared) return text;
  // In-page links into a heading that went with the shared section go to the main page's.
  const ids = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slugId(m[1])));
  for (const m of text.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  const to = (id) => (ids.has(id) ? `#${id}` : `/${rel}#${id}`);
  return text.replace(/\]\(#([^)\s]+)\)/g, (all, id) => `](${to(id)})`)
    .replace(/(\shref=")#([^"]+)"/g, (all, a, id) => `${a}${to(id)}"`);
}

// Clean rebuild of the generated folder.
fs.rmSync(V_ROOT, { recursive: true, force: true });
fs.mkdirSync(V_ROOT, { recursive: true });

// pages: main page -> variants with their own version; only: variant -> pages only it has;
// absent: variant -> main pages it does not have (a region that is not on RIS Light's map).
const MAP = { pages: {}, only: {}, absent: {}, names: {} };
const MAIN_PAGES = walk(MAIN).filter((r) => !r.startsWith("v/") && isPage(r) && !SHARED.test(r));
for (const v of VARIANTS) {
  if (!fs.existsSync(v.out)) { console.log(`${v.id}: not built, skipped`); continue; }
  MAP.names[v.id] = v.name;
  const files = walk(v.out).filter((r) => !r.startsWith("v/"));
  const have = new Set(files);
  MAP.absent[v.id] = MAIN_PAGES.filter((r) => !have.has(r));
  const pages = new Set();
  let only = 0;
  for (const r of files.filter((f) => isPage(f) && !SHARED.test(f))) {
    const mine = fs.readFileSync(path.join(v.out, r), "utf8");
    let theirs = null;
    try { theirs = fs.readFileSync(path.join(MAIN, r), "utf8"); } catch { /* not in main */ }
    if (theirs === mine) continue;
    pages.add(r);
    if (theirs == null) only++;
  }
  // Pictures and data the variant's pages point at: the variant's copy when it differs.
  const assetDiff = new Map();   // rel -> true (copy) / false (main's)
  const assetIsOwn = (r) => {
    if (!assetDiff.has(r)) {
      const a = path.join(v.out, r), b = path.join(MAIN, r);
      assetDiff.set(r, fs.existsSync(a) && hash(a) !== hash(b));
    }
    return assetDiff.get(r);
  };
  const rewrite = (text, rel) => {
    const dir = path.posix.dirname(rel);
    const fix = (target) => {
      if (/^(https?:|mailto:|#|data:|javascript:)/i.test(target) || target.startsWith("/")) return target;
      // Script code building a link (`src="' + d.sym + '"` in the world map's card), not a path.
      if (/['"<>]/.test(target) || target.includes("+ ") || target.includes("${")) return target;
      const m = /^([^#?]*)([?#].*)?$/.exec(target);
      const bare = m[1], tail = m[2] || "";
      if (!bare) return target;
      const res = path.posix.normalize(dir === "." ? bare : `${dir}/${decodeURIComponent(bare)}`);
      if (res.startsWith("..")) return target;
      if (pages.has(res)) return `/v/${v.id}/${res}${tail}`;
      if (!isPage(res) && assetIsOwn(res)) return `/v/${v.id}/${res}${tail}`;
      return `/${res}${tail}`;
    };
    return text
      .replace(/(\]\()([^)\s]+)(\))/g, (all, a, t, b) => a + fix(t) + b)
      .replace(/(\s(?:src|href)=")([^"]+)(")/g, (all, a, t, b) => a + fix(t) + b)
      // The sortable views (factions.html, regions.html, units.html) carry their rows as JSON.
      .replace(/("(?:href|img|sym)":")([^"]+)(")/g, (all, a, t, b) => a + fix(t) + b)
      // The world map's key: bare "tags/recruitment-zones.md#arab" strings in arrays.
      .replace(/"((?:[\w%.-]+\/)+[\w%.-]+\.md(?:#[^"]*)?)"/g, (all, t) => (/world-map\.html$/.test(rel) ? `"${fix(t)}"` : all));
  };
  for (const r of pages) {
    const out = path.join(V_ROOT, v.id, r);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let text = fs.readFileSync(path.join(v.out, r), "utf8");
    if (/\.md$/i.test(r) && fs.existsSync(path.join(MAIN, r))) text = shareSections(text, fs.readFileSync(path.join(MAIN, r), "utf8"), r);
    fs.writeFileSync(out, rewrite(text, r));
    if (fs.existsSync(path.join(MAIN, r))) (MAP.pages[r] = MAP.pages[r] || []).push(v.id);
    else (MAP.only[v.id] = MAP.only[v.id] || []).push(r);
  }
  let copied = 0, bytes = 0;
  for (const [r, own] of assetDiff) {
    if (!own) continue;
    const out = path.join(V_ROOT, v.id, r);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(v.out, r), out);
    copied++; bytes += fs.statSync(out).size;
  }
  console.log(`${v.name}: ${pages.size} pages of its own (${only} only in it), ${copied} pictures/files (${(bytes / 1048576).toFixed(0)} MB), ${(sharedBytes / 1048576).toFixed(0)} MB of sections linked to the main page`);
  sharedBytes = 0;
}
fs.writeFileSync(path.join(V_ROOT, "variants.json"), JSON.stringify(MAP));
