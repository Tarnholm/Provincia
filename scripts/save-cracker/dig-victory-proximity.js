// dig-victory-proximity.js
// Find a window where ALL of the player's outlive faction IDs appear close
// together (any encoding/stride). Reveals non-contiguous or strided storage
// of the outlive list. Also tries the hold-region IDs the same way.
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS = "C:\\RIS\\RIS\\data\\";
const file = process.argv[2] || "save_macedon t0.sav";
const player = (process.argv[3] || "antigonid").toLowerCase();
const buf = fs.readFileSync(SAVES + file);

function buildFactionOrder() {
  const text = fs.readFileSync(RIS + "descr_sm_factions.txt", "latin1");
  const order = []; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1].toLowerCase(); continue; }
    if (cur && /^\s*"culture"\s*:/.test(line)) { order.push(cur); cur = null; }
  }
  return order;
}
const order = buildFactionOrder();
const idOf = (n) => order.indexOf(n.toLowerCase());

function readWC() {
  const text = fs.readFileSync(RIS + "world/maps/campaign/imperial_campaign/descr_win_conditions.txt", "latin1");
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    if (/^[a-z_0-9]+$/.test(lines[i]) && lines[i + 1] && /^hold_regions?,?\s/i.test(lines[i + 1])) {
      const fac = lines[i].toLowerCase();
      let outlive = [];
      for (let j = i + 2; j < Math.min(i + 6, lines.length); j++) {
        if (/short_campaign/i.test(lines[j])) {
          for (let k = j + 1; k < Math.min(j + 3, lines.length); k++)
            if (lines[k] && /^[a-z]/.test(lines[k])) { outlive = lines[k].split(/[\s,]+/).filter(Boolean).map(s => s.toLowerCase()); break; }
        }
      }
      out[fac] = outlive;
    }
  }
  return out;
}
const outlive = readWC()[player] || [];
const oids = outlive.map(idOf);
console.log(`=== ${file} — player=${player} ===`);
console.log(`outlive: ${outlive.join(", ")}`);
console.log(`outlive IDs: ${oids.join(", ")}\n`);

// Find all byte offsets where each outlive ID appears as a u8, u16 or u32.
function positionsOf(id) {
  const pos = { u8: [], u16: [], u32: [] };
  for (let p = 0; p + 4 < buf.length; p++) {
    if (buf[p] === (id & 0xff)) pos.u8.push(p);
  }
  // u16/u32 via index search
  const b16 = Buffer.alloc(2); b16.writeUInt16LE(id & 0xffff);
  const b32 = Buffer.alloc(4); b32.writeUInt32LE(id >>> 0);
  let q = 0; while ((q = buf.indexOf(b16, q)) !== -1) { pos.u16.push(q); q += 1; if (pos.u16.length > 200000) break; }
  q = 0; while ((q = buf.indexOf(b32, q)) !== -1) { pos.u32.push(q); q += 1; if (pos.u32.length > 200000) break; }
  return pos;
}

// For u32 encoding: find windows of size W containing one occurrence of every outlive ID.
function clusterScan(enc, stride, W) {
  // build sorted list of (pos, id)
  const events = [];
  for (const id of oids) {
    const b = Buffer.alloc(stride);
    if (stride === 1) b.writeUInt8(id & 0xff);
    else if (stride === 2) b.writeUInt16LE(id & 0xffff);
    else b.writeUInt32LE(id >>> 0);
    let p = 0;
    while ((p = buf.indexOf(b, p)) !== -1) { events.push({ p, id }); p += 1; }
  }
  events.sort((a, b) => a.p - b.p);
  const need = new Set(oids);
  // sliding window
  const found = [];
  for (let i = 0; i < events.length; i++) {
    const seen = new Map();
    let j = i;
    while (j < events.length && events[j].p - events[i].p <= W) {
      seen.set(events[j].id, events[j].p);
      j++;
    }
    if (need.size === seen.size && [...need].every(x => seen.has(x))) {
      found.push({ start: events[i].p, end: events[j - 1].p, positions: oids.map(id => seen.get(id)) });
      if (found.length > 20) break;
    }
  }
  console.log(`[${enc} stride=${stride} window=${W}] clusters with all ${need.size} outlive IDs: ${found.length}`);
  for (const f of found.slice(0, 8)) {
    console.log(`   0x${f.start.toString(16)}..0x${f.end.toString(16)}  positions: ${f.positions.map(p => "0x" + p.toString(16)).join(", ")}`);
  }
  return found;
}

console.log("Proximity clusters (all outlive IDs within window):");
clusterScan("u32", 4, 64);
clusterScan("u32", 4, 128);
clusterScan("u8", 1, 16);
clusterScan("u8", 1, 32);
clusterScan("u16", 2, 32);
