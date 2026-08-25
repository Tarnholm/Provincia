// Convert the generated RIS wiki markdown into GitHub-wiki-ready pages.
// GitHub wikis have a FLAT page namespace and discard directories, so pages are
// emitted flat, prefixed by their source folder (regions-Akarnania) to avoid the
// 57 basename collisions between regions/settlements, cultures/religions, etc.
const fs = require('fs'), path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
// The notes store is the single source of truth for Team notes; an existing wiki
// clone is only a fallback for the very first run, before anything was pulled back.
const NOTES = require('./ris-wiki-notes.js');
const NOTES_STORE = process.env.RIS_WIKI_NOTES || NOTES.NOTES_DIR;
const PREV = process.argv[4] || null;

const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const NEWLINE_RE = new RegExp(CR + '?' + LF);
const MARK = '<!-- TEAM-NOTES -- everything below this line is kept when the wiki is re-imported -->';
const PLACEHOLDER = 'Nothing yet. Click **Edit** above and write below the line -- it will survive the next import.';

// Everything a human wrote below MARK, minus our own heading and placeholder line.
function existingNotes(pageFile) {
  const stored = NOTES.readNote(pageFile, NOTES_STORE);
  if (stored) return stored;
  if (!PREV) return null;
  const f = path.join(PREV, pageFile);
  if (!fs.existsSync(f)) return null;
  return NOTES.extractNotes(fs.readFileSync(f, 'utf8'));
}

const WIKI = '/Tarnholm/ris-wiki/wiki/';
const RAW  = 'https://raw.githubusercontent.com/Tarnholm/ris-wiki/main/';
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function resolveRel(fileRel, target) {
  const dir = path.posix.dirname(fileRel);
  return path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
}

// source path (factions/acarnania) -> flat wiki page name (factions-acarnania)
function pageName(srcPath) {
  const parts = srcPath.split('/');
  return parts.length === 1 ? parts[0] : parts.join('-');
}

const stats = { files: 0, links: 0, images: 0, notesKept: 0, unresolved: [] };
const files = walk(SRC);
const pageSet = new Set(files.map(f => path.relative(SRC, f).split(path.sep).join('/').replace(/\.md$/, '')));

// guard: the flat namespace must stay collision-free
const seen = new Map();
for (const p of pageSet) {
  const n = pageName(p).toLowerCase();
  if (seen.has(n)) { console.error(`COLLISION: ${p} and ${seen.get(n)} both -> ${n}`); process.exit(1); }
  seen.set(n, p);
}

function toWikiLink(p) { return WIKI + pageName(p); }

for (const abs of files) {
  const rel = path.relative(SRC, abs).split(path.sep).join('/');
  let md = fs.readFileSync(abs, 'utf8');

  md = md.replace(/!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (m, alt, href, rest) => {
    if (/^(https?:|\/)/.test(href)) return m;
    stats.images++;
    return `![${alt}](${RAW}${resolveRel(rel, href)}${rest})`;
  });

  md = md.replace(/(<img[^>]*?src=")([^"]+)(")/g, (m, a, href, b) => {
    if (/^(https?:|\/)/.test(href)) return m;
    stats.images++;
    return `${a}${RAW}${resolveRel(rel, href)}${b}`;
  });

  md = md.replace(/\]\(([^)\s#]+)\.(md|html)(#[^)\s]*)?\)/g, (m, href, ext, anchor) => {
    if (/^(https?:|\/)/.test(href)) return m;
    const p = resolveRel(rel, href);
    if (!pageSet.has(p)) { stats.unresolved.push(`${rel} -> ${href}.${ext}`); return m; }
    stats.links++;
    return `](${toWikiLink(p)}${anchor || ''})`;
  });

  md = md.replace(/(<a[^>]*?href=")([^"]+?)\.(md|html)(#[^"]*)?(")/g, (m, a, href, ext, anchor, b) => {
    if (/^(https?:|\/)/.test(href)) return m;
    const p = resolveRel(rel, href);
    if (!pageSet.has(p)) { stats.unresolved.push(`${rel} -> ${href}.${ext}`); return m; }
    stats.links++;
    return `${a}${toWikiLink(p)}${anchor || ''}${b}`;
  });

  md = md.replace(/(<a[^>]*?href=")([^"]+)(")/g, (m, a, href, b) => {
    if (/^(https?:|\/)/.test(href)) return m;
    if (!IMG_EXT.test(href)) return m;
    stats.images++;
    return `${a}${RAW}${resolveRel(rel, href)}${b}`;
  });

  md = md.replace(/\((\.\.?\/[^)\s]+)\)/g, (m, href) => {
    const p = resolveRel(rel, href);
    if (IMG_EXT.test(href)) { stats.images++; return `(${RAW}${p})`; }
    stats.unresolved.push(`${rel} -> ${href}`); return m;
  });

  // On the index the label reads better first and the icon after it. Scoped to that page
  // deliberately: the same img-then-bold-link shape occurs 292 times across the culture and
  // family pages, where icon-first is the intended layout, and a blanket rule would flip
  // every one of them.
  if (rel === 'README.md') {
    md = md.replace(/(<img[^>]*>)\s*(\[\*\*[^\]]*\*\*\]\([^)]*\))/g, '$2 $1');
  }

  const outName = pageName(rel.replace(/\.md$/, '')) + '.md';
  const kept = existingNotes(outName);

  // A page with no notes gets only the marker, which is an HTML comment and so
  // renders as nothing. No empty heading, no placeholder prose. The marker is
  // still visible in the wiki's edit box, which is where it needs to be read.
  if (kept) {
    stats.notesKept++;
    md = [md.trimEnd(), '', '---', '', MARK, '', '## Team notes', '', kept, ''].join(LF);
  } else {
    md = [md.trimEnd(), '', MARK, ''].join(LF);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, outName), md);
  stats.files++;
}

