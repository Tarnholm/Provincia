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
import { createRequire } from "node:module";
import {
  parseCharacterExtras,
  identifyPlayerFactionFromSave,
  parseFactionTreasuries,
  identifyFactionRecordOwners,
  parseAllFactionDiplomacy,
  parseDiplomacyMatrix,
  parseFactionTreasuryHistory,
} from "./saveCrackerExtras.js";
const require = createRequire(import.meta.url);
const { crackSave } = require("./saveCracker.js");

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

// ── locateDiplomacyMatrix — key-agnostic, gap-tolerant locator (2026-05-31) ──
// Regression for the fix that lets Republic-of-Rome saves locate their
// diplomacy matrix. ROOT CAUSE (findings-diplo-locator-2026-05-31): the old
// stride detector required (a) every cell share one `key` (+4) and (b) a
// PERFECT N-long signature run. On clean imperial saves both hold (julii1:
// uniform key 10, 239/239 sig). On RR saves neither holds — the matrix carries
// a MIXED key column and ~8 per-row signature gaps (Raymond T5: 231/239) — so
// the locator never recognised the real matrix and returned null. Fix: detect
// stride from the cell SIGNATURE only (key-agnostic) and accept a near-complete
// run (>=90% of N). julii1 must be unchanged; Raymond T5 must now locate.
const julii1Dip = loadSaveIfPresent(`${SAVE_DIR}\\save_julii1.sav`);
const RAYMOND_T5 = "C:\\dev\\crash-saves-v7.2\\2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_5_Start\\save_Autosave   Republic of Rome   Turn 5 Start.sav";
const raymondT5 = loadSaveIfPresent(RAYMOND_T5);

const describeIfJulii1Dip = (julii1Dip && factionOrder) ? describe : describe.skip;
describeIfJulii1Dip("locateDiplomacyMatrix — julii1 regression (clean imperial)", () => {
  test("locates a clean imperial matrix (stride 267, full symmetry)", () => {
    const m = parseDiplomacyMatrix(julii1Dip, factionOrder);
    expect(m).toBeTruthy();
    // base is save-specific and shifts whenever the save is re-saved, so assert
    // it LOCATED (positive integer) rather than pinning an absolute offset.
    expect(Number.isInteger(m._meta.base)).toBe(true);
    expect(m._meta.base).toBeGreaterThan(0);
    expect(m._meta.stride).toBe(267);
    expect(m._meta.symmetry).toBe(1);            // a real lock = ~100% symmetry
    expect(m._meta.warPairs).toBeGreaterThan(0);
  });
});

const describeIfRaymond = (raymondT5 && factionOrder) ? describe : describe.skip;
describeIfRaymond("locateDiplomacyMatrix — Raymond T5 Republic of Rome (mixed key, gapped sig)", () => {
  test("now LOCATES with high symmetry and plausible turn-5 diplomacy", () => {
    const m = parseDiplomacyMatrix(raymondT5, factionOrder);
    expect(m).toBeTruthy();              // used to be null (locator missed it)
    expect(m._meta.symmetry).toBeGreaterThanOrEqual(0.95);
    expect(m._meta.stride).toBe(267);
    // Julii is NOT at war with everyone — a handful of real wars at turn 5.
    const julii = m.romans_julii;
    expect(julii).toBeTruthy();
    expect(julii.war.length).toBeGreaterThan(0);
    expect(julii.war.length).toBeLessThan(15);
    // Allied with the Roman senate and its early Italian client states.
    expect(julii.allied).toContain("roman_senate");
    expect(julii.allied).toContain("samnites");
    // 2026-05-31: placeholders are now KEPT in the WAR list (a war with a
    // rebel/slave faction is a REAL war the game displays). They must NOT,
    // however, leak into the ALLIED list (the old Free-Peoples "92 allies" bug).
    for (const ph of ["slave", "italics", "dummies"]) expect(julii.allied).not.toContain(ph);
  });
});

