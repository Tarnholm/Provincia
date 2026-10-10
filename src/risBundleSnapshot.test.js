// The build's RIS inputs come from a git rev, not the C:\RIS working tree
// (scripts/bundle-mod-data.js). Skipped on machines without the RIS repo.
import { describe, it, expect } from "vitest";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { risBundleSnapshot } = require("./risDataSnapshot.js");

const REPO = "C:/RIS";
const REV = "origin/alternate_map";
let hasRev = false;
try {
  execFileSync("git", ["-C", REPO, "rev-parse", "--verify", "-q", `${REV}^{commit}`], { stdio: "ignore", windowsHide: true });
  hasRev = true;
} catch { /* no repo or no rev */ }

describe("risBundleSnapshot", () => {
  it("returns null for a rev that does not exist", () => {
    expect(risBundleSnapshot("no-such-branch-xyz", { repo: REPO })).toBe(null);
  });

  it("returns null when the folder is not a git repo", () => {
    expect(risBundleSnapshot(REV, { repo: path.join(__dirname, "no-such-repo") })).toBe(null);
  });

  it.skipIf(!hasRev)("writes the rev's faction list byte-for-byte, whatever is checked out", () => {
    const snap = risBundleSnapshot(REV, { repo: REPO });
    expect(snap).not.toBe(null);
    expect(snap.commit).toMatch(/^[0-9a-f]{40}$/);
    const want = execFileSync("git", ["-C", REPO, "cat-file", "--filters", `${snap.commit}:RIS/data/descr_sm_factions.txt`],
      { maxBuffer: 1 << 28, windowsHide: true });
    const got = fs.readFileSync(path.join(snap.dir, "descr_sm_factions.txt"));
    expect(got.equals(want)).toBe(true);
    const icons = fs.readdirSync(path.join(snap.dir, "ui", "faction_icons")).filter((f) => /\.tga$/i.test(f));
    expect(icons.length).toBeGreaterThan(0);
  });
});
