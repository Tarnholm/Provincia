// The diplomacy cell's +20 field is a set of treaty bits (decoded 2026-09-24
// against the running engine: DIPLOMACY_MANAGER::has_trade_rights and the
// military-access assertion in apply_proposition read the same flags, and all
// 717 pairs checked map save value -> engine flags one-to-one). Trade rights is
// bit 32. Reading "bond >= 54" as trade showed only alliances: a trade deal the
// Sarsinates offered the player (and he accepted) never appeared.
// Fixtures: the user's RIS campaign, Turn 2 (before the deal) and Turn 6 Start.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { parseDiplomacyMatrix } = require("./saveCrackerExtras.js");
const DIR = path.resolve(__dirname, "../calibration/saves-2026-09-24");
const MOD = "C:/RIS/RIS/data";
const T2 = path.join(DIR, "rome_t2_before_trade.sav");
const T6 = path.join(DIR, "rome_t6_start.sav");
const have = fs.existsSync(T2) && fs.existsSync(T6) && fs.existsSync(path.join(MOD, "descr_sm_factions.txt"));

const smOrder = () => {
  const out = [];
  for (const l of fs.readFileSync(path.join(MOD, "descr_sm_factions.txt"), "utf8").split("\n")) {
    const m = l.match(/^\t"([a-z_0-9]+)":/);
    if (m) out.push(m[1]);
  }
  return out;
};

describe.skipIf(!have)("treaty bits on a real RIS campaign", () => {
  const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
  const order = have ? smOrder() : [];
  const t2 = have ? quiet(() => parseDiplomacyMatrix(fs.readFileSync(T2), order)) : null;
  const t6 = have ? quiet(() => parseDiplomacyMatrix(fs.readFileSync(T6), order)) : null;

  it("a trade-rights deal shows once it is in a save", () => {
    expect(t2.romans_julii.trade).not.toContain("sarsinates");
    expect(t6.romans_julii.trade).toContain("sarsinates");
    expect(t6.sarsinates.trade).toContain("romans_julii");
    expect(t6.romans_julii.trade).toContain("messapians");
  });

  it("allies still trade (every alliance carries the bit)", () => {
    for (const f of ["bruttians", "capua", "lucanians", "samnites", "taras", "volsinii"]) {
      expect(t6.romans_julii.allied).toContain(f);
      expect(t6.romans_julii.trade).toContain(f);
    }
  });

  it("a protectorate that also trades (62/63) is still a protectorate", () => {
    expect(t6.seleucid.protectorates).toEqual(expect.arrayContaining(["lysiad", "priene"]));
    expect(t6.lysiad.suzerains).toContain("seleucid");
  });

  it("bits 8/4/2 alone are not trade (10 and 14 occur between factions at war)", () => {
    expect(t6.getae.trade).not.toContain("asti");
    expect(t6.acarnania.trade).not.toContain("aetolia");
  });
});
