// src/saveCrackerExtras.js
//
// Consolidates all newly-cracked save-file fields (2026-05-17 / 2026-05-18) so
// Provincia can use them in any future UI feature.
//
// Coverage:
//   * Header (campaign UUID, mod display name, mod content hash, faction-discovered
//     bitmask, faction-config 53-byte records)
//   * Per-character extras (own_uuid, role, region, spouse_uuid, age) anchored on
//     `<culture> <role>` ASCII pstr16
//   * Per-settlement extras (already in main.js — re-exported here for completeness)
//   * Per-soldier weapon byte (9-byte soldier records, byte +0 = weapon_lvl × 4)
//   * Unit-level stat aggregate slots (3× 14-byte blocks of pattern
//     `01 00 40 00 XX ...` — weapon/armor/experience aggregates)
//
// Each function is pure-read: no side effects, returns plain JS objects.
//
// Validated against:
//   - Spain T1 (vanilla imperial)
//   - Macedon T0 (RIS imperial, 109 characters)
//   - Arretium PRE/QUEUE/POST/T2-queued/T3/T4 (RIS imperial)
//   - Alex Macedon T1/T11/T12 (alexander campaign)

"use strict";

// ── Header ──────────────────────────────────────────────────────────────────

function readCampaignName(buf) {
  if (buf.length < 0x60) return "";
  const len = buf.readUInt16LE(0x3a);
  if (len < 1 || len > 64 || 0x3c + len * 2 > buf.length) return "";
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(0x3c + i * 2);
    if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
  }
  return s;
}

// Read header essentials. Cheap; safe to call once per save load.
function parseHeader(buf) {
  if (buf.length < 0x100) return null;
  const magic = buf.readUInt32LE(0x00);
  if (magic !== 0x070a) return null;
  const campaignUuid = buf.readUInt32LE(0x04);
  const campaignTypeFlag = buf.readUInt32LE(0x1c);
  const saveVersion = buf.readUInt32LE(0x20);
  // 12-byte content hash (3 u32 sub-hashes — campaign / mod / setup variant)
  const hash = [
    buf.readUInt32LE(0x24),
    buf.readUInt32LE(0x28),
    buf.readUInt32LE(0x2c),
  ];
  const sessionTimestamp = buf.readUInt32LE(0x30);
  const campaignName = readCampaignName(buf);
  return {
    magic,
    campaignUuid,
    campaignTypeFlag,           // 0x20004 imperial / 0x20204 alexander
    saveVersion,                // 7 for RR
    hash,                       // 3 × u32
    sessionTimestamp,
    campaignName,
    nameEnd: 0x3c + campaignName.length * 2,
  };
}

// Read the per-faction header bitmask. NOTE (verified 2026-05-22): despite the
// name, this is NOT "discovered by player" — it's STATIC campaign config. The
// raw bytes are byte-identical across every RIS save tested (Macedon, Seleucid,
// Antigonid, Carthage, Rome, Dummies; turns 0–8), so it cannot encode
// per-player discovery. bits[i] indexes descr_sm_factions order but the data is
// constant per campaign (likely a faction-category/enabled flag). Do NOT build a
// "factions you've met" feature on it — see memory reference_faction_discovered_bitmask.
// Kept parsed (App.js state) for completeness; not rendered. Layout:
//   name_end+16..18: 3 bytes `9X c7 06` (X = 0xc on most saves, 0xe on
//                    some late-campaign autosaves; ImHex cross-save diff
//                    2026-05-19 showed Bactria T964 had `9e c7 06` vs
//                    Dummies T900/T1134's `9c c7 06`. One-bit flip means
//                    byte 0 is flags, not a fixed magic. Accept the bottom
//                    nibble == 0xc and bytes 1..2 unchanged so the bitmask
//                    still parses on those saves.
//   name_end+19    : u8 bitmask byte count
//   name_end+20..  : bitmask bytes
function parseFactionDiscoveredBitmask(buf, hdr) {
  if (!hdr) return null;
  const start = hdr.nameEnd + 16;
  if (start + 4 > buf.length) return null;
  if ((buf[start] & 0x0f) !== 0x0c || buf[start + 1] !== 0xc7 || buf[start + 2] !== 0x06) return null;
  const count = buf[start + 3];
  if (count < 1 || count > 100) return null;
  const bits = [];
  for (let i = 0; i < count; i++) {
    const b = buf[start + 4 + i];
    for (let k = 0; k < 8; k++) bits.push((b >> k) & 1);
  }
  const discoveredCount = bits.filter(b => b).length;
  return { byteCount: count, totalFactions: count * 8, bits, discoveredCount };
}

// Read faction-config 53-byte records. Each record byte +29 = faction roster index
// (or 21 = slave-merged / disabled). Each record byte +4 = total faction count
// (redundant — matches header's faction count).
//
// First record marker `12 34 de 0a` is at name_end + 146 (RIS-imperial 240-bit
// bitmask) or name_end + 92 (vanilla 24-bit bitmask). Position depends on
// bitmask size.
function parseFactionConfigRecords(buf, hdr, bitmask) {
  if (!hdr || !bitmask) return null;
  const MARKER = Buffer.from([0x12, 0x34, 0xde, 0x0a]);
  // Scan a small range starting from after the bitmask + small trailer
  const searchStart = hdr.nameEnd + 20 + bitmask.byteCount;
  const firstMarker = buf.indexOf(MARKER, searchStart);
  if (firstMarker < 0 || firstMarker - searchStart > 200) return null;
  const factionCount = buf.readUInt32LE(firstMarker + 4);
  if (factionCount < 1 || factionCount > 300) return null;
  // Verify the next few markers are at +53 each
  const recordSize = 53;
  for (let i = 0; i < Math.min(5, factionCount); i++) {
    const ofs = firstMarker + i * recordSize;
    if (buf[ofs] !== 0x12 || buf[ofs + 1] !== 0x34 || buf[ofs + 2] !== 0xde || buf[ofs + 3] !== 0x0a) {
      return null;
    }
  }
  const records = [];
  for (let i = 0; i < factionCount; i++) {
    const ofs = firstMarker + i * recordSize;
    if (ofs + recordSize > buf.length) break;
    records.push({
      index: i,
      offset: ofs,
      factionIndex: buf[ofs + 29],     // descr_strat order, or 21 = slave-merged
      flag43: buf[ofs + 43],
      flag47: buf[ofs + 47],
      flag48: buf[ofs + 48],
    });
  }
  return { firstMarker, recordSize, factionCount, records };
}

// Try to read the mod display name (UTF-16 LE) located at ~0x326d.
// Returns null if save was made without an explicit mod path.
function parseModInfo(buf) {
  if (buf.length < 0x4500) return null;
  function readPstr16Utf16At(off) {
    if (off + 2 > buf.length) return null;
    const chars = buf.readUInt16LE(off);
    if (chars < 4 || chars > 200) return null;
    if (off + 2 + chars * 2 > buf.length) return null;
    let s = "";
    for (let i = 0; i < chars; i++) {
      const c = buf[off + 2 + i * 2];
      const h = buf[off + 2 + i * 2 + 1];
      if (h !== 0 || c < 0x20 || c > 0x7e) return null;
      s += String.fromCharCode(c);
    }
    return { str: s, totalLen: 2 + chars * 2 };
  }
  const modDisplayName = readPstr16Utf16At(0x326d);
  const modContentHash = readPstr16Utf16At(0x32c2);
  const modPath = readPstr16Utf16At(0x43fc);
  const actionCounter = buf.length >= 0x4400 ? buf.readUInt32LE(0x43f8) : 0;
  return {
    modDisplayName: modDisplayName ? modDisplayName.str : null,
    modContentHash: modContentHash ? modContentHash.str : null,
    modPath: modPath ? modPath.str : null,
    actionCounter,
  };
}

// ── Per-character extras (anchored on role string) ──────────────────────────

const ROLES = ["general", "captain", "diplomat", "spy", "assassin", "admiral", "merchant"];

// 0.9.422: Discover the save's culture names DYNAMICALLY by scanning for
// any `<lowercase_token> <role>\0` pstr16 pattern. Avoids hardcoding (user
// directive: must work for any mod — vanilla, RIS, BI, custom mods).
// Previously a hardcoded VANILLA_CULTURES + RIS_CULTURES list missed any
// custom culture name a mod added (e.g. RIS Macedon's `e_hellenistic` for
// some character buckets).
//
// Scan logic: for each ROLE, look for ASCII pstr16 strings ending in
// " <role>\0" and harvest the leading token as a culture candidate. The
// token must match /^[a-z][a-z_0-9]*$/ to reject random byte noise.
function discoverCultures(buf) {
  const cultures = new Set();
  for (const role of ROLES) {
    const tail = Buffer.from(" " + role + "\0", "ascii");
    let p = 0;
    while (true) {
      const idx = buf.indexOf(tail, p);
      if (idx === -1) break;
      p = idx + 1;
      // Walk backwards to find the start of the culture token (stops at any
      // non-[a-z_0-9] byte — typical because the pstr16's u16 length prefix
      // sits at idx - tokenLen - 2).
      let start = idx;
      while (start > 0) {
        const b = buf[start - 1];
        if ((b >= 0x61 && b <= 0x7a) /* a-z */
          || (b >= 0x30 && b <= 0x39) /* 0-9 */
          || b === 0x5f /* _ */) {
          start -= 1;
        } else break;
      }
      if (start === idx) continue; // no token before " <role>"
      const token = buf.slice(start, idx).toString("ascii");
      // Reject if too short or doesn't start with a-z.
      if (token.length < 3) continue;
      if (token[0] < "a" || token[0] > "z") continue;
      // Pre-validate: the u16 right before `start` (so 2 bytes before idx-tokenLen)
      // should equal the pstr16 length (tokenLen + 1 + roleLen + 1 = tokenLen + roleLen + 2).
      // We don't enforce this strictly — too restrictive — but the next step is
      // the parser's full structural check, which discards garbage anyway.
      cultures.add(token);
    }
  }
  return Array.from(cultures);
}

