// Bundled RIS Crash Reporter (2026-07-25).
//
// The reporter used to be a separate program a tester had to remember to start
// before launching the game. It is bundled here so running Provincia is enough:
// the same crash_reporter.py, driven by the Python runtime Provincia already
// ships, spawned as a child process and surfaced in the UI.
//
// WHAT IT NEEDS FROM US
// --------------------
//   • the bundled python-runtime (already an extraResource for the Scripts suite)
//   • crash-reporter/crash_reporter.py + ai_log_patterns.py (extraResource)
//   • a writable working directory, because the reporter keeps its config and its
//     own log NEXT TO ITSELF — and resources/ inside a packaged app is read-only.
//     So it is copied into userData/crash-reporter on first run.
//
// `--no-update` is ALWAYS passed. The standalone reporter updates itself by
// downloading and silently installing its own installer; inside Provincia that
// would fight Provincia's own updater and could replace the bundled copy with a
// standalone install. Provincia ships the version it was built with.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Same resolution order as main-scripts.js so both agree about which Python runs.
function resolvePython(app) {
  const exe = process.platform === "win32" ? "python.exe" : path.join("bin", "python3");
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, "python-runtime", exe)
    : path.join(__dirname, "..", "python-runtime", exe);
  if (fs.existsSync(bundled)) return bundled;
  if (process.env.PROVINCIA_PYTHON && fs.existsSync(process.env.PROVINCIA_PYTHON)) return process.env.PROVINCIA_PYTHON;
  return null;
}

function sourceDir(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "crash-reporter")
    : path.join(__dirname, "..", "crash-reporter");
}

// The reporter writes crash_reporter.ini and crash_reporter.log beside its own
// script. resources/ is read-only in a packaged app, so it runs from a copy in
// userData — and the config there survives updates, which is the behaviour a
// tester wants anyway.
function ensureWorkDir(app, log) {
  const src = sourceDir(app);
  const dst = path.join(app.getPath("userData"), "crash-reporter");
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ["crash_reporter.py", "ai_log_patterns.py"]) {
    const from = path.join(src, f);
    const to = path.join(dst, f);
    if (!fs.existsSync(from)) throw new Error(`bundled reporter file missing: ${f}`);
    // Copy when absent or stale, so a Provincia update ships a newer reporter,
    // but never touch crash_reporter.ini — that is the tester's own settings.
    let stale = true;
    try { stale = fs.statSync(from).mtimeMs > fs.statSync(to).mtimeMs; } catch { stale = true; }
    if (stale) { fs.copyFileSync(from, to); log(`[crash-reporter] refreshed ${f}`); }
  }
  const ini = path.join(dst, "crash_reporter.ini");
  if (!fs.existsSync(ini)) {
    const example = path.join(src, "crash_reporter.ini.example");
    if (fs.existsSync(example)) { fs.copyFileSync(example, ini); log("[crash-reporter] seeded crash_reporter.ini from the example"); }
  }
  return dst;
}

