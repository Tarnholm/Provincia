// src/nonLiveCommanderResolver.test.js
//
// REGRESSION GUARD for the NON-LIVE / starting-state commander-card portrait
// bug: the starting royal family (Quintus / Marcus / Servius Ogulnius_Gallus,
// romans_julii) rendered DJB2 hash-pool faces (110/020/058.tga) on their
// field/garrison commander cards, because resolveNonLiveCommanderInfo resolved
// the portrait ONLY from statsCache (which carried the stat row but no portrait
// for these chars) and never consulted the engine-exact coord map the FAMILY
// TREE uses (v1PortraitsByCoord). The fix folds v1PortraitsByCoord + descr_strat
// char coords + statsCache into one map and consults it FIRST.
//
// This test exercises the SHARED resolver the UI + headless doctor both use,
// against a real RIS julii save fixture. Skips when the save/mod is absent.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import {
  buildNonLivePortraitMap,
  resolveNonLiveCommanderInfo,
} from "./nonLiveCommanderResolver.js";
import { crackSave } from "./saveCracker.js";
import { parseDescrStrat } from "./descrStratGeneral.js";

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_julii1.sav";
const MOD = "C:\\RIS\\RIS\\data";

function loadIfPresent(p) { try { return fs.readFileSync(p); } catch { return null; } }

const buf = loadIfPresent(SAVE);
const haveFixture = !!buf && fs.existsSync(MOD);
const describeIf = haveFixture ? describe : describe.skip;

// The starting Julii royal family — the exact chars from the bug report.
const ROYALS = [
  { fn: "Quintus", ln: "Ogulnius_Gallus", coord: "285,404" },
  { fn: "Marcus", ln: "Ogulnius_Gallus", coord: "283,402" },
  { fn: "Servius", ln: "Ogulnius_Gallus", coord: "282,404" },
];
const FAC = "romans_julii";
const HASH_POOL_FILES = ["110.tga", "020.tga", "058.tga"]; // the wrong faces

