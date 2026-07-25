// @vitest-environment node
//
// The campaign script's own commands, rejected by the engine.
//
// "555x no building of this type in settlement" names neither the command nor the
// file. This module turns it into "5 calls at RIS_Campaign_Script.txt:4623-4627, each
// failing 111 times", which a modder can act on in a minute.
//
// Three plausible root causes were ruled out before the wording was settled, and the
// tests below pin the reasoning so it cannot quietly regress:
//   - the building chains don't exist in EDB → they all DO exist
//   - `local` is an unexpanded variable → `local` is correct RTW scope syntax
//   - it's a deliberate try-all-four, so 3 of 4 must fail → then one would SUCCEED;
//     all five counts are equal, including a chain outside the mutually-exclusive set
import { describe, it, expect } from "vitest";
import { auditFailedConsoleCommands } from "./aiScriptAudit.js";

const FAILURES = ["hinterland_region", "governmentA", "governmentB", "governmentC", "governmentD"]
  .map((c) => ({
    command: `set_building_health local ${c} 100`,
    count: 111,
    messages: [{ message: "no building of this type in settlement", n: 111 }],
  }));

// Shaped like the real script: a commented-out call far above, then the live block.
const SCRIPT = [
  "monitor_event SettlementTurnStart",
  ";\t\tconsole_command set_building_health local hinterland_region 100",
  "\t\tremove_hidden_resource local salt_supply_built",
  "\t\tconsole_command set_building_health local hinterland_region 100",
  "\t\tconsole_command set_building_health local governmentA 100",
  "\t\tconsole_command set_building_health local governmentB 100",
  "\t\tconsole_command set_building_health local governmentC 100",
  "\t\tconsole_command set_building_health local governmentD 100",
  "\t\tif SettlementBuildingExists = amber_supply",
  "end_monitor",
].join("\n");

describe("auditFailedConsoleCommands", () => {
  it("names the file and the exact line span", () => {
    const leads = auditFailedConsoleCommands({ failures: FAILURES, campaignScript: SCRIPT });
    expect(leads).toHaveLength(1);
    expect(leads[0].file).toBe("RIS_Campaign_Script.txt");
    // Lines 4-8 of the fixture: the live block. NOT line 2, which is commented out.
    expect(leads[0].issue).toContain("lines 4-8");
  });

  it("ignores commented-out call sites", () => {
    // A `;` line is not running, so blaming it would send the modder to the wrong
    // place — and the real script has exactly such a line 2,869 lines above the block.
    const leads = auditFailedConsoleCommands({
      failures: FAILURES,
      campaignScript: ";  console_command set_building_health local governmentA 100",
    });
    expect(leads).toHaveLength(0);
  });

  it("claims 'none is succeeding' only when every count is equal", () => {
    const equal = auditFailedConsoleCommands({ failures: FAILURES, campaignScript: SCRIPT });
    expect(equal[0].issue).toContain("none of them is succeeding");

    // Unequal counts are consistent with some calls succeeding, so the strong claim
    // must not appear. Overclaiming here would be the "shotgun theory" mistake in
    // reverse — asserting a cause the numbers do not establish.
    const uneven = auditFailedConsoleCommands({
      failures: FAILURES.map((f, i) => ({ ...f, count: 100 + i * 7 })),
      campaignScript: SCRIPT,
    });
    expect(uneven[0].issue).not.toContain("none of them is succeeding");
  });

  it("states that the counts are failures, not a rate", () => {
    // The console echoes only failures, so this log has NO denominator. A reader who
    // takes 111 as a percentage or a ratio would be misled.
    const leads = auditFailedConsoleCommands({ failures: FAILURES, campaignScript: SCRIPT });
    expect(leads[0].evidence).toMatch(/no denominator/i);
  });

  it("emits nothing when it cannot name a line", () => {
    // A lead that cannot point at a location is not worth reading, and guessing one
    // would be worse than silence.
    expect(auditFailedConsoleCommands({ failures: FAILURES, campaignScript: null })).toEqual([]);
    expect(auditFailedConsoleCommands({ failures: [], campaignScript: SCRIPT })).toEqual([]);
    expect(auditFailedConsoleCommands({})).toEqual([]);
    // Command that appears nowhere in the script.
    expect(auditFailedConsoleCommands({
      failures: [{ command: "give_trait x y 1", count: 4, messages: [] }],
      campaignScript: SCRIPT,
    })).toEqual([]);
  });

  it("groups by command name rather than emitting one lead per call", () => {
    // Five calls in one block is one thing to fix, not five things to read.
    const leads = auditFailedConsoleCommands({ failures: FAILURES, campaignScript: SCRIPT });
    expect(leads).toHaveLength(1);
    expect(leads[0].evidence).toContain("governmentA");
    expect(leads[0].evidence).toContain("governmentD");
  });
});