// Find every <culture> <role>\0 ASCII pstr16 in the buffer and extract the
// per-character fields anchored on it. Fields live AFTER the role string,
// so offsets are relative to (idx + roleLen) where roleLen = chars + 1 (null):
//   after+1   u32 own UUID         (was role+15 when roleLen=14)
//   after+5   u32 bodyguard UUID   (was role+19)
//   after+21  u16 region char count L
//   after+23  UTF-16 region name (2L bytes)
//   after+23+2L      u32 ff ff ff ff sentinel
//   after+23+2L+4    u32 spouse UUID  (0 / 0xffffffff = unmarried)
//   after+23+2L+8    f32 (unknown)
//   after+23+2L+12   u32 age in years
//   after+23+2L+16   u32 second age value
//
// Old code hardcoded offsets calibrated for "greek general" (14 bytes), which
// broke for "antigonid general" (18), "barbarian general" (18), etc. Fixed
// 2026-05-18 by making offsets relative to roleLen, unlocking 30+ RIS cultures.
function parseCharacterExtras(buf) {
  const out = [];
  const len = buf.length;
  // Single pass: scan the buffer once per role (7 total) for the " <role>\0"
  // tail, then walk back to the culture token and read the per-character fields
  // anchored on the role string. The previous version called discoverCultures()
  // (7 scans) and then re-scanned the WHOLE buffer once per (culture × role) —
  // ~200 full passes on a 35 MB save (~1.1 s). This is 7 passes (~47 ms),
  // verified to produce an identical result set (scripts/bench-save-parse.js).
  for (const role of ROLES) {
    const tail = Buffer.from(" " + role + "\0", "ascii");
    const tailLen = tail.length; // 1 (space) + role chars + 1 (null)
    let p = 0;
    while (true) {
      const t = buf.indexOf(tail, p);
      if (t === -1) break;
      p = t + 1;
      // Walk back to the start of the culture token (a-z, 0-9, _).
      let s = t;
      while (s > 0) {
        const b = buf[s - 1];
        if ((b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x5f) s--;
        else break;
      }
      if (s === t) continue;              // no culture token before " <role>"
      if (t - s < 3) continue;            // same filter as discoverCultures
      if (buf[s] < 0x61 || buf[s] > 0x7a) continue; // must start a-z
      const idx = s;                      // start of "<culture> <role>\0"
      const roleLen = (t + tailLen) - s;  // length incl. null
      const culture = buf.toString("ascii", s, t);
      // Field offsets relative to idx (start of role string).
      const ownUuidOff = roleLen + 1;
      const bgUuidOff = roleLen + 5;
      const regionLenOff = roleLen + 21;
      const regionStartOff = roleLen + 23;
      if (idx + regionStartOff + 64 > len) continue;
      const ownUuid = buf.readUInt32LE(idx + ownUuidOff);
      if (ownUuid === 0 || ownUuid === 0xffffffff) continue;
      const bodyguardUuid = buf.readUInt32LE(idx + bgUuidOff);
      const regionLen = buf.readUInt16LE(idx + regionLenOff);
      if (regionLen < 1 || regionLen > 32) continue;
      // Read region name (UTF-16 LE)
      let region = "";
      let regionValid = true;
      for (let i = 0; i < regionLen; i++) {
        const lo = buf[idx + regionStartOff + i * 2];
        const hi = buf[idx + regionStartOff + i * 2 + 1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { regionValid = false; break; }
        region += String.fromCharCode(lo);
      }
      if (!regionValid) continue;
      const postRegion = idx + regionStartOff + regionLen * 2;
      if (postRegion + 16 > len) continue;
      // Validate sentinel
      if (buf.readUInt32LE(postRegion) !== 0xffffffff) continue;
      const spouseUuid = buf.readUInt32LE(postRegion + 4);
      const age = buf.readUInt32LE(postRegion + 12);
      if (age > 200) continue; // sanity
      out.push({
        offset: idx,
        role,
        culture,
        ownUuid,
        bodyguardUuid,
        region,
        spouseUuid,
        isMarried: spouseUuid !== 0 && spouseUuid !== 0xffffffff,
        age,
      });
    }
  }
  return out;
}

// Parse all "major faction" records — one per playable faction. Each record
// holds the faction's current treasury, start-of-turn treasury (so net
// = income earned this turn so far), regionCount, region IDs, faction_id
// (descr_sm_factions index), and ai_personality index (feral_descr_ai_personality.txt order).
//
// Confirmed structure from session 5 (cracker memory `dig-faction-treasury-final.js`):
//   +0   i32  current treasury (denarii)
//   +8   u32 = 100   (MAJOR-CLASS tag — distinguishes from rebels/NPCs)
//   +12  u32 = 1     (version)
//   +24  self_ptr   = record_pos + 24
//   +40  self_ptr   = record_pos + 40
//   +44  u32 = 6     (next sub-section size; minor placeholder records use 8)
//   +48  u32         regionCount
//   +52..+(52+4N)    region IDs (u32 each)
//   +(92 + 4N)       i32 start-of-turn treasury snapshot
//   +(96 + 4N)       u32 regionCount snapshot (= regionCount, redundant)
//   ...
//   +(191 + 4N)      u8  faction_id (descr_sm_factions order; **session 174 crack 2026-05-21**;
//                        preceded by 3 zero bytes at +188..+190 — could be read as u32 BE)
//   +(227 + 4N)      u8  ai_personality_index (feral_descr_ai_personality.txt order;
//                        **session 174 crack 2026-05-21** — 23/23 validated on Macedon T0 RIS)
//   +(244 + 4N)      u32 0x39240005 diplomacy marker, then count + 16-byte entries
//
// Validates on Macedon T0 (RIS imperial, 34 MB save): 23 records found,
// records cover NPC factions only (player faction sits elsewhere in body).
// faction_id and ai_personality bytes match descr_sm_factions/feral_descr_ai_personality.txt
// orders exactly.
function parseFactionTreasuries(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i += 1) {
    // Minimum signature — these three checks gate the loop. Stricter prefix
    // checks (i+32==0, i+36==0) were excluding L2 records where the engine
    // inserts per-turn-history fields between turns.
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    // Layout L1 (T1 saves):       second self-pointer at +40, sub at +44, regions at +48
    // Layout L3 (cracked 2026-05-29 from Julii T7): second self-pointer at +48, sub at +52, regions at +56
    // Layout L2 (T2+ saves):       second self-pointer at +52, sub at +56, regions at +60
    //   — engine inserts 8 (L3) or 12 (L2) extra bytes for per-turn-history trackers.
    let layoutShift;
    if (buf.readUInt32LE(i + 40) === i + 40 &&
        buf.readUInt32LE(i + 32) === 0 && buf.readUInt32LE(i + 36) === 0) {
      layoutShift = 0;
    } else if (i + 48 < buf.length && buf.readUInt32LE(i + 48) === i + 48 &&
               buf.readUInt32LE(i + 52) === 6) {
      // L3 needs sub==6 at +52 to disambiguate from L2 (which has self-ptr at +52).
      layoutShift = 8;
    } else if (i + 52 < buf.length && buf.readUInt32LE(i + 52) === i + 52) {
      layoutShift = 12;
    } else {
      continue;
    }
    const sub = buf.readUInt32LE(i + 44 + layoutShift);
    if (sub === 6) {
      // Two distinct sub=6 record formats exist per faction:
      //   Type A (the REAL treasury record): treasury at +0, factionId at
      //          a FIXED +99 (no region-count adjustment), and +48 holds a
      //          large "knowledge-size" count (e.g. 414, not the 25 regions
      //          Julii actually owns). Verified against user ground-truth:
      //          Julii=17500, Carthage=25500 — both match in-game values.
      //   Type B (the AI baseline record): treasury at +0 is the uniform
      //          5500 baseline (probably a difficulty modifier seed),
      //          factionId at midBase+99 (regions-shifted), +48 holds a
      //          small knowledge-size (~30). Used to be the only record
      //          the parser found, giving the bogus uniform 5500 treasury.
      // Heuristic: Type A has +48 > 200, Type B has +48 <= 200. We emit
      // BOTH per faction; caller (saveCracker) picks Type A's treasury via
      // dedup-by-factionId-prefer-larger-knowledge.
      const regions = buf.readUInt32LE(i + 48 + layoutShift);
      if (regions > 2000) continue;
      const regionStart = i + 52 + layoutShift;
      if (regionStart + 4 * regions + 200 > buf.length) continue;
      const treasury = buf.readInt32LE(i);
      let factionId, aiPersonalityIndex, midBase;
      if (regions > 200) {
        midBase = i;
        factionId = buf.readUInt8(i + 99);
        aiPersonalityIndex = null;
      } else {
        midBase = i + 92 + layoutShift + 4 * regions;
        factionId = buf.readUInt8(midBase + 99);
        aiPersonalityIndex = buf.readUInt8(midBase + 135);
      }
      const turnStart = buf.readInt32LE(midBase);
      const regionIds = [];
      for (let r = 0; r < regions; r += 1) regionIds.push(buf.readUInt32LE(regionStart + r * 4));
      out.push({
        offset: i,
        treasury,
        turnStartTreasury: turnStart,
        netThisTurn: treasury - turnStart,
        // DO NOT USE — faction's knowledge-size, NOT current owned regions.
        // Use saveOwnershipParser.resolveCurrentOwners + tally instead.
        knowledgeSize: regions,
        regionCount: null,
        regionIds,
        factionId,
        aiPersonalityIndex,
      });
    } else if (sub === 8) {
      // "Republic of Rome"-style layout (cracked 2026-05-24). Unlike the
      // imperial layout, there is ONE record per faction for EVERY faction
      // (incl. the player), stored in descr_sm_factions order. Current
      // treasury sits at +0 and the start-of-turn snapshot at +48. The
      // faction-id byte (at diploMarker-53) is a 1-based record counter
      // (== position+1), so the faction is the record's POSITION in this list.
      // Validated against a live save: record 0 = romans_julii (the player)
      // with the exact in-game treasury, faction_id==position+1 for all 220
      // markered records (0 mismatches), and 0 out-of-range treasuries / 239.
      const treasury = buf.readInt32LE(i);
      const turnStart = buf.readInt32LE(i + 48);
      const rc = buf.readUInt32LE(i + 52);
      out.push({
        offset: i,
        treasury,
        turnStartTreasury: turnStart,
        netThisTurn: treasury - turnStart,
        regionCount: rc <= 500 ? rc : 0,
        regionIds: [],
        factionId: out.length,   // record position == descr_sm_factions index
        aiPersonalityIndex: null,
      });
    }
  }
  return out;
}

// Per-faction TREASURY-OVER-TIME history. Cracked 2026-05-22 (session 175):
// before each class-100 faction record sits a self-pointer-framed economy-
// history table — `turnSerial` immutable blocks of 23 i32 (one appended per
// game turn), and block field index 13 (f13) is that turn's end-of-turn
// TREASURY checkpoint. NOTE: net income / income-expense breakdown are NOT in
// the save (proven) — only this per-turn treasury checkpoint timeline is.
// See memory reference_faction_econ_history_block + dig-econ-DECODE-SUMMARY.js.
//
// Returns { factionName: [treasury_turn0, treasury_turn1, ...] } (trailing 0 of
// the current incomplete turn dropped; factions with <2 points omitted).
//
// KEYING (fixed 2026-05-31): the history record's faction is its RECORD POSITION
// in `factionRecords`, indexed into `factionOrder` (descr_sm_factions order),
// NOT the record's `factionId` byte. On the imperial sub=6 layout (RIS julii
// saves) the `factionId` byte is shifted by one slot starting at the carthage
// record (roman_senate consumes the descr_sm slot but the byte read drifts) —
// so `factionOrder[r.factionId]` cross-wired every faction's series to the next
// faction's name (carthage's treasury timeline → "antigonid", etc). Validated
// against consecutive julii1/2/3 saves: the series that physically precedes the
// Nth record tracks the Nth faction's treasury timeline. The caller MUST pass
// the descr_sm_factions order (smOrder), NOT engineOrder — engineOrder rotates
// the first rebel slot to the end, which re-introduces a one-slot shift here.
// See docs/findings-treasury-history-keying-2026-05-31.md.
function findEconHistoryStart(buf, core) {
  // Walk backward from the faction record; the first u32 == its own offset
  // (self-pointer) is the econ-history object header.
  for (let off = core - 4; off >= core - 60000 && off >= 0; off -= 4) {
    if (buf.readUInt32LE(off) === off) return off;
  }
  return -1;
}
function parseFactionTreasuryHistory(buf, factionRecords, factionOrder) {
  if (!Array.isArray(factionRecords) || factionRecords.length === 0) return null;
  const S = 23, F13 = 13;
  const out = {};
  for (let idx = 0; idx < factionRecords.length; idx += 1) {
    const r = factionRecords[idx];
    const start = findEconHistoryStart(buf, r.offset);
    if (start < 0) continue;
    const f = [];
    for (let o = start; o + 4 <= r.offset; o += 4) f.push(buf.readInt32LE(o));
    // [0]=selfptr, [1]=turnSerial, then N×23 blocks, [last]=faction marker.
    const body = f.slice(2, f.length - 1);
    if (body.length < S || body.length % S !== 0) continue;
    const series = [];
    for (let b = 0; b < body.length / S; b++) series.push(body[b * S + F13]);
    // Only the FINAL entry is the unfinalized current turn (engine zeroes it
    // until end-of-turn). Stripping all trailing zeros nuked legitimately
    // broke factions ([..., 0, 0, 0] = three turns at 0 denari) — dropping
    // 156/236 factions on T1017. Pop one zero max.
    if (series.length && series[series.length - 1] === 0) series.pop();
    if (series.length < 2) continue;
    // Faction = RECORD POSITION (idx) → factionOrder, NOT r.factionId (the byte
    // is off-by-one on imperial sub=6 records — see header note).
    const name = (Array.isArray(factionOrder) && idx >= 0 && idx < factionOrder.length)
      ? factionOrder[idx] : null;
    if (!name) continue;
    out[name.toLowerCase()] = series;
  }
  return Object.keys(out).length ? out : null;
}

// Identify the PLAYER faction from the save alone, without needing
// descr_strat or user-supplied playerFaction state.
//
// Crack 2026-05-18: the player's faction record sits BEFORE all 23 NPC
// major-faction records in the save body. NPC records each embed at
// least one `captain_card_FACTIONNAME.tga` path inline for their
// captains. The player's record ALSO embeds its faction banner — but
// that's the only captain banner that appears BEFORE the first NPC
// record (offset of factionRecords[0]).
//
// So: any captain_card_X.tga path whose offset is < factionRecords[0].offset
// must belong to the player. If multiple such paths exist (unlikely), the
// dominant one wins.
//
// Returns the lowercase faction internal name (e.g. "antigonid",
// "romans_julii"), or null if not identifiable.
function identifyPlayerFactionFromSave(buf, factionRecords) {
  if (!factionRecords || factionRecords.length === 0) return null;
  const firstMajorOff = factionRecords[0].offset;
  const target = Buffer.from("captain_card_", "ascii");
  const counts = new Map();
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    if (p >= firstMajorOff) break; // banners are file-ordered; stop at first NPC record
    let end = p + target.length;
    while (end < p + 80 && buf[end] !== 0x2e /* . */ && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
    const name = buf.slice(p + target.length, end).toString("ascii");
    counts.set(name, (counts.get(name) || 0) + 1);
    p = end;
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

// Identify each major faction record's owning faction via the embedded
// `captain_card_FACTIONNAME.tga` paths. Each captain in a faction record
// has its faction's banner path stored inline, so the dominant banner
// faction = that record's owner.
//
// Crack 2026-05-18: validated on Macedon T0 RIS save. Records are NOT
// in player-first order — rec 0 in that save is `carthage`, not the
// player (`antigonid`). Previous App.js code assumed rec 0 == player
// which is wrong for RIS imperial saves.
//
// Returns array `[{ recordIndex, factionName | null, captainCount }, ...]`.
// `factionOrder` (optional): array of faction internal names in
// descr_sm_factions.txt declaration order. When supplied, each record's
// cracked `factionId` byte indexes directly into it — a reliable identity
// that works even for records with zero captain banners (13/23 in Macedon
// T0 RIS). The captain-banner heuristic is kept as a fallback (and a
// cross-check) for saves/mods where factionId is unavailable or out of
// range. Session 174 validated factionId 23/23 against descr_strat.
function identifyFactionRecordOwners(buf, factionRecords, factionOrder = null) {
  const out = [];
  const target = Buffer.from("captain_card_", "ascii");
  // Collect all captain_card_* positions
  const positions = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    let end = p + target.length;
    while (end < p + 80 && buf[end] !== 0x2e /* . */ && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
    const factionName = buf.slice(p + target.length, end).toString("ascii");
    positions.push({ at: p, name: factionName });
    p = end;
  }
  // Bucket by record
  const byRec = new Map();
  for (const pos of positions) {
    let recIdx = -1;
    for (let i = 0; i < factionRecords.length; i += 1) {
      const next = i + 1 < factionRecords.length ? factionRecords[i + 1].offset : buf.length;
      if (pos.at >= factionRecords[i].offset && pos.at < next) { recIdx = i; break; }
    }
    if (recIdx < 0) continue;
    if (!byRec.has(recIdx)) byRec.set(recIdx, new Map());
    const m = byRec.get(recIdx);
    m.set(pos.name, (m.get(pos.name) || 0) + 1);
  }
  // Assign faction per record. factionId (when in range) is authoritative;
  // captain banners fill the remainder and serve as a cross-check.
  for (let i = 0; i < factionRecords.length; i += 1) {
    const m = byRec.get(i);
    const bannerSorted = m && m.size > 0 ? [...m.entries()].sort((a, b) => b[1] - a[1]) : null;
    const bannerName = bannerSorted ? bannerSorted[0][0] : null;
    const captainCount = bannerSorted ? bannerSorted[0][1] : 0;
    const fid = factionRecords[i] ? factionRecords[i].factionId : null;
    const idName = (Array.isArray(factionOrder) && typeof fid === "number" && fid >= 0 && fid < factionOrder.length)
      ? factionOrder[fid]
      : null;
    out.push({
      recordIndex: i,
      // factionId wins; banner is the fallback.
      factionName: idName || bannerName || null,
      // Provenance so the UI / logs can tell how the record was identified.
      source: idName ? "factionId" : (bannerName ? "captainBanner" : "none"),
      factionId: typeof fid === "number" ? fid : null,
      bannerName: bannerName || null,
      captainCount,
    });
  }
  return out;
}

// Extract per-faction diplomatic relations. Each major faction record has
// a `05 00 24 39` marker at offset +(244 + 4 × regionCount), followed by
// `u32 count` and `count × 16-byte` entries. Each entry:
//   +0   u32 relationUuid   (globally unique counter — same UUID never
//                            appears in two different factions' lists)
//   +4   u32 class          (0 = ALLIED, 1 = ceasefire, 2 = WAR,
//                            4 = locked alliance — per session 108 memory)
//   +8   u32 attitudeTier   (0..4)
//   +12  u32 tag            (constant 0x00010101)
//
// LIMITATION: the entry does NOT contain the OTHER faction's identity.
// Memory session 108/109: the (factionA, factionB) → relation mapping
// requires an external lookup that hasn't been cracked yet.
function parseFactionDiplomacy(buf, factionRecords) {
  const DIPLO_MARKER = 0x39240005; // little-endian "05 00 24 39"
  const out = [];
  for (let i = 0; i < factionRecords.length; i += 1) {
    const r = factionRecords[i];
    const expectedOff = r.offset + 244 + 4 * r.regionCount;
    if (expectedOff + 8 > buf.length) { out.push({ relations: [] }); continue; }
    if (buf.readUInt32LE(expectedOff) !== DIPLO_MARKER) { out.push({ relations: [] }); continue; }
    const count = buf.readUInt32LE(expectedOff + 4);
    if (count > 200) { out.push({ relations: [] }); continue; }
    const relations = [];
    for (let k = 0; k < count; k += 1) {
      const o = expectedOff + 8 + k * 16;
      if (o + 16 > buf.length) break;
      relations.push({
        uuid: buf.readUInt32LE(o),
        class_: buf.readUInt32LE(o + 4),
        attitude: buf.readUInt32LE(o + 8),
        tag: buf.readUInt32LE(o + 12),
      });
    }
    out.push({ relations, markerOffset: expectedOff });
  }
  return out;
}

// 0.9.539: live diplomacy COUNTS for EVERY faction (not just the 23 majors).
// Cracked 2026-05-22: the save holds ~221 `0x39240005` diplomacy zones — one
// per active faction, including minor factions, the senate, and the player's
// own faction (all of which are absent from the 23 major class-100 records).
// The owning faction is identified by a single byte 53 bytes BEFORE the
// marker: `factionId = buf[markerOffset - 53]`, indexed into
// descr_sm_factions.txt declaration order (`factionOrder`). Verified: delta
// 53 is the ONLY offset reproducing all 23 known major factionIds while also
// resolving all ~197 minor zones to valid, distinct faction indices (both
// Seleucid and Macedon saves). The relation entry still does NOT name the
// partner faction (proven unrecoverable) — so this is COUNTS only.
//
// Returns { factionName: { wars, allies, ceasefires, locked, count } }.
// Skips markers with count>200 (false-positive byte sequences) and out-of-
// range factionIds. Keeps the highest-count zone per faction (dedup).
//
// ⚠️ 2026-05-22 CONTROLLED CRACK CORRECTION (do not trust the bucket NAMES below):
// The class enum has TWO encodings selected by the entry `tag` (+12), and this
// function wrongly counts both together with a single map. Validated semantics:
//   * PLAYER zone (tag=0): class 5=met-no-deal, 2=TRADE, 1=ALLIANCE,
//     4=LOCKED/protectorate; `attitude` is a meaningless placeholder (always 5).
//   * NPC zone (tag=0x00010101): class is a relation-RECORD-TYPE, NOT a stance;
//     the real mood is `attitude` 0..4 (0=ALLIED … 4=AT_WAR).
//   * WAR is NOT in the zones at all (it lives in the churned object graph), so
//     the `wars` bucket here is meaningless. Partner identity is unrecoverable.
// This output is intentionally UNSURFACED (0.9.544 shows mod-file named
// diplomacy only). Kept for structural tests. If you ever surface live data,
// rewrite per the encodings above — see memory project_diplomatic_relations.
function parseAllFactionDiplomacy(buf, factionOrder) {
  const MARKER = 0x39240005;
  const out = {};
  if (!Array.isArray(factionOrder) || factionOrder.length === 0) return out;
  for (let i = 53; i + 8 < buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    if (fid >= factionOrder.length) continue;
    const name = factionOrder[fid];
    if (!name) continue;
    let wars = 0, allies = 0, ceasefires = 0, locked = 0, neutral = 0;
    let ok = true;
    for (let k = 0; k < count; k += 1) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      const cls = buf.readUInt32LE(o + 4);
      if (cls === 2) wars++;
      else if (cls === 0) allies++;
      else if (cls === 1) ceasefires++;
      else if (cls === 4) locked++;
      else neutral++; // class 5 etc. — "known but neutral" padding (the
      // player's own zone lists every discovered faction this way; NPC
      // zones only list active relations). Not a meaningful stance.
    }
    if (!ok) continue;
    const lc = name.toLowerCase();
    // relationCount = MEANINGFUL relations only (war/ally/ceasefire/locked) —
    // excludes the neutral padding so the displayed total matches the chips.
    const active = wars + allies + ceasefires + locked;
    if (!out[lc] || out[lc].count < count) {
      out[lc] = { wars, allies, ceasefires, locked, neutral, count, relationCount: active };
    }
  }
  return out;
}

// ── Diplomacy attitude matrix (THE real diplomacy source) ───────────────────
//
// Cracked 2026-05-22. Unlike the per-faction 0x39240005 "zones" (which hold only
// positive agreement handles with no partner identity), the save contains a flat
// N×N faction-relationship ATTITUDE MATRIX. Cell (A,B) = faction A's stance
// toward faction B on the descr_strat scale:
//   0=ALLIED, 200=NEUTRAL, 400=HOSTILE, 600=AT_WAR, 850=TotalWar, 1000=Crazy.
// A,B index descr_sm_factions declaration order, so the matrix POSITION names the
// pair — partner identity IS recoverable here. The matrix is symmetric.
//
// Cell record (stride S varies per save — 267 RIS / 115 vanilla; locate
// dynamically): [u32 0][u32 key][u32 200 baseline][u32 attitude][u32 flag]...
// Stable invariants: +0==0, +4==key, +8==200. attitude(+12) & flag(+16) change
// live. See memory reference_diplomacy_matrix + scripts/save-cracker/dig-warhunt-*.
// Stance lookup. The +12 STATE field encodes the formal diplomatic relationship
// (== descr_strat faction_relationships): 0=allied(199), 200=neutral(200),
// 600=AT WAR(201). FULLY CRACKED & validated 2026-05-29 to 99.9% against clean
// Julii (idx 0) AND Carthage (idx 4) T1/T2/T3 replica saves — see memory
// provincia-diplomacy-matrix-cracked. NOTE: an earlier build (v0.9.732) wrongly
// reclassified 600 as "hostile, not war"; that was a misdiagnosis caused by the
// OLD locator reading mis-aligned cells. With the self-aligning locator below,
// 600=war is correct (Carthage T1 reads: at war only with slave, allied with
// gades/masaesyli/massylii — exactly in-game truth).
const DIPLO_STANCE = {
  0: "allied", 200: "neutral", 400: "hostile", 600: "war", 850: "war", 1000: "war",
};
function stanceOf(v) {
  if (v === 0) return "allied";
  if (v >= 600) return "war";        // 600 = at war (faction_relationships 201)
  if (v >= 400) return "hostile";    // 400 = transient hostility/drift, not a formal war
  return "neutral";                  // 200 neutral (and anything below 400)
}

// Engine placeholder / non-diplomatic factions whose attitude cells are
// meaningless engine defaults and must never appear in decoded diplomacy:
//   • slave / rebels  — the generic independent "Free Peoples"
//   • dummies         — RIS's bankrupt placeholder slot (-50000 denari, dies T2)
//   • *_rebels        — per-faction respawn markers (roman_rebels_1, seleucid_rebels2, …)
//   • italics         — RIS's territory-less Italic-rebel slot (ai_rome, not playable,
//                       owns 0 settlements); shows as a phantom "war" target with no
//                       faction on the map. Effectively Free Peoples. (2026-05-31)
// SINGLE SOURCE OF TRUTH — exported so the renderer uses the exact same rule
// (avoids each consumer filtering differently, which let `dummies` leak through).
const DIPLO_PLACEHOLDER_RE = /(_rebels|^slave$|^slaves$|^rebels$|^dummies$|^italics$)/;
function isDiplomaticFaction(name) {
  return !!name && !DIPLO_PLACEHOLDER_RE.test(String(name).toLowerCase());
}

// Locate the matrix AND self-align to its true (0,0) cell — crib-free.
// Cell signature (stride S: 267 RIS / 115 vanilla): +0==0, +4==key(const),
// +8==200, +16==2; the live fields are STATE(+12), bond(+20), agg(+24).
// Alignment: the STATE field is symmetric (war/ally are mutual) and non-neutral
// cells are sparse, so the TRUE offset maximizes symmetry(state(r,c)==state(c,r))
// AMONG non-200 cells (~100%); any wrong offset scrambles the (r,c)<->(c,r)
// pairing. This replaced the old `calibrateMatrixC` symmetry-over-all-cells,
// which was dominated by the ~95% neutral cells and locked the wrong offset
// (the root cause of the phantom-wars / wrong-ally bug). Validated 2026-05-29
// against Julii & Carthage T1/T2/T3 — see memory provincia-diplomacy-matrix-cracked.
// Returns {base, stride, key, C:0, symmetry} where base = cellStart(0,0)+8 so the
// existing +4/+12/+16 reader offsets are unchanged.
function locateDiplomacyMatrix(buf, N) {
  const sig = (o) => o >= 0 && o + 20 <= buf.length &&
    buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 8) === 200 && buf.readUInt32LE(o + 16) === 2;
  const stateAt = (base, stride, r, c) => {
    const o = base + (r * N + c) * stride + 12;
    return (o >= 0 && o + 4 <= buf.length) ? buf.readInt32LE(o) : null;
  };
  // Scan the WHOLE file (cracked 2026-05-31): the prior 0x800000 (8 MB) cap was
  // never the miss-cause (real matrices sit ~1.1 MB in, below the cap), but a
  // cap risks future late-matrix saves and gives no upside now that work is
  // bounded below. Keep a tail margin for the 20-byte cell read.
  const limit = buf.length - 64;
  // The per-candidate symmetry check is O(N²) per k-offset. On a normal save the
  // real matrix locks within a few candidates, but a Republic-of-Rome / RIS save
  // can present tens of thousands of matrix-LIKE byte regions (uniform-key zeroed
  // memory matching the 0/200/2 signature). Guards keep it bounded:
  //  (1) skip-ahead by `stride` past any region once its rough(0,0) is evaluated.
  //  (2) early-reject a k-alignment the moment accumulated mismatches make
  //      frac>=0.8 unreachable, so each bad candidate costs far less than a full
  //      O(N²) sweep — this lets the budget survive to reach the real matrix.
  //  (3) a global work budget: bail to null rather than hang.
  let work = 0;
  const WORK_BUDGET = 300_000_000; // ~a few seconds; normal saves lock in << this
  // CRACK 2026-05-31 (Raymond "Republic of Rome Turn 5"): the matrix's `key`
  // field (+4) is NOT constant across cells on every save. On clean imperial
  // saves (Julii/Macedon) every cell shares one key (10), but RR saves carry a
  // MIXED key column (cell(0,1)=10, then 14, plus a few 1/2) — see
  // findings-diplo-locator-2026-05-31. The OLD stride detector required an
  // N-run of SAME-key signature cells, so it never recognised the real matrix
  // (its cells aren't uniform-key) and instead matched uniform-key noise regions
  // elsewhere, exhausting the budget → null. FIX: detect stride from the cell
  // SIGNATURE run only (key-agnostic). The symmetry sweep is the real
  // discriminator. `key` is still returned (from the rough row's first cell) for
  // diagnostics, but is no longer a gate.
  const HALF_PAIRS = (N * (N - 1)) / 2;
  // The matrix's signature is NOT perfect across a full row: the diagonal cell
  // (faction-vs-itself) plus a handful of mixed-key/mixed-state cells fail sig.
  // On clean imperial saves the row is 239/239 sig; on RR saves (Raymond T5) it
  // is ~231/239 (8 gaps). Requiring a PERFECT N-run (old `run >= N`) therefore
  // missed the real RR matrix entirely. Accept a near-complete strided run
  // instead (>=90% of N cells pass sig over N steps) — high enough that random
  // byte regions can't fake it, tolerant of the genuine per-row gaps.
  const MIN_RUN = Math.ceil(N * 0.9);
  for (let p = 0x4000; p < limit; p++) {
    if (!sig(p)) continue;
    // detect stride: smallest s giving a near-complete strided run of signature
    // cells over N steps (key-agnostic; gap-tolerant — see crack notes above).
    let stride = 0;
    for (let s = 80; s <= 400; s++) {
      if (p + s + 20 > buf.length) break;
      if (!sig(p + s)) continue;
      let run = 0;
      for (let k = 0; k < N; k++) { if (sig(p + k * s)) run++; }
      if (run >= MIN_RUN) { stride = s; break; }
    }
    if (!stride) continue;
    // rough (0,0): walk back over contiguous signature cells. NOTE the true
    // diagonal cell(0,0) does NOT pass sig (+0 is a self-pointer 0x01000001, not
    // 0) on real matrices, so the walk-back stops one cell late — the k-sweep
    // below corrects that off-by-one alignment.
    let rough = p;
    while (sig(rough - stride)) rough -= stride;
    const key = buf.readUInt32LE(rough + 4);
    // self-align via non-neutral STATE symmetry
    let best = { frac: -1, base: rough, k: 0 };
    for (let k = -40; k <= 40; k++) {
      const base = rough + k * stride;
      let sym = 0, tot = 0;
      // Early-reject budget: once mismatches exceed 20% of the *maximum possible*
      // pairs (HALF_PAIRS), this alignment can never reach frac>=0.8, so stop.
      const maxMis = Math.floor(HALF_PAIRS * 0.2);
      let mis = 0, evald = 0;
      let bailed = false;
      for (let r = 0; r < N && !bailed; r++) for (let c = r + 1; c < N; c++) {
        const a = stateAt(base, stride, r, c), b = stateAt(base, stride, c, r);
        evald++;
        if (a == null || b == null) continue;
        if (a !== 200 || b !== 200) { tot++; if (a === b) sym++; else if (++mis > maxMis) { bailed = true; break; } }
      }
      work += evald;
      const frac = bailed ? 0 : (tot ? sym / tot : 0);
      if (frac > best.frac || (frac === best.frac && Math.abs(k) < Math.abs(best.k))) best = { frac, base, k };
      if (best.frac >= 0.999) break; // a real matrix locks at ~100% — stop sweeping
    }
    // a real matrix locks at ~100% symmetry; reject false-positive regions
    if (best.frac >= 0.8) return { base: best.base + 8, stride, key, C: 0, symmetry: best.frac };
    if (work > WORK_BUDGET) return null; // bounded: don't hang on matrix-like noise
    p += stride; // rejected: skip this candidate region instead of re-evaluating every byte
  }
  return null;
}

// Parse the full diplomacy attitude matrix into per-faction named stance lists.
// Returns { factionName: { war:[names], allied:[names], hostile:[names] },
//   _meta:{base,stride,key,C,N,symmetry,warPairs} } or null if not found.
// `factionOrder` = descr_sm_factions declaration order (modFactionOrder).
function parseDiplomacyMatrix(buf, factionOrder) {
  if (!Array.isArray(factionOrder) || factionOrder.length < 2) return null;
  const N = factionOrder.length;
  const m = locateDiplomacyMatrix(buf, N);
  if (!m) return null;
  // locateDiplomacyMatrix returns the TRUE (0,0) base, self-aligned via
  // non-neutral STATE symmetry (m.C is 0). m.symmetry ~1.0 on a real lock.
  const cal = { C: m.C, symmetry: m.symmetry };
  // Per-cell reader. m.base = cellStart+8, so reader-offset X == cell-offset X+8.
  // DEEP-DECODE 2026-05-31 (probes/diplo-deep) — full per-pair field map:
  //   cell+12 STATE  0 allied / 200 neutral / 600 war   (reader +4)
  //   cell+20 BOND   6 none / 54 ally-or-client / 55 SUZERAIN  (reader +12)
  //          → 54/54 symmetric = plain alliance; 54/55 ASYMMETRIC = PROTECTORATE
  //            (the 55-holder is the suzerain, the 54-holder the client state).
  //            rel199 + bond6 = trade-rights/non-aggression pact (no military bond).
  //   cell+24 AGG    aggression, signed; live-drifts (reader +16)
  //   cell+32 TURNS-ALLIED  per-pair counter, +1/turn while allied   (reader +24)
  //   cell+36 TURNS-AT-WAR  per-pair counter, +1/turn while at war    (reader +28)
  //   cell+68 TURNS-IN-STATE generic relationship-age counter         (reader +60)
  // No per-pair tribute/ceasefire-timer in the cell (proven negative). +4/+60/+76/
  // +84/+256.. are GLOBAL turn-stamps replicated identically in every cell (NOT
  // relation data). See probes/diplo-deep/FINDINGS.txt.
  const cellAt = (A, B) => {
    const o = m.base + (A * N + B + m.C) * m.stride;
    if (o < 0 || o + 64 > buf.length) return null;
    return {
      att: buf.readUInt32LE(o + 4), bond: buf.readUInt32LE(o + 12), agg: buf.readInt32LE(o + 16),
      turnsAllied: buf.readUInt32LE(o + 24), turnsAtWar: buf.readUInt32LE(o + 28),
      turnsInState: buf.readUInt32LE(o + 60),
    };
  };
  const out = {};
  let warPairs = 0;
  for (let A = 0; A < N; A++) {
    const name = factionOrder[A];
    if (!name || !isDiplomaticFaction(name)) continue; // skip placeholder rows
    // `rel` carries the RAW numbers for every non-neutral cell — consumed by
    // the dev-mode "raw diplomacy numbers" view (right-click the widget).
    const rec = { war: [], allied: [], hostile: [], trade: [], protectorates: [], suzerains: [], rel: [] };
    for (let B = 0; B < N; B++) {
      if (B === A) continue;
      const bName = factionOrder[B];
      const c = cellAt(A, B);
      if (c == null) continue;
      const v = c.att;
      const s = stanceOf(v);
      // WAR is GROUND TRUTH regardless of partner: the game shows the player at
      // war with rebel/emergent/slave factions (roman_rebels_1→"House of Aemilii",
      // roman_rebels_2→"House of Cornelii", slave/italics→"Free Peoples"), so a
      // war cell against a placeholder column is a REAL war and must NOT be
      // dropped (2026-05-31 — was hidden by `isDiplomaticFaction` column-skip,
      // which made the player's live war list empty while the game showed 3 wars).
      // The display side (RegionInfo) folds slave/*_rebels → game labels.
      if (s === "war") { rec.war.push(bName); warPairs++; continue; }
      // ALLIED / HOSTILE / TRADE / PROTECTORATE against a placeholder column are
      // meaningless engine-default cells (e.g. the old Free-Peoples "92 allies"
      // bug — slave's raw row decodes as Allied toward everyone). Keep skipping
      // placeholders for the NON-war relations only.
      if (!isDiplomaticFaction(bName)) continue;
      if (s === "allied") rec.allied.push(bName);
      else if (s === "hostile") rec.hostile.push(bName);
      // Military bond at cell +20 (reader bond): 6=none, 54=ally-or-client side,
      // 55=SUZERAIN side. DEEP-DECODE 2026-05-31 (probes/diplo-deep): a 54/55
      // ASYMMETRIC pair is a PROTECTORATE — the 55-holder is the suzerain, the
      // 54-holder its client. 54/54 symmetric = plain alliance. cellAt(A,B) is A's
      // view toward B, so A holding 55 ⇒ A is B's suzerain (B is A's protectorate).
      if (c.bond >= 54) rec.trade.push(bName);       // any military bond (ally|protectorate)
      // Protectorate orientation in THIS reader (verified via makeDiplomacyPairReader):
      // cellAt(A,B).bond===55 means A is the CLIENT and B is A's SUZERAIN
      // (reader(gades,carthage)=55, reader(samnites,romans_julii)=55). So:
      //   A holds 55 ⇒ B is A's suzerain (A is B's protectorate)
      //   A holds 54 with B holding 55 ⇒ B is A's protectorate
      //   54/54 symmetric ⇒ plain alliance (no protectorate either way)
      if (c.bond === 55) rec.suzerains.push(bName); // B is A's suzerain
      else if (c.bond === 54) {
        const back = cellAt(B, A);
        if (back && back.bond === 55) rec.protectorates.push(bName); // B is A's protectorate
      }
      if (v !== 200 || c.bond !== 6) rec.rel.push({ to: bName, att: v, bond: c.bond, agg: c.agg, turnsAllied: c.turnsAllied, turnsAtWar: c.turnsAtWar });
    }
    out[name.toLowerCase()] = rec;
  }
  out._meta = { base: m.base, stride: m.stride, key: m.key, C: m.C, N, symmetry: cal.symmetry, warPairs: warPairs / 2 };
  // Diagnostic: how many wars decoded incl. rebel/slave placeholders (the wars
  // the game DOES show). Logged once per parse so "empty war list" reports are
  // debuggable from provincia.log. [diplo] tag matches the [live-init] style.
  try {
    const realRows = Object.keys(out).filter((k) => k !== "_meta");
    const withWars = realRows.filter((k) => out[k].war && out[k].war.length).length;
    const sample = realRows.find((k) => out[k].war && out[k].war.length);
    // eslint-disable-next-line no-console
    console.log(`[diplo] matrix decoded: N=${N} stride=${m.stride} symmetry=${cal.symmetry?.toFixed?.(3)} warPairs=${(warPairs / 2)} factionsWithWars=${withWars}${sample ? ` e.g. ${sample}→[${out[sample].war.join(", ")}]` : ""}`);
  } catch { /* logging must never break the parse */ }
  return out;
}

// Raw per-pair matrix access for round-trip emit. Returns
// `(factionA, factionB) => {att, bond, agg} | null`. Looks up by NAME and
// resolves to the matrix indices via `factionOrder` (must be the same
// engine order passed to parseDiplomacyMatrix). Returns null if either
// faction is unknown or the matrix can't be located.
function makeDiplomacyPairReader(buf, factionOrder) {
  if (!Array.isArray(factionOrder) || factionOrder.length < 2) return null;
  const N = factionOrder.length;
  const m = locateDiplomacyMatrix(buf, N);
  if (!m) return null;
  // m.base/m.C already self-aligned to the true (0,0) by locateDiplomacyMatrix.
  const nameToIdx = new Map();
  for (let i = 0; i < N; i++) nameToIdx.set(factionOrder[i].toLowerCase(), i);
  return (factionA, factionB) => {
    const A = nameToIdx.get(String(factionA).toLowerCase());
    const B = nameToIdx.get(String(factionB).toLowerCase());
    if (A == null || B == null) return null;
    const o = m.base + (A * N + B + m.C) * m.stride;
    if (o < 0 || o + 20 > buf.length) return null;
    return {
      att:  buf.readUInt32LE(o + 4),
      bond: buf.readUInt32LE(o + 12),
      agg:  buf.readInt32LE(o + 16),
    };
  };
}

// Walk all region records in the save. Signature found 2026-05-18:
// region records have paired self-pointers 8 bytes apart, with a region
// UUID between them and the engine's numeric region ID at +12.
//
//   +0   u32  self_ptr_A == record_offset
//   +4   u32  region_uuid
//   +8   u32  self_ptr_B == record_offset + 8
//   +12  u32  region_id     (matches parseFactionTreasuries.regionIds)
//   +16  ...  per-region data
//
// Returns an array of `{offset, regionUuid, regionId}` per region record.
function findRegionRecords(buf) {
  const out = [];
  for (let off = 0x3000; off + 16 < buf.length; off += 4) {
    if (buf.readUInt32LE(off) !== off) continue;
    if (buf.readUInt32LE(off + 8) !== off + 8) continue;
    out.push({
      offset: off,
      regionUuid: buf.readUInt32LE(off + 4),
      regionId: buf.readUInt32LE(off + 12),
    });
  }
  return out;
}

// Read the +288 / +292 map coordinates from each character's extended
// record. Useful for bridging save data ↔ descr_strat data (descr_strat
// character lines have explicit x,y; the extended record stores the same
// values). Resolves 134/143 chars on Macedon T0 vanilla save.
function attachMapCoords(buf, characters) {
  // The back-reference lives in the portrait pool, which starts ~0x1500000
  // in Macedon T0 RIS. Hardcoded constant — calibrated for the only
  // observed RIS save layout. Smaller (vanilla) saves end before this
  // offset, so they just produce 0 attached coords (which is fine because
  // parseCharacterExtras finds 0 chars in vanilla saves anyway).
  //
  // 2026-05-20 crack note: the values read at +288/+292 are SCRAMBLED —
  // they're not actually the character's tile coords (proven via
  // scripts/save-cracker/dig-true-char-coords.js). The REAL coord table
  // is at ~0x1517fb1+ with 354-byte stride and secondaryUuid at +0 (which
  // does NOT match cracker.bodyguardUuid, so we can't bridge here). The
  // family tree's coord lookup is therefore fixed in main.js's calibrate
  // by building v1PortraitsByCoord directly from v1.tileX/tileY +
  // v1.portraits, bypassing this scrambled assignment.
  for (const c of characters) {
    if (!c.ownUuid) continue;
    const ownBytes = Buffer.alloc(4);
    ownBytes.writeUInt32LE(c.ownUuid);
    const ref = buf.indexOf(ownBytes, 0x1500000);
    if (ref < 0 || ref >= c.offset) continue;
    if (ref + 296 > buf.length) continue;
    c.extX = buf.readUInt32LE(ref + 288);
    c.extY = buf.readUInt32LE(ref + 292);
  }
}

// Crack 2026-05-19: parseCharacterExtras (role-anchored, 421 chars in
// Macedon T0 RIS) doesn't read traits/ancillaries — the post-role layout
// doesn't match the v1 character record format. But v1 parser DOES find
// these characters at totally different offsets (UUID namespaces differ).
//
// The reliable bridge is the (x, y) map tile: v1 attaches tileX/tileY via
// `buildPositionIndex` after parsing, and parseCharacterExtras attaches
// extX/extY via attachMapCoords. A character can't share a tile with
// another, so coord match → same character.
//
// This function mutates `extChars` in place, attaching `traits`,
// `ancillaries`, `firstName`, `lastName`, `traitCount`, `traitNames`
// (humanized) for the right-click character info panel. On Macedon T0 RIS
// the bridge hits ~241/421 chars; the rest didn't have a tile-coord match
// (typically v1 missed them OR they're stacked on the same tile as
// another char and lost the coord-key collision).
function bridgeV1Traits(extChars, v1Chars, ancillaryNames) {
  if (!Array.isArray(extChars) || !Array.isArray(v1Chars)) return 0;
  const v1ByCoord = new Map();
  for (const v of v1Chars) {
    if (v.tileX == null || v.tileY == null) continue;
    // Last write wins; we don't have a discriminator for tile-collisions yet.
    v1ByCoord.set(`${v.tileX},${v.tileY}`, v);
  }
  let bridged = 0;
  for (const c of extChars) {
    if (c.extX == null || c.extY == null) continue;
    const v = v1ByCoord.get(`${c.extX},${c.extY}`);
    if (!v) continue;
    // Don't overwrite existing fields the ext parser already set
    // (ownUuid, age, region etc); add the v1-only fields.
    if (!c.firstName && v.firstName) c.firstName = v.firstName;
    if (!c.lastName && v.lastName) c.lastName = v.lastName;
    if (v.traits) c.traits = v.traits;
    if (v.ancillaries) {
      // v1 parser stores ancillaries as `{id}` only — resolve names from
      // the mod's export_descr_ancillaries.txt (passed in as ancillaryNames).
      // 0.9.418: without this, InfoPopup showed "#undefined" because
      // main.js's name-resolution pass only touched charactersByRegion,
      // not the raw v1 chars we bridge from.
      c.ancillaries = v.ancillaries.map((a) => ({
        id: a.id,
        name: ancillaryNames && ancillaryNames[a.id] ? ancillaryNames[a.id] : (a.name || `#${a.id}`),
      }));
    }
    if (v.traits) c.traitCount = v.traits.length;
    if (v.clanHead) c.clanHead = v.clanHead;
    if (v.primaryUuid) c.primaryUuid = v.primaryUuid;
    if (v.childUuids) c.childUuids = v.childUuids;
    // 0.9.420: character stats — command/influence/management/loyalty
    if (typeof v.command === "number") c.command = v.command;
    if (typeof v.influence === "number") c.influence = v.influence;
    if (typeof v.management === "number") c.management = v.management;
    if (typeof v.loyalty === "number") c.loyalty = v.loyalty;
    // Mark provenance for debugging / UI hints
    c._v1Bridged = true;
    bridged += 1;
  }
  return bridged;
}

// Crack 2026-05-18: each character's portrait is identified by a u32
// portrait UUID stored at offset +280 of the character's 354-byte extended
// record (located by the first back-ref of own_uuid in the portrait pool
// section, before the role string). The portrait pool entries embed pstr16
// portrait paths with their UUID 72–74 bytes AFTER each pstr16 start.
//
// Validated on Macedon T0 vanilla save: 103/109 greek generals resolved to
// unique portrait paths.
function resolvePortraitsByCharacter(buf, characters) {
  // 0.9.452 rewrite: ported from `scripts/save-cracker/dig-portrait-CRACKED.js`
  // For each character, find ALL occurrences of their portrait UUID in the
  // buffer, then for each find a pstr16 portrait-path that STARTS within
  // ~100 bytes BEFORE the UUID. First hit wins. Tighter than the previous
  // 64-byte forward-sweep + global UUID index: that bridged most chars to
  // wrong pairs because the sweep window picked up false-positive u32s.
  //
  // The pool layout (per cracker memo): each entry has a portraits pstr16
  // path followed shortly by the u32 portrait_uuid prefix. The crack found
  // the portrait pstr16 sits 72-74 bytes BEFORE the uuid occurrence.
  //
  // For each char's +280 portrait_uuid lookup, we materialise the pair
  // (cards path + fulls path) by also scanning forward for the matching
  // /portraits/ variant of the /cards/ entry we found.

  // Step 1: build cards → fulls pairing across the whole buffer once so
  // we can hand back both paths per char. Cards always precedes its fulls.
  const fullsByCards = new Map(); // cards path → fulls path
  {
    let lastCards = null;
    for (let i = 0x1000; i + 200 < buf.length; i++) {
      const len = buf.readUInt16LE(i);
      if (len < 8 || len > 200) { continue; }
      let s = "", ok = true;
      for (let k = 0; k < len - 1; k++) {
        const b = buf[i + 2 + k];
        if (b < 0x20 || b > 0x7e) { ok = false; break; }
        s += String.fromCharCode(b);
      }
      if (!ok || buf[i + 2 + len - 1] !== 0) { continue; }
      if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) { continue; }
      if (s.includes("/cards/")) {
        lastCards = s;
      } else if (lastCards) {
        if (!fullsByCards.has(lastCards)) fullsByCards.set(lastCards, s);
        lastCards = null;
      }
      i += 1 + len;
    }
  }

  // Step 2: index every pstr16 portrait path by its END offset. Lets the
  // per-char back-scan be a single map lookup instead of byte-walking back
  // 100 bytes for every UUID hit.
  const pstrEndOffsets = new Map(); // pstrEndOffset → { s, startOffset }
  for (let i = 0x1000; i + 200 < buf.length; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 8 || len > 200) continue;
    if (buf[i + 2 + len - 1] !== 0) continue;
    let ok = true;
    for (let k = 0; k < len - 1; k++) {
      const b = buf[i + 2 + k];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    const s = buf.slice(i + 2, i + 2 + len - 1).toString("latin1");
    if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) continue;
    pstrEndOffsets.set(i + 2 + len, { s, startOffset: i });
    i += 1 + len;
  }

  // Step 3: for each unique portrait UUID we'll need to resolve, find the
  // closest preceding portrait path (within 100 bytes back). Memoised so
  // identical UUIDs across chars only resolve once.
  const portraitByUuid = new Map();
  function resolveUuid(portraitUuid) {
    if (portraitByUuid.has(portraitUuid)) return portraitByUuid.get(portraitUuid);
    const target = Buffer.alloc(4);
    target.writeUInt32LE(portraitUuid);
    let p = 0;
    while ((p = buf.indexOf(target, p)) !== -1) {
      // Look backwards up to 100 bytes for a pstr16 ending at offset
      // <= p (the UUID sits AFTER the pstr16 terminator).
      for (let end = p; end >= Math.max(0, p - 100); end--) {
        const hit = pstrEndOffsets.get(end);
        if (hit && hit.s.includes("/portraits/")) {
          // We've found the "fulls" or "cards" path that precedes this
          // UUID. The pool layout puts /portraits/ (fulls) right before
          // the UUID; the corresponding /cards/ path precedes that.
          // Map fulls → cards if we have it (try both directions).
          let cards = null, fulls = null;
          if (hit.s.includes("/cards/")) {
            cards = hit.s;
            fulls = fullsByCards.get(hit.s) || null;
          } else {
            fulls = hit.s;
            // Reverse lookup: scan fullsByCards for an entry whose
            // value matches `fulls`.
            for (const [c, f] of fullsByCards) {
              if (f === fulls) { cards = c; break; }
            }
          }
          const entry = { cards, fulls };
          portraitByUuid.set(portraitUuid, entry);
          return entry;
        }
      }
      p += 1;
    }
    portraitByUuid.set(portraitUuid, null);
    return null;
  }

  // For each character, locate their extended record and read +280, then
  // resolve the portrait UUID via the back-scan helper. Unresolved chars
  // get NO cached portrait — renderer falls back to its hash-pool pick.
  const byOwnUuid = new Map();
  let resolved = 0;
  let unresolved = 0;
  for (const c of characters) {
    if (!c.ownUuid) continue;
    const ownBytes = Buffer.alloc(4);
    ownBytes.writeUInt32LE(c.ownUuid);
    const ref = buf.indexOf(ownBytes, 0x1500000);
    if (ref < 0 || ref >= c.offset) continue;
    if (ref + 284 > buf.length) continue;
    const portraitUuid = buf.readUInt32LE(ref + 280);
    if (portraitUuid === 0 || portraitUuid === 0xffffffff) continue;
    const portrait = resolveUuid(portraitUuid);
    if (portrait && portrait.cards) {
      byOwnUuid.set(c.ownUuid, {
        portraitUuid,
        cards: portrait.cards,
        fulls: portrait.fulls,
      });
      resolved++;
    } else {
      // 0.9.452: no seed-modulo fallback. The previous fallback wrote a
      // path derived from `portraitUuid % poolSize` but that's a different
      // deterministic function from RTW's actual engine pick, so chars
      // that fell into the fallback got a wrong portrait. Let the
      // renderer's hash fallback handle it (matches engine for chars
      // without explicit portrait_index).
      unresolved++;
    }
  }
  if (typeof console !== "undefined" && console.log) {
    console.log(`[resolvePortraitsByCharacter] resolved=${resolved} unresolved=${unresolved} (out of ${characters.length} chars, ${pstrEndOffsets.size} portrait pstrs indexed)`);
  }
  return byOwnUuid;
}