// Build the engine-exact v1 coord→portrait map from the crack (the SAME pick +
// /cards/ rewrite as main.js's v1PortraitsByCoord builder), plus the descr_strat
// starting-char list with coords (firstName/lastName/faction/x/y).
function buildSources() {
  const r = crackSave(buf, MOD);
  const v1ByCoord = {};
  const startingChars = [];
  for (const c of r.characters.v1) {
    if (c.isDead) continue;
    if (c.tileX == null || c.tileY == null) continue;
    const ports = Array.isArray(c.portraits) ? c.portraits : [];
    const isBad = (p) => !p || (!c.isDead && /\/dead\//i.test(p));
    const gl = ports.find((p) => !isBad(p) && /\/portraits\/portraits\//i.test(p));
    const ga = ports.find((p) => !isBad(p));
    const pick = gl || ga;
    if (pick) v1ByCoord[`${c.tileX},${c.tileY}`] = pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/");
    if (c.firstName) startingChars.push({ firstName: c.firstName, lastName: c.lastName || null, faction: c.faction || FAC, x: c.tileX, y: c.tileY });
  }
  return { v1ByCoord, startingChars };
}

describeIf("nonLiveCommanderResolver — starting royal family (julii1 fixture)", () => {
  // crackSave is heavy (~5-10s) — run it ONCE for the whole describe block.
  let v1ByCoord, startingChars, map;
  beforeAll(() => {
    ({ v1ByCoord, startingChars } = buildSources());
    map = buildNonLivePortraitMap(v1ByCoord, startingChars, null);
  }, 60000);

  it("each royal resolves a REAL engine-exact portrait (not the hash pool)", () => {
    for (const royal of ROYALS) {
      const info = resolveNonLiveCommanderInfo(royal.fn, royal.ln, FAC, null, startingChars, map);
      expect(info, `${royal.fn} should resolve to an info object`).toBeTruthy();
      expect(info.savePath, `${royal.fn} must resolve a real portrait, not null (hash pool)`).toBeTruthy();
      // It must be the COORD-keyed engine-exact portrait the family tree shows.
      expect(info.savePath).toBe(v1ByCoord[royal.coord]);
      // And NOT one of the wrong hash-pool faces from the bug.
      const base = String(info.savePath).replace(/^.*[\\/]/, "").toLowerCase();
      expect(HASH_POOL_FILES).not.toContain(base);
    }
  });

  it("OLD behavior (no portraitMap, no statsCache) returned null savePath — the bug", () => {
    // Reproduce the pre-fix resolution: statsCache-only (null here) with NO
    // engine-exact map. Every royal falls to null savePath → renderer hash pool.
    for (const royal of ROYALS) {
      const info = resolveNonLiveCommanderInfo(royal.fn, royal.ln, FAC, null, startingChars, null);
      // The resolver still returns an info object (it has a name), but with no
      // portrait — which is exactly what made the renderer hash-pool the face.
      expect(info && info.savePath, `${royal.fn} (old path) should have NO portrait`).toBeFalsy();
    }
  });

  it("a genuinely-unknown commander stays null savePath (no fabricated face)", () => {
    const info = resolveNonLiveCommanderInfo("Nonexistus", "Madeupname", FAC, null, startingChars, map);
    // No coord, no name-key, no statsCache → null savePath (respects no-fallback).
    // (info itself is now non-null — it has a firstName — so the card hash-pools a
    // real culture face instead of going BLANK; only the precise PATH is absent.)
    expect(info ? info.savePath : null).toBeFalsy();
  });
});

// ── PURE NON-LIVE (no save) regression guard ─────────────────────────────────
//
// THE BUG (v0.9.806): in PURE non-live (no save loaded ⇒ empty portrait map, no
// persisted statsCache), single-name characters (Greek/Italic Julii generals
// like Statiis, Eumedes — no surname) resolved to `null` from
// resolveNonLiveCommanderInfo because the old gate bailed when there was no
// savePath, no lastName, and no statsCache hit. A null info made the commander
// card fall back to the bodyguard unit icon / a blank gray box — a BLANK card —
// while the FAMILY TREE rendered the same character a deterministic hash-pool
// portrait. The fix returns an info object for ANY firstName (savePath stays
// null), so the card hash-pools the SAME face the family tree shows.
//
// This block needs ONLY descr_strat (no save fixture), so it runs in CI even
// when the .sav is absent — it's the true model of the pure-non-live path.
const MOD_DS = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const haveDescrStrat = fs.existsSync(MOD_DS);
const describeIfDS = haveDescrStrat ? describe : describe.skip;

describeIfDS("nonLiveCommanderResolver — PURE non-live, no save (descr_strat only)", () => {
  let startingChars, emptyMap;
  beforeAll(() => {
    const ds = parseDescrStrat(fs.readFileSync(MOD_DS, "utf8"));
    startingChars = [];
    for (const f of ds.factions) {
      for (const c of f.characters || []) {
        startingChars.push({ firstName: c.firstTok, lastName: c.famTok || null, faction: f.name, x: c.x, y: c.y });
      }
    }
    // Pure non-live: no v1 coords, no statsCache → empty engine-exact map.
    emptyMap = buildNonLivePortraitMap({}, [], {});
  });

  // The exact single-name Julii generals from the bug report. commanderLastName
  // is null (single-name); commanderName is the firstName the card tags.
  const SINGLE_NAME = ["Statiis", "Eumedes"];

  it("single-name commanders resolve a NON-NULL info (card never goes blank)", () => {
    for (const fn of SINGLE_NAME) {
      const info = resolveNonLiveCommanderInfo(fn, null, FAC, {}, startingChars, emptyMap);
      expect(info, `${fn} must resolve a NON-NULL info so the card renders a (hash) portrait, not a blank`).toBeTruthy();
      expect(info.firstName, `${fn} info must carry the firstName the card feeds to the hash pool`).toBe(fn);
      expect(info.faction, `${fn} info must carry the faction so the culture/portrait pool resolves`).toBe(FAC);
    }
  });

  // v0.9.807 FIRST-NAME-ONLY PORTRAIT FIX. The bug: statsCache writes a
  // portrait under the FULL `fn|ln|fac` key, but the per-key writeBest can leave
  // the stripped `fn||fac` key portrait-less. A commander whose army entry tags
  // only a first name (no surname) then looks up the stripped key, finds no
  // portrait, and renders BLANK — even though the portrait is known under the
  // full name. buildNonLivePortraitMap now mirrors a full-name portrait onto the
  // stripped first-name keys, so a firstName-only lookup resolves the SAME
  // portrait the full-name lookup gives. This test is self-contained (no save).
  it("firstName-only lookup resolves the SAME portrait the full-name lookup gives", () => {
    const sc = {
      "statiis|of poseidonia the drunkard|romans_julii": { portrait: "data/ui/roman/portraits/cards/young/generals/249.tga", lastName: "of_Poseidonia_the_Drunkard", faction: FAC },
      // The portrait-less stripped key the original writeBest left behind.
      "statiis||romans_julii": { portrait: null, faction: FAC },
      "statiis||": { portrait: null },
    };
    const m = buildNonLivePortraitMap({}, [], sc);
    const full = resolveNonLiveCommanderInfo("Statiis", "of Poseidonia the Drunkard", FAC, sc, [], m);
    const firstOnly = resolveNonLiveCommanderInfo("Statiis", null, FAC, sc, [], m);
    expect(full.savePath, "full-name lookup should resolve the known portrait").toBe("data/ui/roman/portraits/cards/young/generals/249.tga");
    expect(firstOnly.savePath, "firstName-only lookup must resolve the SAME portrait (was null/blank before the fix)").toBe(full.savePath);
  });

  it("the surnamed Julii field generals ALSO resolve a non-null info in pure non-live", () => {
    const surnamed = [
      ["Servius", "Fulvius Flaccus"],
      ["Decimus", "Iunius Brutus"],
      ["Publius", "Sempronius Sophus"],
      ["Appius", "Claudius Pulcher"],
    ];
    for (const [fn, ln] of surnamed) {
      const info = resolveNonLiveCommanderInfo(fn, ln, FAC, {}, startingChars, emptyMap);
      expect(info, `${fn} ${ln} must resolve a non-null info`).toBeTruthy();
      expect(info.firstName).toBe(fn);
    }
  });

  it("EVERY romans_julii starting character resolves a non-null info (whole-map floor)", () => {
    const julii = startingChars.filter((c) => c.faction === FAC && c.firstName);
    expect(julii.length, "fixture should have romans_julii starting characters").toBeGreaterThan(0);
    const blanks = [];
    for (const c of julii) {
      // Mirror the renderer: commanderLastName is the surname with spaces.
      const lnSpaces = c.lastName ? String(c.lastName).replace(/_/g, " ") : null;
      const info = resolveNonLiveCommanderInfo(c.firstName, lnSpaces, FAC, {}, startingChars, emptyMap);
      if (!(info && (info.savePath || info.firstName))) blanks.push(`${c.firstName} ${c.lastName || ""}`.trim());
    }
    expect(blanks, `these romans_julii would render a BLANK card in pure non-live: ${blanks.join(", ")}`).toHaveLength(0);
  });
});
