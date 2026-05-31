import { describe, test, expect } from "vitest";
import fs from "node:fs";
import { parseTurn, yearForTurnsElapsed, EPOCH_YEAR } from "./turnParser.js";

// Build a minimal synthetic save fragment carrying the campaign-date record:
//   "...descr_strat.txt" (UTF-16LE) + variant byte + 44 00 00 01
//   + u32 turnsElapsed + i32 currentYear
function makeDateRecord(turn, { variant = 0xa6, year = null, pad = 64 } = {}) {
  const turnsElapsed = turn - 1;
  const yr = year == null ? yearForTurnsElapsed(turnsElapsed) : year;
  const str = Buffer.from("descr_strat.txt", "utf16le"); // ends in "...txt"
  const marker = Buffer.from([variant, 0x44, 0x00, 0x00, 0x01]);
  const body = Buffer.alloc(8);
  body.writeInt32LE(turnsElapsed, 0);
  body.writeInt32LE(yr, 4);
  const prefix = Buffer.alloc(pad); // leading junk so offset != 0
  return Buffer.concat([prefix, str, marker, body, Buffer.alloc(pad)]);
}

describe("parseTurn (synthetic)", () => {
  test("reads a 1-based turn from the date record", () => {
    for (const t of [1, 2, 3, 5, 8, 34, 250]) {
      const buf = makeDateRecord(t);
      const r = parseTurn(buf);
      expect(r).not.toBeNull();
      expect(r.turn).toBe(t);
      expect(r.turnsElapsed).toBe(t - 1);
    }
  });

  test("derives year + season (4 turns/year)", () => {
    expect(parseTurn(makeDateRecord(1)).year).toBe(-270);
    expect(parseTurn(makeDateRecord(4)).year).toBe(-270);
    expect(parseTurn(makeDateRecord(5)).year).toBe(-269);
    expect(parseTurn(makeDateRecord(8)).year).toBe(-269);
    expect(parseTurn(makeDateRecord(34)).year).toBe(-262);
    expect(parseTurn(makeDateRecord(1)).seasonIndex).toBe(0);
    expect(parseTurn(makeDateRecord(3)).seasonIndex).toBe(2);
    expect(parseTurn(makeDateRecord(8)).seasonIndex).toBe(3);
  });

  test("accepts the older-layout variant byte (0xd6)", () => {
    expect(parseTurn(makeDateRecord(3, { variant: 0xd6 })).turn).toBe(3);
  });

  test("rejects a record whose year violates the 4-turns/year law (coincidental hit)", () => {
    // year that does NOT match -270 + floor(turnsElapsed/4) => not the date record
    const buf = makeDateRecord(34, { year: -100 });
    expect(parseTurn(buf)).toBeNull();
  });

  test("returns null when no date record present", () => {
    expect(parseTurn(Buffer.alloc(256))).toBeNull();
  });
});

// Optional: assert exact known turns on the real corpus when the saves are
// present on this machine (skipped in CI / on machines without the saves).
const REAL = [
  { turn: 1, file: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav" },
  { turn: 2, file: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii2.sav" },
  { turn: 3, file: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii3.sav" },
  { turn: 1, file: "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Carthage1.sav" },
  { turn: 5, file: "C:/dev/crash-saves-v7.2/2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_5_Start/save_Autosave   Republic of Rome   Turn 5 Start.sav" },
  { turn: 8, file: "C:/dev/crash-saves-v7.2/2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_8_End/save_Autosave   Republic of Rome   Turn 8 End.sav" },
  { turn: 34, file: "C:/dev/crash-saves-v7.2/2026-05-30__Thibaud_Borny__save_Autosave_Republic_of_Rome_Turn_34_Start/save_Autosave   Republic of Rome   Turn 34 Start.sav" },
];

describe("parseTurn (real saves, when available)", () => {
  for (const { turn, file } of REAL) {
    test(`turn ${turn}: ${file.split(/[\\/]/).pop()}`, () => {
      if (!fs.existsSync(file)) return; // skip if asset absent
      const r = parseTurn(fs.readFileSync(file));
      expect(r).not.toBeNull();
      expect(r.turn).toBe(turn);
    });
  }
});

void EPOCH_YEAR;
