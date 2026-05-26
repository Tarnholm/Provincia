// Map the region between the player's diplomacy zone end and firstMajor.
// This is the ~50KB+ AI/diplomacy block. Look for:
//  - runs of ~239 floats (per-faction AI attitude)
//  - runs of ~239 small ints (per-faction stance table)
//  - faction-name strings embedded
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};
const MARKER = 0x39240005;

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  let markerOff = -1;
  for (let i = 0; i + 8 < firstMajor; i++) {
    if (buf.readUInt32LE(i) !== MARKER) { continue; }
    const cnt = buf.readUInt32LE(i + 4);
    if (cnt > 0 && cnt <= 250) { markerOff = i; break; }
  }
  const count = buf.readUInt32LE(markerOff + 4);
  const zoneEnd = markerOff + 8 + count * 16;
  console.log(`\n===== ${label} (${player}) =====`);
  console.log(`zoneStart=0x${markerOff.toString(16)} zoneEnd=0x${zoneEnd.toString(16)} firstMajor=0x${firstMajor.toString(16)}`);
  console.log(`gap from zoneEnd to firstMajor = ${firstMajor - zoneEnd} bytes (0x${(firstMajor-zoneEnd).toString(16)})`);

  // Scan the gap for runs of floats in [0,1] or attitude-like values, and
  // for runs of small bytes. First, count faction-name strings.
  // List embedded ASCII tokens (length>=4) in the gap.
  const gapStart = zoneEnd, gapEnd = firstMajor;
  // Sample: dump 0x39240005 markers count in gap (should be ~0 since player has 1)
  // Look for any other diplo markers between zoneEnd and firstMajor
  let extraMarkers = 0;
  for (let i = gapStart; i + 8 < gapEnd; i++) {
    if (buf.readUInt32LE(i) === MARKER) { const c=buf.readUInt32LE(i+4); if(c>0&&c<=250){extraMarkers++;} }
  }
  console.log(`extra diplo markers in gap: ${extraMarkers}`);

  // Look for runs of float32 in plausible AI-attitude range. Window scan.
  // Count consecutive floats with abs value < 1000 and not NaN.
  let bestRunStart = -1, bestRunLen = 0, curStart = -1, curLen = 0;
  for (let i = gapStart; i + 4 < gapEnd; i += 4) {
    const f = buf.readFloatLE(i);
    const ok = Number.isFinite(f) && Math.abs(f) > 1e-6 && Math.abs(f) < 1000;
    if (ok) { if (curStart < 0) { curStart = i; curLen = 0; } curLen++; }
    else { if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; } curStart = -1; curLen = 0; }
  }
  if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
  console.log(`longest float-run in gap: ${bestRunLen} floats at 0x${bestRunStart>=0?bestRunStart.toString(16):"none"}`);

  // ASCII token histogram in gap
  const tokens = {};
  let s = "";
  for (let i = gapStart; i < gapEnd; i++) {
    const b = buf[i];
    if (b >= 0x61 && b <= 0x7a || b === 0x5f) s += String.fromCharCode(b);
    else { if (s.length >= 5) tokens[s] = (tokens[s]||0)+1; s = ""; }
  }
  const topTokens = Object.entries(tokens).sort((a,b)=>b[1]-a[1]).slice(0,30);
  console.log(`top ASCII tokens in gap: ${topTokens.map(([t,c])=>`${t}:${c}`).join("  ")}`);
}
