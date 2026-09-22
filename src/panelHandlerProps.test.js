// A button wired to nothing is invisible to every other guard.
//
// Campaign Autopsy's only control — "Scan saves…" — did nothing from the day it
// shipped: the panel takes `onScanTimeline`, App.js passed `runTimelineScan`,
// and `onScanTimeline && onScanTimeline()` silently did nothing. The Timeline
// section of Save Insights had the same dead button. Nothing caught it: the
// name is bound (so check-freevars is happy), the panel renders (so the smoke
// tests are happy), and the handler exists in App (so it looks wired).
//
// So: every handler prop a panel DECLARES and then USES — calls, or forwards to
// a child — must be supplied at each place App.js mounts that panel. A prop the
// panel declares but never uses is not reported; it is dead weight, not a dead
// control.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const NL = String.fromCharCode(10);

// comment lines blanked: `// the inline <RegionInfo> data props` is prose, not a mount
const APP = fs.readFileSync(path.join(ROOT, "src", "App.js"), "utf8")
  .split(NL).map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l)).join(NL);

function panelFiles() {
  const out = [];
  for (const dir of ["src", "src/panels"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.jsx?$/.test(f) && !/\.test\./.test(f)) out.push(path.join(dir, f).replace(/\\/g, "/"));
    }
  }
  return out;
}

function deadControls() {
  const found = [];
  for (const rel of panelFiles()) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const sig = src.match(/export default function (\w+)\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!sig) continue;
    const [, name, propList] = sig;
    const handlers = [...propList.matchAll(/(?:^|,)\s*(\w+)/g)].map((x) => x[1]).filter((p) => /^on[A-Z]/.test(p));
    if (!handlers.length) continue;
    const body = src.slice(sig.index + sig[0].length);

    for (const mount of APP.matchAll(new RegExp("<" + name + "\\b", "g"))) {
      const start = mount.index;
      const end = APP.indexOf("/>", start);
      const block = APP.slice(start, end < 0 ? start + 6000 : end);
      const passed = new Set([...block.matchAll(/(\w+)\s*=\s*\{/g)].map((x) => x[1]));
      const dead = handlers.filter((h) => !passed.has(h) && new RegExp("\\b" + h + "\\b").test(body));
      if (dead.length) found.push(`${rel} <${name}> at App.js:${APP.slice(0, start).split(NL).length} never receives ${dead.join(", ")}`);
    }
  }
  return found;
}

describe("panels are mounted with the handlers they use", () => {
  it("finds no control wired to nothing", () => {
    expect(deadControls(), "App.js mounts a panel without a handler that panel uses — that control does nothing when clicked").toEqual([]);
  });

  it("the check can actually fail (it found the Campaign Autopsy scan button)", () => {
    // Same analysis over a fabricated pair, to prove the walk is not vacuous.
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "propguard-"));
    const panel = path.join(dir, "FakePanel.js");
    fs.writeFileSync(panel, "export default function FakePanel({ title, onDoThing }) {" + NL +
      "  return <button onClick={() => onDoThing && onDoThing()}>{title}</button>;" + NL + "}" + NL);
    const app = "<FakePanel" + NL + "  title={t}" + NL + "  runDoThing={runDoThing}" + NL + "/>";
    const sig = fs.readFileSync(panel, "utf8").match(/export default function (\w+)\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    const handlers = [...sig[2].matchAll(/(?:^|,)\s*(\w+)/g)].map((x) => x[1]).filter((p) => /^on[A-Z]/.test(p));
    const passed = new Set([...app.matchAll(/(\w+)\s*=\s*\{/g)].map((x) => x[1]));
    fs.rmSync(dir, { recursive: true, force: true });
    expect(handlers).toEqual(["onDoThing"]);
    expect(handlers.filter((h) => !passed.has(h))).toEqual(["onDoThing"]);
  });
});
