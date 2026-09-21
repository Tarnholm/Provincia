#!/usr/bin/env node
/**
 * npm run ship — one-command release, with the publish VERIFIED at the end.
 *
 * Exists because of the v0.9.1269 gap: a release was committed and tagged but
 * never published, so the update feed silently kept serving the previous
 * version. This script makes "shipped" mean "the update feed serves it".
 *
 * Flow (each step prints, any failure aborts loudly):
 *   1. Preflight  — on master, GH_TOKEN set, top changelog entry is a NEW
 *                   version (that entry defines the release version).
 *   2. Bump       — package.json version := top changelog version.
 *   2b. Bundle    — regenerate the TRACKED build inputs (AI-log patterns,
 *                   public/ mod data from C:\RIS) BEFORE the tests and the
 *                   commit, so the suite tests what ships and the release
 *                   commit holds what the installer holds. (The build's
 *                   prebuild used to do this AFTER the commit: every ship left
 *                   public/ dirty, and a re-run after a failed publish then
 *                   aborted on "tree has new changes".)
 *   2c. Manifest  — the exact set of paths this release will commit, printed.
 *   3. Test       — vitest run (full suite).
 *   4. Commit     — ONLY the manifest paths, "Ship vX.Y.Z: <summary>". Aborts
 *                   if the working tree changed while the tests ran (another
 *                   session writing into the repo) — `git add -A` used to
 *                   sweep that in unseen. Untracked files outside the known
 *                   source folders are refused unless named with --allow=<path>.
 *                   Summary = CLI arg (`npm run ship -- "message"`) or derived
 *                   from the top changelog item.
 *   5. Tag + push — tag vX.Y.Z, push branch + tags.
 *   6. Build      — npm run build (prebuild re-runs the bundle: a no-op now).
 *   7. Publish    — electron-builder --win nsis --publish always.
 *   8. Verify     — poll the GitHub latest.yml update feed until it serves
 *                   the new version (this is the step 1269 was missing).
 *
 * Re-runnable after a mid-flight failure: commit/tag steps skip themselves
 * when already done for this version.
 */
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FEED_URL = "https://github.com/Tarnholm/Provincia/releases/latest/download/latest.yml";

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}
function run(label, cmd, args) {
  console.log(`\n=== ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status}). Fix and re-run npm run ship — completed steps skip themselves.`);
}
function fail(msg) {
  console.error(`\nSHIP ABORTED: ${msg}`);
  process.exit(1);
}

// ---------- 1. Preflight ----------
console.log("=== Preflight");
const branch = sh("git branch --show-current");
if (branch !== "master") fail(`on branch "${branch}", releases ship from master.`);
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  fail("GH_TOKEN is not set in this environment — electron-builder cannot publish. (It is normally set in the user's env; check the shell you're running in.)");
}

// Crash reporter: bundled from disk, deliberately untracked.
//
// This repo is PUBLIC. v0.9.1438 committed crash-reporter/crash_reporter.py with
// the live Discord webhook in it; GitHub secret scanning reported it, Discord
// deleted the webhook, and every tester's upload started failing with
// "Unknown Webhook" — with no visible symptom on our side, because the reporter
// only fails on the testers' machines. So: the source is gitignored and copied
// in before packaging, and this guard enforces all three ways that can go wrong.
{
  const crDir = path.join(ROOT, "crash-reporter");
  for (const f of ["crash_reporter.py", "ai_log_patterns.py", "crash_reporter.ini.example"]) {
    const p = path.join(crDir, f);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      fail(`crash-reporter/${f} is missing or empty — it is untracked on purpose, so a fresh clone does not have it. Copy the current files in from ..\\RIS-CrashReporter before shipping (otherwise this release bundles a reporter that cannot run).`);
    }
  }
  // Never let the webhook back into a public commit.
  const tracked = sh('git ls-files "crash-reporter/*.py" "crash-reporter/crash_reporter.ini.example"');
  if (tracked) {
    fail(`these crash-reporter files are tracked by git again:\n  ${tracked.split("\n").join("\n  ")}\nThey contain the live Discord webhook and this repo is public — committing them gets the webhook revoked (it already happened once). Run: git rm --cached <files>  and check .gitignore.`);
  }
  // A retired webhook builds and installs fine and simply uploads nothing.
  const py = fs.readFileSync(path.join(crDir, "crash_reporter.py"), "utf8");
  const dflt = py.match(/^DEFAULT_WEBHOOK_URL\s*=\s*"([^"]+)"/m);
  const retiredBlock = py.match(/RETIRED_WEBHOOK_IDS\s*=\s*\{([\s\S]*?)\}/);
  const retired = retiredBlock ? [...retiredBlock[1].matchAll(/"(\d{15,25})"/g)].map((m) => m[1]) : [];
  const dfltId = dflt && dflt[1].match(/\/webhooks\/(\d+)/);
  if (!dflt || !dfltId) fail("could not read DEFAULT_WEBHOOK_URL out of crash-reporter/crash_reporter.py.");
  if (retired.includes(dfltId[1])) {
    fail(`crash-reporter/crash_reporter.py still has a RETIRED webhook as its default (id ${dfltId[1]}) — this release would collect no reports at all. Create a new webhook in Discord and update DEFAULT_WEBHOOK_URL in ..\\RIS-CrashReporter, then copy it in.`);
  }
}

