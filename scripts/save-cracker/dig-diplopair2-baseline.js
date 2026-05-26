// dig-diplopair2-baseline.js
//
// NEW-RUN baseline. Goal: determine if the PARTNER faction of a diplomacy
// relation is recoverable. Prior runs used only the 23 major class-100 records.
// THIS run uses ALL ~221 diplomacy zones (one per active faction) found via the
// 0x39240005 marker with owner = buf[marker-53].
//
// Step 1: dump every zone {ownerFaction, [relations]} with full byte detail.
// Step 2: build ground truth (descr_strat faction_relationships + script).
// Step 3: report aggregate stats: total relations, parity, uuid global span,
//         and whether the number of war-relations is consistent with a
//         bidirectional (stored-twice) model.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const DSTRAT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SCRIPT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt';
const FACS = 'C:/RIS/RIS/data/descr_sm_factions.txt';

const buf = fs.readFileSync(SAVE);

function parseFactionOrder() {
  const txt = fs.readFileSync(FACS, 'utf8');
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"?([a-z_0-9]+)"?:\s*(;.*)?$/);
    // descr_sm_factions: "faction <name>" blocks. Try both common formats.
    if (fm) { cur = fm[1]; continue; }
    if (cur && /^\s*"?culture"?/.test(line)) { order.push(cur); cur = null; }
  }
  return order;
}

// More robust descr_sm_factions parser: lines like `faction	romans_julii`
function parseFactionOrder2() {
  const txt = fs.readFileSync(FACS, 'latin1');
  const order = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*faction\s+([a-z0-9_]+)\s*(,.*)?$/i);
    if (m) order.push(m[1].toLowerCase());
  }
  return order;
}

let factionOrder = parseFactionOrder2();
if (factionOrder.length < 5) factionOrder = parseFactionOrder();
console.log('factionOrder length:', factionOrder.length);
console.log('factionOrder:', factionOrder.join(', '));

// --- Parse ALL zones ---
const MARKER = 0x39240005;
const zones = [];
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4);
  if (count === 0 || count > 250) continue;
  const fid = buf[i - 53];
  const name = (fid < factionOrder.length) ? factionOrder[fid] : `#${fid}`;
  const relations = [];
  let ok = true;
  for (let k = 0; k < count; k++) {
    const o = i + 8 + k * 16;
    if (o + 16 > buf.length) { ok = false; break; }
    relations.push({
      uuid: buf.readUInt32LE(o),
      class_: buf.readUInt32LE(o + 4),
      attitude: buf.readUInt32LE(o + 8),
      tag: buf.readUInt32LE(o + 12),
    });
  }
  if (!ok) continue;
  zones.push({ markerOffset: i, fid, name, count, relations });
}

console.log('\n=== Zones found ===', zones.length);

// Dedup: keep the highest-count zone per fid (matches parseAllFactionDiplomacy)
const byFid = new Map();
for (const z of zones) {
  if (!byFid.has(z.fid) || byFid.get(z.fid).count < z.count) byFid.set(z.fid, z);
}
console.log('distinct fids:', byFid.size);

// Aggregate
let total = 0;
const classCount = {};
const allUuids = [];
const uuidToZone = new Map(); // uuid -> [zone names]
for (const z of byFid.values()) {
  for (const r of z.relations) {
    total++;
    classCount[r.class_] = (classCount[r.class_] || 0) + 1;
    allUuids.push(r.uuid);
    if (!uuidToZone.has(r.uuid)) uuidToZone.set(r.uuid, []);
    uuidToZone.get(r.uuid).push(z.name);
  }
}
console.log('\ntotal relations:', total);
console.log('by class:', JSON.stringify(classCount));
allUuids.sort((a, b) => a - b);
console.log('uuid range:', allUuids[0], '..', allUuids[allUuids.length - 1]);
console.log('distinct uuids:', new Set(allUuids).size, 'of', allUuids.length);

// How many uuids appear in MORE than one zone? (bidirectional shared-uuid model)
let shared = 0;
for (const [u, zs] of uuidToZone) if (zs.length > 1) shared++;
console.log('uuids appearing in >1 zone (shared):', shared);