function registerCrashReporterHandlers(ipcMain, { app, BrowserWindow, writeLog }) {
  const log = (line) => { try { writeLog(line); } catch { /* logging must never throw */ } };

  let child = null;
  let startedAt = null;
  let lastLines = [];          // rolling tail of the reporter's own output
  let lastExit = null;

  const push = (s) => {
    for (const line of String(s).split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      lastLines.push(t);
      if (lastLines.length > 80) lastLines.shift();
    }
  };
  const notify = () => {
    try {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) win.webContents.send("crash-reporter-status", status());
    } catch { /* the UI simply polls instead */ }
  };
  const status = () => ({
    running: !!child,
    pid: child ? child.pid : null,
    startedAt,
    lastExit,
    tail: lastLines.slice(-14),
  });

  ipcMain.handle("crash-reporter-status", () => status());

  ipcMain.handle("crash-reporter-start", async () => {
    if (child) return { ok: true, already: true, ...status() };
    const py = resolvePython(app);
    if (!py) {
      return { ok: false, error: "the bundled Python runtime is missing — run `npm run fetch-runtime` in a dev checkout, or reinstall Provincia" };
    }
    let cwd;
    try { cwd = ensureWorkDir(app, log); }
    catch (e) { return { ok: false, error: e.message }; }

    const script = path.join(cwd, "crash_reporter.py");
    try {
      // --non-interactive: stdin is closed below, so the reporter must never
      // prompt. Without it the "what is your RIS Discord name?" question raises
      // EOFError and takes the reporter down before it watches anything.
      child = spawn(py, [script, "--no-update", "--non-interactive"], {
        cwd,
        windowsHide: true,
        // The reporter is interactive when run standalone (it can prompt for a
        // Discord name). Inside Provincia there is no console to type into, so
        // stdin is closed and the name must come from the config file.
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
      });
    } catch (e) {
      child = null;
      return { ok: false, error: `could not start the reporter: ${e.message}` };
    }

    startedAt = Date.now();
    lastExit = null;
    lastLines = [];
    log(`[crash-reporter] started (pid ${child.pid}) using ${path.basename(py)}`);

    child.stdout.on("data", (d) => { push(d); notify(); });
    child.stderr.on("data", (d) => { push(d); log(`[crash-reporter] stderr: ${String(d).trim().slice(0, 400)}`); notify(); });
    child.on("exit", (code, signal) => {
      lastExit = { code, signal, at: Date.now() };
      log(`[crash-reporter] exited code=${code} signal=${signal || "none"}`);
      child = null;
      notify();
    });
    child.on("error", (e) => {
      push(`error: ${e.message}`);
      log(`[crash-reporter] spawn error: ${e.message}`);
      child = null;
      notify();
    });

    return { ok: true, ...status() };
  });

  ipcMain.handle("crash-reporter-stop", async () => {
    if (!child) return { ok: true, already: true, ...status() };
    const pid = child.pid;
    try {
      // The reporter installs a console-control handler and cleans up on exit, so
      // ask politely first and only force it if it ignores that.
      child.kill();
      setTimeout(() => { try { if (child && child.pid === pid) child.kill("SIGKILL"); } catch { /* gone */ } }, 4000);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    log(`[crash-reporter] stop requested (pid ${pid})`);
    return { ok: true, ...status() };
  });

  // The tester's RIS Discord name. Standalone the reporter asks for this on the
  // console; bundled there is nowhere to ask, so Provincia collects it and writes
  // it into the same ini key the reporter already reads. Reports are tagged
  // "unnamed (set it in Provincia)" until it is set, rather than being blocked.
  ipcMain.handle("crash-reporter-get-name", () => {
    try {
      const ini = path.join(app.getPath("userData"), "crash-reporter", "crash_reporter.ini");
      if (!fs.existsSync(ini)) return { ok: true, name: "", confirmed: false };
      const txt = fs.readFileSync(ini, "utf8");
      const m = /^\s*tester_name\s*=\s*(.*)$/mi.exec(txt);
      const c = /^\s*name_confirmed\s*=\s*(.*)$/mi.exec(txt);
      return {
        ok: true,
        name: m ? m[1].trim() : "",
        confirmed: !!c && /^(1|true|yes|on)$/i.test(c[1].trim()),
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("crash-reporter-set-name", (_e, name) => {
    // strip newlines so a pasted name cannot inject extra ini keys
    const clean = String(name || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80);
    if (!clean) return { ok: false, error: "the name cannot be empty" };
    try {
      const cwd = ensureWorkDir(app, log);
      const ini = path.join(cwd, "crash_reporter.ini");
      let txt = fs.existsSync(ini) ? fs.readFileSync(ini, "utf8") : "[reporter]\n";
      // Rewrite the key in place if present, otherwise add it under [reporter].
      // configparser (which the reporter uses) accepts either.
      const set = (key, val) => {
        const rx = new RegExp("^[ \\t]*" + key + "[ \\t]*=.*$", "mi");
        if (rx.test(txt)) { txt = txt.replace(rx, `${key} = ${val}`); return; }
        if (/\[reporter\]/i.test(txt)) txt = txt.replace(/(\[reporter\][ \t]*\r?\n)/i, `$1${key} = ${val}\n`);
        else txt = `[reporter]\n${key} = ${val}\n` + txt;
      };
      set("tester_name", clean);
      set("name_confirmed", "true");
      fs.writeFileSync(ini, txt);
      log(`[crash-reporter] tester name set to "${clean}"`);
      return { ok: true, name: clean };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Where the tester's own settings live, so the UI can offer "open config".
  ipcMain.handle("crash-reporter-config-path", () => {
    try { return { ok: true, path: path.join(app.getPath("userData"), "crash-reporter", "crash_reporter.ini") }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // A reporter left running would keep watching for the game after Provincia is
  // gone, and its child would be orphaned. Stop it with us.
  app.on("before-quit", () => { try { if (child) child.kill(); } catch { /* quitting anyway */ } });
}

module.exports = { registerCrashReporterHandlers, resolvePython, sourceDir, ensureWorkDir };
