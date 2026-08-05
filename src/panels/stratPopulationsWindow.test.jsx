// @vitest-environment jsdom
//
// WINDOWED-RENDERING guard for the Starting Populations table (v0.9.1484).
// v0.9.1482 rendered all ~1,300 rows (a controlled input each ≈ 10k DOM
// nodes); toggling "level≠pop only" re-laid-out the whole table and froze the
// UI for seconds (user: "the mouse gets unresponsive"). Only the visible
// window may reach the DOM — this fails if someone reverts to a full map().
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import StratPopulationsModal from "./StratPopulationsModal.js";

const LEVELS = ["village", "town", "large_town", "city", "large_city", "huge_city"];
const rows = [];
for (let i = 0; i < 1306; i++) {
  rows.push({
    faction: "fac_" + (i % 239), region: "Region_" + i, settlement: "City_" + i,
    level: LEVELS[i % 6], pop: 400 + (i * 37) % 30000, capital: i % 40 === 0,
  });
}
const tiers = { upgradeAt: { village: 0, town: 1500, large_town: 4000, city: 9000, large_city: 17000, huge_city: 27000 }, tierOrder: LEVELS, minPop: 400, uniformAcrossCultures: true };

let container, root;
afterEach(() => {
  if (root) { try { root.unmount(); } catch { /* */ } root = null; }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
});

describe("StratPopulationsModal windowed table", () => {
  it("keeps the DOM to the visible window, and the chips/checkbox filter without a full re-layout", async () => {
    window.electronAPI = { getStratPopulations: () => Promise.resolve({ path: "x", rows, tiers }) };
    const ReactDOM = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    flushSync(() => { root.render(<StratPopulationsModal modDataDir="C:/x" factionDisplayNames={{}} pushToast={() => {}} onClose={() => {}} />); });
    await new Promise((r) => setTimeout(r, 0));

    // toLocaleString's thousands separator is locale-dependent (comma, space,
    // nbsp…) — match the digits with any single separator between them.
    const ALL_SHOWN = /1[\s,. ]?306 shown/;
    // 1,306 filtered rows, but the DOM holds only the window (+2 spacer rows)
    const domRows = document.body.querySelectorAll("tbody tr").length;
    expect(domRows).toBeGreaterThan(10);
    expect(domRows).toBeLessThan(120);
    expect(document.body.textContent).toMatch(ALL_SHOWN);

    // the mismatch checkbox narrows the count without exploding the DOM
    const box = document.body.querySelector('input[type="checkbox"]');
    flushSync(() => { box.click(); });
    expect(document.body.textContent).not.toMatch(ALL_SHOWN);
    expect(document.body.querySelectorAll("tbody tr").length).toBeLessThan(120);
    flushSync(() => { box.click(); });

    // ladder chips are clickable level filters: "Town" shows only the 218 towns
    const townChip = [...document.body.querySelectorAll("button")].find((b) => /^Town\b/.test(b.textContent));
    expect(townChip).toBeTruthy();
    flushSync(() => { townChip.click(); });
    expect(document.body.textContent).toContain("218 shown"); // 1306/6 levels → 218 declared town
    flushSync(() => { townChip.click(); }); // toggle off restores everything
    expect(document.body.textContent).toMatch(ALL_SHOWN);
  });
});
