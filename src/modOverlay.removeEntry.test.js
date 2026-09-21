// The submod overlay is a tree of junctions that point INTO the user's live
// mod. Pruning it must remove the junction and never what is behind it.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { _removeEntry } = require("./modOverlay.js");

let root;
afterEach(() => { if (root) { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); root = null; } });

describe("modOverlay._removeEntry", () => {
  it("removes a junction — and the live folder behind it keeps every file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-rm-"));
    const live = path.join(root, "live-mod", "ui");
    fs.mkdirSync(path.join(live, "units"), { recursive: true });
    fs.writeFileSync(path.join(live, "units", "card.tga"), "precious");
    fs.writeFileSync(path.join(live, "banner.tga"), "precious too");
    const overlay = path.join(root, "overlay");
    fs.mkdirSync(overlay);
    fs.symlinkSync(live, path.join(overlay, "ui"), "junction");
    expect(fs.existsSync(path.join(overlay, "ui", "banner.tga"))).toBe(true); // the link really works

    _removeEntry(path.join(overlay, "ui"));

    expect(fs.existsSync(path.join(overlay, "ui"))).toBe(false);
    expect(fs.readFileSync(path.join(live, "units", "card.tga"), "utf8")).toBe("precious");
    expect(fs.readFileSync(path.join(live, "banner.tga"), "utf8")).toBe("precious too");
  });

  it("a real overlay directory is removed whole, stopping at any junction inside it", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-rm-"));
    const live = path.join(root, "live-mod", "text");
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, "names.txt"), "live names");
    const dir = path.join(root, "overlay", "world");
    fs.mkdirSync(path.join(dir, "maps"), { recursive: true });
    fs.writeFileSync(path.join(dir, "maps", "copied.txt"), "overlay copy");
    fs.symlinkSync(live, path.join(dir, "maps", "text"), "junction");

    _removeEntry(dir);

    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readFileSync(path.join(live, "names.txt"), "utf8")).toBe("live names");
  });

  it("a missing path and a plain file are both fine", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-rm-"));
    expect(() => _removeEntry(path.join(root, "nope"))).not.toThrow();
    const f = path.join(root, "f.txt");
    fs.writeFileSync(f, "x");
    _removeEntry(f);
    expect(fs.existsSync(f)).toBe(false);
  });
});
