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
 *   3. Test       — vitest run (full suite).
 *   4. Commit     — everything in the tree, "Ship vX.Y.Z: <summary>".
 *                   Summary = CLI arg (`npm run ship -- "message"`) or derived
 *                   from the top changelog item.
 *   5. Tag + push — tag vX.Y.Z, push branch + tags.
 *   6. Build      — npm run build (prebuild bundles mod data + runtime).
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
  console.log(`\n=== src/changelog.js has ${entryCount} entries (cap ~5) — trimming into docs/changelog-archive.js`);
  run("Changelog trim", "node", [path.join(ROOT, "scripts", "trim-changelog.js")]);
  // re-read: the version we ship is parsed from this file further down
  changelogSrc = fs.readFileSync(path.join(ROOT, "src", "changelog.js"), "utf8");
}

const firstItem = changelogSrc.match(/text:\s*"(.*?)(?<!\\)"/s);
const defaultSummary = firstItem
  ? firstItem[1].replace(/\*\*/g, "").replace(/\\"/g, '"').split(/[.!]\s/)[0].slice(0, 100)
  : "release";
const summary = process.argv.slice(2).join(" ").trim() || defaultSummary;
const commitMsg = `Ship ${tag}: ${summary}`;

console.log(`Version:  ${pkg.version} -> ${version}`);
console.log(`Commit:   ${commitMsg}`);
const dirty = sh("git status --short");
console.log(dirty ? `Shipping these working-tree changes:\n${dirty}` : "Working tree clean (re-run / already committed).");

// ---------- 2. Bump ----------
if (pkg.version !== version) {
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`\n=== Bumped package.json to ${version}`);
}

// ---------- 3. Test ----------
run("Test", "npx", ["vitest", "run"]);

// ---------- 4. Commit ----------
if (sh("git status --short") !== "") {
  sh("git add -A");
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
