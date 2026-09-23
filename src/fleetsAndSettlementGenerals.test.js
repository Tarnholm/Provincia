// Two live-mode gaps found against the running game (RTWHook, 2026-09-23).
//
// 1. Fleets carrying passengers. A ship's fleet id sits 20 bytes before its
//    name plus 4 bytes per boarded passenger (the passenger array lies in
//    between). Read at a fixed -20, a loaded fleet got garbage, its ships were
//    lumped into the previous fleet, and it vanished from the map. Engine truth
//    at the start of turn 3 of a RIS campaign: 91 fleets, incl. Admiral
//    Onasimos (issa, a diplomat aboard) at (327,420) and Admiral Tereus
//    (rhodes, an army aboard) at (435,332). Needs the local fixture
//    scripts/save-fixtures/feral/ris_t3_fleets.sav and the RIS mod.
// 2. A general put into a settlement mid-turn (a married-in general gets his
//    bodyguard): only the log knows — "transferring general(...) ... in
//    settlement(Perusia)".
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseLine } = require("./messageLogParser.js");

const SAVE = path.join(__dirname, "..", "scripts", "save-fixtures", "feral", "ris_t3_fleets.sav");
const MOD = "C:/RIS/RIS/data";
const have = fs.existsSync(SAVE) && fs.existsSync(MOD + "/descr_sm_factions.txt");

describe.skipIf(!have)("fleets carrying passengers (engine-measured save)", () => {
  let fleets;
  it("parses", () => {
    const H = require("./mainIpcHarness.js").loadMainHandlers();
    H.main.loadModCharacterData(MOD);
    fleets = H.main.parseCharactersAndUnits(fs.readFileSync(SAVE)).liveArmies.filter((a) => a.armyClass === "navy");
    expect(fleets.length).toBeGreaterThan(0);
  }, 120000);

  it("finds every fleet the engine had, loaded ones included", () => {
    expect(fleets.length).toBe(91);
    expect(fleets.find((a) => a.x === 327 && a.y === 420)).toMatchObject({ faction: "issa" });
    expect(fleets.find((a) => a.x === 435 && a.y === 332)).toMatchObject({ faction: "rhodes" });
  });
});

describe("a general put into a settlement mid-turn", () => {
  it("is read from the log", () => {
    expect(parseLine("transferring general(Numerius Seius Corvinus:7ddb2480) unit(9fac1b30) from army(5d8ee8b0) to army(f39f8d20) in settlement(Perusia)"))
      .toMatchObject({ type: "general_to_settlement", name: "Numerius Seius Corvinus", settlement: "Perusia" });
  });

  it("does not swallow the named-general transfer", () => {
    expect(parseLine("transferring general(Gnaeus Cornelius Blasio:f3967c40) unit(edd30530) from army(f39f7fa0) to named general(Gnaeus Cornelius Blasio:f3967c40):army(5d8eeaf0) ").type)
      .toBe("general_transfer");
  });
});
