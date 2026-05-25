// Assembles bundled runtime deps that are too big / binary to commit, for the
// embedded Settlement Processor (Scripts) feature:
//   python-runtime/    — Windows embeddable Python + Pillow (runs the .py scripts)
//   scripts-suite/vs/  — Monaco editor, served locally (CSP-safe, offline)
//
// Idempotent: each step is skipped if its output already exists. Wired into
// `prebuild`, and runnable directly via `npm run fetch-runtime`.
const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PY_DIR = path.join(ROOT, "python-runtime");
const VS_DIR = path.join(ROOT, "scripts-suite", "vs");
const PY_VERSION = "3.11.9";
const MONACO_VERSION = "0.52.2";

function log(m) { console.log(`[fetch-runtime] ${m}`); }

// GET with redirect following → Buffer.
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("too many redirects"));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(download(next, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

// Resolve a tar that can extract BOTH .zip and .tar.gz. On Windows that's the
// system bsdtar (System32\tar.exe) — GNU tar (e.g. from git-bash) can't read
// .zip, so don't rely on PATH order.
function tarBin() {
  if (process.platform === "win32") {
    const sys = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (fs.existsSync(sys)) return sys;
  }
  return "tar";
}

// Extract a .zip or .tar.gz; bsdtar auto-detects the format from -xf.
function extract(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync(tarBin(), ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
}

async function fetchPython() {
  if (process.platform !== "win32") {
    log(`skip python-runtime (host is ${process.platform}; the Windows embeddable build is fetched on win32 / CI)`);
    return;
  }
  const pyExe = path.join(PY_DIR, "python.exe");
  const pilDir = path.join(PY_DIR, "Lib", "site-packages", "PIL");
  if (fs.existsSync(pyExe) && fs.existsSync(pilDir)) {
    log("python-runtime already present (python.exe + Pillow) — skipping");
    return;
  }

  fs.rmSync(PY_DIR, { recursive: true, force: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-py-"));
  const zip = path.join(tmp, "python-embed.zip");

  log(`downloading Python ${PY_VERSION} embeddable…`);
  fs.writeFileSync(zip, await download(
    `https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`));
  log("extracting…");
  extract(zip, PY_DIR);

  // Enable site-packages so pip + Pillow are importable (embeddable disables it).
  const pthName = `python${PY_VERSION.split(".").slice(0, 2).join("")}._pth`; // python311._pth
  const pth = path.join(PY_DIR, pthName);
  if (fs.existsSync(pth)) {
    let body = fs.readFileSync(pth, "utf8").replace(/^#\s*import site/m, "import site");
    if (!/Lib\\site-packages/.test(body)) body += "\r\nLib\\site-packages\r\n";
    if (!/^import site/m.test(body)) body += "\r\nimport site\r\n";
    fs.writeFileSync(pth, body);
  }

  log("bootstrapping pip…");
  const getPip = path.join(tmp, "get-pip.py");
  fs.writeFileSync(getPip, await download("https://bootstrap.pypa.io/get-pip.py"));
  let r = spawnSync(pyExe, [getPip, "--no-warn-script-location"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("get-pip failed");

  log("installing Pillow…");
  r = spawnSync(pyExe, ["-m", "pip", "install", "--no-warn-script-location", "Pillow"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("pip install Pillow failed");

  fs.rmSync(tmp, { recursive: true, force: true });
  log("python-runtime ready");
}

// Shrink the runtime: the scripts only need PIL + stdlib at runtime, so drop
// pip/setuptools/wheel/etc., the Scripts/ dir, and all __pycache__. Idempotent.
function trimRuntime() {
  if (!fs.existsSync(PY_DIR)) return;
  const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} };
  const sp = path.join(PY_DIR, "Lib", "site-packages");
  if (fs.existsSync(sp)) {
    for (const entry of fs.readdirSync(sp)) {
      const l = entry.toLowerCase();
      const keep = l === "pil" || l === "pillow.libs" || l.startsWith("pillow-") || l.startsWith("pillow_");
      if (!keep) rm(path.join(sp, entry)); // pip, setuptools, wheel, packaging, *.dist-info, .pth, …
    }
  }
  rm(path.join(PY_DIR, "Scripts"));
  (function stripCaches(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name === "__pycache__") rm(full); else stripCaches(full); }
    }
  })(PY_DIR);
  log("trimmed python-runtime (kept PIL + stdlib only)");
}

async function fetchMonaco() {
  if (fs.existsSync(path.join(VS_DIR, "loader.js"))) {
    log("scripts-suite/vs already present — skipping");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-monaco-"));
  const tgz = path.join(tmp, "monaco.tgz");
  log(`downloading monaco-editor ${MONACO_VERSION}…`);
  fs.writeFileSync(tgz, await download(
    `https://registry.npmjs.org/monaco-editor/-/monaco-editor-${MONACO_VERSION}.tgz`));
  log("extracting min/vs…");
  extract(tgz, tmp); // → tmp/package/min/vs
  const src = path.join(tmp, "package", "min", "vs");
  if (!fs.existsSync(src)) throw new Error("monaco min/vs not found in package");
  fs.mkdirSync(path.dirname(VS_DIR), { recursive: true });
  fs.cpSync(src, VS_DIR, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  log("scripts-suite/vs ready");
}

(async () => {
  try {
    await fetchPython();
    trimRuntime();
    await fetchMonaco();
    log("done");
  } catch (e) {
    console.error(`[fetch-runtime] FAILED: ${e.message}`);
    process.exit(1);
  }
})();
