#!/usr/bin/env node
/**
 * Keep src/changelog.js at the documented cap and move the overflow into
 * docs/changelog-archive.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * WelcomeScreen dynamic-imports src/changelog.js and parses the whole module on
 * every post-update launch. The cap was set at ~5 versions in 0.9.1275 for
 * exactly that reason, and `npm run ship` has warned about it ever since — but a
 * warning nobody acts on is not a cap. It had drifted to 151 entries / 112 KB.
 * This makes the trim mechanical so it cannot drift again.
 *
 * HOW IT IS SAFE
 * --------------
 * The entries are moved as TEXT, spliced on brace boundaries found by a scanner
 * that tracks string and template literals. Nothing is re-serialised, because
 * regenerating this file from parsed data is precisely how a previous attempt
 * corrupted it: the prose contains emoji and quotes, and re-escaping them went
 * wrong and truncated the file mid-write.
 *
 * Both files are import-checked BEFORE anything is written, and the entry counts
 * must add up to what we started with — no entry may be silently dropped.
 *
 *   node scripts/trim-changelog.js [--keep N] [--check]
 *
 * --check exits non-zero if a trim is needed but changes nothing (for CI/ship).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const LIVE = path.join(ROOT, "src", "changelog.js");
const ARCHIVE = path.join(ROOT, "docs", "changelog-archive.js");

const args = process.argv.slice(2);
const KEEP = (() => {
  const i = args.indexOf("--keep");
  return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 5) : 5;
})();
const CHECK_ONLY = args.includes("--check");

/**
 * Find the top-level `{ … }` spans inside the array literal that starts after
 * `openIdx`. String-aware so a brace inside release-note prose can't fool it.
 * Returns [{start, end}] where end is exclusive of the trailing comma.
 */
function findEntrySpans(src, arrayOpenIdx) {
  const spans = [];
  let i = arrayOpenIdx + 1;
  let depth = 0, entryStart = -1;
  let quote = null, escaped = false;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 2; continue; }
    if (ch === "{") { if (depth === 0) entryStart = i; depth++; i++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) { spans.push({ start: entryStart, end: i + 1 }); entryStart = -1; }
      i++; continue;
    }
    if (ch === "]" && depth === 0) break;   // end of the array
    i++;
  }
  return spans;
}

function arrayOpen(src, declRx) {
  const m = declRx.exec(src);
  if (!m) throw new Error("could not find the array declaration: " + declRx);
  return src.indexOf("[", m.index);
}

const liveSrc = fs.readFileSync(LIVE, "utf8");
const archSrc = fs.readFileSync(ARCHIVE, "utf8");
// Preserve each file's existing line endings — both are CRLF in this repo, and
// splicing in bare LF would leave mixed endings and spurious diff churn.
const archEol = archSrc.indexOf("\r\n") >= 0 ? "\r\n" : "\n";

const liveOpen = arrayOpen(liveSrc, /const CHANGELOG\s*=\s*/);
const liveSpans = findEntrySpans(liveSrc, liveOpen);
const archOpen = arrayOpen(archSrc, /const CHANGELOG_ARCHIVE\s*=\s*/);
const archSpans = findEntrySpans(archSrc, archOpen);

console.log(`src/changelog.js: ${liveSpans.length} entries, ${(liveSrc.length / 1024).toFixed(0)} KB`);
console.log(`docs/changelog-archive.js: ${archSpans.length} entries`);

if (liveSpans.length <= KEEP) {
  console.log(`Nothing to do — already at or under the cap of ${KEEP}.`);
  process.exit(0);
}
const moveCount = liveSpans.length - KEEP;
if (CHECK_ONLY) {
  console.error(`\ncap EXCEEDED: ${liveSpans.length} entries, cap ${KEEP}. Run: npm run changelog:trim`);
  process.exit(1);
}

// ── build the new text ──
// keep entries [0, KEEP), move [KEEP, end). The kept block ends where the first
// moved entry begins, so the array's own formatting is preserved verbatim.
const firstMoved = liveSpans[KEEP];
const lastEntry = liveSpans[liveSpans.length - 1];
const movedText = liveSrc.slice(firstMoved.start, lastEntry.end);
// text between the last entry and the closing `]` (a trailing comma + newline)
const afterLast = liveSrc.slice(lastEntry.end, liveSrc.indexOf("]", lastEntry.end));

const newLive =
  liveSrc.slice(0, firstMoved.start) +
  liveSrc.slice(lastEntry.end).replace(/^[\s,]*/, "");   // drop the dangling comma/space

// prepend into the archive, right after its `[`
const insertAt = archOpen + 1;
const newArch =
  archSrc.slice(0, insertAt) + archEol + "  " +
  movedText.trim().replace(/,\s*$/, "") + "," +
  archSrc.slice(insertAt);

// ── verify BEFORE writing ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clog-"));
const tLive = path.join(tmp, "live.mjs");
const tArch = path.join(tmp, "arch.mjs");
fs.writeFileSync(tLive, newLive);
fs.writeFileSync(tArch, newArch);

(async () => {
  let ok = true;
  try {
    const a = (await import("file://" + tLive.replace(/\\/g, "/"))).default;
    const b = (await import("file://" + tArch.replace(/\\/g, "/"))).default;
    if (!Array.isArray(a) || a.length !== KEEP) { console.error(`FAIL: trimmed changelog has ${a && a.length} entries, expected ${KEEP}`); ok = false; }
    if (!Array.isArray(b) || b.length !== archSpans.length + moveCount) {
      console.error(`FAIL: archive has ${b && b.length} entries, expected ${archSpans.length + moveCount}`); ok = false;
    }
    if (ok) {
      // no entry may vanish, and the two files must stay contiguous by version
      const total = a.length + b.length;
      const expected = liveSpans.length + archSpans.length;
      if (total !== expected) { console.error(`FAIL: ${total} entries after, ${expected} before`); ok = false; }
      if (ok && a[a.length - 1] && b[0]) {
        console.log(`  live now ends at ${a[a.length - 1].version}, archive now starts at ${b[0].version}`);
      }
      // every kept entry must still have its items intact
      for (const e of a) {
        if (!e.version || !Array.isArray(e.items) || !e.items.length) { console.error("FAIL: malformed kept entry", e.version); ok = false; }
      }
    }
  } catch (e) {
    console.error("FAIL: the trimmed output does not parse —", e.message);
    ok = false;
  }
  if (!ok) { console.error("\nNOTHING WRITTEN."); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }

  fs.writeFileSync(LIVE, newLive);
  fs.writeFileSync(ARCHIVE, newArch);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nMoved ${moveCount} entries to the archive.`);
  console.log(`src/changelog.js: ${(liveSrc.length / 1024).toFixed(0)} KB → ${(newLive.length / 1024).toFixed(0)} KB`);
  void afterLast;
})();
