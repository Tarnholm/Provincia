// src/factionKnowledgeParser.js
//
// Parses the per-faction AI WORLD-KNOWLEDGE cache (FACTION_RECORD_TAIL) —
// what each faction has scouted about the map. Cracked 2026-05-31
// (rtw-sav-parser/docs/findings-faction-tail-2026-05-31.md). Inside each of the
// 238 `ff 0a af f0` faction records, after the vision-grid RLE, is a flat array
// of known-settlement tuples.
//
// Record (model-anchored walk; tag selects variant):
//   tag 0x1b (27) FULL: [tag][f1=tileX][f2=tileY][tier][prevTier][f5=OWNER]
//                       [state6][culture][f8][model pstr16][model2 if prevTier!=-1]
//   tag 0x1d (29) UPDATE: [tag][..6 u32..][3 bytes][model pstr16]
//   tag 0x1f (31) COMPOSITE: [tag][f1..f4][nested 27/29]
//
// (f1,f2) is the GLOBAL WORLD TILE: f1 = tile X (0..1019), f2 = tile Y in engine
// coords = (699 - map_regions.tga image row). Verified exact on julii1/Carthage1.
// Owner (f5) is a descr_strat 0-based faction index. This module returns the raw
// tuples + tile + resolved owner name; (tileX,tileY)→settlement-name resolution
// needs map_regions.tga (out of scope here — a pure function of tile + map data).

"use strict";

const FACTION_MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
const INNER_MAGIC = 0xf0af0af0 >>> 0; // bytes f0 0a af f0 as LE u32
const ZONE_START = 0x18;

// Enumerate validated ff0aaff0 faction records → [{offset, size}].
function findFactionRecords(buf) {
  const starts = [];
  let p = 0;
  while ((p = buf.indexOf(FACTION_MAGIC, p)) !== -1) {
    if (p + 24 <= buf.length &&
        buf.readUInt32LE(p + 12) === INNER_MAGIC &&
        buf.readUInt32LE(p + 16) === 1020 &&
        buf.readUInt32LE(p + 20) === 700) {
      starts.push(p);
    }
    p += 1;
  }
  const recs = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1] : buf.length;
    recs.push({ offset: s, size: e - s });
  }
  return recs;
}

// Zone-relative index of the RLE terminator (first <value, count==0> pair).
function rleEndRel(buf, off, size) {
  const zoneOff = off + ZONE_START;
  let i = 0;
  const limit = size - ZONE_START;
  while (i + 2 <= limit) {
    if (buf[zoneOff + i + 1] === 0) break;
    i += 2;
  }
  return i;
}

// Tail byte bounds [start, end) — the data after the vision RLE terminator.
function tailBounds(buf, off, size) {
  const start = off + ZONE_START + rleEndRel(buf, off, size) + 2; // skip <v,0>
  return [start, off + size];
}

