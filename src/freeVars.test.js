// Free-variable guard (backlog item since 2026-07: "check-freevars.cjs as a test").
//
// App.js is one ~21,000-line component; blocks get extracted from it and dead
// state gets removed from it. Either can leave a name that is referenced but no
// longer bound, which only fails at RUNTIME, on the code path that reads it — a
// gray screen for whoever opens that panel. scripts/check-freevars.cjs reports
// every identifier a file references without binding; here it runs over the
// renderer's big files and every panel, and anything that is not a browser
// global fails the suite.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const BROWSER_GLOBALS = new Set([
  "Audio", "Blob", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FileReader", "File", "FormData",
  "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "Uint16Array", "Uint32Array", "Uint8ClampedArray", "ImageData", "ImageBitmap",
  "MutationObserver", "ResizeObserver", "IntersectionObserver", "Path2D", "Worker", "OffscreenCanvas", "Image", "DOMParser", "XMLSerializer",
  "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "createImageBitmap", "structuredClone", "queueMicrotask",
  "decodeURIComponent", "encodeURIComponent", "location", "history", "performance", "sessionStorage", "localStorage", "navigator", "screen",
  "getComputedStyle", "matchMedia", "alert", "confirm", "prompt", "fetch", "URL", "URLSearchParams", "AbortController", "TextDecoder", "TextEncoder",
  "HTMLElement", "HTMLCanvasElement", "HTMLInputElement", "Node", "Element", "crypto", "atob", "btoa", "Intl", "WeakRef",
  "import", "meta", // import.meta / dynamic import() surface as bare "import" and "meta" references
]);

const FILES = [
  "src/App.js", "src/RegionInfo.js", "src/InfoPopup.js", "src/FamilyTree.js",
  ...fs.readdirSync(path.join(ROOT, "src", "panels")).filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f)).map((f) => `src/panels/${f}`),
];

function freeVars(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-freevars.cjs"), path.join(ROOT, rel)], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (/\(none\)/.test(out)) return [];
  const m = out.match(/free identifier\(s\)\s*\r?\n\s*(.+)/);
  if (!m) throw new Error(`check-freevars gave no readable result for ${rel}:\n${out.slice(0, 400)}`);
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

describe("renderer files reference nothing they do not bind", () => {
  it("the checker itself can see an unbound name (the guard can fire)", () => {
    const tmp = path.join(ROOT, "src", "__freevars_probe__.js");
    fs.writeFileSync(tmp, "export default function P() { return <div>{definitelyNotBoundAnywhere}</div>; }\n");
    try { expect(freeVars("src/__freevars_probe__.js")).toContain("definitelyNotBoundAnywhere"); }
    finally { fs.unlinkSync(tmp); }
  });

  for (const rel of FILES) {
    it(rel, () => {
      const unbound = freeVars(rel).filter((n) => !BROWSER_GLOBALS.has(n));
      expect(unbound, `${rel} references these without binding them — a removed state hook, a missed prop on an extracted block, or a missing import`).toEqual([]);
    }, 60000);
  }
});
