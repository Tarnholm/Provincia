// dig-diplopair2-lib.js — shared helpers for the diplopair2 run.
const fs = require('fs');

const FACS = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DSTRAT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SCRIPT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt';

// descr_sm_factions JSON-ish: a top-level `"<name>":` line, where the block
// then contains a `"culture":` line. Declaration order = engine faction index.
function parseFactionOrder() {
  const txt = fs.readFileSync(FACS, 'latin1');
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    // a faction header is a single quoted token at tab depth 1: `\t"name":`
    const fm = line.match(/^\t"([a-z_0-9]+)":/);
    if (fm) { cur = fm[1].toLowerCase(); continue; }
    if (cur && /^\s*"culture"\s*:/.test(line)) { order.push(cur); cur = null; }
  }
  return order;
}

const MARKER = 0x39240005;
function parseZones(buf, factionOrder) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    const fid = buf[i - 53];
    const name = (fid < factionOrder.length) ? factionOrder[fid] : `#${fid}`;
    let ok = true;
    const relations = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      relations.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4), attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12), entryOff: o });
    }
    if (!ok) continue;
    zones.push({ markerOffset: i, fid, name, count, relations, endOff: i + 8 + count * 16 });
  }
  return zones;
}
function dedupZones(zones) {
  const byFid = new Map();
  for (const z of zones) if (!byFid.has(z.fid) || byFid.get(z.fid).count < z.count) byFid.set(z.fid, z);
  return [...byFid.values()];
}

// Combined ground truth (descr_strat + script). Returns Map(undirected key -> 'war'|'ally').
function parseGT() {
  const m = new Map();
  const dt = fs.readFileSync(DSTRAT, 'latin1');
  for (const line of dt.split(/\r?\n/)) {
    const mm = line.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!mm) continue;
    const from = mm[1].toLowerCase(), val = parseInt(mm[2], 10), to = mm[3].toLowerCase();
    if (to === 'slave' || from === 'slave' || val === 200) continue;
    m.set([from, to].sort().join('|'), val >= 201 ? 'war' : 'ally');
  }
  const st = fs.readFileSync(SCRIPT, 'latin1');
  for (const raw of st.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '');
    let mm = line.match(/become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
    if (mm) { m.set([mm[1].toLowerCase(), mm[2].toLowerCase()].sort().join('|'), 'ally'); continue; }
    mm = line.match(/diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i);
    if (mm) { const k = mm[3].toLowerCase().includes('war') ? 'war' : 'ally'; m.set([mm[1].toLowerCase(), mm[2].toLowerCase()].sort().join('|'), k); }
  }
  return m;
}

module.exports = { parseFactionOrder, parseZones, dedupZones, parseGT, MARKER, FACS, DSTRAT, SCRIPT };
