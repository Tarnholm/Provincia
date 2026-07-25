// @vitest-environment node
//
// THE RULE: the app must never say "crack" / "cracked" / "cracking" to the user.
//
// The word is internal jargon for reading the save file's binary format, and it
// had leaked into tooltips, buttons, error messages, progress text, changelog
// entries and log lines. The user asked for it gone and for the ban to be a
// standing rule — so it is enforced here rather than left to memory.
//
// WHAT IS BANNED: the word inside any string literal or JSX text. That covers
// everything a user can read, including provincia.log (which they open when
// something goes wrong) and the Welcome screen's changelog.
//
// WHAT IS ALLOWED: internal identifiers and file paths — `crackSave()`,
// `saveCracker.js`, the `crack-save` IPC channel, `runCrackWorker`. Renaming
// those is a separate refactor that touches the preload bridge, and none of it
// is user-facing. Code COMMENTS are also allowed: they explain the binary format
// work to whoever maintains this, and they ship to nobody.
//
// If this test fails, do not add to the allow-list — rewrite the string. The
// established replacement is "read" (for the action) or "decoded" (for
// provenance: "decoded 2026-05-10", "the decoded income model").

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = __dirname;
const ROOT = path.resolve(__dirname, "..");
// The main process and the preload bridge produce user-visible text too (dialog
// titles, error messages, log lines), so they are in scope. `scripts/` is not —
// those are development tools that never ship inside the app.
const EXTRA_FILES = ["main.js", "main-scripts.js", "preload.js"]
  .map((f) => path.join(ROOT, f))
  .filter((f) => fs.existsSync(f));

// Identifier / module-path / IPC-channel forms that are internal plumbing.
// Matched case-sensitively where it matters so bare prose "crack" can't hide.
const ALLOWED_IDENTIFIERS = [
  /\bcrackSave\b/g,
  /\bcrackSaveOnce\b/g,
  /\bsaveCracker\b/g,
  /\bsaveCrackerExtras\b/g,
  /\bsaveCrackWorker\b/g,
  /\brunCrackWorker\b/g,
  /\bCRACK_WORKER_PATH\b/g,
  /\bpreCracked\b/g,
  /\b_?inflightCrack\b/g,
  /\bcrack-save\b/g,                 // IPC channel
  /\bcrack-trade-network\b/g,        // IPC channel
  /\.\/saveCracker\w*\.js/g,
  /\.\/saveCrackWorker\.js/g,
];

function collectFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(p));
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// Pull the string literals and JSX text out of a line, skipping comments.
// Deliberately simple: it over-collects rather than under-collects, because a
// false positive costs one rewrite and a false negative ships the word.
function userVisibleText(line, inBlockComment) {
  const trimmed = line.trim();
  if (inBlockComment) return "";
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) return "";
  const withoutLineComment = line.replace(/\/\/.*$/, "");
  const literals = withoutLineComment.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || [];
  const jsxText = withoutLineComment.match(/>[^<>{}]*</g) || [];
  return [...literals, ...jsxText].join(" ");
}

function scan() {
  const offences = [];
  for (const file of [...collectFiles(SRC), ...EXTRA_FILES]) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    let inBlock = false;
    lines.forEach((line, i) => {
      const opensBlock = /\/\*/.test(line) && !/\*\//.test(line);
      const closesBlock = inBlock && /\*\//.test(line);
      const wasInBlock = inBlock;
      if (closesBlock) inBlock = false;
      else if (opensBlock) inBlock = true;

      if (!/crack/i.test(line)) return;
      let text = userVisibleText(line, wasInBlock && !closesBlock);
      if (!text) return;
      for (const rx of ALLOWED_IDENTIFIERS) text = text.replace(rx, "");
      if (/crack/i.test(text)) {
        offences.push(`${rel}:${i + 1} — ${line.trim().slice(0, 160)}`);
      }
    });
  }
  return offences;
}

describe('the app never says "crack" to the user', () => {
  const offences = scan();

  it("has no user-visible string or JSX text containing the word", () => {
    expect(
      offences,
      'Rewrite the string — do not extend ALLOWED_IDENTIFIERS. Use "read" for the action ' +
      'and "decoded" for provenance.'
    ).toEqual([]);
  });

  it("actually catches the word when it is reintroduced (the guard is not vacuous)", () => {
    // prove the matcher works on each shape the word previously appeared in
    const cases = [
      '  _prog("save", "cracking the save file");',
      '  title="decoded via save-cracker session 3"',
      '  return { error: `Cracked 0 of ${n} save(s)` };',
      '  <span>3 crack error(s)</span>',
      "  { type: 'fix', text: 'Cracking a 45MB save takes 12s' },",
    ];
    for (const line of cases) {
      let text = userVisibleText(line, false);
      for (const rx of ALLOWED_IDENTIFIERS) text = text.replace(rx, "");
      expect(/crack/i.test(text), `should have been flagged: ${line}`).toBe(true);
    }
  });

  it("does not flag internal identifiers, module paths or comments", () => {
    const allowed = [
      '  const { crackSave } = require("./saveCracker.js");',
      '  ipcMain.handle("crack-save", async (_e, p) => {',
      '  return await runCrackWorker("trade", { preCracked });',
      '  // cracking the save takes 12s, hence the worker',
      '   * The crack is self-contained (buffer in, object out).',
    ];
    for (const line of allowed) {
      let text = userVisibleText(line, false);
      for (const rx of ALLOWED_IDENTIFIERS) text = text.replace(rx, "");
      expect(/crack/i.test(text), `should NOT have been flagged: ${line}`).toBe(false);
    }
  });
});
