// src/characterParser.js
//
// Character record parser for Rome: Total War Remastered save files.
// Decodes names, age, traits, portraits, family tree from .sav binary data.
//
// Discovery summary (full details in calibration/PROGRESS_LOG.md):
//   - Character records contain name indices into descr_names_lookup.txt.
//   - Age is encoded as `242 - byte[+26]`.
//   - Traits are stored at offset +308 as a list of
//     `[uint32 trait_id, uint16 level, uint16 _]` pairs, count at +302.
//   - Portrait paths follow the trait list as length-prefixed ASCII.
//   - Father UUID at +46 links to parent's record.
//
// This module works on a Buffer. It assumes the mod's
// `descr_names_lookup.txt` and `export_descr_character_traits.txt` are
// pre-loaded and passed in as arrays (index → name).

// Walk the 354-byte coord/state record table to extract every bodyguard
// uuid in the save. Records have layout: +0 secondaryUuid, +8 x, +12 y,
// +16 fractional marker (low 16 bits == 0x7fff for land AND naval — naval
// chars have high bit set at +18 marking "is_at_sea"). This index is the
// authoritative set of valid character bodyguard uuids; we use it to gate
// tc=0 admiral records (which have no trait-list anchor for the main scan).
function buildSecUuidIndex(buf) {
  const set = new Set();
  // The coord table sits in the upper half of the save. Byte-by-byte
  // scan is ~80ms on a 32 MB save — acceptable for a one-shot pass.
  const start = Math.max(0, Math.floor(buf.length / 2));
  for (let p = start; p + 20 < buf.length; p += 1) {
    if (buf.readUInt16LE(p + 16) !== 0x7fff) continue;
    const x = buf.readUInt32LE(p + 8);
    const y = buf.readUInt32LE(p + 12);
    if (x < 1 || x > 2047 || y < 1 || y > 2047) continue;
    const sec = buf.readUInt32LE(p);
    if (sec === 0 || sec === 0xffffffff || sec < 0x10000) continue;
    set.add(sec);
  }
  return set;
}