// Build family tree maps. Provincia's existing v1 parser already produces
// father_uuid; combine with our spouse_uuid to expose parent/spouse/children.
//
// Args: characters (from parseCharacterExtras), v1Chars (from existing
// characterParser.js if available).
//
// Returns:
//   byUuid:       Map(ownUuid → character)
//   spouseOf:     Map(uuid → spouseUuid)
//   childrenOf:   Map(parentUuid → [childUuid, ...])
function buildFamilyTreeMaps(characters, v1Chars) {
  const byUuid = new Map();
  for (const c of characters) byUuid.set(c.ownUuid, c);
  const spouseOf = new Map();
  for (const c of characters) {
    if (c.isMarried) spouseOf.set(c.ownUuid, c.spouseUuid);
  }
  const childrenOf = new Map();
  if (v1Chars && Array.isArray(v1Chars)) {
    for (const c of v1Chars) {
      const father = c.fatherUuid;
      if (!father || father === 0xffffffff) continue;
      if (!childrenOf.has(father)) childrenOf.set(father, []);
      childrenOf.get(father).push(c.primaryUuid || c.ownUuid || c.uuid);
    }
  }
  return { byUuid, spouseOf, childrenOf };
}

// ── Per-soldier stats ───────────────────────────────────────────────────────

// Decode soldier records of a unit. Each soldier is 9 bytes:
//   +0  u8 weapon_lvl (encoded as level × 4; 0x04 = +1, 0x08 = +2, 0x0c = +3)
//   +1  u8 (zeros for fresh recruits — possibly secondary stat)
//   +2  u8 (zeros — possibly experience or HP)
//   +3  u8 (zeros)
//   +4  u8 (zeros — possibly hit-points-lost or status)
//   +5..+8  4 bytes soldier UUID (varies per soldier)
//
// Returns array of soldier objects + aggregate display weapon level.
function parseSoldierArray(buf, arrayStart, maxSoldiers = 240) {
  const soldiers = [];
  let weaponSum = 0;
  for (let i = 0; i < maxSoldiers; i++) {
    const off = arrayStart + i * 9;
    if (off + 9 > buf.length) break;
    const w = buf[off];
    // Stop at the first record where bytes 0..4 are all 0xff (padding/end)
    if (w === 0xff && buf[off + 1] === 0xff && buf[off + 4] === 0xff) break;
    soldiers.push({
      weaponLvl: Math.floor(w / 4),
      rawWeaponByte: w,
      uuid: buf.readUInt32LE(off + 5),
    });
    weaponSum += Math.floor(w / 4);
  }
  return {
    count: soldiers.length,
    soldiers,
    avgWeaponLvl: soldiers.length > 0 ? weaponSum / soldiers.length : 0,
  };
}

