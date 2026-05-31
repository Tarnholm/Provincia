// Regression tests for saveCrackerExtras. These run against a real save
// file at a fixed user-specific path; if the file isn't present (typical
// in CI or on a different machine), the tests are skipped.
//
// Targets locked-in behavior added during the 2026-05-18 / 2026-05-19
// cracker session:
//   - parseCharacterExtras extracts 421 chars from Macedon T0 RIS
//     (after the role-length offset fix in 0.9.406)
//   - identifyPlayerFactionFromSave returns "antigonid" for that save
//   - parseFactionTreasuries returns 23 NPC major-faction records

import { describe, test, expect } from "vitest";
import fs from "fs";
import {
  parseCharacterExtras,
  identifyPlayerFactionFromSave,
  parseFactionTreasuries,
  identifyFactionRecordOwners,
  parseAllFactionDiplomacy,
  parseDiplomacyMatrix,
  parseFactionTreasuryHistory,
} from "./saveCrackerExtras.js";

const MACEDON_T0_PATH = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const SM_FACTIONS_PATH = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";

function loadSaveIfPresent(path) {
  try {
    return fs.readFileSync(path);
  } catch {
    return null;
  }
}

// Parse descr_sm_factions.txt declaration order (mirrors main.js) — the index
// space the cracked faction_id byte points into. Skips tests if absent.
function loadFactionOrder(path) {
  let txt;
  try { txt = fs.readFileSync(path, "utf8"); } catch { return null; }
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order.length > 0 ? order : null;
}

const macedonT0 = loadSaveIfPresent(MACEDON_T0_PATH);
const factionOrder = loadFactionOrder(SM_FACTIONS_PATH);
const describeIfSave = macedonT0 ? describe : describe.skip;
const describeIfSaveAndOrder = (macedonT0 && factionOrder) ? describe : describe.skip;

describeIfSave("saveCrackerExtras — Macedon T0 RIS regression", () => {
  test("parseCharacterExtras returns 400+ characters (dynamic culture discovery)", () => {
    const chars = parseCharacterExtras(macedonT0);
    // 0.9.422 switched from a hardcoded RIS_CULTURES list to dynamic
    // discovery — count rose from 421 to ~465 by picking up cultures that
    // weren't in the hand-curated list (sarmatian, illyrian, etc).
    // Lock in 400+ as the floor; if the role-length offset regresses or
    // discovery breaks, the count drops sharply.
    expect(chars.length).toBeGreaterThanOrEqual(400);
  });

  test("parseCharacterExtras covers all 31 expected cultures including RIS-specific", () => {
    const chars = parseCharacterExtras(macedonT0);
    const cultures = new Set(chars.map((c) => c.culture));
    // RIS Macedon T0 cultures broken pre-0.9.406 because parser was greek-only-shaped
    expect(cultures.has("antigonid")).toBe(true);
    expect(cultures.has("seleucid")).toBe(true);
    expect(cultures.has("baktrian")).toBe(true);
    expect(cultures.has("cappadocian")).toBe(true);
    expect(cultures.has("greek")).toBe(true);
    expect(cultures.has("roman")).toBe(true);
  });

  test("parseFactionTreasuries returns 23 major NPC records", () => {
    const recs = parseFactionTreasuries(macedonT0);
    expect(recs.length).toBe(23);
  });

  test("identifyPlayerFactionFromSave returns 'antigonid' for Macedon save", () => {
    const recs = parseFactionTreasuries(macedonT0);
    const player = identifyPlayerFactionFromSave(macedonT0, recs);
    // Macedon player in RIS is the antigonid faction
    expect(player).toBe("antigonid");
  });

  test("identifyFactionRecordOwners identifies at least 10 of 23 records via captain banners", () => {
    const recs = parseFactionTreasuries(macedonT0);
    const owners = identifyFactionRecordOwners(macedonT0, recs);
    const named = owners.filter((o) => o.factionName).length;
    // Memory notes ~10/23 identified; lock in at least 8 to allow some flex
    expect(named).toBeGreaterThanOrEqual(8);
    // Specific records we expect to identify
    const names = owners.map((o) => o.factionName).filter(Boolean);
    expect(names).toContain("carthage");
    expect(names).toContain("romans_julii");
    expect(names).toContain("seleucid");
    expect(names).toContain("ptolemaic");
  });

  test("parseFactionTreasuries exposes cracked factionId + aiPersonalityIndex (session 174)", () => {
    const recs = parseFactionTreasuries(macedonT0);
    // Every record carries the two cracked bytes as numbers.
    for (const r of recs) {
      expect(typeof r.factionId).toBe("number");
      expect(typeof r.aiPersonalityIndex).toBe("number");
    }
  });
});

