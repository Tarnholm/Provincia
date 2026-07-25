// @vitest-environment node
//
// The crash reporter ships its campaign_ai_log extract as .txt.xz — the only way a
// 330MB log fits an attachment. Until this existed the pipeline stopped one step
// short: the report arrived and somebody had to unpack it by hand before Provincia
// would read it.
//
// Node has no xz, so .xz goes through the Python runtime Provincia already bundles.
// That makes the availability of that runtime load-bearing, which is why there is a
// test for the missing-runtime message too.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openMaybeCompressed, cleanup, isCompressed, resolvePython } from "./logDecompress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY = resolvePython();
const havePython = !!PY;

const SAMPLE = [
  "AI: \t\t\t\tstart 'rome' for year -270, season summer",
  "AI: 3 spies assigned this turn",
  "AI: campaign: campaign for 'Pella' (reg 1, des 2) using strategy ACS_GATHERING. required str 400 (ACZ_SOLID), allocated str 120; num res 3.",
].join("\n");

describe("isCompressed", () => {
  it("recognises the extensions the reporter can produce, and nothing else", () => {
    for (const p of ["a.txt.xz", "a.xz", "b.gz", "c.lzma", "D.TXT.XZ"]) expect(isCompressed(p), p).toBe(true);
    for (const p of ["a.txt", "campaign_ai_log.txt", "a.zip", "a.7z", "", null]) expect(isCompressed(p), String(p)).toBe(false);
  });
});

describe("openMaybeCompressed", () => {
  it("passes a plain path straight through, creating nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-"));
    const p = path.join(dir, "log.txt");
    fs.writeFileSync(p, SAMPLE);
    const r = openMaybeCompressed(p);
    expect(r).toMatchObject({ path: p, temp: null, error: null });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("unpacks a .gz with Node's own zlib", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-"));
    const gz = path.join(dir, "campaign_ai_log.txt.gz");
    fs.writeFileSync(gz, zlib.gzipSync(Buffer.from(SAMPLE, "latin1")));
    const r = openMaybeCompressed(gz);
    expect(r.error).toBeNull();
    expect(r.from).toBe("gz");
    if (r.pending) await r.pending;
    expect(fs.readFileSync(r.path, "latin1")).toBe(SAMPLE);
    // the inner name is preserved so downstream filename hints still work
    expect(path.basename(r.path)).toBe("campaign_ai_log.txt");
    cleanup(r.temp);
    expect(fs.existsSync(r.path)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.runIf(havePython)("unpacks a .xz via the bundled Python runtime", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-"));
    const src = path.join(dir, "plain.txt");
    const xz = path.join(dir, "campaign_ai_extract_20260725.txt.xz");
    fs.writeFileSync(src, SAMPLE, "latin1");
    // compress with the same runtime that will decompress it
    const mk = spawnSync(PY, ["-c",
      "import lzma,sys;open(sys.argv[2],'wb').write(lzma.compress(open(sys.argv[1],'rb').read()))",
      src, xz], { encoding: "utf8" });
    expect(mk.status, mk.stderr).toBe(0);
    // real xz magic, so this is not just a renamed file
    expect(fs.readFileSync(xz).slice(0, 6).toString("hex")).toBe("fd377a585a00");

    const r = openMaybeCompressed(xz);
    expect(r.error).toBeNull();
    expect(r.from).toBe("xz");
    expect(r.bytes).toBe(Buffer.byteLength(SAMPLE, "latin1"));
    expect(fs.readFileSync(r.path, "latin1")).toBe(SAMPLE);
    expect(path.basename(r.path)).toBe("campaign_ai_extract_20260725.txt");
    cleanup(r.temp);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("reports a corrupt archive instead of throwing or returning junk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-"));
    const bad = path.join(dir, "broken.txt.xz");
    fs.writeFileSync(bad, Buffer.from("this is not an xz file at all"));
    const r = openMaybeCompressed(bad);
    expect(r.error, "a corrupt archive must be reported").toBeTruthy();
    expect(r.temp).toBeNull();                 // nothing left behind
    expect(r.path).toBe(bad);                  // and the original is handed back
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120000);

  it("cleanup never throws, whatever it is handed", () => {
    expect(() => cleanup(null)).not.toThrow();
    expect(() => cleanup(undefined)).not.toThrow();
    expect(() => cleanup(path.join(os.tmpdir(), "definitely-not-there-" + Date.now()))).not.toThrow();
  });

  it("leaves no temp directory behind once cleaned up", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-"));
    const gz = path.join(dir, "x.txt.gz");
    fs.writeFileSync(gz, zlib.gzipSync(Buffer.from("AI: 1 spies assigned this turn")));
    const r = openMaybeCompressed(gz);
    if (r.pending) await r.pending;
    const temp = r.temp;
    expect(fs.existsSync(temp)).toBe(true);
    cleanup(temp);
    expect(fs.existsSync(temp), "a 107MB extract must not be left on disk").toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the analysis pipeline accepts a compressed log", () => {
  it("names logDecompress in the worker's require graph, so it ships", () => {
    // aiMovementRun runs inside the crack worker; an unlisted module breaks the
    // packaged app exactly as the v0.9.1417 electron require did
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.build.files).toContain("src/logDecompress.js");
    const run = fs.readFileSync(path.join(__dirname, "aiMovementRun.js"), "utf8");
    expect(run).toMatch(/openMaybeCompressed/);
    // and it must clean up however the run ends
    expect(run).toMatch(/finally \{/);
    expect(run).toMatch(/cleanup\(unpacked\)/);
  });
});
