// @vitest-environment jsdom
// Campaign Autopsy's only control is "Scan saves…", and it did nothing for its
// whole life: the panel takes `onScanTimeline`, App.js passed `runTimelineScan`
// (fixed 2026-09-22, with src/panelHandlerProps.test.js to keep it fixed).
// Here: the button calls what it is given, and a scanned timeline actually
// reaches the analysis — the two halves of that path.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import CampaignAutopsyPanel from "./panels/CampaignAutopsyPanel.js";

let container, root;
function mount(el) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(el));
}
afterEach(() => {
  if (root) { try { flushSync(() => root.unmount()); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  delete window.electronAPI;
});
const text = () => document.body.textContent;
// "Scan saves…" when idle, "Scanning saves…" while a scan runs
const scanButton = () => [...document.querySelectorAll("button")].find((b) => /Scan(ning)? saves/.test(b.textContent || ""));

describe("CampaignAutopsyPanel", () => {
  it("the scan button calls the handler it is given", () => {
    let calls = 0;
    mount(<CampaignAutopsyPanel modDataDir="C:/mod" timeline={null} scanning={false} onScanTimeline={() => { calls++; }} onClose={() => { }} />);
    const b = scanButton();
    expect(b).toBeTruthy();
    flushSync(() => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(calls, "clicking 'Scan saves…' must reach the handler — it was passed under the wrong name until 2026-09-22").toBe(1);
  });

  it("says a scan is running rather than offering another", () => {
    mount(<CampaignAutopsyPanel modDataDir="C:/mod" timeline={null} scanning={true} onScanTimeline={() => { }} onClose={() => { }} />);
    expect(scanButton().disabled).toBe(true);
    expect(text()).toMatch(/Scanning saves/);
  });

  it("a scanned timeline reaches the analysis and renders its verdicts", async () => {
    const timeline = { scanned: 4, campaigns: [{ player: "romans_julii", rows: [{ turn: 1 }, { turn: 17 }] }] };
    let sawTimeline = null;
    window.electronAPI = {
      analyzeCampaign: (dir, t) => { sawTimeline = t; return Promise.resolve({
        turns: [1, 17],
        winner: "romans_julii",
        factions: [
          { faction: "romans_julii", verdict: "dominant", peakTurn: 17, peak: 26, series: [12, 26] },
          { faction: "carthage", verdict: "eliminated", peakTurn: 1, peak: 41, eliminatedTurn: 17, series: [41, 0] },
        ],
      }); },
    };
    mount(<CampaignAutopsyPanel modDataDir="C:/mod" timeline={timeline} scanning={false} factionDisplayNames={{ romans_julii: "Rome", carthage: "Carthage" }} onScanTimeline={() => { }} onClose={() => { }} />);
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => { });
    expect(sawTimeline, "the panel must forward the app's already-scanned timeline, not re-scan").toBe(timeline);
    expect(text()).toMatch(/Rome/);
    expect(text()).toMatch(/Carthage/);
    expect(text()).toMatch(/Eliminated/);
    expect(scanButton(), "with a timeline loaded the empty state is gone").toBeFalsy();
  });

  it("an analysis error is shown, not swallowed", async () => {
    window.electronAPI = { analyzeCampaign: () => Promise.resolve({ error: "no campaigns in that folder" }) };
    mount(<CampaignAutopsyPanel modDataDir="C:/mod" timeline={{ campaigns: [{ player: "x", rows: [] }] }} scanning={false} onScanTimeline={() => { }} onClose={() => { }} />);
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => { });
    expect(text()).toMatch(/no campaigns in that folder/);
  });
});
