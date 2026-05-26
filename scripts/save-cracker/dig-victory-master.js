// dig-victory-master.js
// Master victory-condition diagnostic. Builds faction order from
// descr_sm_factions.txt (same logic as main.js), resolves the player's
// hold_regions to region IDs via descr_strat, then searches the save body
// for: outlive-faction list, hold-region list, take_regions integer, and
// the WIN_CONDITION / OUTLIVE_FACTIONS record location.
// Research/diagnostics only — no app code touched.

const fs = require("fs");
const path = require("path");
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS = "C:\\RIS\\RIS\\data\\";

const file = process.argv[2] || "save_macedon t0.sav";
const player = (process.argv[3] || "antigonid").toLowerCase();
const buf = fs.readFileSync(SAVES + file);

// ── Faction order (descr_sm_factions.txt) — same parse rule as main.js ──
function buildFactionOrder() {
  const text = fs.readFileSync(RIS + "descr_sm_factions.txt", "latin1");
  const order = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1].toLowerCase(); continue; }
    if (cur && /^\s*"culture"\s*:/.test(line)) {
      order.push(cur);
      cur = null;
    }
  }
  return order;
}
const factionOrder = buildFactionOrder();
const idOf = (n) => factionOrder.indexOf(n.toLowerCase());

console.log(`=== ${file} (${buf.length} bytes) — player=${player} ===`);
console.log(`faction order: ${factionOrder.length} factions, playerId=${idOf(player)}\n`);

// ── descr_win_conditions: player's outlive + hold list ──
function readWinConditions() {
  const text = fs.readFileSync(RIS + "world\\maps\\campaign\\imperial_campaign\\descr_win_conditions.txt", "latin1");
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^[a-z_0-9]+$/.test(l) && lines[i + 1] && /^hold_regions?,?\s/i.test(lines[i + 1])) {
      const fac = l.toLowerCase();
      const hold = lines[i + 1].replace(/^hold_regions?,?\s*/i, "").split(",").map(s => s.trim()).filter(Boolean);
      let take = 100, outlive = [];
      for (let j = i + 2; j < Math.min(i + 6, lines.length); j++) {
        const t = lines[j].match(/take_regions\s+(\d+)/i);
        if (t) take = parseInt(t[1], 10);
        if (/short_campaign/i.test(lines[j])) {
          // outlive on next non-empty line
          for (let k = j + 1; k < Math.min(j + 3, lines.length); k++) {
            if (lines[k] && /^[a-z]/.test(lines[k])) { outlive = lines[k].split(/[\s,]+/).filter(Boolean).map(s=>s.toLowerCase()); break; }
          }
        }
      }
      out[fac] = { hold, take, outlive };
    }
  }
  return out;
}
const wc = readWinConditions();
const pwc = wc[player];
if (!pwc) { console.log("no win condition for player " + player); process.exit(0); }
console.log(`player win cond: take_regions=${pwc.take}`);
console.log(`  outlive (${pwc.outlive.length}): ${pwc.outlive.join(", ")}`);
console.log(`  outlive IDs: ${pwc.outlive.map(idOf).join(", ")}`);
console.log(`  hold (${pwc.hold.length}): ${pwc.hold.slice(0, 8).join(", ")}...\n`);

// ── search helpers ──
function searchBytes(arr, label, limit = 30) {
  const t = Buffer.from(arr);
  let p = 0, hits = [];
  while ((p = buf.indexOf(t, p)) !== -1) { hits.push(p); p += 1; if (hits.length > limit) break; }
  return hits;
}
function u8seq(arr) { return Buffer.from(arr.map(v => v & 0xff)); }
function u32seq(arr) { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, k) => b.writeUInt32LE(v >>> 0, k * 4)); return b; }
function findBuf(b, label, limit = 30) {
  let p = 0, hits = [];
  while ((p = buf.indexOf(b, p)) !== -1) { hits.push(p); p += 1; if (hits.length > limit) break; }
  console.log(`  [${label}] ${hits.length} hits${hits.length ? ": " + hits.slice(0, 8).map(h => "0x" + h.toString(16)).join(", ") : ""}`);
  return hits;
}

const oids = pwc.outlive.map(idOf);
console.log("OUTLIVE list search:");
findBuf(u8seq(oids), "u8 declared");
findBuf(u8seq([...oids].sort((a, b) => a - b)), "u8 sorted");
findBuf(u32seq(oids), "u32 declared");
findBuf(u32seq([...oids].sort((a, b) => a - b)), "u32 sorted");
findBuf(u32seq([oids.length, ...oids]), "u32 count+declared");
findBuf(u32seq([oids.length, ...[...oids].sort((a, b) => a - b)]), "u32 count+sorted");

// take_regions integer (rare value, but try)
console.log("\nTAKE_REGIONS integer search (value=" + pwc.take + "):");
{
  const b = Buffer.alloc(4); b.writeUInt32LE(pwc.take, 0);
  findBuf(b, "u32 " + pwc.take, 50);
}
console.log();