function findCharacterRecords(buf, nameLookup, traitNames, surnamesFilter) {
  // If a surnamesFilter is provided, only match characters whose last name is in it.
  // If null/undefined, do a broad scan using structural heuristics.
  const records = [];
  const seen = new Set();
  // 2026-05-20: pre-compute valid bodyguard uuid set for the tc=0 gate.
  // Lets tryParseAt accept admiral records (traitCount=0) when their
  // secondaryUuid is a known bodyguard — eliminates ~2000 false-positives
  // that the broad tc=0 path would otherwise produce.
  const secUuidIndex = buildSecUuidIndex(buf);

  if (surnamesFilter) {
    const surnameIdx = new Map();
    for (const sn of surnamesFilter) {
      const idx = nameLookup.indexOf(sn);
      if (idx >= 0) surnameIdx.set(sn, idx);
    }
    for (const [sn, idx] of surnameIdx) {
      for (let i = 0; i < buf.length - 308; i++) {
        if (buf.readUInt32LE(i + 5) !== idx) continue;
        const cand = tryParseAt(buf, i, nameLookup, traitNames, secUuidIndex);
        if (cand && !seen.has(i)) { seen.add(i); records.push(cand); }
      }
    }
  } else {
    // Broad scan using structural validation only
    for (let i = 47; i < buf.length - 308; i++) {
      const cand = tryParseAt(buf, i, nameLookup, traitNames, secUuidIndex);
      if (cand && !seen.has(i)) {
        seen.add(i);
        records.push(cand);
        i += 100; // skip ahead
      }
    }
  }

  // Session 101: attach pos + mpRemaining to each character that has a
  // secondaryUuid. One file-wide scan covers all characters.
  const uuidSet = new Set();
  for (const c of records) {
    if (c.secondaryUuid && c.secondaryUuid !== 0xffffffff) uuidSet.add(c.secondaryUuid);
  }
  if (uuidSet.size > 0) {
    const posIdx = buildPositionIndex(buf, uuidSet);
    const actionIdx = buildActionIndex(buf, uuidSet);
    // Observed map bounds (max tile seen across all character positions) — used
    // to gate move-order destinations as on-map. Generous 1.1× headroom so a
    // dest just past the eastmost/southmost character still counts.
    let maxX = 0, maxY = 0;
    for (const p of posIdx.values()) { if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
    const BX = maxX > 0 ? Math.round(maxX * 1.1) : 2047;
    const BY = maxY > 0 ? Math.round(maxY * 1.1) : 2047;
    for (const c of records) {
      const p = posIdx.get(c.secondaryUuid);
      if (p) {
        c.tileX = p.x;
        c.tileY = p.y;
        // For turn-start saves, mpRemaining == max MP per turn for that
        // character/unit type. Mid-turn, mpRemaining < max. We expose both
        // names so the caller can decide: a UI showing "MP this turn"
        // wants mpRemaining; a UI showing "this unit's speed" wants maxMP.
        // Without a second snapshot we can't distinguish — both fields
        // carry the same observed value.
        c.mpRemaining = p.mpRemaining;
        c.maxMP = p.mpRemaining;
      } else {
        c.tileX = null;
        c.tileY = null;
        c.mpRemaining = null;
        c.maxMP = null;
      }
      // Pending move order (CHARACTER_ACTION_DETAILS). Live only when the dest
      // is a valid on-map tile differing from the current tile (idle chars carry
      // stale junk in the dest fields).
      const a = actionIdx.get(c.secondaryUuid);
      if (a && a.destX >= 1 && a.destX <= BX && a.destY >= 1 && a.destY <= BY &&
          (c.tileX == null || a.destX !== c.tileX || a.destY !== c.tileY)) {
        c.moveDestX = a.destX;
        c.moveDestY = a.destY;
        c.moveFlag = a.flag;
        // 0x100 = the player's own active short move (most reliable "on the
        // march now"); 0x300/0x400 = AI strategic march / scripted rally.
        c.moveActive = a.flag === 0x100;
      } else {
        c.moveDestX = null;
        c.moveDestY = null;
        c.moveFlag = null;
        c.moveActive = false;
      }
    }
  }

  return records.sort((a, b) => a.offset - b.offset);
}

function tryParseAt(buf, i, nameLookup, traitNames, secUuidIndex = null) {
  const first = buf.readUInt32LE(i);
  // 0.9.502: dropped the `first < 50` gate. It was a heuristic to filter
  // junk byte patterns but happened to reject every legitimate character
  // whose nameLookup index falls in 0..49 — including Achaios (idx 46),
  // Aaron (0), Achaeus (45), Achilleus (50)*, etc. With the other gates
  // (length ≥ 3, A-Z first char, valid trait list, valid age, etc.)
  // doing the actual filtering, this low-index cutoff was pure regression.
  if (first >= nameLookup.length) return null;
  const firstName = nameLookup[first];
  if (!firstName || firstName.length < 3) return null;
  if (firstName[0] < "A" || firstName[0] > "Z") return null;
  const gender = buf[i + 4];
  if (gender > 3) return null;
  // Two record layouts coexist in RTW:R saves:
  //   • LAYOUT_A (surnamed): firstName u32 (+0), gender (+4),
  //     lastName u32 (+5), padding (+9), …, 8 bytes 0xff (+18..+25)*,
  //     age byte (+26), …, traitCount u16 (+302), trait records (+308).
  //   • LAYOUT_B (single-name): lastName omitted, every field shifts
  //     -4. 0xff sentinel at +14..+21*; age (+22); traitCount (+298).
  //
  // *The 0xff slot is the FAST PATH anchor — most records have it. But
  // some records carry real values there (e.g. Aulus Gabinius once the
  // RomanConquerorMessapians trait fires in save_rome3: +18..+25 holds
  // a Cornelius_Scapula name index instead of 0xff sentinel). For those
  // records we fall through to a SLOW PATH that anchors on the trait
  // table itself: traitCount in valid range AND the first trait record
  // (u32 traitId, u16 level) being a real trait. That's hard to forge
  // by random bytes — there are only ~3800 valid trait ids out of 2^32,
  // and the level u16 is bounded.
  let layoutB = null;
  const matches = (off) => {
    const tcAt = off === 0 ? 302 : 298;
    const tsAt = off === 0 ? 308 : 304;
    if (i + tcAt + 2 > buf.length) return false;
    const tc = buf.readUInt16LE(i + tcAt);
    if (tc > 200) return false;
    // 2026-05-20: tc=0 admiral case. RTW admirals have traitCount=0 (no
    // traits), so the trait-list anchor below can't validate them. Accept
    // tc=0 ONLY when the secondaryUuid (offset-43 from i) is in the
    // coord-table index — that's strong proof the record is a real
    // character. Without this gate, a broad tc=0 scan produces 2000+
    // false positives in Macedon T0 RIS.
    if (tc === 0) {
      if (!secUuidIndex) return false;
      if (i < 43) return false;
      const sec = buf.readUInt32LE(i - 43);
      return secUuidIndex.has(sec);
    }
    if (tc < 1) return false;
    if (i + tsAt + 8 > buf.length) return false;
    const tid0 = buf.readUInt32LE(i + tsAt);
    if (tid0 >= traitNames.length || !traitNames[tid0]) return false;
    // Trait levels in RTW go higher than the small Threshold values you
    // see in descr files — internal levels for things like Factionleader
    // (60+ on the leader), FasterCharacters (50+), Estates (20+) are real.
    // Cap at 1000 just to filter random-byte garbage; real values stay
    // well under that.
    const lvl0 = buf.readUInt16LE(i + tsAt + 4);
    if (lvl0 > 1000) return false;
    return true;
  };
  // LAYOUT_A first: need a valid lastName.
  const lastA = buf.readUInt32LE(i + 5);
  const validLastA = lastA >= 50 && lastA < nameLookup.length
    && nameLookup[lastA] && nameLookup[lastA].length >= 3
    && nameLookup[lastA][0] >= "A" && nameLookup[lastA][0] <= "Z";
  if (validLastA && matches(0)) {
    layoutB = false;
  } else if (buf[i + 5] === 0 && matches(-4)) {
    // LAYOUT_B: byte +5 must be 0 (the would-be first byte of lastName
    // in LAYOUT_A) to discriminate from LAYOUT_A records.
    layoutB = true;
  } else {
    return null;
  }
  // Field-offset table per layout — every check that reads the body of
  // the record routes through it.
  const off = layoutB
    ? { pad9: 5, d34: 30, age: 22, role: 38, traitCount: 298, traitsStart: 304, fatherUuid: 42 }
    : { pad9: 9, d34: 34, age: 26, role: 42, traitCount: 302, traitsStart: 308, fatherUuid: 46 };
  if (buf[i + off.pad9] !== 0) return null;
  const d34 = buf[i + off.d34];
  if (d34 !== 0x00 && d34 < 0xf0) return null;
  const age = 242 - buf[i + off.age];
  if (age < 0 || age > 100) return null;
  const role = buf[i + off.role];
  if (role > 10) return null;
  const tc = buf.readUInt16LE(i + off.traitCount);
  if (tc > 200) return null;
  // 2026-05-20 cracker session 2: reject records where BOTH primaryUuid
  // (at offset-47) AND secondaryUuid (at offset-43) are 0. Real characters
  // always have at least one of these uuids set — primaryUuid is the
  // character's identity and is always non-zero; secondaryUuid is the
  // bodyguard unit uuid and is also non-zero for most chars. The 362
  // false-positive "Aaron" records in Macedon T0 RIS (vs 0 real Aarons in
  // descr_strat) all had both uuids = 0; this filter eliminates them
  // without affecting any real character. Verified via
  // scripts/save-cracker/dig-descr-strat-audit.js.
  if (i >= 47) {
    const primaryUuid = buf.readUInt32LE(i - 47);
    const secondaryUuid = buf.readUInt32LE(i - 43);
    // 2026-05-20: real characters have at least ONE uuid >= 0x10000 (most
    // real uuids are in the millions; small values like 2048 / 9728 are
    // partial-byte interpretations of unrelated regions). 362 false-positive
    // Aaron records in Macedon T0 RIS — none of them satisfied this gate,
    // while 0 real chars were rejected by it. Verified against descr_strat
    // (Aaron not present in any starting character list).
    const FF = 0xffffffff;
    const pBig = primaryUuid > 0xffff && primaryUuid !== FF;
    const sBig = secondaryUuid > 0xffff && secondaryUuid !== FF;
    if (!pBig && !sBig) return null;
    // Additional gate: real character records always have non-zero bytes
    // within the first 8 bytes (firstName + gender + pad + start of next
    // field). Fake records caused by zero-byte regions have 8 zero bytes,
    // which is what allows index 0 ("Aaron") to be incorrectly parsed as
    // a character. Verified across Macedon T0 RIS: 100% of fake Aarons
    // have all-zero head8; 0 real chars have all-zero head8.
    if (i + 8 <= buf.length) {
      let head8Zero = true;
      for (let k = 0; k < 8; k++) if (buf[i + k] !== 0) { head8Zero = false; break; }
      if (head8Zero) return null;
    }
    // 0.9.524: post-children "system constants" gate. Cracked layout shows
    // real chars have a 20-byte constant block at +66..+85 (LAYOUT_B) /
    // +70..+89 (LAYOUT_A) starting with the end-of-children u32 sentinel
    // (0xFFFFFFFF) and containing the RTW constant `2` u32 four slots
    // later. Validating EITHER of these two slots eliminates Appuleius_
    // Saturninus and 7 other false-positive records hitting the parser at
    // offsets that happen to satisfy the firstName/age/uuid gates but live
    // outside the character-records section (relationship tables, name-
    // pool zones). Verified against Macedon T0 RIS: 861/861 descr_strat-
    // resident chars pass this gate (zero false-negatives), and 8/8 known
    // false-positives are filtered. Runtime-spawned chars (105 of them in
    // Macedon T0 RIS, not in descr_strat) all pass too — they live in the
    // real character section with the constant layout intact.
    const sentinelOff = layoutB ? 66 : 70;
    const const2Off = layoutB ? 74 : 78;
    if (i + const2Off + 4 <= buf.length) {
      const sentinel = buf.readUInt32LE(i + sentinelOff);
      const k2 = buf.readUInt32LE(i + const2Off);
      if (sentinel !== 0xFFFFFFFF && k2 !== 2) return null;
    }
  } else {
    // Records below offset 47 can't have pre-header uuids in-buffer.
    // The first ~5000 bytes are the save header / mod info, never
    // contains real character records.
    return null;
  }
  return parseCharacter(buf, i, nameLookup, traitNames, layoutB);
}

function parseCharacter(buf, offset, nameLookup, traitNames, layoutB = false) {
  // Field-offset table per layout (mirrors tryParseAt). LAYOUT_B is the
  // 4-bytes-shorter Greek/single-name variant; lastName is omitted and
  // every subsequent field moves -4.
  // Pre-record UUID fields (at -47 / -43) DON'T shift; only the in-record
  // offsets after the missing lastName u32 do. Verified on Milon's record:
  // his secondaryUuid (0xf48b2861, matches the greek-general unit cmd) is
  // at exactly record_start - 43, same as Roman characters.
  const off = layoutB
    ? { age: 22, role: 38, fatherUuid: 42, traitCount: 298, traitsStart: 304, primaryUuid: -47, secondaryUuid: -43 }
    : { age: 26, role: 42, fatherUuid: 46, traitCount: 302, traitsStart: 308, primaryUuid: -47, secondaryUuid: -43 };
  const first = buf.readUInt32LE(offset);
  const gender = buf[offset + 4];
  const last = layoutB ? 0 : buf.readUInt32LE(offset + 5);
  const age = 242 - buf[offset + off.age];
  // Fine-grained age timer at +86 u16 (LAYOUT_A) — save-cracker session 4
  // CONFIRMED at 96.8% match across 1304 Sparta-corpus chars. Value =
  // age × 64 + birth_offset; engine ticks +64 per turn, 4 turns per
  // year. Only accept when the implied years match the integer age
  // within 1 — the 3.2% gap is real (e.g. Aulus Gabinius in save_rome6
  // reads raw=0 at +86 despite being age 20). The basic `age` field
  // stays as the rounded integer for the rest of the code.
  let ageFineQuarter = null;
  if (!layoutB && offset + 86 + 2 <= buf.length) {
    const raw = buf.readUInt16LE(offset + 86);
    const yrs = Math.floor(raw / 64);
    const qtr = Math.floor((raw % 64) / 16); // 0..3, four quarters per year
    if (raw > 0 && yrs >= 0 && yrs < 200 && Math.abs(yrs - age) <= 1) {
      ageFineQuarter = { years: yrs, quarter: qtr, raw };
    }
  }
  const role = buf[offset + off.role];
  const fatherUuid = buf.readUInt32LE(offset + off.fatherUuid);
  // Clan-head / cognomen link at +18 u32 (LAYOUT_A only) — save-cracker
  // session 8 STRONG. Most chars have 0xffffffff sentinel; specific
  // characters bound to a Roman gens / patron clan have a name-lookup
  // index here. The adjacent u32 at +22 is a small enum (relationship
  // type — values 2 seen for both Aulus and Marcus pointing to
  // Cornelius_Scapula).
  let clanHead = null;
  if (!layoutB && offset + 22 + 4 <= buf.length) {
    const idx = buf.readUInt32LE(offset + 18);
    const relType = buf.readUInt32LE(offset + 22);
    if (idx !== 0xffffffff && idx < nameLookup.length && nameLookup[idx]) {
      clanHead = { name: nameLookup[idx], relType };
    }
  }
  // Children's primaryUuids — save-cracker session 13 CONFIRMED (218/218
  // parent-child hits in Rome T1, byte-identical reproduction across
  // sessions). 4-byte slot array; slot order is by birth, dead children
  // preserve their slot leaving "garbage" between active slots, so
  // filter sentinel 0xffffffff and only keep real uuids. The 4 slots
  // sit at +54..+66 (LAYOUT_A) / +50..+62 (LAYOUT_B).
  const childUuids = [];
  {
    const childStart = layoutB ? 50 : 54;
    for (let s = 0; s < 4; s++) {
      const o = offset + childStart + s * 4;
      if (o + 4 > buf.length) break;
      const u = buf.readUInt32LE(o);
      if (u && u !== 0xffffffff) childUuids.push(u);
    }
  }
  // spouseUuid at +46 (LAYOUT_B) / +50 (LAYOUT_A) — CONFIRMED 2026-05-20
  // by cross-referencing every char's +46 against the global set of all
  // v1.childUuids. 14 dynastic marriages verified where slot46 == primaryUuid
  // of a daughter held in another char's child slot — proven cases include
  // AntigonosB ↔ PhilaB (Seleukos's daughter), Magas ↔ Apame (Seleukos's
  // daughter), Antiochos ↔ StratonikeB (Demetrios's daughter), AlexandrosB
  // ↔ daughter-of-Pyrrhos, etc. The earlier "3% match" finding was caused
  // by a disambiguation bug (the descr_strat young Seleukos at age 23 was
  // being preferred over v1's dynastic-ancestor Seleukos at age 88 who
  // actually holds the children list). With the proper "is slot46 a child
  // of ANYONE?" test, +46 is confirmed as spouseUuid. The 610 non-matching
  // values are chars whose wives aren't anyone's daughter in v1 (female
  // wives with no traits don't get v1 records).
  let spouseUuid = 0;
  {
    const spouseOff = layoutB ? 46 : 50;
    if (offset + spouseOff + 4 <= buf.length) {
      const u = buf.readUInt32LE(offset + spouseOff);
      if (u && u !== 0xffffffff) spouseUuid = u;
    }
  }
  // Primary/secondary UUIDs sit BEFORE the record start (offset -47 / -43
  // for LAYOUT_A, -43 / -39 for LAYOUT_B). The shift is the same -4
  // pattern as the in-record fields.
  const primaryUuid = offset + off.primaryUuid >= 0 ? buf.readUInt32LE(offset + off.primaryUuid) : 0;
  const secondaryUuid = offset + off.secondaryUuid >= 0 ? buf.readUInt32LE(offset + off.secondaryUuid) : 0;
  // Character stats. Cluster framed by u16=23 at +96 and u32=50 at +98,
  // then four u32 LE stat fields.
  // Label assignment corrected 2026-05-19 against in-game ground truth
  // (Antigonos II Gonatas in RIS Macedon T0: Command 7, Influence 6,
  // Management 5 — user verified). Session 91 had the labels wrong:
  //   +102 → command    (was labeled "management")
  //   +106 → influence  (was labeled "command")
  //   +110 → management (was labeled "influence")
  //   +126 → loyalty    (unchanged)
  // The byte offsets are unchanged; only the field labels rotate.
  // LAYOUT_B offsets follow the same -4 shift convention as other fields.
  let management = null, command = null, influence = null, loyalty = null;
  // taxEffect = the engine's accumulated TaxCollection% for this character — the
  // governor-tax modifier the engine actually applies to a settlement's tax
  // income. CRACKED 2026-06-17 (cyrene STRating session): the stat frame
  // ([u16=23][u32=50]) is the base of a fixed-stride i32 EFFECT VECTOR indexed
  // by the engine's internal attribute enum; every trait/ancillary/meta-trait
  // (STRating, ICERating, Wealthy, Cheapskate, …) folds its effects into this
  // vector at game-start and on every load. TaxCollection is enum index 31, so
  // it sits at frame+124 (== record+218 for LAYOUT_B greek, record+222 for
  // LAYOUT_A roman — both anchored off the frame, so the read is layout-agnostic).
  //
  // This is the AUTHORITATIVE governor-tax value and SUPERSEDES the heuristic
  // re-derivation in gov-tax.js. It is the only field that distinguishes two
  // governors whose final Selflessness/Temperament are identical but whose
  // come-of-age STRating differed (the long-standing Perseus@Automala +5% vs
  // Theodotos@Ptolemais 0% puzzle): Perseus reads +5 here, Theodotos 0. Proven
  // on all 7 Cyrene governors in BOTH the Turn-1 and Turn-2 saves
  // (Magas −25, Perseus +5, Hermokrates +10, Aristoteles +5, others 0), giving
  // the correct faction tax total of 3995 with Automala = 594.
  let taxEffect = null;
  {
    // Locate the stat cluster by its frame signature [u16=23][u32=50] rather
    // than a fixed offset. The frame's exact position drifts ±4 by record
    // layout, and the old fixed +102 (±4 by layoutB flag) mis-read records
    // whose layout was detected wrong — reading the stats 4 bytes off, which
    // produced garbage like Antigonos II's 0/1/0 instead of the real 7/6/5.
    // Verified vs Macedon T0 (Antigonos II Gonatas, age 50): frame at +94, so
    // command=frame+4 (=7), influence=+8 (=6), management=+12 (=5),
    // loyalty=frame+28. command/influence/management labels per 2026-05-19.
    let frameP = -1;
    for (let p = 90; p <= 104; p++) {
      const o = offset + p;
      if (o - 2 >= 0 && o + 12 <= buf.length &&
          buf.readUInt16LE(o - 2) === 23 && buf.readUInt32LE(o) === 50) { frameP = o; break; }
    }
    if (frameP >= 0 && frameP + 28 + 4 <= buf.length) {
      // SIGNED reads (2026-06-11, cyrene live cards): stats can be negative
      // (Theodotos influence −1, Perseus −2 — stored as 0xFFFF… two's
      // complement; the in-game card clamps the display at 0). The old
      // unsigned read turned a −1 into 4.29e9, tripped the garbage gate, and
      // nulled the whole cluster for any character with one negative stat.
      command    = buf.readInt32LE(frameP + 4);
      influence  = buf.readInt32LE(frameP + 8);
      management = buf.readInt32LE(frameP + 12);
      loyalty    = buf.readInt32LE(frameP + 28);
      // Sanity gate: legit veteran stats can exceed the base 0..10, but a
      // garbage read lands far outside ±30 — filter those.
      if (Math.abs(management) > 30 || Math.abs(command) > 30 || Math.abs(influence) > 30 || Math.abs(loyalty) > 30) {
        management = command = influence = loyalty = null;
      }
      // TaxCollection effect — enum index 31 of the effect vector (frame+124).
      if (frameP + 124 + 4 <= buf.length) {
        const te = buf.readInt32LE(frameP + 124);
        // TaxCollection effects are small (±~50). Anything larger is a garbage
        // read (frame mislocated); leave null so the caller can fall back.
        if (Math.abs(te) <= 100) taxEffect = te;
      }
    }
  }
  const traitCount = buf.readUInt16LE(offset + off.traitCount);

  const traits = [];
  // 0.9.551: the last slot is a REAL trait, not a terminator — verified
  // 890/890 in macedon t0 (dig-traitanc-discriminator.js). The old
  // `i < traitCount - 1` dropped one real trait per character (TurnsAlive,
  // STRating, GoodCommander, Factionheir, …). trEnd below still uses the full
  // traitCount, so the ancillary boundary is unaffected by this fix.
  for (let i = 0; i < traitCount; i++) {
    const tid = buf.readUInt32LE(offset + off.traitsStart + i * 8);
    // 0.9.521: u16 at trait+4 is accumulated POINTS, not displayed level.
    // E.g. Quintus's "Estates 2" in descr_strat = 26 points in save.
    // Engine derives displayed level via threshold lookup. Caller (main.js)
    // post-processes to attach the resolved display level when modTraitLevels
    // is available. Field name `points` is the byte value; `level` is the
    // engine's displayed level after threshold lookup (filled in by caller).
    const points = buf.readUInt16LE(offset + off.traitsStart + i * 8 + 4);
    if (tid >= traitNames.length) break;
    if (!traitNames[tid]) continue;
    traits.push({ id: tid, name: traitNames[tid], points, level: points });
  }

  // Ancillaries — 0.9.551 CORRECTED layout (byte-verified via
  // dig-anc-boundary.js). The ancillary block sits at `trEnd - 4` (i.e. it
  // OVERLAPS the last trait slot's points/pad fields), as:
  //   [u16 ancCount][ancCount × u32 ancId]
  // followed by the portrait pstr16 (`[u16 len][data/...]`). The OLD code read
  // `[u16 pad][u16 id]` pairs starting at trEnd, which dropped the FIRST
  // ancillary of every character (e.g. Antigonos II's poet) and could misread
  // the rest. Detection: scan for "data/" from ancStart; count = (dataPos-4)/4
  // must be a non-negative integer and equal the u16 at ancStart. Validated:
  // poet/historian/tutor etc. all resolve; no-ancillary chars give count 0.
  const ancillaries = [];
  let ancCountFound = 0;
  {
    const trEnd = offset + off.traitsStart + traitCount * 8;
    const ancStart = trEnd - 4;
    let dataPos = -1;
    for (let i = 0; i < 220 && ancStart + i + 4 < buf.length; i++) {
      if (buf[ancStart + i] === 0x64 && buf[ancStart + i + 1] === 0x61 &&
          buf[ancStart + i + 2] === 0x74 && buf[ancStart + i + 3] === 0x61 &&
          buf[ancStart + i + 4] === 0x2f) { dataPos = i; break; }
    }
    if (dataPos >= 4 && (dataPos - 4) % 4 === 0) {
      const n = (dataPos - 4) / 4;
      if (n >= 0 && n <= 16 && buf.readUInt16LE(ancStart) === n) {
        for (let i = 0; i < n; i++) ancillaries.push({ id: buf.readUInt32LE(ancStart + 2 + i * 4) });
        ancCountFound = n;
      }
    }
  }
  // LAST-TRAIT POINTS / ANCILLARY OVERLAP — byte-exact layout (verified on the
  // Cyrene T1 save, 2026-06-17 cracker session). The post-trait region is:
  //
  //     [lastTraitId u32][ancCount u16][ancId u32 × ancCount][portLen u16][portrait]
  //
  // i.e. the ancCount occupies the LAST trait's would-be `points` slot (+4) and
  // the first ancId occupies its `pad` slot (+6) onward. There is NO points
  // field stored for the last trait — its slot is structurally the ancCount.
  // (Proven: Magas has [id][02 00][0b00 0000][2001 0000][33 00] = ancCount 2,
  //  ancIds bodyguard(11)+mercenary_captain(288); Perseus [id][01 00][d200 0000]
  //  [35 00] = ancCount 1, ancId drillmaster(210). No second copy of the trait
  //  id exists anywhere in the record.)
  //
  // Consequence: the last trait's true points are UNRECOVERABLE from the binary
  // whenever ancCount > 0 (the slot holds the count, not the value). When
  // ancCount == 0 the slot reads 0, which IS the true points for the last trait
  // (the engine writes 0 there for "no ancillaries", and the only last traits we
  // observe — STRating / TurnsAlive on starting generals — are genuinely 0 in
  // that slot). So we keep points only when ancCount == 0, and flag it unknown
  // (null) otherwise rather than fabricating a bogus 0 that a tax/level consumer
  // would mistake for a real value. See gov-tax.js for the STRating fallback.
  if (ancCountFound > 0 && traits.length > 0) {
    const last = traits[traits.length - 1];
    last.points = null; last.level = null; last.pointsUnknown = true;
  }

  // Portraits: scan forward from trait end for length-prefixed ASCII paths.
  // Capture up to 4 candidates so we can pick the best one, since the engine
  // sometimes stashes a captain banner (`data/ui/captain banners/captain_
  // portrait_*.tga`) BEFORE the actual general/family portrait. Picking
  // portraits[0] blindly then renders Dionysios with the Syracuse captain
  // banner — which is not what the family tree shows. 0.9.447: filter out
  // captain-banner paths so the first kept entry is always a true portrait
  // (`/portraits/portraits/` or `/portraits/cards/` substring).
  let cursor = offset + off.traitsStart + traitCount * 8;
  const portraits = [];
  for (let tries = 0; tries < 400 && portraits.length < 4; tries++) {
    if (cursor + 3 > buf.length) break;
    const len = buf.readUInt16LE(cursor);
    if (len > 10 && len < 200) {
      let ok = true;
      for (let k = 0; k < len - 1; k++) {
        const c = buf[cursor + 2 + k];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
      }
      if (ok && buf[cursor + 2 + len - 1] === 0x00) {
        const s = buf.slice(cursor + 2, cursor + 2 + len - 1).toString("ascii");
        // Reject captain banners outright — the engine writes them as
        // sibling fields for some characters but they're not the
        // character's actual rendered portrait. Family tree resolves to
        // the per-culture pool; the unit card should too.
        if (!/captain[\s_]*banner|captain_portrait/i.test(s)) {
          portraits.push(s);
        }
        cursor += 2 + len;
        continue;
      }
    }
    cursor++;
  }

  // Derived role classification from traits (more reliable than byte +42)
  const isLeader = traits.some(t => t.name === "Factionleader");
  const isHeir = traits.some(t => t.name === "Factionheir");

  // Death detection — refined 2026-05-10 via save-cracker session 4.
  // The u32 at +30..+33 carries a death-marker sentinel `0xfffffef7`
  // (=-265 i32) when the character is dead, 0 when alive. CONFIRMED on
  // two independent same-turn deaths (Herakleides + Hierokles, Athens
  // T22). The original heuristic read byte +34 (LAYOUT_A) / +30
  // (LAYOUT_B) and treated >= 0xf0 as dead — that happened to work for
  // LAYOUT_B (byte 0 of the u32) but was reading the wrong byte for
  // LAYOUT_A. The u32 check is layout-agnostic.
  let isDead = false;
  if (offset + 34 <= buf.length) {
    const deathMarker = buf.readUInt32LE(offset + 30);
    isDead = deathMarker === 0xfffffef7;
  }

  return {
    offset,
    firstName: nameLookup[first] || `#${first}`,
    // LAYOUT_B has no lastName field — Greek/single-name characters get
    // null. Without this the parser defaulted last=0 → nameLookup[0] →
    // "Aaron", labelling every Greek leader as "Milon Aaron".
    lastName: layoutB ? null : (nameLookup[last] || `#${last}`),
    gender: gender === 1 ? "male" : gender === 2 ? "female" : "unknown",
    age,
    role,
    isLeader,
    isHeir,
    isDead,
    primaryUuid,
    secondaryUuid,
    fatherUuid: fatherUuid === 0 ? null : fatherUuid,
    spouseUuid: spouseUuid === 0 ? null : spouseUuid,
    portraits,
    traits,
    ancillaries,
    ageFineQuarter,
    clanHead,
    childUuids,
    management,
    command,
    influence,
    loyalty,
    taxEffect,
  };
}

// Per-character position + movement-points record (save-cracker session 101,
// STRONG). For each character with a secondaryUuid (bodyguard unit UUID),
// there's a 60+ byte "field-army position" record stored in the
// post-merc-pool region of the save. Layout (offsets from uuid u32 location):
//   +0   u32 = secondaryUuid (the record key)
//   +4   u32 self-pointer-ish
//   +8   u32 = x tile coordinate
//   +12  u32 = y tile coordinate
//   +16  u16 = mid-tile fractional position (32767/32768 boundary)
//   +18..+57 misc state (selection state, pending order, …)
//   +58  f32 = MP remaining this turn (UNALIGNED 4-byte read)
//
// Multiple uuid hits exist per character (one in the type-6 character record,
// one in a path-end / movement-cache mirror, etc.); the TRUE pos record is
// the one preceded by `u32 = 6` at -4 and with x,y in valid map range
// (1..500). Verified by controlled experiment: save_mp_before/after.sav
// shows Manius Aemilius Paullus moving (275,425)→(275,424) and ONLY this
// record's f32(+58) changes (248.0 → 239.2, Δ-8.8 MP for one vertical tile).
//
// For turn-start saves, mpRemaining = max MP per turn for that character.
// Across the corpus we observe distinct caps: 248.0 (Roman general fresh),
// 250.0, 225.0 (navy?), 324.48 (mounted/fast trait), etc. — per-unit-type.
function buildPositionIndex(buf, uuidSet) {
  const idx = new Map();
  for (let i = 100; i < buf.length - 64; i++) {
    const u = buf.readUInt32LE(i);
    if (!uuidSet.has(u)) continue;
    // Filter: hdr u32 at -4 must be 6 (or 4 in some cases), and x,y in valid range.
    const hdr = i >= 4 ? buf.readUInt32LE(i - 4) : 0;
    if (hdr !== 6 && hdr !== 4) continue;
    const x = buf.readUInt32LE(i + 8);
    const y = buf.readUInt32LE(i + 12);
    if (x < 1 || x > 500 || y < 1 || y > 500) continue;
    const mp = buf.readFloatLE(i + 58);
    if (!isFinite(mp) || mp < 0 || mp > 1000) continue;
    if (!idx.has(u)) idx.set(u, { offset: i, x, y, mpRemaining: mp });
  }
  return idx;
}

// CHARACTER_ACTION_DETAILS — per-character pending MOVE ORDER (destination tile).
// One record per character, keyed by secondaryUuid (the same key as the coord
// record). Cracked 2026-06-06 (findings-char-action-details-2026-06-06.md):
//   detector: [u32 sec][u32][1e 00 00 00]   (the 0x1e struct/version tag at +8)
//   +48 u32 destX·256  (destX = >>8)   +56 u32 destY·256 (destY = >>8)
//   +60 u32 order-state flag: 0x100 = active short move (player, moving now),
//       0x300 = AI strategic march, 0x200/0x400 = scripted/other.
// The destination fields hold stale/garbage on idle characters, so a move order
// is only "live" when the decoded dest is a VALID ON-MAP tile (within ~1.1× the
// observed map bounds) AND differs from the character's current tile. This is a
// PARTIAL crack: there is no action-TYPE enum (the corpus is move-only), so we
// surface a movement DESTINATION only, never an action label.
function buildActionIndex(buf, uuidSet) {
  const idx = new Map();
  for (let i = 100; i + 64 < buf.length; i++) {
    const sec = buf.readUInt32LE(i);
    if (!uuidSet.has(sec)) continue;
    if (buf.readUInt32LE(i + 8) !== 0x1e) continue;
    if (idx.has(sec)) continue;
    const destX = buf.readUInt32LE(i + 48) >>> 8;
    const destY = buf.readUInt32LE(i + 56) >>> 8;
    const flag = buf.readUInt32LE(i + 60);
    idx.set(sec, { destX, destY, flag });
  }
  return idx;
}

// Given a character's secondaryUuid, find the unit record commanded by them
// and extract its region. Returns the region name (UTF-16 decoded) or null.
function findCharacterRegion(buf, secondaryUuid) {
  if (!secondaryUuid) return null;
  const uuidBuf = Buffer.alloc(4);
  uuidBuf.writeUInt32LE(secondaryUuid);
  // Find occurrences and check if preceded (within 1000 bytes) by a known bodyguard unit name
  const unitNames = ["tribunus militum", "roman general", "roman bodyguard"];
  let i = 0;
  while ((i = buf.indexOf(uuidBuf, i)) !== -1) {
    for (let p = Math.max(0, i - 1000); p < i; p++) {
      for (const un of unitNames) {
        if (p + un.length >= buf.length) continue;
        if (buf.slice(p, p + un.length).toString("ascii") !== un) continue;
        if (buf[p + un.length] !== 0) continue;
        // Scan forward for UTF-16 region name with 0xff 0xff 0xff 0xff terminator
        for (let q = p + un.length + 1; q < p + un.length + 100; q++) {
          const rlen = buf[q];
          if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue; // raised 2026-05-09 for RIS regions ≤35 chars
          const rs = q + 2, re = rs + rlen * 2;
          if (buf[re] !== 0xff || buf[re + 1] !== 0xff) continue;
          let name = "", ok = true;
          for (let j = rs; j < re; j += 2) {
            if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
            name += String.fromCharCode(buf[j]);
          }
          if (ok && name[0] >= "A" && name[0] <= "Z") return name;
        }
      }
    }
    i++;
  }
  return null;
}

// Group characters by family (lastName) and build parent→children links via UUID
function buildFamilyTree(characters) {
  const byLastName = {};
  for (const c of characters) {
    if (!byLastName[c.lastName]) byLastName[c.lastName] = [];
    byLastName[c.lastName].push(c);
  }
  // For each character, try to find their UUID by searching for it in others' fatherUuid.
  // (Character's own UUID is stored in the pre-record header at -47 but we can also
  //  infer it from who references them as father.)
  const uuidOfChar = new Map();
  for (const c of characters) {
    // Find any character whose fatherUuid we can attribute to c
    // Heuristic: the father of all c's children (same lastName, younger, referencing fatherUuid)
    for (const other of characters) {
      if (other.fatherUuid && other.lastName === c.lastName && other.age < c.age) {
        // This character might be father of `other`. But to know definitively,
        // we'd need to scan for c's UUID in the save. Skip for now.
      }
    }
  }

  // Link father pointers via UUID collection
  const uuidMap = new Map(); // uuid → character (inferred from being referenced)
  for (const c of characters) {
    if (c.fatherUuid != null) {
      // Someone with this UUID is the father — we can identify WHO by matching
      // but we don't have the UUID in the main record. Leave as raw uuid for now.
    }
  }

  return byLastName;
}

// Count dead-pool dynasty records in the save. Cracked 2026-05-26 by the
// save-cracker agent: each per-faction dynasty-pool entry embeds a portrait
// path of the form `data/ui/.../portraits/dead/<idx>.tga`. Scanning for the
// ASCII substring `/portraits/dead/` is a 1:1 match for the pool records
// (verified zero duplicates against self-pointer header counts on the same
// save). On `Dummies Turn 960 Start.sav` this returns 21,762 — the dominant
// bloat source on long campaigns (grows ~8.6 per turn). Tight buffer scan,
// ~50ms on a 70 MB save. Combined with the live-character count, the two
// signatures together account for ~37% of the engine's ~65,536 entity cap
// on that save, which is what the in-app health gauge surfaces.
function countDeadPoolRecords(buf) {
  if (!buf || typeof buf.length !== "number" || buf.length < 16) return 0;
  // Build the needle as a Buffer once. Buffer.indexOf is the fastest scan
  // in Node — way faster than per-byte JS or toString("ascii") on the whole
  // file (which would balloon a 70 MB save into a 70 MB UTF-16 string).
  const needle = Buffer.from("/portraits/dead/", "ascii");
  let count = 0;
  let from = 0;
  while (from < buf.length) {
    const idx = buf.indexOf(needle, from);
    if (idx < 0) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

module.exports = {
  findCharacterRecords,
  parseCharacter,
  buildFamilyTree,
  findCharacterRegion,
  buildPositionIndex,
  countDeadPoolRecords,
};