// Home page = the generated index, with a note about where the pretty version lives
const home = fs.readFileSync(path.join(OUT, 'README.md'), 'utf8');
fs.writeFileSync(path.join(OUT, 'Home.md'), home);

// A flat wiki page name cannot be split back into a path by rule: "factions-overview" is a
// top-level page while "factions-rome" lives under factions/. So the mapping is written out
// here, where it is known, for the notes sync to read. Not a wiki page — GitHub ignores it.
const pageMap = {};
for (const rel of pageSet) pageMap[pageName(rel)] = rel;
fs.writeFileSync(path.join(OUT, 'page-map.json'), JSON.stringify(pageMap));

// Sidebar — the flat page list is unusable at this scale without one
const SB = [
  '### Start here', '',
  '- [Wiki index](' + WIKI + 'Home)',
  '- [All factions](' + WIKI + 'factions)',
  '- [All regions](' + WIKI + 'regions)',
  '- [All settlements](' + WIKI + 'settlements)',
  '- [All units](' + WIKI + 'units)',
  '- [All buildings](' + WIKI + 'buildings)',
  '- [Trade goods](' + WIKI + 'trade-goods)',
  '- [Cultures](' + WIKI + 'cultures)',
  '- [Beliefs](' + WIKI + 'religions)',
  '- [Character traits](' + WIKI + 'traits)',
  '- [Retinue](' + WIKI + 'ancillaries)',
  '- [Settlement sizes](' + WIKI + 'sizes)', '',
  '### Overviews', '',
  '- [Factions vs vanilla](' + WIKI + 'factions-overview)',
  '- [The map](' + WIKI + 'map-and-regions)',
  '- [Roster vs vanilla](' + WIKI + 'units-overview)',
  '- [Buildings & economy](' + WIKI + 'buildings-and-economy)',
  '- [Region tag reference](' + WIKI + 'tags)', '',
  '### Finding a page', '',
  'Pages are named by type — type a',
  'prefix into **Find a page** above:', '',
  '`factions-` `regions-` `units-`',
  '`settlements-` `buildings-`',
  '`cultures-` `religions-`',
  '`goods-` `traits-` `ancillaries-`', '',
  '---', '',
  '### Editing', '',
  'Click **Edit** on any page and',
  'write at the bottom, under the',
  '`TEAM-NOTES` comment. That part',
  'is kept when the wiki is',
  're-imported and appears on the',
  'styled site.', '',
  'Everything above it is generated',
  'from the RIS data files and will',
  'be overwritten — fix wrong',
  'numbers in the generator, not',
  'here.', '',
  '📖 [The styled site](https://tarnholm.github.io/ris-wiki/) has search.', ''
].join(LF);
fs.writeFileSync(path.join(OUT, '_Sidebar.md'), SB);

// Anything in the existing wiki with no source page any more is REPORTED, never
// removed. Push by copying over the top; do not `git rm` the wiki first, or a
// page someone hand-created disappears with no warning.
if (PREV) {
  const emitted = new Set(fs.readdirSync(OUT).filter((f) => f.endsWith('.md')));
  const orphans = fs.readdirSync(PREV)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'Home.md')
    .filter((f) => !emitted.has(f));
  if (orphans.length) {
    console.log('');
    console.log('in the wiki but no longer generated (LEFT IN PLACE — delete by hand if you want them gone):');
    for (const f of orphans.slice(0, 20)) console.log('  ' + f.replace(/\.md$/, ''));
    if (orphans.length > 20) console.log('  ... and ' + (orphans.length - 20) + ' more');
    console.log('');
  }
}

console.log(`files:      ${stats.files}`);
console.log(`links:      ${stats.links}`);
console.log(`images:     ${stats.images}`);
console.log(`notes kept: ${stats.notesKept}`);
console.log(`unresolved: ${stats.unresolved.length}`);
