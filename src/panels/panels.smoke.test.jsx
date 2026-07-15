// @vitest-environment jsdom
//
// RENDER SMOKE-TEST for the panels extracted out of App.js. Each panel was
// moved verbatim with its closed-over App state converted to props; the boot
// smoke-launch never opens them, so this mounts each one in jsdom with
// representative props and asserts it renders without throwing. Catches
// prop-threading mistakes (wrong/renamed prop → crash on open) before release.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import React from "react";

import EntityBudgetModal from "./EntityBudgetModal.js";
import XrefModal from "./XrefModal.js";
import RevertAutosaveModal from "./RevertAutosaveModal.js";
import SettlementAuditModal from "./SettlementAuditModal.js";
import LoadModModal from "./LoadModModal.js";

beforeAll(() => {
  if (!window.electronAPI) window.electronAPI = { scriptsJumpTo: () => {}, selectFolder: () => Promise.resolve(null), findFactionIconsDir: () => Promise.resolve(null) };
});

let container, root;
afterEach(async () => {
  if (root) { try { root.unmount(); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
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
  return container;
}

describe("panels render smoke-test", () => {
  it("EntityBudgetModal renders with counts and with nulls", async () => {
    let c = await mount(<EntityBudgetModal aliveCount={1200} deadCount={30000} inPlaceDeadCount={5} onClose={() => {}} />);
    expect(c.textContent).toContain("Save entity budget");
    expect(c.textContent).toContain("near corruption risk"); // 30000/65536 ~ 0.46 → red tier
    // No-save state (both null) shows the empty hint, no throw.
    if (root) { root.unmount(); root = null; }
    if (container?.parentNode) container.parentNode.removeChild(container);
    c = await mount(<EntityBudgetModal aliveCount={null} deadCount={null} inPlaceDeadCount={null} onClose={() => {}} />);
    expect(c.textContent).toContain("No save loaded yet");
  });

  it("XrefModal renders results grouped by file", async () => {
    const result = { totalMatches: 2, byFile: { "export_descr_buildings.txt": [{ line: 12, text: "building foo" }, { line: 40, text: "  bar" }] } };
    const c = await mount(<XrefModal xrefQuery="foo" setXrefQuery={() => {}} xrefResult={result} xrefLoading={false} onClose={() => {}} />);
    expect(c.textContent).toContain("Cross-reference");
    expect(c.textContent).toContain("export_descr_buildings.txt");
    expect(c.textContent).toContain("2 matches");
  });

  it("RevertAutosaveModal renders a list and an empty state", async () => {
    const autosaves = [{ ts: Date.now() - 120000, label: "Edit A", kind: "trait" }, { ts: Date.now(), label: "Edit B" }];
    const c = await mount(<RevertAutosaveModal autosaves={autosaves} autosaveMax={30} onRevert={() => {}} onClose={() => {}} onClosePendingReview={() => {}} pushToast={() => {}} />);
    expect(c.textContent).toContain("Revert to autosave");
    expect(c.textContent).toContain("Edit B");
    expect(c.textContent).toContain("latest");
  });

  it("SettlementAuditModal renders rows for the focused faction (portal)", async () => {
    const props = {
      selectedFaction: "romans_julii",
      playerFaction: "romans_julii",
      currentOwnerByCity: { Rome: "romans_julii", Capua: "romans_julii" },
      saveSettlementFields: {
        Rome: { publicOrder: 120, income: 500, taxRate: 1, populationGrowth: 10, committedPopulation: 1000 },
        Capua: { publicOrder: 88, income: -20, taxRate: 2, populationGrowth: -5, committedPopulation: 500 },
      },
      regions: { "1,2,3": { city: "Rome", region: "Latium" }, "4,5,6": { city: "Capua", region: "Campania" } },
      saveCharactersByRegion: { Latium: [{ firstName: "Flavius", type: "general" }] },
      factionDisplayNames: { romans_julii: "Julii" },
      onClose: () => {},
    };
    const c = await mount(<SettlementAuditModal {...props} />);
    // Portal renders into document.body, not container — assert on the document.
    expect(document.body.textContent).toContain("Economy Audit");
    expect(document.body.textContent).toContain("Julii");
    expect(document.body.textContent).toContain("Rome");
    void c;
  });

  it("LoadModModal renders its call-to-action", async () => {
    const c = await mount(<LoadModModal onClose={() => {}} onSetModIconsDir={() => {}} pushToast={() => {}} />);
    expect(c.textContent).toContain("Load your mod to edit");
    expect(c.textContent).toContain("Load mod folder");
  });
});
