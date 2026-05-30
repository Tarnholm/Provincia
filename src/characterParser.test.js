// Regression test for character stat parsing. Runs against the dev's real
// Macedon T0 save (skipped if absent, e.g. CI / other machines).
//
// Locks in the 2026-05-26 fix: stats are located by their [u16=23][u32=50]
// frame signature, not a fixed offset whose layout could be mis-detected
// (which read stats 4 bytes off → garbage like Antigonos II 0/1/0 instead of
// the real Command 7 / Influence 6 / Management 5).
import { describe, test, expect } from "vitest";
import fs from "fs";
import { findCharacterRecords } from "./characterParser.js";

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const DATA = "C:\\RIS\\RIS\\data";

function load(p) { try { return fs.readFileSync(p); } catch { return null; } }
function loadLines(p) { try { return fs.readFileSync(p, "utf8").split(/\r?\n/).map((s) => s.trim()); } catch { return null; } }
function loadTraitNames(p) {
  try {
    const out = [];
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*Trait\s+(\w+)/); if (m) out.push(m[1]); }
    return out.length ? out : null;
  } catch { return null; }
}

const buf = load(SAVE);
const nameLookup = loadLines(DATA + "\\descr_names_lookup.txt");
const traitNames = loadTraitNames(DATA + "\\export_descr_character_traits.txt");
const ready = buf && nameLookup && traitNames;
const d = ready ? describe : describe.skip;

d("characterParser — Macedon T0 stat regression", () => {
  // `describe.skip` still EXECUTES this callback to collect test names, so guard
  // the parse: when the (local-only) fixture is absent, `ready` is false and the
  // tests are skipped — but this line would still run findCharacterRecords(null)
  // and throw during collection. Only parse when the fixture actually loaded.
  const recs = ready ? findCharacterRecords(buf, nameLookup, traitNames, null) : [];

  test("Antigonos II Gonatas (age 50 leader) reads Command 7 / Influence 6 / Management 5", () => {
    const leader = recs.find((c) => c.age === 50 && c.command === 7 && c.influence === 6 && c.management === 5);
    expect(leader).toBeTruthy();
  });

  test("stats are real, not garbage — many generals have sane command (1..10), none absurd", () => {
    const withCmd = recs.filter((c) => typeof c.command === "number");
    const sane = withCmd.filter((c) => c.command >= 1 && c.command <= 10);
    expect(sane.length).toBeGreaterThan(20);          // lots of real generals
    expect(withCmd.every((c) => c.command <= 30)).toBe(true); // gate filters garbage
  });
});
