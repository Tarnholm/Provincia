// The write contract every mod-file edit now rides on (src/safeModWrite.js):
// atomic replace, a stamped backup that restore-mod-backup can read, a refused
// write when the backup cannot be made, export mode that leaves the live file
// alone, byte-exact round-trips for ANSI text, and rollback of a multi-file set.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const sw = require("./safeModWrite.js");

let dir;
const mk = () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "safewrite-")); return dir; };
afterEach(() => { if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = null; } });
const baks = (p) => fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith(path.basename(p) + ".provincia-") && f.endsWith(".bak"));
const temps = (d) => fs.readdirSync(d).filter((f) => f.includes(".provincia-tmp-"));

describe("safeWriteModFile", () => {
  it("replaces the file, keeps the ORIGINAL in a stamped backup, leaves no temp", () => {
    const p = path.join(mk(), "descr_strat.txt");
    fs.writeFileSync(p, "original\r\n", "latin1");
    const r = sw.safeWriteModFile(p, "edited\r\n", "latin1");
    expect(fs.readFileSync(p, "latin1")).toBe("edited\r\n");
    expect(r.exported).toBe(false);
    expect(fs.readFileSync(r.backupPath, "latin1")).toBe("original\r\n");
    expect(path.basename(r.backupPath)).toBe(`descr_strat.txt.provincia-${r.backupStamp}.bak`);
    expect(temps(dir)).toEqual([]);
  });

  it("a second apply does NOT overwrite the first backup (the rolling .provincia-bak bug)", () => {
    const p = path.join(mk(), "descr_strat.txt");
    fs.writeFileSync(p, "v0");
    sw.safeWriteModFile(p, "v1", "latin1", { stamp: "2026-01-01T00-00-00-000Z" });
    sw.safeWriteModFile(p, "v2", "latin1", { stamp: "2026-01-01T00-00-01-000Z" });
    const contents = baks(p).sort().map((f) => fs.readFileSync(path.join(dir, f), "latin1"));
    expect(contents).toEqual(["v0", "v1"]);
    expect(sw.listBackupStamps(p)).toEqual(["2026-01-01T00-00-00-000Z", "2026-01-01T00-00-01-000Z"]);
  });

  it("keeps only the newest KEEP_BACKUPS backups", () => {
    const p = path.join(mk(), "f.txt");
    fs.writeFileSync(p, "x");
    for (let i = 0; i < sw.KEEP_BACKUPS + 4; i++) sw.safeWriteModFile(p, "x" + i, "latin1", { stamp: `2026-01-01T00-00-${String(i).padStart(2, "0")}-000Z` });
    const stamps = sw.listBackupStamps(p);
    expect(stamps.length).toBe(sw.KEEP_BACKUPS);
    expect(stamps[0]).toBe("2026-01-01T00-00-04-000Z");
  });

  it("refuses to write when the backup cannot be made — the live file is untouched", () => {
    const p = path.join(mk(), "descr_strat.txt");
    fs.writeFileSync(p, "precious");
    // a DIRECTORY squatting on the backup name makes copyFileSync fail
    fs.mkdirSync(`${p}.provincia-STAMP.bak`);
    expect(() => sw.safeWriteModFile(p, "edited", "latin1", { stamp: "STAMP" })).toThrow(/backup failed, nothing was written/);
    expect(fs.readFileSync(p, "latin1")).toBe("precious");
    expect(temps(dir)).toEqual([]);
  });

  it("export mode writes under outPath, creates its folders, takes no backup, leaves the live file alone", () => {
    const p = path.join(mk(), "mod", "descr_strat.txt");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "live");
    const out = path.join(dir, "export", "world", "descr_strat.txt");
    const r = sw.safeWriteModFile(p, "edited", "latin1", { outPath: out });
    expect(r.exported).toBe(true);
    expect(r.backupStamp).toBe(null);
    expect(fs.readFileSync(out, "latin1")).toBe("edited");
    expect(fs.readFileSync(p, "latin1")).toBe("live");
    expect(baks(p)).toEqual([]);
  });

  it("freshMs skips a duplicate backup only when a same-size one was just taken", () => {
    const p = path.join(mk(), "f.txt");
    fs.writeFileSync(p, "abcd");
    sw.backupStamped(p, "2026-01-01T00-00-00-000Z");
    const r1 = sw.safeWriteModFile(p, "abcdEF", "latin1", { freshMs: 60000 });
    expect(r1.backupStamp).toBe(null);
    // the live file changed size since that backup → a new one IS taken
    const r2 = sw.safeWriteModFile(p, "z", "latin1", { freshMs: 60000 });
    expect(r2.backupStamp).not.toBe(null);
    expect(fs.readFileSync(r2.backupPath, "latin1")).toBe("abcdEF");
  });
});