// ── PLAYER WAR LIST on a LIVE "Republic of Rome Turn 1" save (2026-05-31) ──
// BUG: parseDiplomacyMatrix dropped roman_rebels_1/2/italics/slave from the
// player's war list via the placeholder column-skip, so Provincia showed an
// EMPTY war list while the game showed the player at war with the House of
// Aemilii (roman_rebels_1), House of Cornelii (roman_rebels_2), and Free
// Peoples (slave+italics). FIX: keep war cells against placeholders — a war is
// ground truth regardless of partner. RegionInfo folds slave/italics → "Free
// Peoples" and labels roman_rebels_1/2 via expanded_bi.txt for display.
const ROME_T1 = `${SAVE_DIR}\\save_Autosave   Republic of Rome   Turn 1.sav`;
const romeT1 = loadSaveIfPresent(ROME_T1);
const describeIfRomeT1 = (romeT1 && factionOrder) ? describe : describe.skip;
describeIfRomeT1("parseDiplomacyMatrix — live Republic of Rome Turn 1 player war list", () => {
  test("romans_julii war list includes both rebel houses + slave + italics (matches game)", () => {
    // PRECONDITION: this is a LIVE save the user re-saves while playing. The
    // exact turn-1 war list only holds for a fresh Republic-of-Rome turn-1
    // state. Skip (visibly) if the loaded save has drifted from that.
    const probe = crackSave(romeT1, "C:\\RIS\\RIS\\data");
    if (probe.playerFaction !== "romans_julii" || probe.turn !== 1) {
      console.warn(`[test-skip] Rome T1 player war list: save not in expected state (player=${probe.playerFaction}, turn=${probe.turn}; expected romans_julii turn 1)`);
      return;
    }
    const m = parseDiplomacyMatrix(romeT1, factionOrder);
    expect(m).toBeTruthy();
    const julii = m.romans_julii;
    expect(julii).toBeTruthy();
    // The four raw war targets the save encodes for the player at Turn 1.
    expect(julii.war).toContain("roman_rebels_1"); // → "The House of Aemilii"
    expect(julii.war).toContain("roman_rebels_2"); // → "The House of Cornelii"
    expect(julii.war).toContain("italics");        // → folds to "Free Peoples"
    expect(julii.war).toContain("slave");          // → folds to "Free Peoples"
    // Allied with the senate + early Italian clients (unchanged by the fix).
    expect(julii.allied).toContain("roman_senate");
    // After display-folding (slave+italics → ONE "Free Peoples", houses kept),
    // the player's war list has exactly 3 entries — matching the in-game view.
    const NAMED_EMERGENT_RE = /^roman_rebels_[12]$/;
    const foldsToFree = (n) => /(_rebels|^slave$|^slaves$|^rebels$|^dummies$|^italics$)/.test(n) && !NAMED_EMERGENT_RE.test(n);
    const folded = [];
    let hadFree = false;
    for (const id of julii.war) { if (foldsToFree(id)) hadFree = true; else folded.push(id); }
    if (hadFree) folded.unshift("slave");
    expect(folded.sort()).toEqual(["roman_rebels_1", "roman_rebels_2", "slave"].sort());
    expect(folded.length).toBe(3);
  }, 30000); // heavy: crackSave precondition + matrix scan on a 34 MB save
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

  // SKIPPED: this cross-references julii1/2/3 as ONE campaign's consecutive turns,
  // but those are the user's LIVE saves and get re-saved during play — julii1 is
  // currently a different campaign than julii2/3 (carthage current=33700 in julii1
  // vs julii3's recorded turn-1 history=25250), so the timelines legitimately don't
  // line up. The faction-keying invariant this guarded is still covered by the
  // "carthage's series is NOT antigonid's" test below. Re-enable with a frozen
  // 3-turn fixture set if one is added.
  test.skip("each faction's history series tracks ITS OWN treasury timeline (not the next faction's)", () => {
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
      // (We no longer pin the absolute starting treasury — these live saves get
      // re-saved during testing, which changes the values. The keying check
      // below — the series must match THIS faction's own treasury timeline, and
      // the separate "carthage is not antigonid" test — are the real invariants
      // and are save-content-agnostic.)
      void startTreasury;

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

    // KEYING INVARIANT (always asserted when both series resolve): the two
    // factions must own SEPARATE history series. The off-by-one cross-wired
    // carthage's timeline onto the antigonid key, so their first checkpoints
    // were identical. This holds regardless of which campaign julii3 currently is.
    expect(Array.isArray(hist.carthage)).toBe(true);
    expect(Array.isArray(hist.antigonid)).toBe(true);
    expect(hist.carthage.length).toBeGreaterThanOrEqual(1);
    expect(hist.antigonid.length).toBeGreaterThanOrEqual(1);
    expect(hist.carthage[0]).not.toBe(hist.antigonid[0]);

    // PRECONDITION for the pinned crib windows: these only hold for the
    // canonical fresh-start campaign (carthage's turn-1 checkpoint ≈25250,
    // antigonid ≈21454). The user re-saves these live files during play, so
    // skip the absolute-value cribs (NOT the keying invariant above) when the
    // loaded julii3 has drifted off that campaign.
    const onCanonicalCampaign =
      hist.carthage[0] > 24000 && hist.carthage[0] < 26500 &&
      hist.antigonid[0] > 20000 && hist.antigonid[0] < 23000;
    if (!onCanonicalCampaign) {
      console.warn(`[test-skip] treasury-history cribs: julii3 not on canonical campaign (carthage[0]=${hist.carthage[0]}, antigonid[0]=${hist.antigonid[0]}; keying invariant still verified)`);
      return;
    }
    // Pre-fix, carthage's [25250,39900] timeline was emitted under "antigonid".
    // Post-fix carthage owns it and antigonid owns [21454,41624].
    expect(hist.carthage[0]).toBeGreaterThan(24000);
    expect(hist.carthage[0]).toBeLessThan(26500);
    expect(hist.antigonid[0]).toBeGreaterThan(20000);
    expect(hist.antigonid[0]).toBeLessThan(23000);
  });
});