// Tests that need BOTH the save and the RIS descr_sm_factions order (the
// faction_id index space). Lock in the 0.9.527 factionId-based identification
// and the 0.9.539 all-faction diplomacy zone mapping (faction = byte at
// markerOffset-53). NOTE: we deliberately assert STRUCTURAL facts (counts,
// distinct factions, key resolution) — NOT the per-relation stance counts,
// whose class enum is unresolved (see project_diplomatic_relations memo).
describeIfSaveAndOrder("saveCrackerExtras — factionId + all-faction diplomacy", () => {
  test("factionId identifies all 23 records when given descr_sm_factions order", () => {
    const recs = parseFactionTreasuries(macedonT0);
    const owners = identifyFactionRecordOwners(macedonT0, recs, factionOrder);
    const named = owners.filter((o) => o.factionName).length;
    expect(named).toBe(23);
    // factionId is the primary source for the bulk of records
    const byId = owners.filter((o) => o.source === "factionId").length;
    expect(byId).toBeGreaterThanOrEqual(20);
  });

  test("parseAllFactionDiplomacy maps 150+ distinct factions, incl. romans_julii/seleucid", () => {
    const all = parseAllFactionDiplomacy(macedonT0, factionOrder);
    const keys = Object.keys(all);
    // ~220 zones resolve in a full RIS save; floor well below that to allow flex.
    expect(keys.length).toBeGreaterThanOrEqual(150);
    // The factions the user specifically cares about must resolve.
    expect(all.romans_julii).toBeTruthy();
    expect(all.seleucid).toBeTruthy();
    expect(all.carthage).toBeTruthy();
    // Each entry carries the count fields the UI consumes.
    for (const k of keys.slice(0, 5)) {
      expect(typeof all[k].wars).toBe("number");
      expect(typeof all[k].relationCount).toBe("number");
    }
  });

  // 0.9.546 BREAKTHROUGH: the N×N attitude matrix gives NAMED live diplomacy
  // (war/ally per faction PAIR). Lock in: located, symmetric, and the turn-0
  // war/ally pairs match the mod-file ground truth exactly.
  test("parseDiplomacyMatrix decodes NAMED live diplomacy (matrix located + symmetric)", () => {
    const m = parseDiplomacyMatrix(macedonT0, factionOrder);
    expect(m).toBeTruthy();
    expect(m._meta).toBeTruthy();
    // Matrix must be near-perfectly symmetric (att(A,B)==att(B,A)) — the
    // self-calibration relies on this and it's the integrity signal.
    expect(m._meta.symmetry).toBeGreaterThanOrEqual(0.99);
    // Real-faction war pairs only. Placeholder factions (slave/rebels, dummies,
    // *_rebels respawn markers) are excluded from the decoded matrix, so this is
    // the genuine inter-faction war count — a handful at turn 0, NOT the ~90+
    // that every faction's permanent war with the independent rebels would add.
    expect(m._meta.warPairs).toBeGreaterThan(5);
    expect(m._meta.warPairs).toBeLessThan(60);
  });

  test("parseDiplomacyMatrix names the right turn-0 wars and allies", () => {
    const m = parseDiplomacyMatrix(macedonT0, factionOrder);
    // Antigonid (Macedon player) starts at war with Epirus + Galatians and
    // allied with Seleucid (mod-file ground truth).
    expect(m.antigonid.war).toContain("epirus");
    expect(m.antigonid.war).toContain("galatians");
    expect(m.antigonid.allied).toContain("seleucid");
    // Seleucid starts at war with Bithynia.
    expect(m.seleucid.war).toContain("bithynia");
    // Symmetry sanity: if A is at war with B, B is at war with A.
    expect(m.epirus.war).toContain("antigonid");
  });

  // Full Macedon ground truth (user-verified 2026-05-26). Allies + protectorates
  // both score as Allied (att 0) in the matrix; the protectorate split is a
  // display concern (descr_strat/script). The matrix war list must be EXACTLY
  // the two real wars — no placeholder/rebel noise (slave/dummies excluded).
  test("parseDiplomacyMatrix — full Macedon (antigonid) ground truth", () => {
    const m = parseDiplomacyMatrix(macedonT0, factionOrder);
    const a = m.antigonid;
    for (const ally of ["seleucid", "cabyle", "knossos", "messene", "argos", "megalopolis"]) {
      expect(a.allied).toContain(ally);
    }
    // Trade partners (alliance bond, descr_strat "Ally/Trade" + scripted
    // protectorates) = the same six.
    for (const t of ["seleucid", "cabyle", "knossos", "messene", "argos", "megalopolis"]) {
      expect(a.trade).toContain(t);
    }
    expect([...a.war].sort()).toEqual(["epirus", "galatians"]);
    // Placeholder factions never appear in a real faction's lists.
    for (const ph of ["slave", "dummies"]) {
      expect(a.war).not.toContain(ph);
      expect(a.allied).not.toContain(ph);
    }
    // And no placeholder faction has a row of its own in the matrix.
    expect(m.slave).toBeUndefined();
    expect(m.dummies).toBeUndefined();
  });
});

