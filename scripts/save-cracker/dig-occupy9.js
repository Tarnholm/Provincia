// dig-occupy9.js
// Count buildings with HP=50 vs HP=100 in each Uria record. Per brief & buildingParser:
// chain record format: [uint16 len][ASCII chain name][\x00][hash][per-level data]
// HP is at offset N+32 from chain-record start, where N = name.length.
//
// The chain records for settlement S are between the previous settlement's name
// and S's name (per buildingParser.js comment).
//
// Strategy: locate Uria's marker, then scan back from the marker (where the
// "previous settlement's name marker" would be) for chain records.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

// Reuse from buildingParser
function findAllSettlementMarkers(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") {
      out.push({ offset: i, name, blockEnd: se + 2 });
    }
  }
  return out;
}

function isChainName(buf, ns, ne) {
  if (ne - ns < 3) return false;
  const first = buf[ns];
  if (!(first >= 0x61 && first <= 0x7a)) return false;
  for (let k = ns; k < ne; k++) {
    const c = buf[k];
    const okc = (c >= 0x61 && c <= 0x7a) || c === 0x5f || (c >= 0x30 && c <= 0x39);
    if (!okc) return false;
  }
  return true;
}

function scanChainsBetween(buf, start, end) {
  const out = [];
  for (let i = start; i < end - 4; i++) {
    const ln = buf.readUInt16LE(i);
    if (ln < 4 || ln > 48) continue;
    const ns = i + 2, ne = ns + ln - 1;
    if (ne >= end || buf[ne] !== 0) continue;
    if (!isChainName(buf, ns, ne)) continue;
    const name = buf.slice(ns, ne).toString("ascii");
    if (name === "default_set") continue;
    const lvlAbs = i + 2 + name.length + 1 + 4;
    let level = 0;
    if (lvlAbs < end) {
      const b = buf[lvlAbs];
      if (b <= 10) level = b;
    }
    const healthAbs = i + name.length + 32;
    let health = null;
    if (healthAbs < end) {
      const h = buf[healthAbs];
      if (h >= 0 && h <= 100) health = h;
    }
    out.push({ offset: i, name, level, health });
  }
  return out;
}

const saves = ["save_9.1.sav", "save_10.1.sav", "save_11.1.sav", "save_12.1.sav"];
for (const s of saves) {
  const buf = read(s);
  const markers = findAllSettlementMarkers(buf);
  const uriaIdx = markers.findIndex(m => m.name === "Uria");
  if (uriaIdx < 0) { console.log(`${s}: no Uria`); continue; }
  const uria = markers[uriaIdx];
  const prevSet = markers[uriaIdx - 1];
  // Per buildingParser: chains for S live BETWEEN previous settlement's name and S's name
  const chainStart = prevSet ? prevSet.blockEnd : 0;
  const chainEnd = uria.offset;
  const chains = scanChainsBetween(buf, chainStart, chainEnd);
  console.log(`\n${s} — Uria buildings (${chains.length} found, range [0x${chainStart.toString(16)}..0x${chainEnd.toString(16)}], prev=${prevSet?.name}):`);
  for (const c of chains) {
    console.log(`  ${c.name.padEnd(40)} lvl=${c.level} hp=${c.health}`);
  }
  const damaged = chains.filter(c => c.health !== null && c.health < 100).length;
  console.log(`  --> Damaged buildings (HP<100): ${damaged} / ${chains.length}`);
}
