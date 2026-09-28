// Links inside text the mod wrote (the in-game guides, 2026-09-28: "the guides lists buildings
// etc, but have no hyperlink to said buildings"). Names are read from the generated wiki itself
// (each page's own title, and a building page's level headings), so a link always points at a
// page that exists. The first mention in each section is linked; headings and text already
// inside a link are left alone. Matching is case-sensitive, so "Iron" the trade good links and
// "iron" in a sentence does not.
//
//   const link = require("./lib/wikiLinker.js").makeLinker(OUT, { root: "../", self: "factions/pontus.md" });
//   link(markdown) -> markdown with links
const fs = require("fs");
const path = require("path");

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clean = (t) => String(t).replace(/<[^>]*>/g, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();

// The guides' own shorthand for pages the wiki names differently.
const ALIASES = [
  ["Military Industry Complex", "buildings/military_industrial_complex.md"],
  ["Military Industrial Complex", "buildings/military_industrial_complex.md"],
  ["MIC", "buildings/military_industrial_complex.md"],
  ["garrison chain", "buildings/garrison.md"],
  ["Region Information Building", "buildings/hinterland_region.md"],
  ["Region Information Buildings", "buildings/hinterland_region.md"],
  ["Colony Level", "buildings/colony.md"],
  ["colonies", "buildings/colony.md"],
  ["colony", "buildings/colony.md"],
  ["governments", "buildings/core_building.md"],
  ["government", "buildings/core_building.md"],
];

function titles(dir) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return out; }
  for (const f of files) {
    let md = "";
    try { md = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const h = /^#\s+(.+)$/m.exec(md);
    out.push({ file: f, title: h ? clean(h[1]) : null, md });
  }
  return out;
}

function makeLinker(OUT, opts = {}) {
  const root = opts.root || "";
  const self = opts.self || null;
  const byName = new Map();   // name -> href, or null when two different pages share it
  const add = (name, href, min = 4) => {
    if (!name || name.length < min) return;
    if (!byName.has(name)) byName.set(name, href);
    else if (byName.get(name) !== href) byName.set(name, null);
  };
  for (const [n, h] of ALIASES) add(n, h, 3);
  for (const t of titles(path.join(OUT, "factions"))) if (t.file !== "non-playable.md") add(t.title, `factions/${t.file}`);
  for (const t of titles(path.join(OUT, "units"))) add(t.title, `units/${t.file}`, 5);
  for (const t of titles(path.join(OUT, "reforms"))) {
    const n = t.title && t.title.replace(/^the\s+/i, "");
    add(n, `reforms/${t.file}`, 6);
  }
  for (const t of titles(path.join(OUT, "buildings"))) {
    if (t.title && !/\(/.test(t.title)) add(t.title, `buildings/${t.file}`, 5);
    for (const m of t.md.matchAll(/^##\s+(.+)$/gm)) {
      const n = clean(m[1]);
      if (!/^(Levels?|What|How|Where|Who|Requirements|Effects|Description)\b/i.test(n)) add(n, `buildings/${t.file}#${slug(n)}`, 5);
    }
  }
  for (const t of titles(path.join(OUT, "goods"))) {
    add(t.title, `goods/${t.file}`, 3);
    // Also by the good's own name where the page is titled by its source ("Grapes" is wine,
    // "Olives" olive oil): the guides say what is traded.
    add(t.file.replace(/\.md$/, "").split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "), `goods/${t.file}`, 3);
  }
  add("Medicinal herbs & Perfumes", "goods/perfumes.md");
  for (const t of titles(path.join(OUT, "settlements"))) add(t.title, `settlements/${t.file}`, 5);
  try {
    for (const [tok, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(OUT, "sizes", "index.json"), "utf8")))) {
      if (/ /.test(v.name)) { add(v.name.toLowerCase(), `sizes/${v.page}`); add(v.name, `sizes/${v.page}`); }
    }
  } catch { /* no sizes yet */ }

  const targets = [...byName].filter(([n, h]) => h && h.split("#")[0] !== self)
    .map(([n, h]) => ({ re: new RegExp(`(?<![\\w-])${esc(n)}(?![\\w-])`), href: root + h, len: n.length, id: h.split("#")[0] }))
    .sort((a, b) => b.len - a.len);

  // First mention per section; a page is linked once per section whatever name it went by.
  return (md) => {
    const done = new Set();
    return String(md).split("\n").map((line) => {
      if (/^#{1,6}\s/.test(line)) { done.clear(); return line; }
      const parts = line.split(/(\[[^\]]*\]\([^)]*\)|<[^>]+>)/);
      for (const t of targets) {
        if (done.has(t.id)) continue;
        for (let i = 0; i < parts.length; i += 2) {
          const m = t.re.exec(parts[i]);
          if (!m) continue;
          parts.splice(i, 1, parts[i].slice(0, m.index), `[${m[0]}](${t.href})`, parts[i].slice(m.index + m[0].length));
          done.add(t.id);
          break;
        }
      }
      return parts.join("");
    }).join("\n");
  };
}

module.exports = { makeLinker };
