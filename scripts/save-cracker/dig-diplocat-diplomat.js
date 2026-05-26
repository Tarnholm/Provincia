// dig-diplocat-diplomat.js
// Target #7: diplomat unit negotiation state. Does a diplomat character carry
// any diplomacy-specific state on its record?
// Target #4: pending diplomatic offers — does any in-flight proposal serialize?
//
// Approach: find diplomat characters via parseCharacterExtras (role=="diplomat")
// and dump the bytes around each, comparing to a non-diplomat (spy/general) to
// see if diplomats have an extra field. Also count diplomats and check the
// CHARACTER_ACTION_DETAILS region.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "macedon t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
  "Seleucids t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
};

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const chars = parseCharacterExtras(buf);
  const byRole = {};
  for (const c of chars) byRole[c.role] = (byRole[c.role] || 0) + 1;
  console.log(`\n############ ${label} ############`);
  console.log("character roles:", Object.entries(byRole).map(([r, n]) => `${r}=${n}`).join("  "));

  const diplomats = chars.filter((c) => c.role === "diplomat");
  console.log(`diplomats: ${diplomats.length}`);
  for (const d of diplomats.slice(0, 6)) {
    console.log(`  diplomat ownUuid=0x${d.ownUuid.toString(16)} region=${d.region} age=${d.age} at 0x${d.offset.toString(16)}`);
  }

  // For one diplomat, dump 64 bytes after the role-anchored character fields
  // and compare structurally to one spy/general (both are "agents"). If a
  // diplomat carries negotiation state, there'd be a delta in a consistent slot.
  // Reuse parseCharacterExtras offsets: fields end ~ roleLen+23+2L+16.
  function dumpTail(c, n = 48) {
    // role string starts at c.offset; recompute roleLen
    const roleStr = c.culture + " " + c.role + "\0";
    const roleLen = roleStr.length;
    const regionStartOff = roleLen + 23;
    const postRegion = c.offset + regionStartOff + c.region.length * 2;
    const tailStart = postRegion + 20; // just past age fields
    const bytes = [];
    for (let i = 0; i < n; i++) bytes.push(buf[tailStart + i].toString(16).padStart(2, "0"));
    return { tailStart, hex: bytes.join(" ") };
  }
  if (diplomats.length) {
    const d = diplomats[0];
    const t = dumpTail(d);
    console.log(`  diplomat[0] tail @0x${t.tailStart.toString(16)}: ${t.hex}`);
  }
  const spy = chars.find((c) => c.role === "spy");
  if (spy) { const t = dumpTail(spy); console.log(`  spy[0]      tail @0x${t.tailStart.toString(16)}: ${t.hex}`); }
  const gen = chars.find((c) => c.role === "general");
  if (gen) { const t = dumpTail(gen); console.log(`  general[0]  tail @0x${t.tailStart.toString(16)}: ${t.hex}`); }
}