// Read the 3 unit-level stat aggregate slots that precede the soldier array.
// Each slot is 14 bytes with pattern `01 00 40 00 XX 00 00 00 00 00 00 00 00 00`
// where XX (byte +4) holds the level (× 4 encoding).
//
// Three slots in order are probably weapon / armor / experience aggregates,
// but the exact mapping isn't fully validated.
function parseUnitStatSlots(buf, slotsStart) {
  if (slotsStart + 42 > buf.length) return null;
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const off = slotsStart + i * 14;
    if (buf[off] !== 0x01 || buf[off + 1] !== 0x00 || buf[off + 2] !== 0x40 || buf[off + 3] !== 0x00) {
      return null; // pattern mismatch
    }
    slots.push({
      raw: buf[off + 4],
      level: Math.floor(buf[off + 4] / 4),
    });
  }
  return { slots, weapon: slots[0], armor: slots[1], experience: slots[2] };
}

// ── Religion percentages per settlement ────────────────────────────────────
//
// Each settlement record contains a 6-byte block of religion-share percentages
// (one byte per religion in descr_religions). Values are 0..100 and sum to
// approximately 95..105 (rounding). The offset relative to the settlement
// name position VARIES per settlement (observed +137 / +139 / +152 across
// the cracking session); the values themselves never exceed 100 and the
// row-sum is the reliable signature.
//
// scanReligionForSettlement walks a small window forward from the name
// position looking for a 6-byte run that:
//   1. Has each byte in [0, 100]
//   2. Sums to within [90, 110]
//   3. Contains at least 2 non-zero entries (rules out dominant-100 outliers)
// Returns the first matching block plus its dx for reproducibility.
function scanReligionForSettlement(buf, namePos, windowSize = 200) {
  for (let dx = 0; dx < windowSize; dx++) {
    const off = namePos + dx;
    if (off + 6 > buf.length) break;
    let sum = 0, nonZero = 0, ok = true;
    for (let i = 0; i < 6; i++) {
      const b = buf[off + i];
      if (b > 100) { ok = false; break; }
      sum += b;
      if (b > 0) nonZero++;
    }
    if (!ok) continue;
    if (sum < 90 || sum > 110) continue;
    if (nonZero < 2) continue;
    return { dx, sum, bytes: Array.from(buf.slice(off, off + 6)) };
  }
  return null;
}

