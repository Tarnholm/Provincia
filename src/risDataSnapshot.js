// Test helper: RIS data files as they were at one commit of the local RIS checkout,
// written once into os.tmpdir()/ris-snap-<rev> (Git LFS files smudged) and reused.
//
// Why: the trade engine's live tests compare against numbers captured from the running
// game on 2026-10-01/02. RIS keeps changing (government trade income, factions, the
// map), so reading whatever C:\RIS has checked out made those tests fail for data
// drift, not for engine bugs. Pinning the mod data to the capture's commit keeps them
// an exact regression guard for the engine.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_PATTERNS = [
  /^RIS\/data\/[^/]+\.txt$/,
  /^RIS\/data\/world\/maps\/base\/(descr_regions\.txt|map\.rwm|map_regions\.tga)$/,
  /^RIS\/data\/world\/maps\/campaign\/(imperial_campaign\/[^/]+\.txt|alexander\/descr_strat\.txt)$/,
  /^RIS\/data\/original_overrides\//,
];
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";

// Returns the snapshot's data folder (the equivalent of C:\RIS\RIS\data), or null when
// the repo, the commit or an LFS object is not available on this machine.
function risDataSnapshot(rev, { repo = "C:/RIS", patterns = DEFAULT_PATTERNS } = {}) {
  const dir = path.join(os.tmpdir(), `ris-snap-${rev}`);
  if (fs.existsSync(path.join(dir, ".complete"))) return dir;
  if (!fs.existsSync(path.join(repo, ".git"))) return null;
  const git = (args, opts = {}) => execFileSync("git", ["-C", repo, ...args],
    { maxBuffer: 1 << 30, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], ...opts });
  try {
    const files = git(["ls-tree", "-r", "--name-only", rev, "--", "RIS/data"], { encoding: "utf8" })
      .split("\n").filter((f) => patterns.some((rx) => rx.test(f)));
    if (!files.length) return null;
    for (const f of files) {
      let buf = git(["show", `${rev}:${f}`]);
      if (buf.subarray(0, LFS_POINTER.length).toString("latin1") === LFS_POINTER) {
        buf = git(["lfs", "smudge", "--", f], { input: buf });
      }
      const out = path.join(dir, f.slice("RIS/data/".length));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
    }
    fs.writeFileSync(path.join(dir, ".complete"), rev);
    return dir;
  } catch {
    return null;
  }
}

module.exports = { risDataSnapshot };
