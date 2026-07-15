// TEST-ONLY helper (not shipped — not required by main.js). Builds a throwaway
// mod directory in the OS temp dir so the file-WRITING IPC handlers (character
// edits, icon replace/revert, mod backups) can be driven and verified WITHOUT
// touching the user's real mod. Pair with the harness: point main.js's
// activeModDataDir at sandbox.dir (via the exported setter), invoke the handler,
// then read the sandbox file back to assert the edit landed. cleanup() removes
// the temp dir. Callers should also assert the real source file is byte-unchanged.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// entries: [{ rel, from }] copies `from` → <sandbox>/<rel>; [{ rel, content }]
// writes literal content. Parent dirs are created.
function makeModSandbox(entries = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-sandbox-"));
  for (const { rel, from, content } of entries) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (content != null) fs.writeFileSync(dest, content);
    else fs.copyFileSync(from, dest);
  }
  return {
    dir,
    path: (rel) => path.join(dir, rel),
    read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8"),
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } },
  };
}

module.exports = { makeModSandbox };
