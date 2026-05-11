// dig-occupy10.js
// Check Brundisium's buildings across the 4 saves (Brundisium was captured in save_11.1)

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

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
    const healthAbs = i + name.length + 32;
    let health = null;
    if (healthAbs < end) {
      const h = buf[healthAbs];
      if (h >= 0 && h <= 100) health = h;
    }
    out.push({ offset: i, name, health });
  }
  return out;
}

const saves = ["save_9.1.sav", "save_10.1.sav", "save_11.1.sav", "save_12.1.sav"];
const cityNames = ["Brundisium", "Tarentum"];
for (const s of saves) {
  const buf = read(s);
  const markers = findAllSettlementMarkers(buf);
  for (const cityName of cityNames) {
    const idx = markers.findIndex(m => m.name === cityName);
    if (idx < 0) continue;
    const target = markers[idx];
    const prev = markers[idx - 1];
    const chains = scanChainsBetween(buf, prev ? prev.blockEnd : 0, target.offset);
    const dmg = chains.filter(c => c.health !== null && c.health < 100);
    console.log(`${s} — ${cityName} (range [0x${(prev?prev.blockEnd:0).toString(16)}..0x${target.offset.toString(16)}], prev=${prev?.name}): ${chains.length} chains, ${dmg.length} damaged`);
    for (const c of chains) {
      const hpStr = c.health !== null ? `hp=${c.health}` : "hp=?";
      console.log(`    ${c.name.padEnd(40)} ${hpStr}`);
    }
  }
  console.log();
}