// Find model pstr16 strings in a segment: u16 len (incl NUL) + ASCII + NUL,
// must contain '_' (e.g. "W_hellenistic_Town"). Returns [{pos, len, name}].
function findModels(buf, ts, te) {
  const out = [];
  let i = ts;
  while (i + 2 < te) {
    const ln = buf.readUInt16LE(i);
    if (ln >= 4 && ln <= 40 && i + 2 + ln <= te) {
      let ok = true, hasUnderscore = false, str = "";
      for (let k = 0; k < ln - 1; k++) {
        const c = buf[i + 2 + k];
        if (c < 32 || c >= 127) { ok = false; break; }
        if (c === 0x5f) hasUnderscore = true;
        str += String.fromCharCode(c);
      }
      if (ok && hasUnderscore && buf[i + 2 + ln - 1] === 0) {
        out.push({ pos: i, len: ln, name: str });
        i += 2 + ln;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

// Parse one faction record's tail into known-settlement tuples.
function parseTail(buf, off, size, factionOrder) {
  const [ts, te] = tailBounds(buf, off, size);
  const models = findModels(buf, ts, te);
  if (!models.length) return [];

  // Find the first clean record start: a model whose preceding u32 is a valid
  // tag (27 = 36 bytes back / 9 u32; 29 = 27 bytes back / 6 u32 + 3 bytes).
  let recStart = null;
  for (const m of models) {
    for (const back of [36, 27]) {
      const tp = m.pos - back;
      if (tp >= ts && (buf.readUInt32LE(tp) === 27 || buf.readUInt32LE(tp) === 29)) {
        recStart = tp; break;
      }
    }
    if (recStart != null) break;
  }
  if (recStart == null) return [];

  const tuples = [];
  let p = recStart, mi = 0;
  while (mi < models.length) {
    const m = models[mi];
    if (m.pos < p) { mi++; continue; }
    const bodyLen = m.pos - p;
    const nFields = Math.floor((bodyLen - 0) / 4); // u32s in the body
    const f = [];
    for (let j = 0; j + 4 <= bodyLen; j += 4) f.push(buf.readUInt32LE(p + j));
    const tag = f[0];
    if (tag === 27 && f.length >= 9) {
      const owner = f[5];
      const rebel = f[8]; // named rebel-garrison identity; 239 = generic/none
      tuples.push({
        tag,
        tileX: f[1],
        tileY: f[2],
        tier: f[3],
        prevTier: f[4] === 0xffffffff ? -1 : f[4],
        owner,
        // NB: owner/rebel are strat 0-based faction indices; name resolution via
        // factionOrder is off-by-one for indices ≳148 (descr_strat ordering offset)
        // — fine for the common owner=238 (slave) case; verify high indices.
        ownerName: factionOrder && factionOrder[owner] ? factionOrder[owner] : null,
        rebelFaction: rebel === 239 ? null : rebel, // descr_regions `rebel` line id
        culture: f[7],
        model: m.name,
      });
    } else if (tag === 29 && f.length >= 6) {
      // tag-29 = lightweight size update; f[5] = settlement size level << 14 (0..15)
      tuples.push({ tag, sizeLevel: (f[5] >>> 14) & 0xf, model: m.name });
    } else {
      tuples.push({ tag, model: m.name }); // tag 31 (wonder) / other — raw
    }
    p = m.pos + 2 + m.len;
    mi++;
  }
  return tuples;
}

// OPTIONAL settlement-name resolution. `tileIndex` is a built index from
// src/tileResolver.js buildTileIndex(modDataDir) (anything exposing
// .resolve(tileX, tileY) → { region, settlement } | null works). Mutates each
// tag-27 tuple in-place, adding `region` + `settlement` (null when the tile
// has no settlement on this map). Returns `records` for chaining. This is
// HEAVY (needs map_regions.tga) and OFF the crackSave hot path — call it on
// demand for inspect-save / diff-saves. Safe to call with a null tileIndex
// (no-op) so callers can wire it unconditionally.
function resolveNames(records, tileIndex) {
  if (!tileIndex || typeof tileIndex.resolve !== "function") return records;
  for (const rec of records || []) {
    for (const t of rec.tuples || []) {
      if (t.tag !== 27) continue;
      const hit = tileIndex.resolve(t.tileX, t.tileY);
      t.region = hit ? hit.region : null;
      t.settlement = hit ? hit.settlement : null;
    }
  }
  return records;
}

// Parse the AI world-knowledge for every faction. `factionOrder` =
// descr_sm_factions / descr_strat declaration order (0-based) for owner names.
// `opts.tileIndex` (optional) = a tileResolver index; when supplied every
// tag-27 tuple is annotated with `region`/`settlement` (see resolveNames).
// Returns { records: [{factionIndex, tupleCount, fullCount, tuples}], totalTuples }.
// Tuples are returned for every faction that has a populated tail (~107/238).
function parseFactionKnowledge(buf, factionOrder = null, opts = {}) {
  const recs = findFactionRecords(buf);
  const out = [];
  let total = 0;
  for (let i = 0; i < recs.length; i++) {
    const tuples = parseTail(buf, recs[i].offset, recs[i].size, factionOrder);
    if (!tuples.length) continue;
    const full = tuples.filter((t) => t.tag === 27).length;
    total += tuples.length;
    out.push({ factionIndex: i, tupleCount: tuples.length, fullCount: full, tuples });
  }
  if (opts && opts.tileIndex) resolveNames(out, opts.tileIndex);
  return { records: out, totalTuples: total };
}

module.exports = { parseFactionKnowledge, resolveNames, findFactionRecords, parseTail, tailBounds };