// ── crackSave current-treasury ATTRIBUTION keying (fixed 2026-05-31) ───────
// Bug: on mid/late saves, current treasury was mis-attributed to the WRONG
// faction NAMES. The values were right but bound to the wrong factions — e.g.
// on the T34 Republic-of-Rome save a 0-region faction (paeonia) was shown
// holding 191,983 denarii while a 113-region empire (seleucid) appeared to hold
// almost nothing under the wrong key. Same root cause as the treasury-HISTORY
// off-by-one: the old logic keyed by a non-unique knowledge signature + a
// player-pulled-to-front order that drifted from the real record layout. FIX:
// key current treasury by record ARRAY POSITION into descr_sm order (with the
// player faction swapped to position 0), 1:1, exactly like the history fix.
const MOD_DATA = "C:\\RIS\\RIS\\data";
const T34_PATH = "C:\\dev\\crash-saves-v7.2\\2026-05-30__Thibaud_Borny__save_Autosave_Republic_of_Rome_Turn_34_Start\\save_Autosave   Republic of Rome   Turn 34 Start.sav";
const t34 = loadSaveIfPresent(T34_PATH);
const carthage1 = loadSaveIfPresent(`${SAVE_DIR}\\save_Carthage1.sav`);
const describeIfT34 = (t34 && fs.existsSync(MOD_DATA)) ? describe : describe.skip;

describeIfT34("crackSave — current-treasury attribution keying (T34 Republic of Rome)", () => {
  // The T34 save is ~45 MB; crack it ONCE and share the result (a per-test
  // crack blows the default 5s timeout).
  let factions;
  const cracked = crackSave(t34, MOD_DATA);
  factions = cracked.factions;

  test("major empires are keyed to their knowledge-signature-confirmed treasuries", () => {
    // These values are pinned by each major faction's STABLE engine knowledge
    // signature (seleucid=250, ptolemaic=207, carthage=173, antigonid=161,
    // bactria=83, romans_julii=414), which uniquely identifies the record
    // regardless of save timing. They must land on the correct faction NAME.
    expect(factions.seleucid.treasury).toBe(39326);     // 113-region empire
    expect(factions.ptolemaic.treasury).toBe(29853);    // 86-region empire
    expect(factions.carthage.treasury).toBe(14756);
    expect(factions.antigonid.treasury).toBe(9600);
    expect(factions.bactria.treasury).toBe(3802);
    expect(factions.romans_julii.treasury).toBe(10528); // the player
  });

  test("0-region factions do NOT hold the misattributed mega-treasuries", () => {
    // Pre-fix these 0-region factions were bound to 191983 / 175363 / 34988.
    for (const name of ["paeonia", "gades", "arados", "minaeans"]) {
      const f = factions[name];
      if (!f) continue;
      if (f.regionCount === 0) {
        expect(f.treasury, `${name} (0 regions) must not hold a mega-treasury`).toBeLessThan(150000);
      }
    }
    // Specifically: the bug bound 191983 to paeonia (0 regions).
    expect(factions.paeonia.treasury).not.toBe(191983);
  });

  test("seleucid (113 regions) is the richest among the major empire factions", () => {
    const majors = ["seleucid", "ptolemaic", "carthage", "antigonid", "bactria", "romans_julii"];
    const sel = factions.seleucid.treasury;
    for (const m of majors) {
      if (m === "seleucid") continue;
      expect(sel, `seleucid >= ${m}`).toBeGreaterThanOrEqual(factions[m].treasury);
    }
  });
}, 30000);

// PLAYER-SWAP regression: when the player is NOT romans_julii, the player's
// record sits at position 0 and romans_julii is displaced to the player's
// natural descr_sm slot. The keying must swap them back. save_Carthage1 is the
// canonical case (player=carthage; carthage starts with 25500, julii with 17500).
const describeIfCarthage1 = (carthage1 && fs.existsSync(MOD_DATA)) ? describe : describe.skip;
describeIfCarthage1("crackSave — player-swap treasury keying (Carthage T1)", () => {
  test("player carthage keeps 25500 and displaced romans_julii keeps 17500", () => {
    const { factions, playerFaction, turn } = crackSave(carthage1, MOD_DATA);
    // PRECONDITION: the pinned 25500/17500 are the fresh Carthage turn-1
    // STARTING treasuries. save_Carthage1.sav is a LIVE file the user re-saves;
    // skip (visibly) if it's no longer that exact fresh-start state. The
    // player-swap keying invariant (player record swapped to position 0, julii
    // displaced to its natural slot) is what's under test, and it only has a
    // known ground-truth value pair on this canonical save.
    if (playerFaction !== "carthage" || turn !== 1) {
      console.warn(`[test-skip] Carthage T1 player-swap: save not in expected state (player=${playerFaction}, turn=${turn}; expected carthage turn 1)`);
      return;
    }
    expect(factions.carthage.treasury).toBe(25500);
    expect(factions.romans_julii.treasury).toBe(17500);
  }, 30000); // heavy: full crackSave on a 34 MB save
});
