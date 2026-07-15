"use strict";
const fs=require("fs");
const path=require("path");
const { parseEventLog: cxParseEventLog } = require("./eventLogParser.js");
const { parseEventSchedule: cxParseEventSchedule } = require("./eventScheduleParser.js");
const { parseFactionKnowledge: cxParseFactionKnowledge } = require("./factionKnowledgeParser.js");
const { findFactionRecords, summarizeFactionArray } = require("./factionRecordParser.js");
const { findLuaCounters, indexCountersByName } = require("./luaCounterParser.js");
const { readUtf16Name } = require("./saveBinaryReaders.js");
const descrGen = require("./descrStratGeneral.js");
const {
  parseHeader: cxParseHeader, parseFactionDiscoveredBitmask: cxParseBitmask,
  parseFactionConfigRecords: cxParseFactionConfig, parseModInfo: cxParseModInfo,
  parseCharacterExtras: cxParseCharacterExtras, attachMapCoords: cxAttachMapCoords,
  bridgeV1Traits: cxBridgeV1Traits, resolvePortraitsByCharacter: cxResolvePortraits,
  parseFactionTreasuries: cxParseTreasuries, parseFactionTreasuryHistory: cxParseTreasuryHistory,
  identifyFactionRecordOwners: cxIdentifyRecordOwners, identifyPlayerFactionFromSave: cxIdentifyPlayerFromSave,
  parseFactionDiplomacy: cxParseDiplomacy, parseAllFactionDiplomacy: cxParseAllDiplomacy,
  parseDiplomacyMatrix: cxParseDiplomacyMatrix, buildFamilyTreeMaps: cxBuildFamilyMaps,
  parseReligionByCity: cxParseReligion, deriveEngineFactionOrder: cxDeriveEngineOrder,
  countEngineCharacters,
} = require("./saveCrackerExtras.js");