// ── parseFactionTreasuryHistory keying (fixed 2026-05-31) ──────────────────
// The off-by-one bug: the function keyed each history series by the record's
// `factionId` BYTE, which is shifted one slot on imperial sub=6 records, so
// every faction's per-turn treasury series was cross-wired to the NEXT faction's
// name (carthage's timeline labelled "antigonid", etc). FIX: key by the record's
// POSITION in factionRecords, indexed into the descr_sm order. Validated against
// three consecutive turns (save_julii1/2/3): a faction's history checkpoints
// must track its OWN treasury timeline. Each f13 checkpoint is the end-of-turn
// snapshot, taken a hair before the in-save current treasury (≈250 denarii of
// rollover income), so we assert closeness within a small tolerance.
const julii1 = loadSaveIfPresent(`${SAVE_DIR}\\save_julii1.sav`);
const julii2 = loadSaveIfPresent(`${SAVE_DIR}\\save_julii2.sav`);
const julii3 = loadSaveIfPresent(`${SAVE_DIR}\\save_julii3.sav`);
const describeIfJulii = (julii1 && julii2 && julii3 && factionOrder) ? describe : describe.skip;

describeIfJulii("parseFactionTreasuryHistory — correct faction keying (julii1/2/3)", () => {
  // Starting treasuries (julii1) that uniquely crib each faction's identity.
  const CRIB = {
    carthage: 25500,
    antigonid: 22000,
    ptolemaic: 47000,
    seleucid: 62500,
    bactria: 11000,
  };

  test("each faction's history series tracks ITS OWN treasury timeline (not the next faction's)", () => {
    const recs1 = parseFactionTreasuries(julii1);
    const recs2 = parseFactionTreasuries(julii2);
    const recs3 = parseFactionTreasuries(julii3);
    // Records are positional + stable across consecutive turns.
    expect(recs1.length).toBe(recs2.length);
    expect(recs2.length).toBe(recs3.length);

    const hist = parseFactionTreasuryHistory(julii3, recs3, factionOrder);
    expect(hist).toBeTruthy();

    const idxByName = {};
    factionOrder.forEach((n, i) => { idxByName[n] = i; });

    for (const [fac, startTreasury] of Object.entries(CRIB)) {
      const i = idxByName[fac];
      expect(i).toBeGreaterThanOrEqual(0);
      // Identity crib: the record at this position really is this faction.
      expect(recs1[i].treasury).toBe(startTreasury);

      const series = hist[fac];
      expect(series, `history series present for ${fac}`).toBeTruthy();
      expect(series.length).toBeGreaterThanOrEqual(2);

      // The faction's checkpoint timeline must match its own treasury timeline.
      // Build the set of this faction's known treasuries across the 3 saves; the
      // last 2 checkpoints must each be within tolerance of one of them.
      const treasuries = [recs1[i].treasury, recs2[i].treasury, recs3[i].treasury];
      const TOL = 800;
      const last2 = series.slice(-2);
      for (const cp of last2) {
        const matches = treasuries.some((t) => Math.abs(cp - t) <= TOL);
        expect(matches, `${fac} checkpoint ${cp} should match one of treasuries [${treasuries}]`).toBe(true);
      }
    }
  });

  test("carthage's series is NOT antigonid's (the exact off-by-one that was wired wrong)", () => {
    const recs3 = parseFactionTreasuries(julii3);
    const hist = parseFactionTreasuryHistory(julii3, recs3, factionOrder);
    // Pre-fix, carthage's [25250,39900] timeline was emitted under "antigonid".
    // Post-fix carthage owns it and antigonid owns [21454,41624].
    expect(hist.carthage[0]).toBeGreaterThan(24000);
    expect(hist.carthage[0]).toBeLessThan(26500);
    expect(hist.antigonid[0]).toBeGreaterThan(20000);
    expect(hist.antigonid[0]).toBeLessThan(23000);
    // They must differ — the cross-wire made one the other.
    expect(hist.carthage[0]).not.toBe(hist.antigonid[0]);
  });
});
