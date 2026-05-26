// dig-diplocat-npctail.js
// Characterize the LARGE tail after each NPC record's diplo zone. Question:
// is there a second diplomacy structure (AI brain / attitude floats / a
// reputation field) in there, or is it just roster/settlement scaffolding?
//
// Also locate the PLAYER faction record (which sits BEFORE the first NPC
// record) and compare: does it have an AI block that NPCs lack?
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyFactionRecordOwners,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "macedon t0 (RIS)":   "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};
const SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const MARKER = 0x39240005;

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(SM_FACTIONS);

function tokenHist(buf, start, end) {
  const tokens = {}; let s = "";
  for (let i = start; i < end; i++) {
    const b = buf[i];
    if ((b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a) || b === 0x5f || (b >= 0x30 && b <= 0x39)) s += String.fromCharCode(b);
    else { if (s.length >= 6) tokens[s] = (tokens[s] || 0) + 1; s = ""; }
  }
  return Object.entries(tokens).sort((a, b) => b[1] - a[1]).slice(0, 15);
}

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  const player = identifyPlayerFactionFromSave(buf, recs);
  console.log(`############ ${label} ############  player=${player}`);

  // Examine 3 representative NPC records: a big one (seleucid), a small one, and one mid.
  const pick = [3, 5, 13]; // seleucid(686k), parni(23k), acragas(26k)
  for (const idx of pick) {
    const r = recs[idx];
    const next = idx + 1 < recs.length ? recs[idx + 1].offset : buf.length;
    const zoneOff = r.offset + 244 + 4 * r.regionCount;
    const zoneCount = buf.readUInt32LE(zoneOff + 4);
    const zoneEnd = zoneOff + 8 + zoneCount * 16;
    const fac = owners[idx].factionName;
    console.log(`\n=== rec ${idx} ${fac} 0x${r.offset.toString(16)} tail 0x${zoneEnd.toString(16)}..0x${next.toString(16)} (${next - zoneEnd} bytes) ===`);

    // Count extra diplo markers in tail
    let extraMarkers = 0, markerPositions = [];
    for (let i = zoneEnd; i + 8 < next; i++) {
      if (buf.readUInt32LE(i) === MARKER) { const c = buf.readUInt32LE(i + 4); if (c >= 0 && c <= 250) { extraMarkers++; if (markerPositions.length < 5) markerPositions.push("0x" + i.toString(16)); } }
    }
    console.log(`  extra 0x39240005 markers in tail: ${extraMarkers} ${markerPositions.join(",")}`);

    // Longest run of plausible float32 attitude values
    let bestLen = 0, bestAt = -1, cs = -1, cl = 0;
    for (let i = zoneEnd; i + 4 < next; i += 4) {
      const f = buf.readFloatLE(i);
      const ok = Number.isFinite(f) && Math.abs(f) > 1e-4 && Math.abs(f) < 1e6;
      if (ok) { if (cs < 0) { cs = i; cl = 0; } cl++; } else { if (cl > bestLen) { bestLen = cl; bestAt = cs; } cs = -1; cl = 0; }
    }
    if (cl > bestLen) { bestLen = cl; bestAt = cs; }
    console.log(`  longest float-run: ${bestLen} at 0x${bestAt > 0 ? bestAt.toString(16) : "-"}`);

    // Top ASCII tokens (what dominates the tail — roster? settlements?)
    console.log(`  top tokens: ${tokenHist(buf, zoneEnd, next).map(([t, c]) => `${t}:${c}`).join("  ")}`);
  }

  // PLAYER record: find the player's own diplo zone before firstMajor.
  const firstMajor = recs[0].offset;
  let pmark = -1;
  for (let i = 0; i + 8 < firstMajor; i++) {
    if (buf.readUInt32LE(i) === MARKER) { const c = buf.readUInt32LE(i + 4); if (c > 0 && c <= 250) { pmark = i; } }
  }
  // Use the LAST zone before firstMajor as the player zone (att5)
  console.log(`\n=== PLAYER zone (last 0x39240005 before firstMajor 0x${firstMajor.toString(16)}) ===`);
  if (pmark > 0) {
    const c = buf.readUInt32LE(pmark + 4);
    const zEnd = pmark + 8 + c * 16;
    console.log(`  player zone 0x${pmark.toString(16)} count=${c} end 0x${zEnd.toString(16)} gap-to-firstMajor=${firstMajor - zEnd} bytes`);
    console.log(`  player tail top tokens: ${tokenHist(buf, zEnd, firstMajor).map(([t, c]) => `${t}:${c}`).join("  ")}`);
  }
}
