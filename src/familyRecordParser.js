// src/familyRecordParser.js
//
// Parses the RTW Remastered save "family-member table" — the fixed-stride
// records that hold family members the trait-anchored character parser MISSES:
// wives, daughters, young sons, and dead relatives (none of which carry a
// trait list to anchor on). Cracked 2026-05-30 (see
// rtw-sav-parser/docs/findings-family-2026-05-30.md), validated against
// descr_strat ground truth on save_julii1/2/3 with parent/spouse reciprocity.
//
// RECORD ANCHOR (each family member):
//   p              u32 self-pointer == its own byte offset
//   p-7            u32 == 0xffffffff  (header sentinel)
//   p+4            u32 character UUID
//   p+16           u32 == 30 (0x1e)   (record-type constant)
//   p+51           u32 firstName index (into descr_names_lookup)
//   name+4         u8  hasSurname flag (1 => surname u32 at name+5)
//   marker         u32 family-record tag at name+6 (no surname) / name+10 (surname)
//                  — THE discriminator that rejects false self-pointer hits.
//                  The tag value is MOD-SPECIFIC (1325 on the RIS dev mod, 347 on
//                  the bundled sample mod), so we AUTO-DETECT it per save as the
//                  modal marker-position value across candidate anchors rather
//                  than hardcoding. Pass an explicit `marker` to override.
//
// FIELDS, relative to m = markerOff + 4 (anchored at the marker because the
// variable name/surname length shifts everything before it):
//   m+12   i32  AGE encoded as (-value) - 270   (270 = campaign-year reference)
//   m+28   u32  child count (0..4)
//   m+32   u32  FATHER / family-head UUID (child -> parent)
//   m+36   u32  SPOUSE UUID
//   m+40,+44,+48,+52  u32  CHILDREN UUID array (childCount entries)
//   m+56   u32  == 0xffffffff (children-array sentinel)
//   m+76   u32  flags: bit0 = ALIVE(1)/DEAD(0), bit1 = GENDER male(1)/female(0)
//
// nameLookup is the descr_names_lookup.txt array (index -> name token),
// pre-loaded and passed in (same array the character parsers use).

"use strict";

const AGE_EPOCH = 270; // age = (-i32 @ m+12) - AGE_EPOCH

function isNameIndex(nameLookup, v) {
  if (v < 50 || v >= nameLookup.length) return false;
  const n = nameLookup[v];
  return !!n && n.length >= 3 && /^[A-Z][a-z]/.test(n);
}

// A candidate anchor is a self-pointer (value==offset) preceded by the
// 0xffffffff header sentinel, with the record-type constant 30 and a valid
// name index at +51. Returns {nameOff, hasSurname, markerOff} or null.
function anchorAt(buf, p, nameLookup) {
  if (buf.readUInt32LE(p) !== (p >>> 0)) return null;
  if (buf.readUInt32LE(p - 7) !== 0xffffffff) return null;
  if (buf.readUInt32LE(p + 16) !== 30) return null;
  const nameOff = p + 51;
  if (!isNameIndex(nameLookup, buf.readUInt32LE(nameOff))) return null;
  const hasSurname = buf[nameOff + 4] === 1;
  const markerOff = nameOff + (hasSurname ? 10 : 6);
  if (markerOff + 4 > buf.length) return null;
  return { nameOff, hasSurname, markerOff };
}

// Auto-detect the mod-specific family-record marker = the modal value at the
// marker position across all candidate anchors (real family records dominate;
// stray self-pointer false-positives scatter across many values).
function detectMarker(buf, nameLookup) {
  const tally = new Map();
  const end = buf.length - 90;
  for (let p = 0x1000; p < end; p++) {
    const a = anchorAt(buf, p, nameLookup);
    if (!a) continue;
    const mk = buf.readUInt32LE(a.markerOff);
    tally.set(mk, (tally.get(mk) || 0) + 1);
  }
  let best = 0, bestN = 0;
  for (const [mk, n] of tally) if (n > bestN) { best = mk; bestN = n; }
  return { marker: best, count: bestN };
}

