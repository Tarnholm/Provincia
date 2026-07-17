// @vitest-environment jsdom
//
// Render smoke-test for SaveComparePanel (same harness as panels.smoke.test.jsx,
// kept in its own file — the compare feature ships as new files only). Mounts
// the panel bare and with a picked-saves + result state exercised via the
// stubbed electronAPI, asserting it renders without throwing.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import React from "react";
import SaveComparePanel from "./SaveComparePanel.js";

beforeAll(() => {
  window.electronAPI = {
    selectSaveFile: () => Promise.resolve({ file: "a.sav", path: "C:/saves/a.sav" }),
    compareSaves: () => Promise.resolve({
      flips: [{ settlement: "Capua", from: "julii", to: "carthage" }],
      factionRows: [{
        faction: "julii", settlementsFrom: 2, settlementsTo: 1, settlementsDelta: -1,
        treasuryFrom: 5000, treasuryTo: 4000, treasuryDelta: -1000,
        unitsFrom: 10, unitsTo: 12, unitsDelta: 2,
        soldiersFrom: 1000, soldiersTo: 1200, soldiersDelta: 200,
        appeared: false, disappeared: false,
      }],
      popRows: [{ settlement: "Rome", from: 4000, to: 4400, delta: 400 }],
      meta: {
        a: { turn: 1, turnLabel: "Turn 1 · Spring 270 BC", file: "a.sav", path: "C:/saves/a.sav", settlements: 3, factions: 2 },
        b: { turn: 2, turnLabel: "Turn 2 · Summer 270 BC", file: "b.sav", path: "C:/saves/b.sav", settlements: 3, factions: 2 },
        orderSuspect: false, identical: false, popChangedTotal: 1, popRowsTruncated: false,
      },
    }),
  };
});

let container, root;
afterEach(async () => {
  if (root) { try { root.unmount(); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  document.body.innerHTML = ""; // the panel portals into document.body
});

async function mount(element) {
  const ReactDOM = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  container = document.createElement("div");
  document.body.appendChild(container);
  let caught = null;
  root = ReactDOM.createRoot(container, {
    onUncaughtError: (e) => { caught = caught || e; },
    onCaughtError: (e) => { caught = caught || e; },
  });
  flushSync(() => { root.render(element); });
  if (caught) throw new Error("render threw: " + (caught.message || String(caught)));
  return document.body; // portal target
}

describe("SaveComparePanel render smoke-test", () => {
  it("renders empty (no picks yet)", async () => {
    const b = await mount(<SaveComparePanel modDataDir="C:/RIS/RIS/data" onClose={() => {}} />);
    expect(b.textContent).toContain("Compare saves");
    expect(b.textContent).toContain("Pick earlier save");
    expect(b.textContent).toContain("Pick two saves from the same campaign");
  });

  it("renders full result state after pick + compare", async () => {
    const { act } = await import("react");
    const b = await mount(<SaveComparePanel modDataDir="C:/RIS/RIS/data" onClose={() => {}} />);
    const buttons = () => [...b.querySelectorAll("button")];
    // pick earlier + later (stub resolves the same path — fine for a render test)
    await act(async () => { buttons().find((x) => x.textContent.includes("Pick earlier save")).click(); });
    await act(async () => { buttons().find((x) => x.textContent.includes("Pick later save")).click(); });
    await act(async () => { buttons().find((x) => x.textContent === "Compare").click(); });
    expect(b.textContent).toContain("Turn 1 · Spring 270 BC");
    expect(b.textContent).toContain("Ownership flips");
    expect(b.textContent).toContain("Capua");
    expect(b.textContent).toContain("Faction deltas");
    expect(b.textContent).toContain("julii");
    expect(b.textContent).toContain("Population");
    expect(b.textContent).toContain("+400");
  });
});