describe("readModText — byte-exact round trips", () => {
  it("ANSI high-bit bytes survive read → edit → write (a utf8 read would turn 0xE9 into EF BF BD)", () => {
    const p = path.join(mk(), "descr_strat.txt");
    const bytes = Buffer.from([0x3B, 0x20, 0x63, 0x61, 0x66, 0xE9, 0x0D, 0x0A, 0x78, 0x20, 0x31, 0x0D, 0x0A]); // "; café\r\nx 1\r\n" in cp1252
    fs.writeFileSync(p, bytes);
    const { text, encoding } = sw.readModText(p);
    expect(encoding).toBe("latin1");
    sw.safeWriteModFile(p, text.replace("x 1", "x 2"), encoding, { backup: false });
    const out = fs.readFileSync(p);
    expect(out.includes(Buffer.from([0xEF, 0xBF, 0xBD]))).toBe(false);
    expect(out[5]).toBe(0xE9);
    expect(out.toString("latin1")).toContain("x 2");
  });

  it("valid UTF-8 (multi-byte) is read and written back as UTF-8", () => {
    const p = path.join(mk(), "descr_strat.txt");
    fs.writeFileSync(p, "; Ῥώμη\r\nx 1\r\n", "utf8");
    const before = fs.readFileSync(p);
    const { text, encoding } = sw.readModText(p);
    expect(encoding).toBe("utf8");
    expect(text).toContain("Ῥώμη");
    sw.safeWriteModFile(p, text, encoding, { backup: false });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe("safeWriteModFiles", () => {
  it("writes the set in order under ONE stamp", () => {
    mk();
    const a = path.join(dir, "names.txt"), b = path.join(dir, "descr_strat.txt");
    fs.writeFileSync(a, "A0"); fs.writeFileSync(b, "B0");
    const r = sw.safeWriteModFiles([{ livePath: a, data: "A1", encoding: "latin1" }, { livePath: b, data: "B1", encoding: "latin1" }]);
    expect(fs.readFileSync(a, "latin1")).toBe("A1");
    expect(fs.readFileSync(b, "latin1")).toBe("B1");
    expect(sw.listBackupStamps(a)).toEqual([r.stamp]);
    expect(sw.listBackupStamps(b)).toEqual([r.stamp]);
  });

  it("a failure part-way puts the earlier files back — with or without backups", () => {
    for (const backup of [true, false]) {
      mk();
      const a = path.join(dir, "names.txt"), b = path.join(dir, "descr_strat.txt");
      fs.writeFileSync(a, "A0");
      fs.mkdirSync(b); // the second target is a directory → its rename fails
      expect(() => sw.safeWriteModFiles([{ livePath: a, data: "A1", encoding: "latin1" }, { livePath: b, data: "B1", encoding: "latin1" }], { backup }))
        .toThrow(/rolled back names\.txt/);
      expect(fs.readFileSync(a, "latin1")).toBe("A0");
      expect(temps(dir)).toEqual([]);
      fs.rmSync(dir, { recursive: true, force: true }); dir = null;
    }
  });
});