// --- Ground truth ---
function gtFromStrat() {
  const txt = fs.readFileSync(DSTRAT, 'latin1');
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1].toLowerCase(), value = parseInt(m[2], 10), to = m[3].toLowerCase();
    if (to === 'slave' || from === 'slave') continue;
    out.push({ from, to, value, kind: value <= 199 ? 'ally' : (value === 200 ? 'neutral' : 'war') });
  }
  return out;
}
const GT = gtFromStrat();
console.log('\n=== Ground truth (descr_strat faction_relationships) ===');
console.log('total GT lines (non-slave):', GT.length);
const gtKinds = {};
for (const p of GT) gtKinds[p.kind] = (gtKinds[p.kind] || 0) + 1;
console.log('GT kinds:', JSON.stringify(gtKinds));
// Non-neutral undirected pairs
const gtNonNeutral = new Set();
for (const p of GT) {
  if (p.kind === 'neutral') continue;
  gtNonNeutral.add([p.from, p.to].sort().join('|') + '#' + p.kind);
}
console.log('GT non-neutral undirected pairs:', gtNonNeutral.size);

// Script: become_protector + diplomatic_stance
function gtFromScript() {
  const txt = fs.readFileSync(SCRIPT, 'latin1');
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, ''); // strip comments
    let m = line.match(/become_protector\s+([a-z0-9_]+)\s+([a-z0-9_]+)/i);
    if (m) { out.push({ kind: 'protector', a: m[1].toLowerCase(), b: m[2].toLowerCase() }); continue; }
    m = line.match(/diplomatic_stance\s+([a-z0-9_]+)\s+([a-z0-9_]+)\s+([a-z_]+)/i);
    if (m) { out.push({ kind: 'stance', a: m[1].toLowerCase(), b: m[2].toLowerCase(), stance: m[3].toLowerCase() }); continue; }
  }
  return out;
}
const GTS = gtFromScript();
console.log('\n=== Ground truth (script) ===');
console.log('script directives:', GTS.length);
const scriptKinds = {};
for (const g of GTS) scriptKinds[g.kind + (g.stance ? ':' + g.stance : '')] = (scriptKinds[g.kind + (g.stance ? ':' + g.stance : '')] || 0) + 1;
console.log('script kinds:', JSON.stringify(scriptKinds));

// Combined undirected GT (war/ally) across ALL factions, not just majors
const GT_ALL = new Map(); // key a|b -> kind
function addGT(a, b, kind) {
  if (a === b) return;
  const key = [a, b].sort().join('|');
  GT_ALL.set(key, kind);
}
for (const p of GT) if (p.kind !== 'neutral') addGT(p.from, p.to, p.kind);
for (const g of GTS) {
  if (g.kind === 'protector') addGT(g.a, g.b, 'ally');
  else if (g.kind === 'stance') {
    const k = g.stance.includes('war') ? 'war' : (g.stance.includes('alli') || g.stance.includes('peace') ? 'ally' : g.stance);
    addGT(g.a, g.b, k);
  }
}
console.log('\nCombined GT undirected non-neutral pairs:', GT_ALL.size);

// Now: how many save-zone factions are present in GT?
const zoneNames = new Set([...byFid.values()].map(z => z.name));
console.log('\nzone faction names:', [...zoneNames].sort().join(', '));

// For each zone-faction, count GT war/ally degree vs save war/ally degree
console.log('\n=== Degree comparison (save zone vs GT) per faction ===');
console.log('faction | saveWar saveAlly saveCease saveLock | gtWar gtAlly');
const gtDeg = {};
for (const [key, kind] of GT_ALL) {
  const [a, b] = key.split('|');
  gtDeg[a] = gtDeg[a] || { war: 0, ally: 0 };
  gtDeg[b] = gtDeg[b] || { war: 0, ally: 0 };
  gtDeg[a][kind === 'war' ? 'war' : 'ally']++;
  gtDeg[b][kind === 'war' ? 'war' : 'ally']++;
}
let matchDeg = 0, totalDeg = 0;
for (const z of [...byFid.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const sv = { 0: 0, 1: 0, 2: 0, 4: 0 };
  for (const r of z.relations) sv[r.class_] = (sv[r.class_] || 0) + 1;
  const g = gtDeg[z.name] || { war: 0, ally: 0 };
  const saveWar = sv[2] || 0, saveAlly = sv[0] || 0;
  if (g.war || g.ally) {
    totalDeg++;
    if (saveWar === g.war && saveAlly === g.ally) matchDeg++;
  }
  console.log(`${z.name.padEnd(18)} | ${String(saveWar).padStart(3)} ${String(saveAlly).padStart(3)} ${String(sv[1]||0).padStart(3)} ${String(sv[4]||0).padStart(3)} | ${String(g.war).padStart(3)} ${String(g.ally).padStart(3)}`);
}
console.log(`\nfactions where save (war,ally) exactly == GT (war,ally): ${matchDeg}/${totalDeg}`);