// Parse religion for every settlement marker passed in.
// Returns Map<settlementName, { dx, sum, bytes }>.
function parseReligionByCity(buf, settlementMarkers) {
  const out = {};
  if (!Array.isArray(settlementMarkers)) return out;
  for (const s of settlementMarkers) {
    const namePos = s.offset + 1;
    const r = scanReligionForSettlement(buf, namePos);
    if (r) out[s.name] = r;
  }
  return out;
}

// Derive the ENGINE's faction-index order from the descr_sm_factions order.
// Cracked 2026-05-24 (Republic of Rome / +44==8 layout): the engine enumerates
// factions as descr_sm_factions order with the descr-index-1 faction (the first
// rebel slot, e.g. roman_rebels_1) MOVED TO THE END — i.e. engine[i]=descr[i+1]
// for 1<=i<=N-2 and engine[N-1]=descr[1]. The treasury class-100 records AND the
// diplomacy attitude-matrix rows both iterate in this engine order, so naming
// them with raw descr order mislabels every faction past index 0 by one slot
// (live "at war" showed Megalopolis instead of Messapians; non-player treasuries
// were wrong too). VALIDATED: with this order, Rome's matrix war resolves to
// "messapians" (engine 156), slave lands at engine 237 (221 wars). See memory
// engine-faction-order-permutation. Guarded: only rotates when descr index 1
// looks like a rebel slot (matches the verified pattern), so a roster that
// doesn't follow it falls back to descr order unchanged.
function deriveEngineFactionOrder(descrOrder) {
  if (!Array.isArray(descrOrder) || descrOrder.length < 3) return descrOrder;
  if (!/rebel/i.test(String(descrOrder[1] || ""))) return descrOrder;
  return [descrOrder[0], ...descrOrder.slice(2), descrOrder[1]];
}

