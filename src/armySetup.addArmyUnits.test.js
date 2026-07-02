import { describe, it, expect } from "vitest";
import { applyAddArmyUnits } from "./armySetup.js";

// Regression gate for the spend-headroom suggestions (v0.9.1214): appending units
// to a NAMED CHARACTER's army must land inside THAT character's army block, keep
// CRLF, and respect the engine's 20-unit cap (bodyguard included).

const mkStrat = (extraUnits = 0) => [
  "faction\tromans_julii, balanced smith",
  "denari\t5000",
  ";Arretium",
  "character,\tFlavius Julius, named character, male, age 40, , x 90, y 88",
  "army",
  "unit\t\troman generals guard cavalry early\t\t\texp 0 armour 0 weapon_lvl 0",
  "unit\t\troman hastati\t\t\texp 1 armour 0 weapon_lvl 0",
  ...Array.from({ length: extraUnits }, () => "unit\t\troman leves\t\t\texp 0 armour 0 weapon_lvl 0"),
  "",
  // TAB format — the MAIN RIS shape (914 of 1014 character lines); regression for the
  // 2026-07-02 fix (the comma-only matcher saw 4 of Rome's 34 commanders)
  "character\tVibius Julius, named character, male, age 30, , x 80, y 70",
  "army",
  "unit\t\troman generals guard cavalry early\t\t\texp 0 armour 0 weapon_lvl 0",
  "",
  "faction\tromans_brutii, balanced smith",
  "character,\tTitus Brutus, named character, male, age 30, , x 60, y 40",
  "army",
  "unit\t\troman generals guard cavalry early\t\t\texp 0 armour 0 weapon_lvl 0",
].join("\r\n");

describe("applyAddArmyUnits — spend-headroom army adds", () => {
  it("appends after the target character's LAST unit line, CRLF-safe", () => {
    const r = applyAddArmyUnits(mkStrat(), "romans_julii", "Flavius Julius", ["roman principes", "roman equites"]);
    expect(r.ok).toBe(true);
    expect(r.addedCount).toBe(2);
    expect(r.capClipped).toBe(false);
    const lines = r.text.split("\r\n"); // CRLF must survive
    const hastati = lines.findIndex(l => /roman hastati/.test(l));
    expect(lines[hastati + 1]).toBe("unit\t\troman principes\t\t\texp 0 armour 0 weapon_lvl 0");
    expect(lines[hastati + 2]).toBe("unit\t\troman equites\t\t\texp 0 armour 0 weapon_lvl 0");
    // Vibius' army (next character) untouched: still exactly one unit line after his army
    const vib = lines.findIndex(l => /Vibius Julius/.test(l));
    expect(lines[vib + 1]).toBe("army");
    expect(/^unit\t/.test(lines[vib + 2])).toBe(true);
    expect(lines[vib + 3]).toBe("");
  });

  it("clips at the 20-unit cap and errors when already full", () => {
    // 2 base units + 17 extra = 19 → room for exactly 1
    const r = applyAddArmyUnits(mkStrat(17), "romans_julii", "Flavius Julius", ["roman principes", "roman equites"]);
    expect(r.ok).toBe(true);
    expect(r.addedCount).toBe(1);
    expect(r.capClipped).toBe(true);
    // 2 + 18 = 20 → no room at all
    const full = applyAddArmyUnits(mkStrat(18), "romans_julii", "Flavius Julius", ["roman principes"]);
    expect(full.ok).toBe(false);
    expect(full.error).toMatch(/20-unit cap/);
  });

  it("never touches a same-named character in ANOTHER faction; unknown names error", () => {
    const r = applyAddArmyUnits(mkStrat(), "romans_brutii", "Titus Brutus", ["bruttian infantry"]);
    expect(r.ok).toBe(true);
    const lines = r.text.split("\r\n");
    const brutii = lines.findIndex(l => /^faction\tromans_brutii/.test(l));
    expect(lines.findIndex(l => /bruttian infantry/.test(l))).toBeGreaterThan(brutii);
    expect(applyAddArmyUnits(mkStrat(), "romans_julii", "Nobody Special", ["roman leves"]).ok).toBe(false);
    expect(applyAddArmyUnits(mkStrat(), "carthage", "Flavius Julius", ["roman leves"]).ok).toBe(false);
  });

  it("finds a TAB-format character and stops at a TAB-format boundary", () => {
    // Vibius is tab-format; adds must land in HIS army, not run into romans_brutii
    const r = applyAddArmyUnits(mkStrat(), "romans_julii", "Vibius Julius", ["roman equites"]);
    expect(r.ok).toBe(true);
    const lines = r.text.split("\r\n");
    const vib = lines.findIndex(l => /Vibius Julius/.test(l));
    expect(lines[vib + 3]).toBe("unit\t\troman equites\t\t\texp 0 armour 0 weapon_lvl 0");
    // and adds to Flavius must NOT bleed past the tab-format Vibius line
    const r2 = applyAddArmyUnits(mkStrat(), "romans_julii", "Flavius Julius", ["roman principes"]);
    const l2 = r2.text.split("\r\n");
    expect(l2.findIndex(l => /roman principes/.test(l))).toBeLessThan(l2.findIndex(l => /Vibius Julius/.test(l)));
  });
});
