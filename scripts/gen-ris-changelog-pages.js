#!/usr/bin/env node
// changelog.md and changelog/<version>.md: the mod team's own release notes, one page per
// version, read from the changelog folder that ships with the mod (C:/RIS/RIS/changelog/*.txt).
// The wording is the team's, unchanged; only the layout becomes markdown:
//   - "1." items stay a numbered list, "-" and "+" items become bullets, and deeper
//     indentation becomes nested bullets (each file's own indent widths give the depth);
//   - a line of its own that ends in ":" ("What's Changed (v. 0.3.0):", "The team!:") becomes a
//     heading, without the colon;
//   - the "* = Need to start a new campaign" footnote keeps its asterisk in code, since a line
//     starting with "* " would otherwise render as a bullet.
// Unit, faction, building, settlement and reform names in the changes are linked to their pages
// (lib/wikiLinker.js reads those names from the generated wiki, so this runs after every page
// family). The credits sections are left unlinked: they are people's names, and several of them
// ("Apple", "Rex", "Saxon", "Messenger") are also names of things in the game.
//
//   node scripts/gen-ris-changelog-pages.js [--src C:/RIS/RIS/changelog] [--out C:/RIS/_wiki]
const fs = require("fs");
const path = require("path");

const valOf = (flag, dflt) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : dflt; };
const SRC = valOf("--src", "C:/RIS/RIS/changelog");
const OUT = valOf("--out", "C:/RIS/_wiki");
const DIR = path.join(OUT, "changelog");
// Phrases where a name means something else: a game title, the units rather than the trade good,
// a unit style rather than the faction, a script rather than the building, a building rather
// than the goods (found in review, 2026-09-29).
const LINK = require(path.join(__dirname, "lib", "wikiLinker.js")).makeLinker(OUT, {
  root: "../",
  exclude: ["TW: Rome 2", "Seleucid Elephants", "Bronze Age Egyptians", "Garrison script", "Stone Walls", "Silver and gold mines"],
});

// ── the files ────────────────────────────────────────────────────────────────
// "0.1.0.txt", and "0.0.0 teaser.txt", whose word after the number is its label.
let files = [];
try { files = fs.readdirSync(SRC).filter((f) => /^\d+\.\d+\.\d+.*\.txt$/i.test(f)); } catch { /* none */ }
if (!files.length) { console.error(`no changelog files in ${SRC}`); process.exit(2); }
const versions = files.map((f) => {
  const m = /^(\d+)\.(\d+)\.(\d+)\s*(.*?)\.txt$/i.exec(f);
  return { file: f, ver: `${m[1]}.${m[2]}.${m[3]}`, key: [+m[1], +m[2], +m[3]], label: m[4].trim() };
}).sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2]);   // newest first

// ── one file to markdown ─────────────────────────────────────────────────────
const CREDITS = /^(the team|new members)/i;

function convert(text) {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  // Depth of an item from its indent: this file's distinct indent widths, in order.
  const itemRe = /^(\s*)(\d+\.|[-+*])\s+(.*)$/;
  const indents = [...new Set(raw.map((l) => itemRe.exec(l)).filter(Boolean).map((m) => m[1].length))].sort((a, b) => a - b);

  const out = [];          // markdown lines
  const sections = [];     // { credits, start, end } ranges of out, for linking
  let sec = { credits: false, start: 0 };
  let stack = [];          // open items: { depth, contentCol }
  let topItems = 0;
  let prevWasItem = false;

  const startSection = (credits) => { sec.end = out.length; sections.push(sec); sec = { credits, start: out.length }; };

  for (const line of raw) {
    if (!line.trim()) { prevWasItem = false; continue; }
    const it = itemRe.exec(line);
    // A "*" footnote line is not an item, whatever its first character.
    if (it && !(it[2] === "*" && /^=/.test(it[3])) && !/^\\\*/.test(line.trim())) {
      const depth = Math.max(0, indents.indexOf(it[1].length));
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const pad = stack.length ? stack[stack.length - 1].contentCol : 0;
      const marker = /^\d+\.$/.test(it[2]) ? it[2] : "-";
      if (depth === 0) {
        if (!sec.credits) topItems++;
        // Numbered items are kept apart by a blank line, so a renderer without ordered lists
        // still shows each on a line of its own.
        if (out.length && out[out.length - 1] !== "" && (marker !== "-" || !prevWasItem)) out.push("");
      }
      out.push(" ".repeat(pad) + `${marker} ${it[3].trim()}`);
      stack.push({ depth, contentCol: pad + marker.length + 1 });
      prevWasItem = true;
      continue;
    }
    stack = [];
    prevWasItem = false;
    const t = line.trim();
    if (/:$/.test(t) && t.length < 120) {
      const h = t.replace(/:$/, "");
      startSection(CREDITS.test(h));
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`## ${h}`, "");
      continue;
    }
    if (out.length && out[out.length - 1] !== "") out.push("");
    // The footnote's leading asterisk, in code so it is not read as a bullet.
    const foot = /^\\?\*\s*=\s*(.*)$/.exec(t);
    out.push(foot ? `\`*\` = ${foot[1]}` : t, "");
  }
  sec.end = out.length; sections.push(sec);

  // Link each non-credits section separately (the linker links a name once per section).
  const done = [];
  for (const s of sections) {
    if (s.end <= s.start) continue;
    const chunk = out.slice(s.start, s.end).join("\n");
    done.push(s.credits ? chunk : LINK(chunk));
  }
  const md = done.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { md, topItems };
}

// ── pages ────────────────────────────────────────────────────────────────────
fs.mkdirSync(DIR, { recursive: true });
const titleOf = (v) => `${v.ver}${v.label ? ` (${v.label})` : ""}`;
for (const [i, v] of versions.entries()) {
  const { md, topItems } = convert(fs.readFileSync(path.join(SRC, v.file), "utf8"));
  v.items = topItems;
  const newer = versions[i - 1], older = versions[i + 1];
  const nav = ["[← changelog](../changelog.md)"];
  if (older) nav.push(`older: [${titleOf(older)}](${older.ver}.md)`);
  if (newer) nav.push(`newer: [${titleOf(newer)}](${newer.ver}.md)`);
  const page = `# RIS ${titleOf(v)}\n\n${nav.join(" · ")}\n\n${md}\n`;
  fs.writeFileSync(path.join(DIR, `${v.ver}.md`), page, "utf8");
}

// Pages from an earlier run whose changelog file is gone.
const keep = new Set(versions.map((v) => `${v.ver}.md`));
const stale = fs.readdirSync(DIR).filter((f) => f.endsWith(".md") && !keep.has(f));
if (stale.length) console.log(`  not written this run (no changelog file): ${stale.join(", ")}`);

// ── index ────────────────────────────────────────────────────────────────────
const series = new Map();
for (const v of versions) {
  const s = `${v.key[0]}.${v.key[1]}`;
  if (!series.has(s)) series.set(s, []);
  series.get(s).push(v);
}
// One table, newest at the top: a section per series was laid out as cards side by side, which
// read out of order (the team, 2026-09-29: "have the 0.6 up top and 0.0 at the bottom").
const index = `# Changelog

[← wiki index](README.md)

The mod team's release notes for every version of RIS, newest first.

<div class="nodeal">

| Version | Entries |
|---|---:|
${versions.map((v) => `| [${titleOf(v)}](changelog/${v.ver}.md) | ${v.items} |`).join("\n")}

</div>
`;
fs.writeFileSync(path.join(OUT, "changelog.md"), index, "utf8");
console.log(`changelog.md: ${versions.length} versions (${versions[versions.length - 1].ver} to ${versions[0].ver})`);
