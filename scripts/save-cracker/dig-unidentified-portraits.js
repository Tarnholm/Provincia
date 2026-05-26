// Look at the FULL portrait paths inside unidentified records.
// The culture in the path (e.g. data/ui/<culture>/portraits/...) reveals
// the faction's culture group.
const fs = require("fs");
const { parseFactionTreasuries, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const treas = parseFactionTreasuries(buf);
const owners = identifyFactionRecordOwners(buf, treas);

const PORTRAIT_RE = /data\/ui\/(\w+)\/portraits/g;

for (let i = 0; i < owners.length; i++) {
  if (owners[i].factionName) continue;
  const r = treas[i];
  const nextR = i + 1 < treas.length ? treas[i + 1] : null;
  const span = nextR ? nextR.offset - r.offset : Math.min(buf.length - r.offset, 200000);
  const region = buf.slice(r.offset, r.offset + span).toString("latin1");

  const cultureCounts = new Map();
  let m;
  PORTRAIT_RE.lastIndex = 0;
  while ((m = PORTRAIT_RE.exec(region)) !== null) {
    cultureCounts.set(m[1], (cultureCounts.get(m[1]) || 0) + 1);
  }
  const top = Array.from(cultureCounts.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`rec ${i.toString().padStart(2)} @ 0x${r.offset.toString(16)} (${r.regionCount}r treasury=${r.treasury}):`);
  for (const [k, v] of top.slice(0, 5)) {
    console.log(`  ${k.padEnd(15)} x${v}`);
  }
}
