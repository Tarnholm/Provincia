// Two main-process handlers turn a renderer-supplied string into a file path.
//  • restore-mod-backup spliced its stamp into `<file>.provincia-<stamp>.bak`,
//    so a stamp with ../ could name any .bak on disk and copy it over the mod.
//  • delete-ai-baseline's containment was a string-prefix test, which let a
//    sibling such as <userData>/ai-baselinesX.json through to unlinkSync.
import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const H = require("./mainIpcHarness.js").loadMainHandlers();
const made = [];
afterAll(() => { for (const p of made) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* */ } } });

describe("renderer-supplied paths", () => {
  it("restore-mod-backup refuses a stamp that is not a plain stamp", async () => {
    for (const bad of ["x/../../evil", "..\\..\\evil", "a b", "2026.bak/../x"]) {
      const r = await H.invoke("restore-mod-backup", bad);
      expect(r).toMatchObject({ ok: false, error: "invalid backup stamp" });
    }
  });

  it("delete-ai-baseline refuses a sibling that merely shares the folder's name prefix", async () => {
    const sibling = path.join(os.tmpdir(), `ai-baselinesX-${process.pid}.json`);
    fs.writeFileSync(sibling, "{}"); made.push(sibling);
    const r = await H.invoke("delete-ai-baseline", sibling);
    expect(r.error).toMatch(/refusing/);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("delete-ai-baseline still deletes a file inside the baselines folder", async () => {
    const dir = path.join(os.tmpdir(), "ai-baselines");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `test-${process.pid}.json`);
    fs.writeFileSync(f, "{}"); made.push(f);
    const r = await H.invoke("delete-ai-baseline", f);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(f)).toBe(false);
  });
});
