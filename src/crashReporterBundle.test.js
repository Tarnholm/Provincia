// @vitest-environment node
//
// Guards for the crash reporter Provincia now BUNDLES.
//
// The failure mode this protects against is silent: the reporter imports its
// AI-log line filter inside a try/except, so a build that ships without that
// module keeps running perfectly and simply never attaches the campaign_ai_log
// extract. Nobody notices until someone asks why reports have no AI data.
//
// So there are three checks:
//   1. the generated Python filter is IN SYNC with the analyser's manifest — a
//      drifted copy loses data with no error
//   2. everything the reporter needs is actually packaged
//   3. the reporter's own --selftest passes under Provincia's Python runtime
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pythonPatternModule } from "./aiLogExtract.js";
import { AI_LOG_LINE_PATTERNS } from "./aiMovementAnalyzer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(ROOT, "crash-reporter");
const PY_EXE = path.join(ROOT, "python-runtime", process.platform === "win32" ? "python.exe" : path.join("bin", "python3"));
const havePython = fs.existsSync(PY_EXE);

describe("the bundled reporter is packaged completely", () => {
  it("ships the reporter, its generated filter, and a config example", () => {
    for (const f of ["crash_reporter.py", "ai_log_patterns.py", "crash_reporter.ini.example"]) {
      expect(fs.existsSync(path.join(BUNDLE, f)), `crash-reporter/${f} is missing`).toBe(true);
    }
  });

  it("is listed as an extraResource, or the packaged app would not contain it", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const froms = (pkg.build.extraResources || []).map((r) => (typeof r === "string" ? r : r.from));
    expect(froms).toContain("crash-reporter");
    // the runtime that RUNS it must ship too
    expect(froms).toContain("python-runtime");
  });

  it("has its main-process handler in build.files", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    // main.js requires this directly, so an unlisted file means a broken app
    expect(pkg.build.files).toContain("src/crashReporterHandlers.js");
  });

  it("regenerates its filter as part of prebuild, so a release cannot ship a stale copy", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.prebuild).toMatch(/gen-ailog-patterns/);
    expect(pkg.scripts["gen:ailog-patterns"]).toBeTruthy();
  });
});

describe("the generated Python filter matches the analyser", () => {
  it("is byte-identical to what the generator would write right now", () => {
    const onDisk = fs.readFileSync(path.join(BUNDLE, "ai_log_patterns.py"), "utf8");
    expect(
      onDisk,
      "crash-reporter/ai_log_patterns.py is stale — run `npm run gen:ailog-patterns`"
    ).toBe(pythonPatternModule());
  });

  it("carries every pattern the analyser reads", () => {
    const onDisk = fs.readFileSync(path.join(BUNDLE, "ai_log_patterns.py"), "utf8");
    for (const src of AI_LOG_LINE_PATTERNS) expect(onDisk).toContain(src);
  });

  it("uses search(), not match() — the difference silently dropped 83,427 lines", () => {
    const onDisk = fs.readFileSync(path.join(BUNDLE, "ai_log_patterns.py"), "utf8");
    // JS RegExp.test scans the whole string; Python's match() anchors. One of the
    // patterns is deliberately unanchored (the character-mention catch-all), and
    // match() threw it away without any error.
    expect(onDisk).toMatch(/rx\.search\(line\)/);
    expect(onDisk).not.toMatch(/rx\.match\(line\)/);
  });
});

describe("the reporter runs under Provincia's own Python runtime", () => {
  it.runIf(havePython)("passes its own --selftest", () => {
    const r = spawnSync(PY_EXE, [path.join(BUNDLE, "crash_reporter.py"), "--selftest"], {
      cwd: BUNDLE, encoding: "utf8", timeout: 60000,
    });
    const out = (r.stdout || "") + (r.stderr || "");
    // surface the reporter's own diagnosis on failure — it names the cause
    expect(r.status, `selftest failed:\n${out}`).toBe(0);
    expect(out).toMatch(/SELFTEST: PASS/);
    expect(out).toMatch(/ai_log_patterns importable: True/);
  }, 90000);

  it.runIf(havePython)("does not prompt when told not to, and prompts otherwise", () => {
    const src = fs.readFileSync(path.join(BUNDLE, "crash_reporter.py"), "utf8");
    // bundled: stdin is closed, so every wait-for-the-user must be guarded
    expect(src).toMatch(/def pause_for_user\(/);
    expect(src).not.toMatch(/^\s*input\("Press Enter to close\.\.\."\)/m);
    // standalone: the console prompt must still be reachable, unchanged
    expect(src).toMatch(/prompt_for_discord_name\(\)/);
    expect(src).toMatch(/NON_INTERACTIVE = "--non-interactive" in sys\.argv/);
  });

  it.runIf(havePython)("can be imported without running its main loop", () => {
    // Provincia's handler spawns it as a script, but the tests and the selftest
    // import it — an unguarded main() would hang the suite
    const r = spawnSync(PY_EXE, ["-c", [
      "import importlib.util,sys",
      `sys.path.insert(0, r"${BUNDLE.replace(/\\/g, "\\\\")}")`,
      `spec=importlib.util.spec_from_file_location("cr", r"${path.join(BUNDLE, "crash_reporter.py").replace(/\\/g, "\\\\")}")`,
      "m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "print('VERSION=' + m.APP_VERSION)",
      "print('FILTER=' + str(m.AI_LOG_FILTER_AVAILABLE))",
    ].join("\n")], { cwd: BUNDLE, encoding: "utf8", timeout: 60000 });
    const out = (r.stdout || "") + (r.stderr || "");
    expect(r.status, out).toBe(0);
    expect(out).toMatch(/VERSION=\d+\.\d+\.\d+/);
    expect(out).toMatch(/FILTER=True/);
  }, 90000);
});
