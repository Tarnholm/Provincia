// No raw control characters in source. Twice on 2026-09-21: a literal NUL inside
// a string made git and grep treat App.js as BINARY (no usable diffs for the
// largest file in the repo), and an editing script turned a regex word-boundary
// escape into a literal backspace, which still parses and silently never
// matches. Write the escape sequence, never the byte.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const files = [
  ...["main.js", "main-scripts.js", "preload.js", "preload-scripts.js", "scripts/ship.js", "scripts-suite/renderer.js"],
  ...fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .map((f) => `src/${String(f).split(path.sep).join("/")}`)
    .filter((f) => /\.(jsx?|cjs|mjs|css)$/.test(f)),
].filter((f) => fs.existsSync(path.join(ROOT, f)));

describe("source files hold no raw control characters", () => {
  it("scans the shipped entry points and everything under src/", () => {
    expect(files.length).toBeGreaterThan(200);
    const offenders = [];
    for (const rel of files) {
      const buf = fs.readFileSync(path.join(ROOT, rel));
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) {
          const line = buf.subarray(0, i).toString("latin1").split("\n").length;
          offenders.push(`${rel}:${line} — byte 0x${c.toString(16).padStart(2, "0")}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
