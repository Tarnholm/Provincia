// Hover-preview data for every page family that has no preview of its own (asked for
// 2026-09-29: "add more of those hover over windows"). Built by build-ris-wiki-site.js from the
// generated markdown itself, so a preview always says what its page says:
//
//   previews/<family>.json  { "<page>": P, "<page>#<anchor>": P, ... }
//   P = { t: title, p: first sentences, r: [[label, value], ...] (the first two-column fact
//         table, up to 6 rows), i: first picture, relative to the site root }
//
// A page gets an entry for its opening, and for the families where links point into a page
// (buildings, traits, retinue, tags), one per section heading as well.
const fs = require("fs");
const path = require("path");

const FAMILIES = ["regions", "settlements", "buildings", "goods", "traits", "ancillaries", "reforms",
  "religions", "cultures", "sizes", "revolts", "mercenaries", "tags"];
const SECTIONED = new Set(["buildings", "traits", "ancillaries", "tags"]);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Markdown to plain words: links to their text, pictures and tags out, emphasis off.
const plain = (s) => String(s)
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/\*\*|__|`/g, "").replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2")
  .replace(/\s+/g, " ").trim();

// The first picture in a block of markdown, as a path from the site root.
function firstImage(md, fromDir) {
  const m = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(md) || /<img[^>]*src="([^"]+)"/.exec(md);
  if (!m || /^https?:/.test(m[1])) return null;
  return path.posix.normalize(path.posix.join(fromDir, m[1]));
}

// A block's opening: its first prose paragraph (cut to about two sentences), its first
// two-column table, its first picture.
function summarise(lines, fromDir) {
  let p = null, rows = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || /^\[←/.test(l) || /^#/.test(l) || /^<\/?(div|details|summary)/.test(l) || /^!\[/.test(l)) continue;
    if (/^\|/.test(l)) {
      if (rows) continue;
      // A table: keep it if its rows are label | value.
      const tbl = [];
      let j = i;
      while (j < lines.length && /^\s*\|/.test(lines[j])) tbl.push(lines[j++]);
      i = j - 1;
      const cells = tbl.map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => plain(c)));
      if (cells.length >= 3 && cells.every((c) => c.length === 2)) {
        rows = cells.slice(2).filter((c) => c[0] && c[1]).slice(0, 6);
        if (!rows.length) rows = null;
      }
      continue;
    }
    // A line of "**Label:** value · **Label:** value" facts (a settlement page opens with one).
    if (!rows && /^\*\*[^*]+:\*\*/.test(l) && / · /.test(l)) {
      rows = l.split(/ · (?=\*\*)/).map((seg) => /^\*\*([^*]+):\*\*\s*(.*)$/.exec(seg)).filter(Boolean)
        .map((m) => [plain(m[1]), plain(m[2])]).slice(0, 6);
      continue;
    }
    if (!p && !/^[-*]\s/.test(l)) {
      let para = l;
      for (let j = i + 1; j < lines.length && lines[j].trim() && !/^[|#<!-]/.test(lines[j].trim()); j++) para += " " + lines[j].trim();
      const t = plain(para.replace(/^>\s*/, ""));
      if (t.length > 20) {
        const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t];
        let out = "";
        for (const s of sentences) { if ((out + s).length > 240 && out) break; out += s; }
        p = out.trim().length > 260 ? out.trim().slice(0, 257) + "…" : out.trim();
      }
    }
    if (p && rows) break;
  }
  return { p, r: rows, i: firstImage(lines.join("\n"), fromDir) };
}

function buildPreviews(WIKI) {
  const out = {};
  for (const fam of FAMILIES) {
    const dir = path.join(WIKI, fam);
    if (!fs.existsSync(dir)) continue;
    const data = {};
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const md = fs.readFileSync(path.join(dir, f), "utf8");
      const lines = md.split(/\r?\n/);
      const h = /^#\s+(.+)$/.exec(lines[0] || "");
      const title = h ? plain(h[1]).replace(/\s*\(R\)\s*$/, "") : f.replace(/\.md$/, "");
      const page = f.replace(/\.md$/, "");
      // The opening: everything before the first section heading.
      const firstH2 = lines.findIndex((l, i) => i > 0 && /^##\s/.test(l));
      const s = summarise(lines.slice(1, firstH2 > 0 ? firstH2 : lines.length), fam);
      // No fact table in the opening: the page's first label | value table (a region's
      // "Resources and character").
      if (!s.r && firstH2 > 0) s.r = summarise(lines.slice(firstH2).filter((l) => /^\s*\|/.test(l) || !l.trim()), fam).r;
      if (s.p || s.r || s.i) data[page] = { t: title, ...s };
      if (!SECTIONED.has(fam)) continue;
      for (let i = 1; i < lines.length; i++) {
        const m = /^(#{2,3})\s+(.+)$/.exec(lines[i]);
        if (!m) continue;
        let end = lines.findIndex((l, j) => j > i && /^#{1,3}\s/.test(l) && l.match(/^#+/)[0].length <= m[1].length);
        if (end < 0) end = lines.length;
        const name = plain(m[2]);
        const sec = summarise(lines.slice(i + 1, end), fam);
        if (sec.p || sec.r) data[`${page}#${slug(m[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`]/g, ""))}`] = { t: name, k: title, ...sec };
      }
    }
    out[fam] = data;
  }
  return out;
}

module.exports = { buildPreviews, FAMILIES };