// Parse every family-member record in the save buffer. O(n) single scan
// (plus one detection pass unless `marker` is supplied).
// opts: { marker } to override the auto-detected family marker.
function parseFamilyRecords(buf, nameLookup, opts = {}) {
  const out = [];
  if (!Array.isArray(nameLookup) || nameLookup.length === 0) return out;
  const marker = opts.marker != null ? opts.marker : detectMarker(buf, nameLookup).marker;
  if (!marker) return out;
  const end = buf.length - 90;
  for (let p = 0x1000; p < end; p++) {
    const a = anchorAt(buf, p, nameLookup);
    if (!a) continue;
    const { nameOff, hasSurname, markerOff } = a;
    if (buf.readUInt32LE(markerOff) !== marker) continue;

    const firstIdx = buf.readUInt32LE(nameOff);
    let surnameIdx = 0, surname = null;
    if (hasSurname) {
      const s = buf.readUInt32LE(nameOff + 5);
      if (isNameIndex(nameLookup, s)) { surnameIdx = s; surname = nameLookup[s]; }
    }

    const m = markerOff + 4;
    if (m + 80 > buf.length) continue;

    const firstName = nameLookup[firstIdx];
    const uuid = buf.readUInt32LE(p + 4);
    // AGE is stored as -(epoch + age) where epoch = campaign start year.
    // Keep the raw value now; epoch is auto-detected after the scan (= the
    // minimum raw, i.e. the youngest member, age 0) so the decode is
    // campaign-agnostic. opts.ageEpoch overrides.
    const ageRaw = -buf.readInt32LE(m + 12);
    const childCount = buf.readUInt32LE(m + 28);
    const fatherUuid = buf.readUInt32LE(m + 32) || 0;
    const spouseUuid = buf.readUInt32LE(m + 36) || 0;

    const childUuids = [];
    const n = Math.min(childCount, 4); // children array is 4 slots; sentinel at m+56
    for (let k = 0; k < n; k++) {
      const c = buf.readUInt32LE(m + 40 + 4 * k);
      if (c && c !== 0xffffffff) childUuids.push(c);
    }

    const flags = buf.readUInt32LE(m + 76);
    const alive = (flags & 1) !== 0;
    const gender = (flags & 2) ? "male" : "female";

    out.push({
      offset: p,
      uuid,
      firstName,
      surname,
      fullName: surname ? `${firstName} ${surname}` : firstName,
      firstIdx,
      surnameIdx,
      ageRaw,
      age: null, // filled in below once the epoch is known
      gender,
      alive,
      fatherUuid: fatherUuid === 0xffffffff ? 0 : fatherUuid,
      spouseUuid: spouseUuid === 0xffffffff ? 0 : spouseUuid,
      childUuids,
      flagsRaw: flags,
    });
  }

  // Decode ages: epoch = campaign start year = the smallest raw value (a
  // newborn, age 0). Auto-detected so any campaign/mod works; overridable.
  let epoch = opts.ageEpoch;
  if (epoch == null) {
    epoch = Infinity;
    for (const r of out) if (r.ageRaw > 0 && r.ageRaw < epoch) epoch = r.ageRaw;
    if (!isFinite(epoch)) epoch = 0;
  }
  for (const r of out) {
    const a = r.ageRaw - epoch;
    r.age = a >= 0 && a < 120 ? a : null;
  }
  out.ageEpoch = epoch;
  return out;
}

// Index the records by UUID and back-fill resolvable relationship NAMES.
// Note: family HEADS (adult males with traits) are NOT in this table — they
// live in the trait-anchored character stream and appear here only as link
// targets. So a fatherUuid/spouseUuid may not resolve to a record here; the
// caller can supply a wider uuid->name map (e.g. from the v1 character parser)
// via `extraUuidNames` to resolve those.
function indexFamily(records, extraUuidNames = null) {
  const byUuid = new Map();
  for (const r of records) byUuid.set(r.uuid >>> 0, r);
  const nameOf = (uuid) => {
    if (!uuid) return null;
    const r = byUuid.get(uuid >>> 0);
    if (r) return r.fullName;
    if (extraUuidNames && extraUuidNames.has(uuid >>> 0)) return extraUuidNames.get(uuid >>> 0);
    return null;
  };
  for (const r of records) {
    r.fatherName = nameOf(r.fatherUuid);
    r.spouseName = nameOf(r.spouseUuid);
    r.childNames = r.childUuids.map(nameOf);
  }
  return { byUuid, nameOf };
}

// Attribute each family member to a faction. The family table is one
// contiguous block (no per-faction markers), so faction comes from the
// UUID link graph: family members link (father/spouse/child) to the
// trait-anchored generals in `v1Chars`, which DO carry a faction (assigned
// via the captain_card markers). 655/720 family link UUIDs match a v1
// primaryUuid on save_julii1, so coverage is high.
//
// v1Chars records expose: primaryUuid, faction, childUuids[], spouseUuid.
// Mutates each family record with `.faction` and returns coverage stats.
function attributeFamilyFactions(family, v1Chars) {
  const factionByUuid = new Map();   // generals' primaryUuid -> faction
  for (const c of v1Chars) {
    if (c && c.primaryUuid != null && c.faction) factionByUuid.set(c.primaryUuid >>> 0, c.faction);
  }
  // A general's own child/spouse links also tell us a family member's faction
  // even when the family member's father/spouse field is blank.
  const factionForMember = new Map(); // family member uuid -> faction
  for (const c of v1Chars) {
    if (!c || !c.faction) continue;
    for (const ch of (c.childUuids || [])) factionForMember.set(ch >>> 0, c.faction);
    if (c.spouseUuid) factionForMember.set(c.spouseUuid >>> 0, c.faction);
  }

  const byUuid = new Map(family.map((r) => [r.uuid >>> 0, r]));
  for (const r of family) {
    r.faction =
      (r.fatherUuid && factionByUuid.get(r.fatherUuid >>> 0)) ||
      (r.spouseUuid && factionByUuid.get(r.spouseUuid >>> 0)) ||
      factionForMember.get(r.uuid >>> 0) ||
      null;
  }
  // Propagate through in-table links to a fixpoint (e.g. a child whose father
  // is another family member who is now attributed).
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (const r of family) {
      if (r.faction) continue;
      const f = r.fatherUuid && byUuid.get(r.fatherUuid >>> 0);
      const s = r.spouseUuid && byUuid.get(r.spouseUuid >>> 0);
      const fac = (f && f.faction) || (s && s.faction) || null;
      if (fac) { r.faction = fac; changed++; }
    }
    if (!changed) break;
  }
  const attributed = family.filter((r) => r.faction).length;
  return { attributed, total: family.length };
}

module.exports = {
  parseFamilyRecords,
  indexFamily,
  attributeFamilyFactions,
  detectMarker,
  anchorAt,
  AGE_EPOCH,
};