const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

// The top entry of src/changelog.js names the version being shipped. Parsing
// the first `version: "..."` is enough — entries are newest-first by contract.
let changelogSrc = fs.readFileSync(path.join(ROOT, "src", "changelog.js"), "utf8");
const verMatch = changelogSrc.match(/version:\s*"([\d.]+)"/);
if (!verMatch) fail("could not find a version in src/changelog.js.");
const version = verMatch[1];
const tag = `v${version}`;

const tagExistsLocally = sh(`git tag -l "${tag}"`) !== "";
const tagAtHead = tagExistsLocally && sh(`git rev-parse ${tag}`) === sh("git rev-parse HEAD");
const treeDirty = sh("git status --short") !== "";
if (tagExistsLocally && !tagAtHead) {
  fail(`top changelog entry is ${version}, but tag ${tag} already exists on another commit — already shipped. Add a changelog entry for the NEW version first (that entry is what defines the release version).`);
}
if (tagAtHead && treeDirty) {
  fail(`tag ${tag} is already on HEAD but the working tree has new changes — those changes need their own release. Add a changelog entry for the NEW version first. (A clean tree here would mean a recovery re-run of ${version}, which is allowed.)`);
}

// In-app changelog cap (2026-07-16): WelcomeScreen parses the whole module
// every post-update launch, so only ~5 entries belong in src/changelog.js —
// older ones move to docs/changelog-archive.js.
//
// This used to only WARN, and was ignored for 146 releases until the file hit
// 151 entries / 110 KB (2026-07-25). A cap nobody enforces is not a cap, so the
// trim now runs automatically: it moves the overflow into the archive, verifies
// both files still import and that no entry was lost or altered, and refuses to
// write anything if that check fails.
const entryCount = (changelogSrc.match(/^  \{\s*$/gm) || []).length;
if (entryCount > 8) {
  console.log(`\n=== src/changelog.js has ${entryCount} entries (cap 8) — trimming into docs/changelog-archive.js`);
  run("Changelog trim", "node", [path.join(ROOT, "scripts", "trim-changelog.js")]);
  // re-read: the version we ship is parsed from this file further down
  changelogSrc = fs.readFileSync(path.join(ROOT, "src", "changelog.js"), "utf8");
}

const firstItem = changelogSrc.match(/text:\s*"(.*?)(?<!\\)"/s);
const defaultSummary = firstItem
  ? firstItem[1].replace(/\*\*/g, "").replace(/\\"/g, '"').split(/[.!]\s/)[0].slice(0, 100)
  : "release";
const cliArgs = process.argv.slice(2);
const allowed = cliArgs.filter((a) => a.startsWith("--allow=")).map((a) => a.slice(8).replace(/\\/g, "/").replace(/\/+$/, ""));
const summary = cliArgs.filter((a) => !a.startsWith("--allow=")).join(" ").trim() || defaultSummary;
const commitMsg = `Ship ${tag}: ${summary}`;

console.log(`Version:  ${pkg.version} -> ${version}`);
console.log(`Commit:   ${commitMsg}`);

// ---------- 2. Bump ----------
if (pkg.version !== version) {
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`\n=== Bumped package.json to ${version}`);
}

// ---------- 2b. Bundle the tracked build inputs ----------
// Only the prebuild parts that write TRACKED files; fetch-runtime stays in the
// build (its output is ignored). Skipped on a re-run of an already-tagged
// release: the tree is clean by the preflight above and must stay that way.
if (!tagAtHead) {
  run("AI-log patterns", "node", [path.join(ROOT, "scripts", "gen-ailog-patterns.js")]);
  run("Bundle mod data", "node", [path.join(ROOT, "scripts", "bundle-mod-data.js")]);
}

// ---------- 2c. Release manifest ----------
// One entry per changed path with its size+mtime, so "the same set of paths"
// and "the same contents" are both checked after the tests.
const SOURCE_DIRS = ["src", "scripts", "docs", "public", "scripts-suite", "scripts-suite-py", "bundled-mod", ".github"];
function readManifest() {
  // NOT sh(): it trims, and the first porcelain line opens with a significant space (" M path").
  const out = execSync("git status --porcelain --no-renames --untracked-files=all", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const entries = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const code = line.slice(0, 2);
    let rel = line.slice(3);
    if (rel.startsWith('"')) { try { rel = JSON.parse(rel); } catch { } }
    let sig = "gone";
    try { const st = fs.statSync(path.join(ROOT, rel)); sig = `${st.size}:${Math.floor(st.mtimeMs)}`; } catch { }
    entries.push({ code, rel, sig });
  }
  return entries;
}
const manifest = readManifest();
{
  const stray = manifest.filter((e) => e.code === "??" && !SOURCE_DIRS.some((d) => e.rel.startsWith(d + "/")) && !allowed.some((a) => e.rel === a || e.rel.startsWith(a + "/")));
  if (stray.length) {
    fail(`untracked file(s) outside the source folders would be committed into a PUBLIC release:\n  ${stray.map((e) => e.rel).join("\n  ")}\nDelete them, gitignore them, or name each with --allow=<path> if it really belongs in the repo.`);
  }
  console.log(manifest.length
    ? `\n=== This release commits exactly these ${manifest.length} path(s):\n${manifest.map((e) => `  ${e.code} ${e.rel}`).join("\n")}`
    : "\n=== Working tree clean (re-run / already committed).");
}

// ---------- 3. Test ----------
run("Test", "npx", ["vitest", "run"]);

// ---------- 4. Commit ----------
if (manifest.length) {
  // Anything that moved while the suite ran was written by someone else (a
  // second session working in this repo) — it has not been tested and nobody
  // chose to ship it.
  const now = readManifest();
  const key = (e) => `${e.code} ${e.rel} ${e.sig}`;
  const before = new Set(manifest.map(key));
  const moved = now.filter((e) => !before.has(key(e))).map((e) => `${e.code} ${e.rel}`);
  const after = new Set(now.map(key));
  const vanished = manifest.filter((e) => !after.has(key(e)) && !now.some((n) => n.rel === e.rel)).map((e) => `${e.code} ${e.rel} (no longer changed)`);
  if (moved.length || vanished.length) {
    fail(`the working tree changed while the tests ran — something else is writing into this repo:\n  ${[...moved, ...vanished].join("\n  ")}\nNothing was committed. Re-run npm run ship once the other work is finished (or committed on its own).`);
  }
  const listFile = path.join(require("os").tmpdir(), `provincia-ship-paths-${process.pid}.txt`);
  fs.writeFileSync(listFile, manifest.map((e) => e.rel).join("\0"));
  try { sh(`git add --pathspec-from-file="${listFile}" --pathspec-file-nul`); }
  finally { try { fs.unlinkSync(listFile); } catch { } }
  sh(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
  console.log(`\n=== Committed: ${commitMsg}`);
} else {
  console.log("\n=== Nothing to commit (already committed).");
}

// ---------- 5. Tag + push ----------
if (!tagAtHead && sh(`git tag -l "${tag}"`) === "") sh(`git tag ${tag}`);
console.log(`\n=== Tagged ${tag}, pushing...`);
run("Push", "git", ["push", "origin", "master", "--tags"]);

// ---------- 6 + 7. Build + publish ----------
run("Build", "npm", ["run", "build"]);
{
  // The bundle already ran before the commit, so the build must not move any
  // tracked file. If it did, C:\RIS changed during this ship: the installer
  // about to be published holds files the release commit does not.
  const drift = sh("git status --short");
  if (drift) console.warn(`\n!!! The build changed tracked files AFTER the release commit — the mod data moved while shipping:\n${drift}\n!!! The installer carries these; commit them on their own after this ship so the source matches it.`);
}
run("Publish", "npx", ["electron-builder", "--win", "nsis", "--publish", "always"]);

// ---------- 8. Verify the update feed ----------
(async () => {
  console.log(`\n=== Verifying update feed serves ${version} (${FEED_URL})`);
  const ATTEMPTS = 20, DELAY_S = 15;
  for (let i = 1; i <= ATTEMPTS; i++) {
    let served = null;
    try {
      const res = await fetch(FEED_URL, { redirect: "follow" });
      if (res.ok) served = (await res.text()).match(/^version:\s*(\S+)/m)?.[1] ?? null;
    } catch { /* network hiccup — retry */ }
    if (served === version) {
      console.log(`\nSHIPPED AND VERIFIED: update feed serves ${version}.`);
      console.log("(mac build is manual-only: run build-mac.yml from the Actions tab if a DMG is wanted.)");
      return;
    }
    console.log(`  attempt ${i}/${ATTEMPTS}: feed serves ${served ?? "unreachable"} — waiting ${DELAY_S}s...`);
    await new Promise((r) => setTimeout(r, DELAY_S * 1000));
  }
  fail(`update feed still does not serve ${version} after ${ATTEMPTS} attempts. The release may be a draft or the publish failed — check https://github.com/Tarnholm/Provincia/releases and re-run npm run ship (completed steps skip themselves).`);
})();