function makeParseSaveData({ KNOWN_BUILDINGS, getModAiByFaction, getModAiPersonalityOrder, getModFactionOrder }) {
  return async function parseSaveData(filePath, onProgress, providedBuf = null) {
  const _yieldHere = () => new Promise(resolve => setImmediate(resolve));
  // [perf] timing: each tick logs how long the PREVIOUS stage took, so a
  // turn-end parse writes a stage-by-stage breakdown to provincia.log.
  let _tp = process.hrtime.bigint();
  let _lastStage = "start";
  const tick = (stage) => {
    const now = process.hrtime.bigint();
    console.log(`[perf] parseSaveData ${_lastStage}: ${(Number(now - _tp) / 1e6).toFixed(0)}ms`);
    _tp = now; _lastStage = stage;
    if (onProgress) onProgress({ stage });
  };
  // Reuse a buffer the caller already has in hand instead of re-reading
  // the file from disk. On a 30MB save that's ~100-300ms saved per
  // parse — both reparseLatestSave and saveWatchStart had already read
  // the file before calling this, so the duplicate read was pure waste.
  const data = providedBuf || await fs.promises.readFile(filePath);
  const len = data.length;

  // ── 1. Parse building records ──
  // Format: [uint16LE nameLen] [ascii name] [\0] [4-byte hash] [uint32LE level]
  tick("Scanning building records");
  await _yieldHere();
  const buildingRecords = [];
  let pos = 0;
  while (pos < len - 10) {
    const nameLen = data.readUInt16LE(pos);
    if (nameLen >= 4 && nameLen <= 50) {
      const nameStart = pos + 2;
      const nameEnd = nameStart + nameLen - 1;
      if (nameEnd + 1 < len && data[nameEnd] === 0x00) {
        const candidate = data.slice(nameStart, nameEnd);
        let valid = true;
        for (let i = 0; i < candidate.length; i++) {
          const b = candidate[i];
          if (!((b >= 0x61 && b <= 0x7a) || b === 0x5f)) { valid = false; break; }
        }
        if (valid) {
          const name = candidate.toString('ascii');
          if (KNOWN_BUILDINGS.has(name)) {
            const afterNull = nameEnd + 1;
            if (afterNull + 33 <= len) {
              const levelRaw = data.readUInt32LE(afterNull + 4);
              const level = levelRaw < 20 ? levelRaw : null;
              const healthRaw = data.readUInt32LE(afterNull + 29);
              const health = (healthRaw <= 100) ? healthRaw : null;
              buildingRecords.push({ offset: pos, name, level, health });
              pos = nameEnd + 9;
              continue;
            }
          }
        }
      }
    }
    pos++;
  }

  // ── 2. Find settlement names (UTF-16LE, preceded by \x01 [nchars] \x00) ──
  tick("Scanning settlement markers");
  await _yieldHere();
  const settlements = [];
  for (let i = 0; i < len - 10; i++) {
    if (data[i] === 0x01) {
      const r = readUtf16Name(data, i + 1, len);
      if (r) settlements.push({ offset: i, name: r.name });
    }
  }

  // ── 3. Associate buildings with nearest preceding settlement (within 3000 bytes) ──
  // Both buildingRecords and settlements were collected via sequential
  // byte-order scans, so they're already sorted by offset. Two-pointer
  // walk: O(N + M) instead of the original O(N × M) double loop, which
  // was ~39M iterations on a typical 30MB save (30k buildings × 1.3k
  // settlements). Saves several hundred ms on every save parse.
  tick("Linking buildings to settlements");
  await _yieldHere();
  const buildingsByCity = {};
  let sIdx = -1; // index of last settlement whose offset <= current building
  for (const b of buildingRecords) {
    while (sIdx + 1 < settlements.length && settlements[sIdx + 1].offset <= b.offset) {
      sIdx++;
    }
    if (sIdx < 0) continue;
    const s = settlements[sIdx];
    const dist = b.offset - s.offset;
    if (dist <= 0 || dist >= 3000) continue;
    if (!buildingsByCity[s.name]) buildingsByCity[s.name] = {};
    buildingsByCity[s.name][b.name] = { level: b.level, health: b.health };
  }

  // ── 4. Parse unit/army records ──
  // Format: [\x01\x00] [uint16LE nameLen] [ascii unit name with spaces] [\0]
  //         [bytes...] [uint8 regionLen] [\x00] [UTF-16LE region] [\xff\xff\xff\xff]
  //         [4 bytes] [4 bytes float] [uint32 soldiers] [uint32 maxSoldiers]
  tick("Scanning unit records");
  await _yieldHere();
  const unitRecords = [];
  pos = 0;
  while (pos < len - 20) {
    if (data[pos] === 0x01 && data[pos + 1] === 0x00) {
      const nameLen = data.readUInt16LE(pos + 2);
      if (nameLen >= 4 && nameLen <= 60) {
        const ns = pos + 4;
        const ne = ns + nameLen - 1;
        if (ne < len && data[ne] === 0x00) {
          const candidate = data.slice(ns, ne);
          let valid = true;
          for (let i = 0; i < candidate.length; i++) {
            const b = candidate[i];
            if (!((b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x20)) { valid = false; break; }
          }
          if (valid) {
            const unitName = candidate.toString('ascii');
            if (!KNOWN_BUILDINGS.has(unitName) && unitName !== 'default_set') {
              // Find UTF-16LE region name within next 30 bytes
              let region = null, soldiers = null, maxSoldiers = null;
              let xp = null, weapon = null, armor = null;
              for (let j = ne + 1; j < Math.min(ne + 30, len - 6); j++) {
                const rl = data.readUInt16LE(j);
                if (rl >= 3 && rl <= 25) {
                  const strStart = j + 2;
                  const strEnd = strStart + rl * 2;
                  if (strEnd + 20 <= len) {
                    let ok = true;
                    let chars = '';
                    for (let k = strStart; k < strEnd; k += 2) {
                      const lo = data[k], hi = data[k + 1];
                      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
                      chars += String.fromCharCode(lo);
                    }
                    if (ok && chars.length > 0 && chars[0] >= 'A' && chars[0] <= 'Z') {
                      region = chars;
                      // After region: [ff ff ff ff] [4 bytes] [float] [uint32 soldiers] [uint32 max]
                      // Then typically chevrons (0-9), weapon upgrade (0-3), armor upgrade (0-3)
                      // as uint8 or uint32 fields in the bytes that follow. Best-effort read.
                      const ra = strEnd;
                      if (ra + 20 <= len && data[ra] === 0xff && data[ra + 1] === 0xff &&
                          data[ra + 2] === 0xff && data[ra + 3] === 0xff) {
                        const s = data.readUInt32LE(ra + 12);
                        const m = data.readUInt32LE(ra + 16);
                        if (s <= 2000 && m <= 2000) {
                          soldiers = s;
                          maxSoldiers = m;
                          // Tentative XP fields: read the three uint32s that follow and
                          // only keep them if they fit the expected ranges (chevrons 0-9,
                          // weapon 0-3, armor 0-3). Out-of-range → null.
                          if (ra + 32 <= len) {
                            const xpVal = data.readUInt32LE(ra + 20);
                            const weapVal = data.readUInt32LE(ra + 24);
                            const armVal = data.readUInt32LE(ra + 28);
                            xp = (xpVal <= 9) ? xpVal : null;
                            weapon = (weapVal <= 3) ? weapVal : null;
                            armor = (armVal <= 3) ? armVal : null;
                          }
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (region) {
                unitRecords.push({ unit: unitName, region, soldiers, max: maxSoldiers, xp, weapon, armor });
                pos = ne + 1;
                continue;
              }
            }
          }
        }
      }
    }
    pos++;
  }

  // ── 5. Group units by region ──
  tick("Grouping units by region");
  await _yieldHere();
  const armies = {};
  for (const u of unitRecords) {
    if (!armies[u.region]) armies[u.region] = [];
    armies[u.region].push({
      unit: u.unit,
      soldiers: u.soldiers,
      max: u.max,
      xp: u.xp,
      weapon: u.weapon,
      armor: u.armor,
    });
  }

  // ── 6. Parse construction queue from default_set per settlement ──
  // Pattern discovered via v2 calibration: when a building is queued, the save's
  // per-settlement "default_set" chain record contains either:
  //   • an ASCII chain name entry (for chains the settlement didn't have before), or
  //   • a hash entry pointing to one of the settlement's existing chain slots.
  // The ASCII case is unambiguous — we can name the building directly. The hash
  // case requires matching against the settlement's chain slot hashes (future work).
  tick("construction queues + settlement fields");
  const queues = {};
  const knownChains = new Set(['hinterland_region', 'core_building', 'capital_treasury',
    'military_industrial_complex', 'irrigated_farming', 'market', 'port_buildings',
    'textiles_production', 'health', 'hinterland_roads', 'temple_complex_dorian',
    'temple_complex_italic', 'defenses', 'colony', 'highland_pastoralism',
    'olive_cultivation', 'pottery_production', 'smith', 'horse_trainer']);
  // Precompute needles once instead of re-allocating ~20 Buffers per settlement.
  const dsNeedle = Buffer.from('default_set', 'ascii');
  const chainNeedles = [...knownChains].map((cn) => ({ cn, n: Buffer.from('\0' + cn + '\0', 'ascii') }));
  for (const s of settlements) {
    // Locate "default_set" within 200 bytes after the settlement name. Search a
    // BOUNDED window: an unbounded data.indexOf would scan to the end of the
    // 33 MB buffer for any settlement that has no default_set nearby.
    const dsRel = data.subarray(s.offset, Math.min(s.offset + 211, data.length)).indexOf(dsNeedle);
    if (dsRel === -1) continue; // window (211) caps the start at <=200 by construction
    const dsIdx = s.offset + dsRel;
    const dsDataStart = dsIdx + 11 + 1;
    // Find end by locating the next known chain record — but ONLY within the
    // ~500-byte window we actually accept hits from. The previous code did an
    // UNBOUNDED data.indexOf per chain, so every chain absent near a settlement
    // scanned the whole 33 MB buffer: ~1300 settlements × 19 chains = ~26 s of
    // pure waste on every turn-end parse. Bounding it to a subarray view drops
    // this from ~26 s to ~10 ms (verified identical, scripts/bench-defaultset.js).
    let dsEnd = -1;
    const dsWin = data.subarray(dsDataStart, Math.min(dsDataStart + 540, data.length));
    for (const { cn, n } of chainNeedles) {
      const rel = dsWin.indexOf(n);
      if (rel !== -1 && rel < 500) {
        const recordStart = (dsDataStart + rel) + 1 - cn.length - 1 - 2;
        if (dsEnd === -1 || recordStart < dsEnd) dsEnd = recordStart;
      }
    }
    if (dsEnd === -1) dsEnd = dsDataStart + 300;
    // Scan for ASCII chain names inside default_set
    const queue = [];
    for (let p = dsDataStart; p < dsEnd - 4; p++) {
      const ln = data.readUInt16LE(p);
      if (ln < 3 || ln > 40) continue;
      let ok = true;
      for (let i = 0; i < ln - 1; i++) {
        const c = data[p + 2 + i];
        if (!((c >= 0x61 && c <= 0x7a) || c === 0x5f || (c >= 0x30 && c <= 0x39))) { ok = false; break; }
      }
      if (ok && data[p + 2 + ln - 1] === 0x00 && data[p + 2] >= 0x61 && data[p + 2] <= 0x7a) {
        queue.push(data.slice(p + 2, p + 2 + ln - 1).toString('ascii'));
      }
    }
    if (queue.length > 0) queues[s.name] = queue;
  }

  // ── 7. Parse per-settlement tax level ──
  // Confirmed empirically against RIS imperial-campaign Sparta saves
  // (save_2.0/2.1/2.2 with all settlements set to high/very_high/low):
  // the tax byte sits at exactly  settlement_name_offset - 2269  bytes
  // (where settlement.offset is the `\x01` marker — the UTF-16LE string
  // starts 3 bytes later and the tax byte sits 2272 bytes before that
  // string start). Enum: 0=low, 1=normal (default), 2=high, 3=very_high.
  // Validated across 3 cities × 3 enum values = 9 distinct measurements,
  // identical offset every time.
  const TAX_OFFSET = 2269; // bytes BEFORE settlement.offset (the \x01 marker)
  const TAX_LEVELS = ["low", "normal", "high", "very_high"];
  let taxByCity = null;
  // Defensive: gate by header campaign-name. Formula was only verified on
  // RIS imperial campaign saves (magic 0x070a, campaign "imperial_campaign").
  // Wrapped in try/catch so any header anomaly silently skips tax parsing
  // rather than aborting the whole snapshot — avoids a half-parsed state
  // that could surface as a UI hang on the renderer side.
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      taxByCity = {};
      for (const s of settlements) {
        const off = s.offset - TAX_OFFSET;
        if (off < 0 || off >= len) continue;
        const v = data[off];
        if (v >= 0 && v <= 3) taxByCity[s.name] = TAX_LEVELS[v];
      }
    }
  } catch (err) {
    console.warn("[tax] parsing failed, skipping:", err && err.message);
    taxByCity = null;
  }

  // Settlement per-turn income u32 (and cumulative income u32) — sit at
  // tax_byte + 683 and tax_byte + 687 respectively. Per the save-cracker
  // session-3 byte-map: STRONG-confidence, single clean correlation
  // (Rome=902 d/turn dropping to 860 next turn; Sparta=444). Verified on
  // save_rome10: Capua=400, Brundisium=266, Uria=133. Same campaign-name
  // gate as the other settlement fields.
  let incomeByCity = null;
  // Settlement size class enum u8 at tax_byte + 62. CONFIRMED: 0=village,
  // 1=town, 2=large_town, 3=city, 4=large_city, 5=huge_city. Matches
  // descr_strat (Rome=4, Sparta=2). Live value reflects current upgrade
  // tier — useful when the user has upgraded mid-campaign.
  let sizeByCity = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      incomeByCity = {};
      sizeByCity = {};
      const SIZE_LABELS = ["village", "town", "large_town", "city", "large_city", "huge_city"];
      for (const s of settlements) {
        const taxOff = s.offset - TAX_OFFSET;
        if (taxOff < 0) continue;
        if (taxOff + 687 + 4 <= data.length) {
          const perTurn = data.readUInt32LE(taxOff + 683);
          const cumulative = data.readUInt32LE(taxOff + 687);
          // Sanity: RTW settlement income is bounded — 0..50000/turn is
          // reasonable, cumulative up to a few million. Out of range
          // means the offset drifted or the slot is uninitialised.
          if (perTurn <= 50000 && cumulative <= 10_000_000) {
            incomeByCity[s.name] = { perTurn, cumulative };
          }
        }
        if (taxOff + 62 < data.length) {
          const v = data[taxOff + 62];
          if (v >= 0 && v <= 5) sizeByCity[s.name] = SIZE_LABELS[v];
        }
      }
    }
  } catch (err) {
    console.warn("[income/size] parsing failed, skipping:", err && err.message);
    incomeByCity = null;
    sizeByCity = null;
  }

  // Settlement live population u32 — sits at tax_byte + 775 (so
  // settlement.offset - 1494 with TAX_OFFSET=2269). Cross-validated by the
  // save-cracker (session 2): 18/18 across Sparta tax saves match the
  // descr_strat starting pops (3500/1800/1400), and Roma's 9000-pop
  // independently lines up in the Roman saves. Same campaign-name gate
  // as tax. A SECOND pop-shaped u32 lives at tax_byte + 2235 (= settlement
  // .offset - 34) that mostly mirrors the first but diverges at turn
  // boundaries — likely "tax-eligible pop" or a pre-turn snapshot; not
  // surfaced here.
  let populationByCity = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      populationByCity = {};
      for (const s of settlements) {
        const off = s.offset - 1494;
        if (off < 0 || off + 4 > data.length) continue;
        const v = data.readUInt32LE(off);
        // Sanity: settlement pop in RTW ranges 400 (village) to 60000
        // (megalopolis). Clip out-of-range to detect record-layout drift.
        if (Number.isFinite(v) && v >= 100 && v <= 100000) {
          populationByCity[s.name] = v;
        }
      }
    }
  } catch (err) {
    console.warn("[pop] parsing failed, skipping:", err && err.message);
    populationByCity = null;
  }

  // Settlement happiness / public-order f32 — sits at tax_byte + 2239 (so
  // 30 bytes BEFORE the settlement marker on the RIS imperial-campaign
  // layout, since tax_byte = settlement.offset - 2269 and happiness =
  // tax_byte + 2239 = settlement.offset - 30). Triple-validated by the
  // save-cracker against the Sparta tax-triple — the ONLY byte in any
  // settlement record that changes between tax levels. Empirical range
  // observed: 105..195 with a -25-per-tax-level slope. Engine likely
  // clips this to a 0-100% bar on display, but the raw value is what
  // surfaces here. Wrapped in the same campaign-name gate as the tax
  // parsing because the offset was only verified on imperial-campaign.
  let happinessByCity = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign" || campaignName === "ris_classic") {
      happinessByCity = {};
      for (const s of settlements) {
        const off = s.offset - 30;
        if (off < 0 || off + 4 > data.length) continue;
        const v = data.readFloatLE(off);
        // Sanity: clip to plausible range. Out-of-range means the offset
        // didn't land where we expected (settlement layout drift between
        // engine versions). Skip rather than show garbage.
        if (Number.isFinite(v) && v >= 0 && v <= 500) {
          happinessByCity[s.name] = v;
        }
      }
    }
  } catch (err) {
    console.warn("[happiness] parsing failed, skipping:", err && err.message);
    happinessByCity = null;
  }

  // ── New magic-based decoders (added 2026-05-09 via rtw-sav-parser cracking) ──
  // Faction record array: 239 records starting with `ff 0a af f0` magic.
  // Lua persistent counters: named u32 values (turn_number, id_<faction>, etc.).
  let factionRecords = null;
  let luaCounters = null;
  tick("faction records + exploration");
  let playerExploration = null;
  try {
    const fr = findFactionRecords(data);
    factionRecords = {
      count: fr.length,
      arraySpan: summarizeFactionArray(fr),
      records: fr,
    };
    // Decode the player's ever-explored tile grid + active LOS halo
    // (save-cracker sessions 103 + 105, 2026-05-16). The player faction
    // record is the LARGEST one (~334 KB vs ~6 KB per NPC). After the
    // 24 B header come stride-2 RLE pairs <u8 value><u8 count> that
    // expand row-major to the full 1020×700 strategic-tile grid.
    //
    // CORRECTED 2026-06-04 (findings-faction-knowledge-entities): the grid
    // is 1020 wide × 700 tall, row-major, index = tileY*1020 + tileX in the
    // save's engine tile coords (tileY bottom-up). The old 510×1400 ("half-x,
    // double-y, even-rows-only") interpretation was WRONG — it squashed x 2:1
    // and dropped the right half of every row, so the Explored overlay scored
    // only 2.1% of own settlements on explored tiles. The 1020×700 model
    // scores 100.0% (20728/20738) across the 28-save corpus. The RLE decode
    // itself is unchanged (linear fill); only the grid dims (used by the
    // renderer's sampler) were wrong.
    //
    // Value semantics:
    //   0 = unexplored / never-seen (~99% of tiles)
    //   1 = ever-explored land (settlement tiles are uniformly state 1)
    //   2..24 = vision/recency gradient over explored tiles
    //   count == 0 in an RLE pair is the TERMINATOR. Session 103's
    //   hard-coded end at +0xc264 was wrong — it leaked ASCII bytes
    //   from the trailing settlement-list as fake high tile values.
    if (fr && fr.length > 0) {
      let largest = fr[0];
      for (const r of fr) {
        if ((r.size || 0) > (largest.size || 0)) largest = r;
      }
      const GRID_W = 1020, GRID_H = 700;
      const RLE_START = largest.offset + 0x18;
      const RLE_MAX = Math.min(largest.offset + largest.size, data.length);
      if (largest.size >= 0x18 + 4 && RLE_START < data.length) {
        const grid = new Uint8Array(GRID_W * GRID_H);
        let gi = 0;
        let i = RLE_START;
        while (i + 2 <= RLE_MAX && gi < grid.length) {
          const val = data[i];
          const count = data[i + 1];
          if (count === 0) break; // canonical RLE terminator
          const limit = Math.min(count, grid.length - gi);
          for (let k = 0; k < limit; k++) grid[gi + k] = val;
          gi += limit;
          i += 2;
        }
        if (gi >= 100000) {
          playerExploration = { grid, width: GRID_W, height: GRID_H, decoded: gi };
        }
      }
    }
  } catch (err) { console.warn("[faction-records] parse failed:", err && err.message); }
  try {
    const recs = findLuaCounters(data);
    luaCounters = {
      count: recs.length,
      records: recs,
      byName: Object.fromEntries(recs.map(r => [r.name, r.value])),
    };
  } catch (err) { console.warn("[lua-counters] parse failed:", err && err.message); }

  // Per-faction current treasury (denarii) — CONFIRMED by save-cracker
  // session 5. Major-faction records sit in a flat 23-entry array. Each
  // record has a structural signature:
  //   +0   u32  treasury (signed for bankruptcy)
  //   +8   u32  == 100  (MAJOR-CLASS tag)
  //   +12  u32  == 1    (version)
  //   +24  u32  == self_offset+24
  //   +40  u32  == self_offset+40
  //   +44  u32  == 6
  //   +48  u32  region count N
  //   +(92+4N) u32 start-of-turn treasury snapshot
  // Player is always at index 0; remaining 22 follow descr_strat order
  // with player slot removed. RIS imperial campaign only — gated by
  // campaign-name header check (same as tax/income/pop fields).
  let treasuryByFaction = null;
  try {
    const campaignLen = data.length >= 0x40 ? data.readUInt16LE(0x3a) : 0;
    let campaignName = "";
    if (campaignLen > 0 && campaignLen < 64 && 0x3c + campaignLen * 2 <= data.length) {
      for (let i = 0; i < campaignLen; i++) {
        const c = data.readUInt16LE(0x3c + i * 2);
        if (c >= 0x20 && c <= 0x7e) campaignName += String.fromCharCode(c);
      }
    }
    if (campaignName === "imperial_campaign") {
      // Scan for the structural signature.
      const records = [];
      for (let i = 0; i + 64 < data.length; i += 1) {
        if (data.readUInt32LE(i + 8) !== 100) continue;
        if (data.readUInt32LE(i + 12) !== 1) continue;
        if (data.readUInt32LE(i + 16) !== 0 || data.readUInt32LE(i + 20) !== 0) continue;
        if (data.readUInt32LE(i + 24) !== i + 24) continue;
        if (data.readUInt32LE(i + 32) !== 0 || data.readUInt32LE(i + 36) !== 0) continue;
        if (data.readUInt32LE(i + 40) !== i + 40) continue;
        if (data.readUInt32LE(i + 44) !== 6) continue;
        const regions = data.readUInt32LE(i + 48);
        if (regions > 200) continue;
        const treasury = data.readInt32LE(i);
        const turnStartOff = i + 92 + 4 * regions;
        const turnStart = turnStartOff + 4 <= data.length ? data.readInt32LE(turnStartOff) : null;
        // `regions` here is the record's KNOWLEDGE-SIZE count, not owned
        // regions (canonical: 4 for Carthage T1 when it owns 41) — expose it
        // under the honest name and keep regionCount null so nothing trusts it.
        records.push({ pos: i, treasury, turnStart, knowledgeSize: regions, regionCount: null });
        // Skip ahead by the record's known minimum span to avoid double
        // matching inside the same record.
        i = Math.min(data.length - 64, i + 92 + 4 * regions);
      }
      // Return raw records keyed by scan index — the renderer joins them
      // to faction names using the player-faction state (which lives on
      // that side) and the RIS imperial major-faction descr_strat order.
      treasuryByFaction = { records };
    }
  } catch (err) {
    console.warn("[treasury] parsing failed, skipping:", err && err.message);
    treasuryByFaction = null;
  }

  // ── Short-block settlement stats (added 2026-05-17 via save-cracker) ──
  // Each settlement carries a ~583-byte stats block that ENDS at the UTF-16
  // name. Fields sit at known relative offsets within that block. Validated
  // cross-campaign (Macedon Alex T11 + RIS Spain T1):
  //   tax_rate    u8  at name-562    (0=very_low, 1=low, 2=normal, 3=high, 4=very_high)
  //   level       u32 at name-571    (0=village .. 5=huge_city)
  //   PO          u32 at name-435    (public order %)
  //   income      u32 at name-127    (denarii / turn)
  //   population  u32 at name-35
  //   creator     u32 at name-583    (revolt-to faction; updated to new owner on capture)
  // settlement.offset (the \x01 marker) sits 1 byte BEFORE the UTF-16-len
  // prefix, so name_pos = marker + 1 — translating: tax = marker - 561, etc.
  //
  // TAX ENUM NOTE: Provincia's older long-block parser (marker-2269) uses
  // 4 values 0..3 = low/normal/high/very_high. The short-block byte uses 5
  // values 0..4 = very_low/low/normal/high/very_high. We surface the short
  // path under the same `taxByCity` key, mapped to the same string labels.
  // The short-block path fills in cities the long-block path skipped (e.g.
  // alexander_campaign saves) without changing values where both produced one.
  const SHORT_TAX_LEVELS = ["very_low", "low", "normal", "high", "very_high"];
  const SHORT_SIZE_LABELS = ["village", "town", "large_town", "city", "large_city", "huge_city"];
  try {
    const ensureObj = (v) => (v && typeof v === "object" ? v : {});
    taxByCity = ensureObj(taxByCity);
    populationByCity = ensureObj(populationByCity);
    incomeByCity = ensureObj(incomeByCity);
    sizeByCity = ensureObj(sizeByCity);
    let shortBlockHits = 0;
    for (const s of settlements) {
      const namePos = s.offset + 1;  // findUtf16 returns the nchars byte position
      // Tax rate (single byte, 0..4)
      if (!(s.name in taxByCity)) {
        const taxOff = namePos - 562;
        if (taxOff >= 0 && taxOff < data.length) {
          const v = data[taxOff];
          if (v >= 0 && v <= 4) {
            taxByCity[s.name] = SHORT_TAX_LEVELS[v];
            shortBlockHits++;
          }
        }
      }
      // Population (u32, plausible range 100..100000)
      if (!(s.name in populationByCity)) {
        const popOff = namePos - 35;
        if (popOff >= 0 && popOff + 4 <= data.length) {
          const v = data.readUInt32LE(popOff);
          if (Number.isFinite(v) && v >= 100 && v <= 100000) {
            populationByCity[s.name] = v;
          }
        }
      }
      // Income perTurn (u32, plausible 0..50000 denarii). The short block
      // doesn't carry a cumulative-income twin near this offset, so leave
      // cumulative null where only the short path is available.
      if (!(s.name in incomeByCity)) {
        const incOff = namePos - 127;
        if (incOff >= 0 && incOff + 4 <= data.length) {
          const v = data.readUInt32LE(incOff);
          if (Number.isFinite(v) && v >= 0 && v <= 50000) {
            incomeByCity[s.name] = { perTurn: v, cumulative: null };
          }
        }
      }
      // Settlement level (u32, 0..5)
      if (!(s.name in sizeByCity)) {
        const lvlOff = namePos - 571;
        if (lvlOff >= 0 && lvlOff + 4 <= data.length) {
          const v = data.readUInt32LE(lvlOff);
          if (v >= 0 && v <= 5) sizeByCity[s.name] = SHORT_SIZE_LABELS[v];
        }
      }
    }
    if (shortBlockHits > 0) {
      console.log("[short-block] filled", shortBlockHits, "settlements with short-block tax data");
    }
    // If nothing got populated, drop empty objects back to null so renderer
    // doesn't show empty tax/pop chips for every region.
    if (Object.keys(taxByCity).length === 0) taxByCity = null;
    if (Object.keys(populationByCity).length === 0) populationByCity = null;
    if (Object.keys(incomeByCity).length === 0) incomeByCity = null;
    if (Object.keys(sizeByCity).length === 0) sizeByCity = null;
  } catch (err) {
    console.warn("[short-block] parsing failed, skipping:", err && err.message);
  }

  // ── Save-cracker extras (2026-05-18 batch — header / mod / faction-config /
  //    per-character spouse+age+region) ──
  // Pure-read; each call is cheap and guarded so a corrupt/old save can't break
  // the snapshot.
  let header = null;
  let factionDiscovered = null;
  let factionConfig = null;
  let modInfo = null;
  tick("character extras");
  let characterExtras = null;
  let familyTreeMaps = null;
  let religionByCity = null;
  try { header = cxParseHeader(data); } catch (err) { console.warn("[header] parse failed:", err && err.message); }
  try { if (header) factionDiscovered = cxParseBitmask(data, header); } catch (err) { console.warn("[bitmask] parse failed:", err && err.message); }
  try { if (header && factionDiscovered) factionConfig = cxParseFactionConfig(data, header, factionDiscovered); } catch (err) { console.warn("[faction-config] parse failed:", err && err.message); }
  try { modInfo = cxParseModInfo(data); } catch (err) { console.warn("[mod-info] parse failed:", err && err.message); }
  try {
    characterExtras = cxParseCharacterExtras(data);
    // Attach +288 / +292 map coordinates from the extended record. Lets
    // downstream code bridge save chars to descr_strat character lines by
    // matching (x, y).
    if (characterExtras) cxAttachMapCoords(data, characterExtras);
  } catch (err) { console.warn("[character-extras] parse failed:", err && err.message); }
  // Crack 2026-05-18: each character's portrait is identified by a u32 at
  // +280 of the 354-byte extended record, matched against u32-prefixed
  // entries in the portrait pool. Resolves to the EXACT pstr16 portrait
  // path the in-game family tree displays.
  let portraitByOwnUuid = null;
  try {
    if (characterExtras) {
      const m = cxResolvePortraits(data, characterExtras);
      // Attach per-character portraitPath onto each characterExtras entry
      // for trivial downstream lookup.
      for (const c of characterExtras) {
        const p = m.get(c.ownUuid);
        if (p) {
          c.portraitCardsPath = p.cards;
          c.portraitFullPath = p.fulls;
          c.portraitUuid = p.portraitUuid;
        }
      }
      portraitByOwnUuid = Array.from(m.entries()).map(([uuid, v]) => [uuid, v]);
      console.log(`[portraits] resolved ${m.size}/${characterExtras.length} characters via save UUID linkage`);
    }
  } catch (err) { console.warn("[portraits] resolve failed:", err && err.message); }
  try { religionByCity = cxParseReligion(data, settlements); } catch (err) { console.warn("[religion] parse failed:", err && err.message); }
  // Crack: parse major-faction records to get per-faction treasury + region count.
  // Works on vanilla imperial saves (Macedon T0 yields 23 records, player at idx 0).
  let factionTreasuries = null;
  let factionDiplomacy = null;
  let allFactionDiplomacy = null;
  let diplomacyMatrix = null;
  let treasuryHistory = null;
  let factionRecordOwners = null;
  try {
    factionTreasuries = cxParseTreasuries(data);
    if (factionTreasuries) console.log(`[treasuries] parsed ${factionTreasuries.length} major-faction records`);
  } catch (err) { console.warn("[treasuries] parse failed:", err && err.message); }
  // The +44==8 (Republic of Rome) layout enumerates faction records AND the
  // diplomacy matrix in the ENGINE's faction order (descr order with the index-1
  // rebel slot rotated to the end). Name those POSITIONAL lookups with the engine
  // order. The imperial +44==6 layout uses faction-id bytes (descr index) and
  // needs no remap — detect by record count (≈23 imperial vs ≈239 republic).
  // See memory engine-faction-order-permutation (cracked 2026-05-24).
  const positionalLayout = !!(factionTreasuries && factionTreasuries.length > 30);
  const engineOrder = positionalLayout ? cxDeriveEngineOrder(getModFactionOrder()) : getModFactionOrder();
  if (positionalLayout) console.log(`[faction-order] +44==8 layout — using engine order (rotated) for record/matrix naming`);
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      factionRecordOwners = cxIdentifyRecordOwners(data, factionTreasuries, engineOrder);
      // 0.9.527: attach the resolved AI personality archetype to each
      // record. aiPersonalityIndex (cracked) indexes the parsed personality
      // declaration order; expose both the raw index and the human name.
      for (const o of factionRecordOwners) {
        const rec = factionTreasuries[o.recordIndex];
        const aiIdx = rec && typeof rec.aiPersonalityIndex === "number" ? rec.aiPersonalityIndex : null;
        o.aiPersonalityIndex = aiIdx;
        // Prefer descr_strat fallback (see calibrate path for full rationale).
        const facName = (o.factionName || "").toLowerCase();
        const fromDescrStrat = getModAiByFaction() ? getModAiByFaction()[facName] : null;
        const fromSave = (getModAiPersonalityOrder() && aiIdx != null && aiIdx >= 0 && aiIdx < getModAiPersonalityOrder().length)
          ? getModAiPersonalityOrder()[aiIdx] : null;
        o.aiPersonality = fromDescrStrat || fromSave || null;
        o.aiPersonalitySource = fromDescrStrat ? "descr_strat" : (fromSave ? "save" : null);
      }
      const named = factionRecordOwners.filter(o => o.factionName).length;
      const byId = factionRecordOwners.filter(o => o.source === "factionId").length;
      const byBanner = factionRecordOwners.filter(o => o.source === "captainBanner").length;
      const withAi = factionRecordOwners.filter(o => o.aiPersonality).length;
      console.log(`[record-owners] identified ${named}/${factionRecordOwners.length} faction records (factionId=${byId}, captainBanner=${byBanner}); AI personality on ${withAi}`);
    }
  } catch (err) { console.warn("[record-owners] parse failed:", err && err.message); }
  // Identify the player's faction internal name from the save itself —
  // the only captain banner that appears BEFORE the first major NPC
  // record belongs to the player. Works for any campaign/mod since
  // it's purely structural.
  let savePlayerFaction = null;
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      savePlayerFaction = cxIdentifyPlayerFromSave(data, factionTreasuries);
      if (savePlayerFaction) console.log(`[player-faction] identified player as "${savePlayerFaction}" from save banner`);
    }
  } catch (err) { console.warn("[player-faction] identify failed:", err && err.message); }
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      factionDiplomacy = cxParseDiplomacy(data, factionTreasuries);
      const total = factionDiplomacy.reduce((s, x) => s + (x.relations ? x.relations.length : 0), 0);
      console.log(`[diplomacy] parsed ${total} relations across ${factionDiplomacy.length} factions`);
    }
  } catch (err) { console.warn("[diplomacy] parse failed:", err && err.message); }
  // 0.9.539: live diplomacy COUNTS for EVERY faction (incl. player, senate,
  // carthage, minors) via the ~221 0x39240005 zones, keyed by faction name.
  try {
    allFactionDiplomacy = cxParseAllDiplomacy(data, getModFactionOrder());
    const n = allFactionDiplomacy ? Object.keys(allFactionDiplomacy).length : 0;
    console.log(`[diplomacy-all] live counts for ${n} factions`);
  } catch (err) { console.warn("[diplomacy-all] parse failed:", err && err.message); }
  // 0.9.546: NAMED live diplomacy from the N×N attitude matrix (the real
  // diplomacy source — war/ally/hostile per faction PAIR, partner recoverable).
  try {
    // RAW getModFactionOrder() (NOT engineOrder) — the matrix is descr_sm-indexed and
    // self-calibrates C; the derived engine order would mislabel every pair.
    diplomacyMatrix = cxParseDiplomacyMatrix(data, getModFactionOrder());
    if (diplomacyMatrix && diplomacyMatrix._meta) {
      const mt = diplomacyMatrix._meta;
      console.log(`[diplo-matrix] located base=0x${mt.base.toString(16)} stride=${mt.stride} N=${mt.N} C=${mt.C} symmetry=${(mt.symmetry*100).toFixed(0)}% warPairs=${mt.warPairs}`);
      const pf = (savePlayerFaction || "").toLowerCase();
      const row = pf && diplomacyMatrix[pf];
      if (row) console.log(`[diplo-matrix] ${pf}: war=[${(row.war||[]).join(", ")}] allied=[${(row.allied||[]).join(", ")}] trade=[${(row.trade||[]).join(", ")}]`);
    } else {
      console.log(`[diplo-matrix] NOT located`);
    }
  } catch (err) { console.warn("[diplo-matrix] parse failed:", err && err.message); }
  // 0.9.549: per-faction treasury-over-time history (f13 checkpoints).
  // KEYED BY RECORD POSITION → descr_sm order (getModFactionOrder()), NOT engineOrder.
  // parseFactionTreasuryHistory indexes factionOrder by the record's array
  // position; engineOrder rotates the first rebel slot to the end, shifting every
  // faction's history series by one slot. Fixed 2026-05-31 — see findings doc.
  try {
    if (factionTreasuries && factionTreasuries.length > 0) {
      treasuryHistory = cxParseTreasuryHistory(data, factionTreasuries, getModFactionOrder());
      console.log(`[treasury-history] ${treasuryHistory ? Object.keys(treasuryHistory).length : 0} factions`);
    }
  } catch (err) { console.warn("[treasury-history] parse failed:", err && err.message); }
  try {
    if (characterExtras) {
      // v1Chars come from the existing character parser path — wire whatever is
      // available in this scope. If the caller (renderer) doesn't already pass
      // them in, the tree maps will still expose byUuid+spouseOf without children.
      familyTreeMaps = cxBuildFamilyMaps(characterExtras, null);
    }
  } catch (err) { console.warn("[family-tree] build failed:", err && err.message); }

  tick("diplomacy + treasuries + family tree");
  return {
    buildings: buildingsByCity, armies, queues,
    taxByCity, happinessByCity, populationByCity, incomeByCity, sizeByCity,
    factionRecords, luaCounters, treasuryByFaction, playerExploration,
    // ── Cracker extras (additive — old consumers don't break) ──
    saveHeader: header,
    factionDiscovered,
    factionConfig,
    modInfo,
    characterExtras,
    religionByCity,
    factionTreasuries,
    factionRecordOwners,
    savePlayerFaction,
    factionDiplomacy,
    allFactionDiplomacy,
    diplomacyMatrix,
    treasuryHistory,
    familyTreeMaps: familyTreeMaps ? {
      byUuid: Array.from(familyTreeMaps.byUuid.entries()),
      spouseOf: Array.from(familyTreeMaps.spouseOf.entries()),
      childrenOf: Array.from(familyTreeMaps.childrenOf.entries()),
    } : null,
  };
  };
}
module.exports = { makeParseSaveData };
