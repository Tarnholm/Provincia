// RECREATE the diplo section from the mod files, then VALIDATE against a real
// save. A turn-0/1 save's diplo section is the mod files compiled to binary, so
// we should be able to regenerate its logical content and emit it in the zone
// byte-layout. What we CAN reproduce: every faction's named relations + the
// validated class/attitude encoding. What we CANNOT (and why): the runtime
// relationUuids (allocation handles, not in mod files) and the neutral "met"
// padding entries (visibility-dependent). So this reproduces CONTENT, not bytes.
const fs = require("fs");

const RELS = "C:\\dev\\Provincia\\public\\faction_relationships_large.json";
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const VALIDATE = {
  "Seleucid t0 (player=seleucid)": "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  "Antigonid Turn 1 (player=antigonid)": "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Autosave   Antigonid Kingdom   Turn 1.sav",
};

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(SM_FACTIONS);
const rels = JSON.parse(fs.readFileSync(RELS, "utf8"));

// Validated player-zone class encoding (controlled crack 2026-05-22):
//   ally -> 1 (ALLIANCE), protects/protected_by -> 4 (LOCKED/protectorate),
//   trade -> 2 (not in mod files; formed in-game), met-no-deal -> 5 (padding),
//   war -> NOT stored in the zone.
const KIND_TO_PLAYERCLASS = { ally: 1, protects: 4, protected_by: 4 };
// NPC-zone uses attitude tier (DS_ALLIED=0 .. DS_AT_WAR=4); class there is a
// record-type. For protectorates the NPC-zone class-0 count matches (rome 6=6).

// ---- 1. RECREATE the section content from mod files ----
function reconstruct(factionName) {
  const arr = rels[factionName] || [];
  // group, dropping war (not in zone) for the "agreement entries" view
  const agreements = arr.filter(r => r.kind !== "war");
  const wars = arr.filter(r => r.kind === "war");
  return { agreements, wars };
}

console.log("=== RECREATED DIPLO SECTION (turn-1 content, from mod files) ===\n");
const sampleFactions = ["romans_julii", "carthage", "seleucid", "antigonid", "ptolemaic", "pontus", "bithynia"];
for (const f of sampleFactions) {
  const r = reconstruct(f);
  const ag = r.agreements.map(a => `${a.to}[${a.kind}=>class${KIND_TO_PLAYERCLASS[a.kind] ?? "?"}]`).join(", ");
  console.log(`${f}:`);
  console.log(`   AGREEMENTS (in-zone): ${ag || "(none)"}`);
  console.log(`   WARS (NOT in zone, derived): ${r.wars.map(w => w.to).join(", ") || "(none)"}`);
}

// ---- 2. EMIT in the zone byte-layout (proof of structural mastery) ----
function emitZoneBytes(factionName, fid) {
  const r = reconstruct(factionName);
  const entries = r.agreements;
  const buf = Buffer.alloc(8 + entries.length * 16);
  buf.writeUInt32LE(0x39240005, 0);              // marker
  buf.writeUInt32LE(entries.length, 4);          // count
  entries.forEach((a, k) => {
    const o = 8 + k * 16;
    buf.writeUInt32LE(0xFFFF0000 + k, o);        // synthetic uuid (real one is a runtime handle)
    buf.writeUInt32LE(KIND_TO_PLAYERCLASS[a.kind] ?? 5, o + 4); // class
    buf.writeUInt32LE(5, o + 8);                 // attitude (player-zone placeholder)
    buf.writeUInt32LE(0, o + 12);                // tag=0 (player zone)
  });
  return buf;
}
const demo = emitZoneBytes("seleucid", order.indexOf("seleucid"));
console.log(`\n=== EMITTED seleucid zone bytes (${demo.length} B, ${(demo.length-8)/16} entries) ===`);
console.log("  " + demo.toString("hex").match(/.{1,32}/g).join("\n  "));

// ---- 3. VALIDATE against real saves ----
const MARKER = 0x39240005;
function parseZones(buf) {
  const zones = {};
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf.readUInt32LE(i - 53);
    if (fid >= order.length) continue;
    const name = order[fid]; if (!name) continue;
    let ok = true; const cc = {};
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16; if (o + 16 > buf.length) { ok = false; break; }
      const cls = buf.readUInt32LE(o + 4); cc[cls] = (cc[cls] || 0) + 1;
    }
    if (!ok) continue;
    const isPlayer = buf.readUInt32LE(i + 8 + 12) === 0;
    if (!zones[name] || zones[name].count < count) zones[name] = { count, cc, isPlayer };
  }
  return zones;
}

for (const [label, path] of Object.entries(VALIDATE)) {
  let buf; try { buf = fs.readFileSync(path); } catch { console.log(`\n(skip ${label} — not found)`); continue; }
  console.log(`\n\n=== VALIDATE vs ${label} ===`);
  const zones = parseZones(buf);
  const player = Object.keys(zones).find(n => zones[n].isPlayer);
  console.log(`player zone detected: ${player}`);
  // Player faction: reconstructed alliances(class1) + locked(class4) vs real player-zone class counts.
  if (player && rels[player]) {
    const rec = reconstruct(player);
    const recAlly = rec.agreements.filter(a => a.kind === "ally").length;
    const recLocked = rec.agreements.filter(a => a.kind === "protects" || a.kind === "protected_by").length;
    const z = zones[player];
    console.log(`  PLAYER ${player}: reconstructed ally=${recAlly} locked=${recLocked} | real player-zone class1=${z.cc[1]||0} class4=${z.cc[4]||0} (class5/met padding=${z.cc[5]||0})`);
  }
  // NPC protectorates: reconstructed "protects" count vs real NPC-zone class-0 (rome 6=6 pattern).
  console.log("  NPC protectorate check (reconstructed protects vs real NPC-zone class-0):");
  for (const f of ["romans_julii", "carthage", "ptolemaic"]) {
    if (!zones[f]) continue;
    const recProtects = (rels[f] || []).filter(r => r.kind === "protects").length;
    console.log(`    ${f}: reconstructed protects=${recProtects} | real class-0=${zones[f].cc[0]||0}${zones[f].isPlayer ? " (player zone)" : ""}`);
  }
}
