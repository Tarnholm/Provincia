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
import AiDiagModal from "./AiDiagModal.js";
import ShortcutsModal from "./ShortcutsModal.js";
import AddRegionModal from "./AddRegionModal.js";
import CompareModal from "./CompareModal.js";
import CommandPalette from "./CommandPalette.js";
import WealthPanel from "./WealthPanel.js";
import ArmySetupModal from "./ArmySetupModal.js";
import DashboardModal from "./DashboardModal.js";

// Stand-ins for the DashSection/DashRow module components that App.js passes in.
const StubSection = ({ title, children }) => <div><span>{title}</span>{children}</div>;
const StubRow = ({ label }) => <div>{label}</div>;

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

  it("AiDiagModal renders diagnostics sections + editable thresholds", async () => {
    const props = {
      saveEconomy: { turn: 12 },
      aiDiagConfig: { hoardMode: "scaled", hoardPerSettlement: 1000, hoardPerTier: 0, hoardPerPop: 0, hoardTreasury: 50000, hoardInvest: 500, lowTreasury: 0, dormantTurns: 5 },
      setAiDiagConfig: () => {},
      aiDiagnostics: {
        bankrupt: [{ faction: "gaul", treasury: -100, net: -50 }],
        willBankrupt: [],
        bleeding: [{ faction: "spain", net: -30, treasury: 200 }],
        hoarding: [{ faction: "egypt", treasury: 90000, threshold: 60000, settlements: 8, recruitment: 0, construction: 0, growth: 5 }],
      },
      factionDisplayNames: { gaul: "Gaul", spain: "Spain", egypt: "Egypt" },
      onClose: () => {},
      onPickFaction: () => {},
    };
    const c = await mount(<AiDiagModal {...props} />);
    expect(c.textContent).toContain("AI Diagnostics");
    expect(c.textContent).toContain("turn 12");
    expect(c.textContent).toContain("Bankrupt");
    expect(c.textContent).toContain("Gaul");
    expect(c.textContent).toContain("Egypt");
  });

  it("ShortcutsModal renders shortcuts; dev-only rows gated by devMode", async () => {
    let c = await mount(<ShortcutsModal devMode={false} onClose={() => {}} />);
    expect(c.textContent).toContain("Keyboard Shortcuts");
    expect(c.textContent).toContain("Search everywhere");
    expect(c.textContent).toContain("Toggle dev mode"); // always shown (not dev-gated)
    // Undo/Redo ARE dev-only → hidden when devMode false
    expect(c.textContent).not.toContain("Redo");
    if (root) { root.unmount(); root = null; }
    if (container?.parentNode) container.parentNode.removeChild(container);
    c = await mount(<ShortcutsModal devMode={true} onClose={() => {}} />);
    expect(c.textContent).toContain("Redo"); // dev-only row now visible
  });

  it("AddRegionModal renders the form with faction options and the color swatch", async () => {
    const form = { name: "Garamantia", city: "", faction: "", tags: "", rgb: "10,20,30" };
    const c = await mount(
      <AddRegionModal
        form={form}
        setForm={() => {}}
        factionOptions={["romans_julii", "carthage"]}
        onReroll={() => {}}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );
    expect(c.textContent).toContain("Add new region");
    expect(c.textContent).toContain("romans julii"); // underscores → spaces in options
    expect(c.querySelector('input[value="Garamantia"]')).toBeTruthy();
  });

  it("CompareModal renders picked-faction rows with live/start values and an empty state", async () => {
    const props = {
      factions: ["romans_julii", "carthage"],
      factionColors: { romans_julii: [200, 40, 40] },
      factionRegionsMap: { romans_julii: ["Rome", "Capua"], carthage: ["Carthage"] },
      factionWealth: { romans_julii: 17500, carthage: 25500 },
      liveRegionsByFaction: { romans_julii: 3 },
      liveArmiesByFaction: { romans_julii: 4 },
      liveTreasuryByFaction: { romans_julii: { treasury: 20000 } },
      factionDisplayNames: { romans_julii: "Julii", carthage: "Carthage" },
      aiPersonalityByFaction: { carthage: "ai_balanced" },
      liveLogActive: true,
      selection: ["romans_julii", "carthage", null],
      setSelection: () => {},
      onClose: () => {},
    };
    const c = await mount(<CompareModal {...props} />);
    expect(c.textContent).toContain("Compare factions");
    expect(c.textContent).toContain("Julii");
    expect(c.textContent).toContain("(live)"); // julii has a live treasury
    expect(c.textContent).toContain("Pick a faction above."); // third column empty
  });

  it("CompareModal degrades gracefully with all data slices absent", async () => {
    const c = await mount(
      <CompareModal
        factions={null} factionColors={null} factionRegionsMap={null} factionWealth={null}
        liveRegionsByFaction={null} liveArmiesByFaction={null} liveTreasuryByFaction={null}
        factionDisplayNames={null} aiPersonalityByFaction={null} liveLogActive={false}
        selection={[null, null, null]} setSelection={() => {}} onClose={() => {}}
      />,
    );
    expect(c.textContent).toContain("No factions loaded yet");
  });

  it("CommandPalette renders items, filters by query, and fires the top hit on Enter", async () => {
    let fired = null;
    const items = [
      { kind: "mode", id: "faction", label: "Faction", sub: "map mode", action: () => { fired = "faction"; } },
      { kind: "region", id: "1", label: "Rome", sub: "region", action: () => { fired = "rome"; } },
    ];
    const c = await mount(
      <CommandPalette items={items} query="rom" setQuery={() => {}} selIdx={0} setSelIdx={() => {}} onClose={() => {}} />,
    );
    expect(c.textContent).toContain("Rome");
    expect(c.textContent).not.toContain("Faction"); // filtered out by query "rom"
    expect(c.textContent).toContain("1 of 2 indexed");
    // Enter on the input fires the top hit's action (keyboard nav path).
    const input = c.querySelector("input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(fired).toBe("rome");
  });

  it("WealthPanel renders faction rows (portal) with starting wealth and no save", async () => {
    const props = {
      factions: ["romans_julii", "carthage"],
      factionRegionsMap: { romans_julii: ["Rome", "Capua"], carthage: ["Carthage"] },
      factionWealth: { romans_julii: 17500, carthage: 25500 },
      factionDisplayNames: { romans_julii: "Julii", carthage: "Carthage" },
      saveLiveArmies: [],
      currentOwnerByCity: null,
      saveTreasuryRecords: null,
      playerFaction: "romans_julii",
      factionRecordOwners: null,
      liveLogActive: false,
      saveEconomy: null,
      selectedFaction: "romans_julii",
      treasuryHistory: null,
      onJumpToFaction: () => {},
      onClose: () => {},
    };
    const c = await mount(<WealthPanel {...props} />);
    // Portal renders into document.body.
    expect(document.body.textContent).toContain("Faction Wealth");
    expect(document.body.textContent).toContain("Julii");
    expect(document.body.textContent).toContain("Carthage");
    // Locale-independent (jsdom/node omits the thousands separator that Chromium adds):
    expect(document.body.textContent).toContain("Treasury"); // the row table rendered
    expect(document.body.textContent).toMatch(/25.?500/); // carthage starting denarii
    void c;
  });

  const dashProps = {
    setShowDashboard: () => {},
    portraitAudit: null, captainBannerAudit: null, modExtraAudit: null, descrRegionsAudit: null,
    regionScrollsAudit: null, smFactionsAudit: null, aorCoverage: null, edbResAudit: null,
    buildingImagesAudit: null, unitLocAudit: null, unitImagesAudit: null, logWarningsAudit: null,
    textureDimsAudit: null, modDataDir: "C:/RIS/RIS/data",
    PRIMARY_AOR_TAGS: new Set(), SECONDARY_AOR_TO_FACTION: {},
    DashSection: StubSection, DashRow: StubRow,
  };

  it("DashboardModal shows the scanning state while loading", async () => {
    const c = await mount(<DashboardModal {...dashProps} dashLoading={true} dashResult={null} />);
    expect(c.textContent).toContain("Mod-validation dashboard");
    expect(c.textContent).toContain("Scanning");
  });

  it("DashboardModal renders a clean loaded result with all audits absent (no throw)", async () => {
    const c = await mount(<DashboardModal {...dashProps} dashLoading={false} dashResult={{ summary: {} }} />);
    expect(c.textContent).toContain("Mod-validation dashboard");
    // summary all-zero + null audits → the all-clear path, not the error path.
    expect(c.textContent).not.toContain("undefined");
  });

  it("ArmySetupModal renders with empty data (no throw; search props are strings)", async () => {
    const noop = () => {};
    const props = {
      activeIconsDir: null, armyBudgetFloor: null, armyCalibSave: null, armyCalibSaves: [],
      armyEcoMode: null, armyFacSearch: "", armyOverview: null, armyOverviewRunning: false,
      armyProjIncome: null, armySetSearch: "", armySetupBusy: false, armySetupData: null,
      armySetupFactions: [], armyT1Budget: null, corrCalibStored: null, factionDisplayNames: {},
      garrDone: false, modDataDir: "C:/x", pendingReload: false, pushToast: noop,
      setArmyBudgetFloor: noop, setArmyCalibSaves: noop, setArmyEcoMode: noop, setArmyFacSearch: noop,
      setArmyOverview: noop, setArmyProjIncome: noop, setArmySetSearch: noop, setArmySetupBusy: noop,
      setArmySetupData: noop, setArmyStratPlan: noop, setArmyT1Budget: noop, setGarrDone: noop,
      setPendingReload: noop, setShowArmySetup: noop, taxCalibStored: null,
    };
    const c = await mount(<ArmySetupModal {...props} />);
    // Portals into document.body.
    expect(document.body.textContent).toMatch(/Army Setup|Budget|Tax/);
    void c;
  });
});
