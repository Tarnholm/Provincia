// dig-trade-session44.js — session 44 single-shot attempt to confirm/refute
// trade-route storage in the save. Targets ROME REMASTERED save_1.2.sav.
//
// Strategy (1 attempt, then stop):
//   (a) cstring scan for "trade_route" / "tradeRoute" / "trade" tokens in the
//       body — if engine persists ANY trade-route metadata, the typical
//       RTW save convention is a named sub-record like the settlement
//       sub-records (`hinterland_roads`, etc.). Session 8 mapped all
//       settlement sub-records by name; none of them was a trade-route list.
//   (b) UTF-16LE scan for the same tokens.
//   (c) Confirm session 8's negative result by demonstrating the keyword
//       does not appear in the body anywhere.
//
// Per session-8 RESEARCH addendum: this is expected to confirm the negative.

const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save size: ${buf.length} bytes`);

const tokens = [
  "trade_route", "tradeRoute", "trade_routes", "TradeRoute",
  "trade_graph", "tradegraph", "trade_link", "trade_partner",
  "land_trade", "sea_trade", "trade_lane",
];

console.log("\n=== ASCII cstring scan ===");
for (const tok of tokens) {
  const b = Buffer.from(tok, "ascii");
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(b, p)) !== -1) {
    hits.push(p);
    p += 1;
    if (hits.length > 20) break;
  }
  console.log(`  "${tok}": ${hits.length} hits ${hits.length ? "@ " + hits.slice(0, 5).map(h => "0x" + h.toString(16)).join(", ") : ""}`);
}

console.log("\n=== UTF-16LE scan ===");
for (const tok of tokens) {
  const b = Buffer.alloc(tok.length * 2);
  for (let i = 0; i < tok.length; i++) b.writeUInt16LE(tok.charCodeAt(i), i * 2);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(b, p)) !== -1) {
    hits.push(p);
    p += 1;
    if (hits.length > 20) break;
  }
  console.log(`  "${tok}" (u16): ${hits.length} hits ${hits.length ? "@ " + hits.slice(0, 5).map(h => "0x" + h.toString(16)).join(", ") : ""}`);
}

// Generic "trade" substring (ASCII) — count only, will hit slave_trade-style
// resource strings.
const tradeBuf = Buffer.from("trade", "ascii");
let cnt = 0, p = 0;
while ((p = buf.indexOf(tradeBuf, p)) !== -1) { cnt++; p += 1; }
console.log(`\nGeneric ASCII "trade" substring: ${cnt} hits across the whole file`);

// Show context for a few generic "trade" hits to see what the engine stores
console.log("\n=== Context around first 8 generic 'trade' ASCII hits ===");
p = 0;
let shown = 0;
while ((p = buf.indexOf(tradeBuf, p)) !== -1 && shown < 8) {
  const start = Math.max(0, p - 8);
  const end = Math.min(buf.length, p + 24);
  const slice = buf.slice(start, end);
  const ascii = Array.from(slice).map(x => (x >= 0x20 && x <= 0x7e) ? String.fromCharCode(x) : ".").join("");
  console.log(`  0x${p.toString(16).padStart(8, "0")}: "${ascii}"`);
  p += 1;
  shown++;
}