// Count engine CHARACTER records in the save. Cracked 2026-05-26 by the
// save-cracker agent: every live character (named generals/captains plus
// in-place dead-this-turn entries still in the active CHARACTER block) has a
// self-pointer header. The record sits at offset `i` where:
//   buf[i-8..i-5]   == 1    (record-type marker)
//   buf[i-4..i-1]   == 0    (padding)
//   buf[i..i+3]     == i    (self-pointer — the record's own file offset)
//   buf[i+8..i+11]  == i+8  (next-record self-pointer, +8 ahead)
// All four checks must hold simultaneously, which is what makes the signature
// reliable on a 70 MB buffer. Validated against the dev's engine reference of
// 2,197 on `Dummies Turn 960 Start.sav` (this scan returns 2,114 — within the
// 3.8% noise floor of the verified ground truth). Walks every byte: ~350ms on
// a 70 MB save, so this is a snapshot-time call, not a render-time call.
function countEngineCharacters(buf) {
  if (!buf || typeof buf.length !== "number" || buf.length < 16) return 0;
  let count = 0;
  const end = buf.length - 12;
  for (let i = 8; i < end; i++) {
    if (buf.readUInt32LE(i) !== i) continue;
    if (buf.readUInt32LE(i - 8) !== 1) continue;
    if (buf.readUInt32LE(i - 4) !== 0) continue;
    if (buf.readUInt32LE(i + 8) !== i + 8) continue;
    count++;
  }
  return count;
}

module.exports = {
  parseHeader,
  parseFactionDiscoveredBitmask,
  parseFactionConfigRecords,
  parseModInfo,
  parseCharacterExtras,
  attachMapCoords,
  bridgeV1Traits,
  resolvePortraitsByCharacter,
  parseFactionTreasuries,
  parseFactionTreasuryHistory,
  identifyFactionRecordOwners,
  identifyPlayerFactionFromSave,
  parseFactionDiplomacy,
  parseAllFactionDiplomacy,
  parseDiplomacyMatrix,
  makeDiplomacyPairReader,
  isDiplomaticFaction,
  findRegionRecords,
  buildFamilyTreeMaps,
  parseSoldierArray,
  parseUnitStatSlots,
  scanReligionForSettlement,
  parseReligionByCity,
  deriveEngineFactionOrder,
  countEngineCharacters,
};
