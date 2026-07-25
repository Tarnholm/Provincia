// Transparently open a COMPRESSED log (2026-07-25).
//
// WHY THIS CLOSES A REAL GAP
// --------------------------
// The crash reporter ships its campaign_ai_log extract as `.txt.xz`, because that
// is the only way a 330MB log fits an attachment (lzma gets it to ~3MB; gzip could
// not). Until now the AI Movement Lab could not open one, so the pipeline stopped
// one step short of useful: the report arrived, and then somebody had to find a
// 7-Zip and unpack it by hand before Provincia would look at it.
//
// HOW
// ---
//   .gz  — Node's own zlib.
//   .xz / .lzma — Node has no xz. Provincia already bundles a Python runtime with
//     `_lzma.pyd` (it drives the Scripts suite and the crash reporter), so the
//     decompression is handed to that. No new dependency.
//
// The result is written to a temp file rather than held in memory: these extracts
// are ~107MB decompressed, and the analyser streams a path.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

// Same resolution order as main-scripts.js and crashReporterHandlers.js.
function resolvePython() {
  const exe = process.platform === "win32" ? "python.exe" : path.join("bin", "python3");
  const candidates = [];
  // In a packaged app process.resourcesPath exists; in the worker/dev it may not.
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "python-runtime", exe));
  candidates.push(path.join(__dirname, "..", "python-runtime", exe));
  if (process.env.PROVINCIA_PYTHON) candidates.push(process.env.PROVINCIA_PYTHON);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ } }
  return null;
}

const isCompressed = (p) => /\.(gz|xz|lzma)$/i.test(String(p || ""));

/**
 * If `logPath` is compressed, decompress to a temp file and return that path.
 * Otherwise return the path unchanged.
 *
 * @returns {{path: string, temp: string|null, from: string|null, bytes: number|null, error: string|null}}
 *   `temp` is set when a file was created, so the caller can delete it.
 */
function openMaybeCompressed(logPath, opts = {}) {
  const log = typeof opts.log === "function" ? opts.log : () => {};
  if (!isCompressed(logPath)) return { path: logPath, temp: null, from: null, bytes: null, error: null };

  const ext = (/\.(gz|xz|lzma)$/i.exec(logPath) || [])[1].toLowerCase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provincia-log-"));
  // keep the inner name so downstream filename hints still work
  const inner = path.basename(logPath).replace(/\.(gz|xz|lzma)$/i, "");
  const out = path.join(dir, inner || "log.txt");

  try {
    if (ext === "gz") {
      // Node can do this itself. Streamed so a large extract never lands in memory.
      const gunzip = zlib.createGunzip();
      const rs = fs.createReadStream(logPath);
      const ws = fs.createWriteStream(out);
      // synchronous-style wait: this runs inside the crack worker, where blocking
      // is fine and the caller is already awaiting a long analysis
      const done = new Promise((resolve, reject) => {
        rs.on("error", reject); gunzip.on("error", reject);
        ws.on("error", reject); ws.on("finish", resolve);
      });
      rs.pipe(gunzip).pipe(ws);
      return { path: out, temp: dir, from: ext, bytes: null, error: null, pending: done };
    }

    // .xz / .lzma — hand it to the bundled Python's lzma module.
    const py = resolvePython();
    if (!py) {
      fs.rmSync(dir, { recursive: true, force: true });
      return {
        path: logPath, temp: null, from: ext, bytes: null,
        error: "this log is .xz and Provincia's bundled Python runtime is missing, so it cannot be unpacked — " +
          "extract it with 7-Zip and open the .txt instead",
      };
    }
    // Streamed in chunks; a 107MB decompressed extract must not be built in RAM.
    const code = [
      "import lzma, sys",
      "src, dst = sys.argv[1], sys.argv[2]",
      "with lzma.open(src, 'rb') as f, open(dst, 'wb') as o:",
      "    while True:",
      "        b = f.read(1 << 20)",
      "        if not b: break",
      "        o.write(b)",
    ].join("\n");
    const r = spawnSync(py, ["-c", code, logPath, out], { encoding: "utf8", timeout: 300000 });
    if (r.status !== 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      return {
        path: logPath, temp: null, from: ext, bytes: null,
        error: `could not unpack this .${ext}: ${(r.stderr || r.error?.message || "unknown error").trim().slice(0, 300)}`,
      };
    }
    const bytes = fs.statSync(out).size;
    log(`[log-decompress] ${path.basename(logPath)} (.${ext}) → ${(bytes / 1048576).toFixed(1)}MB via the bundled Python`);
    return { path: out, temp: dir, from: ext, bytes, error: null };
  } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    return { path: logPath, temp: null, from: ext, bytes: null, error: e && e.message ? e.message : String(e) };
  }
}

/** Remove a temp directory created by openMaybeCompressed. Never throws. */
function cleanup(temp) {
  if (!temp) return;
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

module.exports = { openMaybeCompressed, cleanup, isCompressed, resolvePython };
