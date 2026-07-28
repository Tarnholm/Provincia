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
  t = t.replace(/\\\|/g, "|");
  return t;
}

// Block-level raw HTML the pages use for collapsible sections. Emitted verbatim, with the
// markdown inside still processed — the faction pages put tables inside <details>, and
// escaping these printed a literal "<details>" above every folded block.
// Matches a bare open/close tag on its own line AND a complete one-line <summary>…</summary>,
// which is how the faction pages write their fold labels. Without the second form the label
// rendered as a literal "&lt;summary&gt;…" line above every collapsible table.
// The third form is `<details><summary>…</summary>` all on ONE line. Without it that line is
// not a block, so it goes through the paragraph path, gets escaped, and the reader sees the tags
// as text — which is exactly what happened on 60 region pages before anyone noticed.
const RAW_BLOCK = /^\s*(<\/?(?:details|summary|div|p|br|hr)\b[^>]*>|<summary[^>]*>.*<\/summary>|<details\b[^>]*><summary[^>]*>.*<\/summary>)\s*$/i;

function slugId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── two-column layout, done by distribution rather than by grid ───────────────
// Sections sit side by side on a wide screen instead of stacking down one narrow column with
// the rest of the monitor empty. HOW they are placed is the thing that took four attempts.
//
// A CSS grid was the obvious answer and is the wrong one. Grid ROWS align: a row cannot end
// until its tallest item does, so a short section beside a tall one leaves its column empty
// for the tall one's full height AND holds the next row back. Measured on the served pages,
// section heights here are not merely unequal, they are unequal by two orders of magnitude —
// a faction page carries a 7-row settlement table, an 8-row character table and a 449-row
// roster in the same grid; a region page a 5-row trade table beside a 13-row attribute table.
// That produced a screen-height empty band on faction, region and unit pages in turn, and
// three separate "fixes" only moved the band somewhere else.
//
// So the columns are built here, as two independent normal-flow blocks, and each section is
// assigned to one of them. Nothing row-aligns, so no section waits for a neighbour. The cost
// is that the split is decided from an ESTIMATE of each section's height rather than the real
// thing, and that the reading order becomes down-then-across.
//
// CSS multi-column (`column-width` + `break-inside:avoid`) would also avoid row coupling, but
// `break-inside:avoid` is a hint: a section taller than the balanced column height gets split
// across columns anyway, and the 449-row roster and the long unit descriptions are exactly
// that case. Distribution has no such failure mode.
function sectionise(html) {
  const parts = html.split(/(?=<h2 )/);
  if (parts.length < 2) return html;
  const lede = parts[0].trim();
  const secs = parts.slice(1).map((s) => s.trim()).filter(Boolean);

  // Does this section's table need the whole width? COLUMN COUNT is the wrong test and was
  // costing the faction pages half their screen: Starting settlements has five columns, but they
  // are "large town", "3,500", "12 buildings" — the whole table is about 70 characters across and
  // fits a half-width column with room to spare. Counting columns sent it full width, which made
  // it a barrier, which left Starting characters alone in a group and stacked everything down the
  // left of a 1,400px screen.
  //
  // Measured instead: the width of the widest ROW, as the sum of each column's longest cell. A
  // long prose cell is capped, because it wraps rather than forcing the table wider. The
  // threshold is in characters and deliberately generous — being wrong towards "it fits" costs a
  // little horizontal scrolling inside one section, being wrong the other way costs half the page.
  // Measured in the SAME pixels the table renderer uses, and it has to be: this decides whether
  // a section goes in a half-width pane, and the renderer decides whether the table inside gets
  // a scroll box against the FULL width. Two different estimates meant a table could be judged
  // narrow enough for a pane here and wide enough to fit there — so it went into the pane with
  // no scroll box and was clipped by the card. The settlement-sizes page lost the last digit of
  // every number in its Total column that way.
  //
  // A header cannot wrap and is uppercase with tracking, so it is the floor for its column; body
  // text wraps at spaces, so the floor there is its longest single word. That is the width the
  // table cannot go below, which is the only figure that answers "will this be clipped".
  const BODY_PX = 7.0, HEAD_PX = 8.4, PAD_PX = 22.4;
  const tableMinPx = (s) => {
    const rows = [...s.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) =>
      [...m[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => {
        let px = 0;
        for (const im of c[2].matchAll(/<img[^>]*\bwidth="(\d+)"/gi)) px += parseInt(im[1], 10) + 7;
        const txt = c[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return c[1] === "th"
          ? px + txt.length * HEAD_PX                                        // nowrap: whole heading
          : px + Math.max(0, ...txt.split(" ").map((w) => w.length)) * BODY_PX;   // wraps at spaces
      }));
    if (!rows.length) return 0;
    const cols = Math.max(...rows.map((r) => r.length));
    let w = 0;
    for (let c = 0; c < cols; c++) w += PAD_PX + Math.max(0, ...rows.map((r) => r[c] || 0));
    return w;
  };
  // A pane is half the content column, less the gap and the two cards' padding.
  const PANE_PX = 660;
  const isWide = (s) => tableMinPx(s) > PANE_PX;
  const secWrap = (s, wide) => `<section class="sec${wide ? " wide" : ""}">${s}</section>`;
  // Rendered height, in rough text lines. Table and list rows are one line each; prose is its
  // character count over a line length; an image stands in for the space it occupies. This is
  // an estimate and only has to be good enough to tell a 5-line section from a 500-line one.
  const weigh = (s) => (s.match(/<tr>/g) || []).length
    + (s.match(/<li>/g) || []).length
    + Math.ceil(s.replace(/<[^>]*>/g, " ").length / 90)
    + (s.match(/<img\b/gi) || []).length * 8;

  // A section that dwarfs everything beside it cannot be balanced against anything: put a
  // 1,180-line roster in one pane and the other pane is empty for its whole length. Those take
  // the full width, and they split the run either side of them so section order is preserved.
  // The test is "at least twice everything else put together", with a floor of about a screen
  // of text — below that the space left over is not worth giving up the second column for.
  const DWARFS = 2 / 3, FLOOR = 40;
  // Otherwise: two panes, longest section placed first into whichever pane is shorter. Placing
  // in READING order instead is what put a 116-line section beside a 20-line one on the region
  // pages — the big item arrived last, when the choice had already been made.
  const paneGroup = (group) => {
    if (!group.length) return "";
    if (group.length === 1) return secWrap(group[0], isWide(group[0]));
    const w = group.map(weigh);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    const big = w.indexOf(Math.max(...w));
    if (w[big] >= FLOOR && w[big] / total >= DWARFS) {
      return paneGroup(group.slice(0, big)) + secWrap(group[big], isWide(group[big]))
        + paneGroup(group.slice(big + 1));
    }
    const pick = [], h = [0, 0];
    for (const i of group.map((_, i) => i).sort((a, b) => w[b] - w[a])) {
      const k = h[0] <= h[1] ? 0 : 1;
      pick[i] = k; h[k] += w[i];
    }
    const pane = [[], []];
    group.forEach((s, i) => pane[pick[i]].push(secWrap(s, false)));   // reading order within a pane
    return `<div class="panes">${pane.map((p) => `<div class="pane">${p.join("")}</div>`).join("")}</div>`;
  };

  // The unit pages are not distributed: the owner asked for the description in a column of its
  // own, starting at the top beside the unit card, with everything short stacked on the left.
  // Balancing would put the prose halfway down the page, which is the thing being fixed.
  const descAt = secs.findIndex((s) => /^<h2[^>]*>Description</i.test(s));
  if (descAt >= 0) {
    // The title and the "all units" line head the page, not a column, so they stay full width
    // above both panes — otherwise the description's first line sits level with the H1 and the
    // card is pushed below it. The left column starts where the card does.
    const cut = lede.search(/<p>[^\n]*<img/i);
    const head = cut < 0 ? lede : lede.slice(0, cut).trim();
    const paneLede = cut < 0 ? "" : lede.slice(cut).trim();
    const others = secs.filter((_, i) => i !== descAt).map((s) => secWrap(s, false)).join("");
    return (head ? `<div class="lede">${head}</div>` : "")
      + `<div class="panes">`
      + `<div class="pane">${paneLede ? `<div class="lede">${paneLede}</div>` : ""}${others}</div>`
      + `<div class="pane">${secWrap(secs[descAt], false)}</div>`
      + `</div>`;
  }

  const out = [];
  let group = [];
  const flush = () => { if (group.length) { out.push(paneGroup(group)); group = []; } };
  // The lede's images float, so the section after them wraps alongside and continues
  // underneath — the one thing a column layout cannot do. Only worth holding a section out of
  // the layout when there IS an image to wrap: on a region page the lede is three lines of
  // text, and doing it anyway just pushed the first section down the page.
  let start = 0;
  const ledeHasImage = /<img\b/i.test(lede);
  if (lede) out.push(`<div class="lede">${lede}</div>`);
  if (ledeHasImage && secs.length) { out.push(`<div class="lede-flow">${secs[0]}</div>`); start = 1; }

  // A wide section is a barrier: it takes the whole width, so the runs either side of it are
  // balanced separately and nothing is reordered across it.
  for (let i = start; i < secs.length; i++) {
    if (isWide(secs[i])) { flush(); out.push(secWrap(secs[i], true)); continue; }
    group.push(secs[i]);
  }
  flush();
  return out.join("");
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
      // A cell may contain an escaped pipe. Several of the mod's own requirement strings do
      // ("Any Government | Tier 2 Colony not built"), and splitting on every | tore those rows
      // into extra columns. `\|` is how markdown writes a literal pipe in a cell; the escape is
      // removed again in inline().
      const cells = (r) => r.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      const head = cells(line);
      // Alignment from the separator row, so numeric columns stay right-aligned.
      const align = cells(lines[i + 1]).map((c) => (/^-+:$/.test(c) ? "right" : /^:-+:$/.test(c) ? "center" : ""));
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      // ── narrow lists run several items to a row ──────────────────────────
      // A 170-row table of "Zone / Units / Regions" is about 30 characters of content stretched
      // across a 1,400px screen and 170 rows deep: two thirds empty, and nothing but scrolling
      // to read it. Where the table is narrow enough that copies of it fit side by side, the
      // rows are dealt ACROSS instead — items 1, 2, 3 on the first row, 4, 5, 6 on the second —
      // so the same list is a third as tall and the width is used.
      //
      // Dealt across rather than cut into thirds deliberately: a reader scanning the first row
      // of a table sorted by units expects the top three, not items 1, 58 and 115.
      //
      // One table with the columns repeated, not three tables side by side, because then the
      // rows line up by construction and there is a single header, a single scroll box and no
      // flex to fall out of alignment when one group's cells wrap.
      // Estimated in PIXELS, not characters. Characters were close enough to decide "does this
      // need the whole width", but not to decide "do three copies fit", where the answer for the
      // faction tables came out at 2.98 — and a character count cannot tell you that the emblem
      // in the first column is 34px whatever its filename is, nor that an uppercase header with
      // letter-spacing is half again as wide per character as the body text under it.
      //
      // The constants are read off the stylesheet below: body cells 0.9rem, headers 0.82rem
      // uppercase with .04em tracking and nowrap, .7rem of padding each side.
      const BODY_PX = 7.0, HEAD_PX = 8.4, PAD_PX = 22.4, GROUP_GAP_PX = 18;
      // The content column at a typical wide window. Raised from 1380 when the sidebar came
      // down from 15rem to 12.5 and main's side padding from 2.2rem to 1.6: 40px plus 19px
      // handed back. This constant and that layout have to move together — leave it behind and
      // the dealing goes on rationing a width the page no longer has.
      const CONTENT_PX = 1440;
      const textPx = (cell) => {
        let px = 0;
        // An <img width="N"> occupies N pixels regardless of how long its markup is.
        for (const im of String(cell).matchAll(/<img[^>]*\bwidth="(\d+)"/gi)) px += parseInt(im[1], 10) + 7;
        const txt = String(cell).replace(/<[^>]*>/g, "")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")     // a link is as wide as its text
          .replace(/[*_`]/g, "").trim();
        // Capped at 14 characters. A long cell does NOT force the table wider — the browser
        // wraps it — so the width a column NEEDS is set by its header, which cannot wrap, and by
        // typical content rather than by its longest value. Without the cap one 17-character
        // faction name in a culture of 37 dropped that whole table from three across to two,
        // which is both denser than it needs to be and inconsistent with the table beside it.
        return px + Math.min(14, txt.length) * BODY_PX;
      };
      const headPx = (h) => h.replace(/<[^>]*>/g, "").length * HEAD_PX;
      const colPx = head.map((h, k) => PAD_PX + Math.max(headPx(h),
        ...body.map((r) => textPx(r[k] || ""))));
      const groupPx = colPx.reduce((a, b) => a + b, 0);
      // The width below which the table CANNOT be squeezed: a header does not wrap (nowrap, so
      // the whole heading is one unbreakable run) and body text wraps only between words. This
      // is a different question from the one above and needs its own answer — the capped
      // estimate says how much room the table would LIKE, this says what it must have.
      const longestWordPx = (cell) => {
        let px = 0;
        for (const im of String(cell).matchAll(/<img[^>]*\bwidth="(\d+)"/gi)) px += parseInt(im[1], 10) + 7;
        const txt = String(cell).replace(/<[^>]*>/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
        return px + Math.max(0, ...txt.split(/\s+/).map((w) => w.length)) * BODY_PX;
      };
      const minPx = head.reduce((sum, h, k) => sum + PAD_PX
        + Math.max(headPx(h), ...body.map((r) => longestWordPx(r[k] || ""))), 0);
      // Being wrong high costs a horizontal scrollbar inside that one table, which `.tw` already
      // provides; being wrong low wastes half the page, which is what this exists to stop.
      // Two copies of a table that then has to scroll sideways is worse than one that does not:
      // the wrapper gains a horizontal scrollbar AND, because it needs a height for its header
      // to stick to, a vertical one as well — two bars around a list that would have sat still.
      // So the dealing is capped by what FITS at the width the table cannot go below, not only
      // by what it would like.
      const fits = Math.max(1, Math.floor(CONTENT_PX / (minPx + GROUP_GAP_PX)));
      // Eight rows, not the twenty-four this started at. That figure was picked for "this list
      // is long enough to be worth dealing", but the point is saving vertical space, and a
      // twelve-row table of four short columns wastes just as much of the page as a hundred-row
      // one — the faction index has twenty cultures under twenty-four factions, every one of
      // them a narrow column with two thirds of the width beside it empty. Below eight there is
      // little left to save and a three-across table of two rows reads as a mistake.
      // Gate at more than one row, not eight. Eight left ten of the faction index's
      // twenty-two cultures undealt, and an undealt table sizes to its content while a dealt one
      // takes the full width — so the page was a run of identical lists at half a dozen
      // different widths, which reads as a fault rather than as a size.
      //
      // Capped at the row count as well, so a two-row list is dealt two across and not three:
      // a header with an empty third group under it looks like something failed to load.
      // No row-count gate and no row-count cap. Both were there to stop a short list being dealt
      // into a header with empty groups under it, and both cost the thing that matters more:
      // a dealt table takes the full width and an undealt one sizes to its content, so any list
      // left out of the dealing came out a different width from the ones around it. On a page
      // that is the same list repeated — the faction index — that reads as breakage.
      //
      // So a one-faction culture is dealt three across with two slots left empty, and looks like
      // its neighbours. Empty slots, not stretched content: the columns keep their widths.
      const UP = Math.max(1, Math.min(3, fits, Math.floor(CONTENT_PX / (groupPx + GROUP_GAP_PX))));

      const cls = (k, first) => {
        const c = `${align[k] || ""}${first && k === 0 ? " grp" : ""}`.trim();
        return c ? ` class="${c}"` : "";
      };
      const thOne = (first) => head.map((h, k) => `<th${cls(k, first)}>${inline(h)}</th>`).join("");
      const tdOf = (r, first) => head.map((_, k) =>
        `<td${cls(k, first)}>${r ? inline(r[k] || "") : ""}</td>`).join("");

      let th, tr, rowCount;
      if (UP > 1) {
        th = Array.from({ length: UP }, (_, g) => thOne(g > 0)).join("");
        rowCount = Math.ceil(body.length / UP);
        tr = Array.from({ length: rowCount }, (_, r) => "<tr>"
          + Array.from({ length: UP }, (_, g) => tdOf(body[r * UP + g], g > 0)).join("") + "</tr>").join("");
      } else {
        th = thOne(false);
        rowCount = body.length;
        tr = body.map((r) => `<tr>${tdOf(r, false)}</tr>`).join("");
      }
      // Big tables get fixed layout. Content-based sizing means the browser measures every
      // row to decide column widths, and on the 1,172-row roster that pegged a CPU core and
      // made the pointer stutter — any restyle re-measured the whole table. Fixed layout takes
      // the widths from the header row and stops caring how many rows follow. Counted on the
      // ROWS RENDERED, so a list dealt three-up drops below the threshold honestly.
      // Only a table that genuinely overruns the page gets a horizontal scrollbar. That is not
      // cosmetic: `overflow-x:auto` makes the wrapper a scroll container on BOTH axes, and a
      // sticky header inside one sticks to the top of that container rather than to the window
      // — which is why the column headings used to scroll away on every long list. Tables that
      // fit have no wrapper scroll, so their headings follow the page.
      const cannotFit = minPx * UP + GROUP_GAP_PX * (UP - 1) > CONTENT_PX;
      const wrapCls = `tw${rowCount > 60 ? " big" : ""}${UP > 1 ? " multi" : ""}${cannotFit ? " scroll" : ""}`;
      out.push(`<div class="${wrapCls}"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    let m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length, text = inline(m[2]), id = slugId(m[2]);
      // Both levels are collected, and the bar picks. A page's sections are its H2s — except
      // where a page is one long list whose runs are H3s, deliberately, so the viewer does not
      // card each of them; the faction index is exactly that. Recording only H2 gave that page
      // an empty jump bar, which is the page that most needs one.
      if ((level === 2 || level === 3) && toc) toc.push({ id, text, level });
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
    if (buf.length) {
      const html = inline(buf.join(" "));
      // A paragraph that is NOTHING BUT images, two or more of them, is a row of pictures
      // rather than prose — on a faction page that is the symbol beside the territory map.
      // Floated individually they hang from a shared top edge, so a 120px symbol sits against
      // the top quarter of a 700px map. Marked here and centred by CSS instead.
      const onlyImages = (html.match(/<img\b/gi) || []).length >= 2 &&
        !html.replace(/<img\b[^>]*>/gi, "").replace(/<\/?a\b[^>]*>/gi, "").trim();
      out.push(`<p${onlyImages ? ' class="imgrow"' : ""}>${html}</p>`);
    }
  }
  return out.join("\n");
}

// ── shell ────────────────────────────────────────────────────────────────────
const CSS = `
/* ── the mod's own colours ────────────────────────────────────────────────────
   Tyrian purple #67033d and gold #fad05d, both SAMPLED out of the RIS badge rather than
   picked to taste: the badge is 59,475 pixels of #67033d with the monogram in #fad05d /
   #edc558. Using anything else made this look like a generic documentation site that happened
   to be about RIS.

   The accent swaps by theme because the pair is not symmetric. Gold on the dark background is
   about 9:1 contrast and reads well; gold on white is roughly 1.7:1 and is unreadable, so the
   light theme takes the purple as its accent instead — that is about 11:1 on white. The purple
   bar and the gold rule stay constant across both, so the identity does not change with the
   theme, only the thing that has to be legible as text. */
:root{
  --tyrian:#67033d; --tyrian-deep:#4b0230; --gold:#e8c15a;
  --bg:#12141a; --panel:#181b22; --raised:#1e222b; --side:#0e1015; --fg:#e9e6e0; --dim:#9a958c; --line:#2a2e37;
  --acc:#e8c15a; --acc-soft:rgba(232,193,90,.13); --shadow:0 1px 3px rgba(0,0,0,.4);
}
/* The light theme is parchment, not paper. White with grey rules is the look of a software
   manual; this is a wiki about the ancient Mediterranean sitting under a purple-and-gold bar,
   and #faf9f7 with #fff panels made the whole page read as blank. The surfaces are warm and
   the page and the panels are separated by tone rather than by a border alone.
   Contrast measured, not eyeballed: body text 13.4:1 on the page and 15.2:1 on a panel, muted
   text 5.1:1, links 8.6:1 — all clear of AA, with the muted tone the tightest of them. */
@media(prefers-color-scheme:light){
  :root{--bg:#ded0b4; --panel:#ebe0cb; --raised:#f4ecdd; --side:#d3c3a2; --fg:#2a2318; --dim:#574a38; --line:#c4b192;
        --acc:#7d0a49; --acc-soft:rgba(103,3,61,.10); --shadow:0 1px 3px rgba(80,60,30,.14)}
}
:root[data-theme="light"]{--bg:#ded0b4;--panel:#ebe0cb;--raised:#f4ecdd;--side:#d3c3a2;--fg:#2a2318;--dim:#574a38;
  --line:#c4b192;--acc:#7d0a49;--acc-soft:rgba(103,3,61,.10);--shadow:0 1px 3px rgba(80,60,30,.14)}
:root[data-theme="dark"]{--bg:#12141a;--panel:#181b22;--raised:#1e222b;--side:#0e1015;--fg:#e9e6e0;--dim:#9a958c;--line:#2a2e37;
  --acc:#e8c15a;--acc-soft:rgba(232,193,90,.13);--shadow:0 1px 3px rgba(0,0,0,.4)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
/* A heading jumped to lands at the top of the window, which is underneath a sticky bar — so
   every link in the jump strip put the section it named just out of sight, with the row of
   factions below it looking like the top of the section. Costs nothing when nothing is sticky. */
h1,h2,h3,h4,h5,h6{scroll-margin-top:calc(var(--topbar) + .7rem)}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}

/* top bar */
/* The bar is the mod's purple in both themes, with its badge in it — that one strip is what
   makes a page recognisable as RIS at a glance, before any of the words are read. */
/* Everything that has to clear the bar reads this, so the bar can grow a second row without
   the sidebar and every sticky table heading having to be told about it separately. */
:root{--topbar:3.1rem}
body.has-jump{--topbar:5.35rem}
.top{position:sticky;top:0;z-index:20;background:var(--tyrian);border-bottom:1px solid var(--tyrian-deep);
  box-shadow:var(--shadow)}
.top .bar{display:flex;gap:1rem;align-items:center;padding:.55rem 1rem}
/* The page's sections, always in reach. It scrolls sideways rather than wrapping, because a bar
   that grows a second line on some pages and not others moves every sticky offset under it. */
.jump{display:flex;gap:.1rem;align-items:center;overflow-x:auto;padding:0 .7rem .4rem;
  scrollbar-width:thin}
.jump a{color:rgba(244,234,216,.78);text-decoration:none;white-space:nowrap;font-size:.8rem;
  padding:.15rem .45rem;border-radius:5px}
.jump a:hover{color:var(--tyrian);background:var(--gold)}
/* Where you are, as against where you could go. Deliberately quieter than :hover — it marks a
   position, it is not offering an action. */
.jump a.on{color:var(--gold);background:rgba(232,193,90,.16);font-weight:600}
.brand{font-weight:650;letter-spacing:.01em;color:#f4ead8;text-decoration:none;white-space:nowrap;
  display:flex;align-items:center;gap:.55rem}
.brand img{width:26px;height:26px;border-radius:5px;display:block}
.brand span{color:var(--gold)}
.top form{flex:1;display:flex;max-width:34rem}
.top input{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--line);
  border-radius:8px;padding:.42rem .7rem;font:inherit;font-size:.9rem}
.top input:focus{outline:2px solid var(--acc-soft);border-color:var(--acc)}
/* Fixed light tones rather than --dim: the bar is purple in BOTH themes, so a variable that
   goes dark grey in the light theme would be unreadable on it half the time. */
.top .right{display:flex;gap:.9rem;align-items:center;font-size:.82rem;color:rgba(244,234,216,.72)}
.top .right a{color:rgba(244,234,216,.72);text-decoration:none}
.top .right a:hover{color:var(--gold)}
#theme{background:none;border:1px solid rgba(244,234,216,.3);border-radius:6px;
  color:rgba(244,234,216,.8);cursor:pointer;font:inherit;font-size:.78rem;padding:.2rem .5rem}
#theme:hover{border-color:var(--gold);color:var(--gold)}

/* layout */
/* 12.5rem, down from 15. The navigation is a list of short labels and was taking 15rem of a
   screen whose whole point is fitting three tables across; that is 40px given back to every
   page. The type comes down with it so the longest label still fits on one line — "Hazards and
   river trade" is 23 characters, about 154px at .84rem, and the column holds 172 inside its
   padding. Anything longer wraps rather than being cut, which is the right failure. */
.wrap{display:grid;grid-template-columns:12.5rem minmax(0,1fr);gap:0;align-items:start}
nav.side{position:sticky;top:var(--topbar);height:calc(100vh - var(--topbar));overflow-y:auto;
  border-right:1px solid var(--line);padding:1.1rem .7rem 3rem;font-size:.84rem;background:var(--side)}
nav.side h4{margin:1.1rem 0 .35rem;font-size:.7rem;text-transform:uppercase;
  letter-spacing:.09em;color:var(--dim);font-weight:600}
nav.side h4:first-child{margin-top:0}
nav.side a{display:block;color:var(--fg);text-decoration:none;padding:.2rem .45rem;
  border-radius:6px;line-height:1.4}
nav.side a:hover{background:var(--acc-soft);color:var(--acc)}
nav.side a.on{background:var(--acc-soft);color:var(--acc);font-weight:600}
/* Every page uses the full width of the window. No max-width: a cap here left the right-hand
   side of a wide monitor empty, which is the thing being fixed. Readability is handled by
   splitting content into columns below rather than by throwing the space away. */
main{min-width:0;padding:1.6rem 1.6rem 5rem;width:100%}

/* Two columns, each a normal-flow block holding whole sections. There is exactly ONE grid row
   here — the two panes — so nothing inside either column can be held back by the height of
   something in the other. Which sections go where is decided in sectionise(); see the note
   there for why this is not a grid of sections.
   Below ~80rem of viewport there is not room for two readable columns beside the sidebar, so
   they stack. */
.panes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 2.8rem;
  align-items:start;clear:both}
.pane{min-width:0}
@media(max-width:80rem){.panes{grid-template-columns:1fr}}
/* ── three surfaces, not one ──────────────────────────────────────────────────
   Everything used to sit on the page background with a hairline under each heading, so a
   reader had to work out where one section ended and the next began from the spacing alone.
   There are now three tones — the page, a section card on it, and a table raised on the card —
   which is what makes it possible to see at a glance what belongs to what.

   Dark goes up in lightness, light goes up too: paper stacked on a desk, which is the reading
   most people already have. Contrast measured on every layer rather than only the page, since
   the raised surface is the one most text ends up on: dark 12.8:1 body / 5.4:1 muted / 9.3:1
   links, light 13.2 / 7.3 / 8.9. */
.sec{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:.1rem 1.15rem 1rem;margin:0 0 1.1rem}
.sec>h2:first-child,.sec>h3:first-child{margin-top:1rem}
/* The lede deliberately stays ON the page rather than in a card: it is the page's own
   introduction, and boxing it would put a frame around the title's own sentence. */
/* In a column, the unit card sits at the top of its own line rather than floating: at 164px
   inside a half-width pane a float leaves the stat table wrapped around it. */
.pane .lede img{float:none;max-width:100%;margin:0 0 1rem}
.pane .lede p.imgrow{float:none;max-width:100%;margin:0 0 1rem}
.sec>h2:first-child{margin-top:1.2rem}
.pane>.sec:first-child>h2:first-child{margin-top:.2rem}
/* The lede's image floats, so the section after it wraps alongside and then continues under
   it. This is the one thing a grid cannot do: grid rows align, so a short map column sat empty
   until the tall campaign brief beside it finished. */
.lede{max-width:none}
.lede img{float:left;margin:.2rem 1.8rem .8rem 0;max-width:min(42%,34rem);border-radius:8px}
/* A row of pictures floats as ONE block, and the pictures centre against each other inside it.
   Floating them separately hangs both from the same top edge, which on a faction page pins the
   120px symbol level with the top quarter of the map. The map keeps the width it had; the
   container is that plus the symbol and the gap, so nothing else on the page moves. */
.lede p.imgrow{float:left;display:flex;align-items:center;gap:1.4rem;
  margin:.2rem 1.8rem .8rem 0;max-width:min(56%,44rem)}
.lede p.imgrow img{float:none;margin:0;height:auto}
.lede p.imgrow img:first-child{flex:0 0 auto}
.lede p.imgrow img:last-child{flex:0 1 auto;min-width:0;max-width:min(100%,34rem)}
.lede em{display:block;clear:none;color:var(--dim);font-size:.85rem}
.lede-flow{margin-bottom:1.5rem}
.lede-flow>h2:first-child{margin-top:.2rem}
/* Once the floated map ends, the next block reclaims the full width. */
.sec{clear:both}
@media(max-width:900px){.lede img{float:none;max-width:100%;margin-right:0}
  .lede p.imgrow{float:none;max-width:100%;margin-right:0}}
/* Prose paragraphs stay readable without narrowing the page: the line length is limited on
   the paragraph, not on the container, so tables and images beside them still get the width. */
.lede>p,.sec>p{max-width:104ch}
/* A section holding a wide table is allowed to take the whole row rather than being squeezed
   — the roster and building tables have more columns than a half-width column can show. */
.sec.wide{grid-column:1/-1}

/* content */
.crumb{font-size:.8rem;color:var(--dim);margin-bottom:.5rem}
.crumb a{color:var(--dim);text-decoration:none}
.crumb a:hover{color:var(--acc)}
h1{font-size:1.85rem;line-height:1.25;margin:.1rem 0 .6rem;letter-spacing:-.01em}
/* The mod's own divider under the page title. It is a wide, symmetric piece of art with a boss
   at its centre, so it is anchored left and allowed to run to whatever width the column gives
   it; scaled by height rather than stretched, so it never distorts. */
h1::after{content:"";display:block;height:15px;margin:.55rem 0 1rem;
  background:url(/art/ris-rule.png) left center/auto 100% no-repeat;opacity:.9}
h2{font-size:1.28rem;margin:2.1rem 0 .6rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
/* An h3 divides a list into runs — the faction index uses one per culture — so it carries a
   rule and a gold tick to be findable when scrolling, without becoming a card of its own. */
/* The gap ABOVE a divider is what separates one run from the last, so it is the larger of the
   two — but only just. It was 1rem over .3rem, which read as a paragraph break where a rule
   already does the separating. */
h3{font-size:1.06rem;margin:.5rem 0 .3rem;color:var(--fg);
  padding:0 0 .24rem .62rem;border-bottom:1px solid var(--line);border-left:3px solid var(--gold)}
a{color:var(--acc)}
p{margin:.7rem 0}
code{background:var(--acc-soft);color:var(--fg);padding:.08rem .32rem;border-radius:4px;
  font-size:.85em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
blockquote{margin:1rem 0;padding:.65rem .95rem;border-left:3px solid var(--acc);
  background:var(--acc-soft);border-radius:0 6px 6px 0}
blockquote p{margin:.25rem 0}
/* Tables size to their content. width:100% stretched an 8-row, 5-column summary across a
   whole 4K monitor with most of it empty — the numbers ended up further from their labels the
   more screen you had. fit-content on the wrapper keeps the border around the table rather
   than around the empty space beside it, and max-width caps a genuinely wide table, which
   then scrolls inside the wrapper as before. */
.tw{border:1px solid var(--line);border-radius:8px;margin:.3rem 0 .5rem;
  background:var(--raised);width:fit-content;max-width:100%}
/* Scrolls only when the table really is wider than the page. See the note in the renderer: an
   overflow container captures the sticky header, so giving one to every table cost the column
   headings on every long list. */
.tw.scroll{overflow:auto;max-height:calc(100vh - var(--topbar) - 2rem)}
/* Inside a scroll container the header pins to the container, not the window, so the offset
   that clears the site bar would push it a bar's height down its own box. */
.tw.scroll th{top:0}
table{border-collapse:collapse;width:auto;font-size:.9rem}
/* Long prose in a cell would otherwise make a table as wide as its longest sentence. */
td{max-width:70ch}
/* A table with hundreds of rows: fixed layout, so column widths come from the header row and
   the browser never walks the body to size them. Content-fit is only affordable when there is
   little content to fit. */
/* A list dealt several items to a row takes the full width — that is the point of it — and the
   groups are separated by a rule rather than a gap so the eye can tell one item's columns from
   the next one's. */
.tw.multi{width:100%}
/* Auto layout, not fixed: the columns then size to their content and the browser wraps a long
   cell to make the whole thing fit the container, which is what lets three groups sit across a
   page that could not hold three copies of the widest row unwrapped. */
.tw.multi table{width:100%}
.tw.multi th.grp,.tw.multi td.grp{border-left:1px solid var(--line);padding-left:1.1rem}
.tw.big{width:100%;contain:paint}
.tw.big table{width:100%;table-layout:fixed}
.tw.big td{max-width:none;overflow:hidden;text-overflow:ellipsis}
/* Off-screen rows are skipped until scrolled to. Without this, moving the pointer over a
   1,172-row table restyles and repaints rows nobody is looking at, which is what made the
   cursor stutter. contain-intrinsic-size keeps the scrollbar honest for the skipped ones. */
.tw.big tbody tr{content-visibility:auto;contain-intrinsic-size:auto 2.05rem}
th,td{padding:.42rem .7rem;text-align:left;vertical-align:middle;border-bottom:1px solid var(--line)}
/* 3.1rem, not 0: the site bar is sticky at the top of the window and is that tall, so a header
   pinned at 0 slides underneath it and is never readable. The sidebar already uses the same
   offset. z-index keeps the heading above the rows it is holding station over. */
/* The heading band is the section's own tone, one step under the table it sits on, so it reads
   as a band rather than as another row. It must be opaque: it is sticky, and rows slide behind. */
th{background:var(--panel);position:sticky;top:var(--topbar);z-index:5;font-weight:600;font-size:.82rem;
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
/* A fold is a control, so it should look like one. It sits on the raised tone rather than the
   section's own — background:var(--panel) made it the same colour as the card around it, so the
   thing a reader is meant to click was distinguishable only by its border. The marker turns
   when it opens, which is the affordance that says "there is more here". */
details{margin:.9rem 0;border:1px solid var(--line);border-radius:8px;background:var(--raised);
  padding:.1rem .9rem}
details[open]{padding-bottom:.6rem}
summary{cursor:pointer;padding:.55rem 0;font-size:.92rem;color:var(--acc);font-weight:600;
  list-style:none;display:flex;align-items:center;gap:.5rem}
summary::-webkit-details-marker{display:none}
summary::before{content:"";width:0;height:0;flex:0 0 auto;
  border:.34rem solid transparent;border-left-color:currentColor;
  transition:transform .12s ease;transform-origin:.17rem 50%}
details[open]>summary::before{transform:rotate(90deg)}
summary:hover{color:var(--fg)}
details .tw{border:none;background:none}
hr{border:none;border-top:1px solid var(--line);margin:2rem 0}

/* search results */
.res{list-style:none;margin:0;padding:0}
.res li{border-bottom:1px solid var(--line);padding:.42rem .2rem}
.res li:last-child{border-bottom:none}
/* Named "kind", not "sec". It was "sec", which later became the class for a section CARD — so
   every result's little grey label was quietly given a panel background, a border and 1.15rem
   of padding. A generic class name meeting a generic class name.
   (No backticks in this stylesheet: it is a template literal, and one closes it.) */
.res .kind{color:var(--dim);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}

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
    ["/regions.md", "All regions"], ["/settlements.md", "All settlements"],
    ["/units.md", "All units"], ["/buildings.md", "All buildings"], ["/trade-goods.md", "Trade goods"]]],
  ["Overviews", [["/factions-overview.md", "Factions vs vanilla"], ["/map-and-regions.md", "The map"],
    ["/units-overview.md", "Roster vs vanilla"]]],
  ["Region tags", [["/tags.md", "All reference tables"], ["/tags/terrain.md", "Terrain"],
    ["/tags/climate.md", "Climate"], ["/tags/irrigation.md", "Irrigation"],
    ["/tags/ports.md", "Ports"], ["/tags/recruitment-zones.md", "Recruitment zones"],
    ["/tags/specialty-recruitment.md", "Specialty recruitment"],
    ["/tags/cultural-homeland.md", "Cultural homelands"],
    ["/tags/hazards-and-river-trade.md", "Hazards and river trade"],
    ["/tags/fertility.md", "Fertility"]]],
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
    // Named explicitly rather than derived from the directory: the trade goods live in goods/
    // but their index is trade-goods.md, so "<dir>.md" would have produced a crumb pointing at
    // a file that does not exist — which the existence check below turns into an unlinked word,
    // silently losing the way back up.
    const INDEX_OF = {
      factions: "/factions.md", regions: "/regions.md", settlements: "/settlements.md",
      units: "/units.md", buildings: "/buildings.md", tags: "/tags.md", goods: "/trade-goods.md",
    };
    const overview = INDEX_OF[section] || null;
    out.push(overview && fs.existsSync(path.join(ROOT, overview.slice(1)))
      ? `<a href="${overview}">${esc(section)}</a>` : esc(section));
  }
  return `<div class="crumb">${out.join(" › ")}</div>`;
}

// The page's own sections, as a strip in the bar. The bar is sticky, so they stay reachable
// however far down you are — which is the point on a page of 22 sections where the alternative
// is scrolling back to the top to reach the next one.
//
// The label is the text before the first "·". These headings carry their counts now — "Gallic ·
// 44 factions · 43 hold territory at the start" — and a bar of those is unreadable and does not
// fit. A heading with no "·" keeps all of its text, so this costs nothing on other pages.
//
// H2s if the page has any, H3s otherwise: a page whose runs are H3s (the faction index) is
// exactly the page this is for, and mixing both levels would list a section and its subsections
// side by side as equals.
function jumpStrip(toc) {
  if (!toc || !toc.length) return "";
  const level = toc.some((t) => t.level === 2) ? 2 : 3;
  const items = toc.filter((t) => t.level === level);
  if (items.length < 2) return "";     // a strip pointing at one place is furniture, not a tool
  const short = (s) => String(s).split("·")[0].replace(/<[^>]*>/g, "").trim() || s;
  return `<div class="jump">${items.map((t) => `<a href="#${t.id}">${esc(short(t.text))}</a>`).join("")}</div>`;
}

const SHELL = (title, body, rel, toc) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — RIS wiki</title>
<style>${CSS}</style></head><body${jumpStrip(toc) ? ' class="has-jump"' : ""}>
<div class="top">
  <div class="bar">
  <a class="brand" href="/README.md"><img src="/art/ris-mark.png" alt="">Imperium <span>Surrectum</span></a>
  <form action="/search" method="get" role="search">
    <input name="q" type="search" placeholder="Search ${INDEX.length.toLocaleString("en-US")} pages — a faction, region or unit…" autocomplete="off">
  </form>
  <div class="right">
    <button id="theme" type="button" title="Switch theme">theme</button>
    <span>local preview</span>
  </div>
  </div>
  ${jumpStrip(toc)}
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

  // The jump strip marks where you are. On a page of 22 sections the strip otherwise tells you
  // where you could go and nothing about where you have got to, and the strip itself scrolls
  // sideways — so the current entry is brought into view rather than left off the end of it.
  //
  // IntersectionObserver rather than a scroll handler: a scroll handler on a 4,000-row page
  // fires on every frame and has to measure each heading, which is what made the pointer
  // stutter on the big tables before. This does the work only when a heading crosses the line.
  var strip = document.querySelector(".jump");
  if (strip && window.IntersectionObserver) {
    var links = {}, order = [], seen = {};
    Array.prototype.forEach.call(strip.querySelectorAll("a"), function(a){
      var id = decodeURIComponent(a.getAttribute("href").slice(1));
      links[id] = a; order.push(id);
    });
    var mark = function(){
      var active = null;
      for (var i = 0; i < order.length; i++) if (seen[order[i]]) active = order[i];
      Array.prototype.forEach.call(strip.querySelectorAll("a.on"), function(a){ a.classList.remove("on"); });
      if (active && links[active]) {
        links[active].classList.add("on");
        var a = links[active], l = a.offsetLeft, r = l + a.offsetWidth;
        if (l < strip.scrollLeft || r > strip.scrollLeft + strip.clientWidth) {
          strip.scrollTo({ left: Math.max(0, l - strip.clientWidth / 3), behavior: "smooth" });
        }
      }
    };
    // The trigger line sits just under the bar. A heading counts as reached once its top passes
    // it, and stops counting when it scrolls back below — so "active" is the last one crossed.
    var top = parseFloat(getComputedStyle(document.body).getPropertyValue("--topbar")) || 3.1;
    var px = top * parseFloat(getComputedStyle(document.documentElement).fontSize || 16);
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ seen[e.target.id] = e.boundingClientRect.top < px + 8; });
      mark();
    }, { rootMargin: (-Math.round(px) - 8) + "px 0px 0px 0px", threshold: 0 });
    order.forEach(function(id){ var el = document.getElementById(id); if (el) io.observe(el); });
  }
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
    // Grouped by what KIND of page each hit is. A flat list was fine when the wiki was factions
    // and regions; there are now nine families, and "Rome" matches a region, a settlement, a
    // faction and a fistful of units, which as one list of 200 is a pile to sift rather than an
    // answer. The order is the order someone is most likely to have meant, and any family not
    // named here still appears, after them — a new page family must not fall out of search
    // because nobody added it to a list.
    const ORDER = ["overview", "factions", "regions", "settlements", "units", "buildings",
      "goods", "cultures", "religions", "sizes", "tags"];
    const groups = new Map();
    for (const h of hits) {
      if (!groups.has(h.section)) groups.set(h.section, []);
      groups.get(h.section).push(h);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      const ia = ORDER.indexOf(a[0]), ib = ORDER.indexOf(b[0]);
      return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib) || a[0].localeCompare(b[0]);
    });
    const body = `<h1>Search</h1><p>${hits.length
      ? `${hits.length}${hits.length === 200 ? "+" : ""} page${hits.length === 1 ? "" : "s"} matching <code>${esc(q)}</code>`
        + `, in ${ordered.length} ${ordered.length === 1 ? "section" : "sections"}.`
      : `Nothing matches <code>${esc(q)}</code>.`}</p>`
      + ordered.map(([kind, list]) =>
        // H3 rather than H2: these are runs of one list, and an H2 would box each of them.
        `<h3 id="${slugId(kind)}">${esc(kind)} · ${list.length}</h3>`
        + `<ul class="res">${list.map((h) =>
          `<li><a href="${h.rel}">${esc(h.title)}</a></li>`).join("")}</ul>`).join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const toc = ordered.map(([kind, list]) => ({ id: slugId(kind), text: `${kind} · ${list.length}`, level: 3 }));
    res.end(SHELL(`Search: ${q}`, body, "/search", toc));
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
    // The toc has to be held, not passed inline: renderMarkdown fills the array it is given, and
    // the array was being created in the argument list and dropped, so the bar had nothing to
    // build a jump strip from.
    const toc = [];
    res.end(SHELL(title, sectionise(renderMarkdown(md, toc)), rel, toc));
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

// Exported so a static exporter can render the SAME html this serves, rather than growing a
// second renderer that drifts from it. Guarded on require.main so requiring this file does not
// start a server — without the guard, importing the renderer would silently take a port.
module.exports = { renderMarkdown, sectionise, SHELL, CSS, slugId, INDEX, ROOT };

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}/README.md`;
    console.log(`RIS wiki preview: ${url}`);
    console.log(`  serving ${ROOT}`);
    console.log(`  ${INDEX.length.toLocaleString("en-US")} pages indexed for search`);
    console.log(`  Ctrl+C to stop`);
    openBrowser(url);
  });
}
