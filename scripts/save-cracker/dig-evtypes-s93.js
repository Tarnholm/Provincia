// dig-evtypes-s93.js — session 93. Decode event-type enum semantics in the
// 12-byte diplo event log at 0x2a25d..0x2d155 (1,002 events).
//
// Known: [type u8][flag u8][sub-id u16][turn u16][0x0000][cookie u32]
// 892 type=0x01 + 110 type=0x04. Turns span 525..580 (55 turns).
//
// Test hypothesis: type=0x04 = per-turn marker (110/55 = 2/turn exactly);
//                  type=0x01 = mid-turn actions.

"use strict";
const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const LOG_START = 0x2a25d;
const LOG_END   = 0x2d155;
const buf = fs.readFileSync(SAVE);

// Parse all events
const events = [];
for (let p = LOG_START; p + 12 <= LOG_END; p += 12) {
  events.push({
    off: p,
    type: buf.readUInt8(p),
    flag: buf.readUInt8(p+1),
    subId: buf.readUInt16LE(p+2),
    turn: buf.readUInt16LE(p+4),
    pad: buf.readUInt16LE(p+6),
    cookie: buf.readUInt32LE(p+8),
  });
}
console.log(`Total events: ${events.length}`);

// Group by type
const t01 = events.filter(e => e.type === 0x01);
const t04 = events.filter(e => e.type === 0x04);
console.log(`type=0x01: ${t01.length}, type=0x04: ${t04.length}`);

// 1. Turn distribution per type
function turnDist(arr) {
  const m = new Map();
  for (const e of arr) m.set(e.turn, (m.get(e.turn)||0)+1);
  return [...m.entries()].sort((a,b)=>a[0]-b[0]);
}
const td01 = turnDist(t01);
const td04 = turnDist(t04);
console.log(`\n=== type=0x04 per-turn (${td04.length} unique turns) ===`);
console.log(`  range: turn ${td04[0][0]}..${td04[td04.length-1][0]}, span=${td04[td04.length-1][0]-td04[0][0]+1}`);
const counts04 = td04.map(([,c])=>c);
const uniqueCounts04 = [...new Set(counts04)].sort();
console.log(`  unique per-turn counts: ${uniqueCounts04.join(",")}`);
console.log(`  histogram of per-turn-count:`);
const ch04 = new Map();
for (const c of counts04) ch04.set(c, (ch04.get(c)||0)+1);
for (const [c,n] of [...ch04.entries()].sort((a,b)=>a[0]-b[0])) console.log(`    count=${c}: ${n} turns`);
console.log(`  first 10 turns w/ event-04 counts:`);
for (const [t,c] of td04.slice(0,10)) console.log(`    turn ${t}: ${c}`);

console.log(`\n=== type=0x01 per-turn (${td01.length} unique turns) ===`);
console.log(`  range: turn ${td01[0][0]}..${td01[td01.length-1][0]}, span=${td01[td01.length-1][0]-td01[0][0]+1}`);
const counts01 = td01.map(([,c])=>c);
const min01=Math.min(...counts01), max01=Math.max(...counts01);
const sum01=counts01.reduce((a,b)=>a+b,0);
console.log(`  per-turn count min=${min01}, max=${max01}, mean=${(sum01/counts01.length).toFixed(2)}`);

// 2. Check: are turns covered by 0x04 a SUPERSET of 0x01 turns?
const turns04Set = new Set(td04.map(([t])=>t));
const turns01Set = new Set(td01.map(([t])=>t));
const both = [...turns01Set].filter(t=>turns04Set.has(t)).length;
const only01 = [...turns01Set].filter(t=>!turns04Set.has(t)).length;
const only04 = [...turns04Set].filter(t=>!turns01Set.has(t)).length;
console.log(`\n  turns w/ both 0x01 & 0x04: ${both}`);
console.log(`  turns w/ only 0x01: ${only01}`);
console.log(`  turns w/ only 0x04: ${only04}`);

// 3. Position-check: does each type=0x04 mark the START or END of its turn?
// Walk events in file order — find which type=0x04 events fall at turn-boundary.
console.log(`\n=== Type 0x04 positional check ===`);
let lastTurn = -1;
let firstOfTurn04 = 0, lastOfTurn04 = 0, midOfTurn04 = 0;
for (let i = 0; i < events.length; i++) {
  const e = events[i];
  if (e.type !== 0x04) continue;
  const isFirst = (i === 0) || (events[i-1].turn !== e.turn);
  const isLast  = (i === events.length-1) || (events[i+1].turn !== e.turn);
  if (isFirst && isLast) { firstOfTurn04++; } // alone-in-turn
  else if (isFirst) firstOfTurn04++;
  else if (isLast) lastOfTurn04++;
  else midOfTurn04++;
}
console.log(`  type=0x04 at FIRST-of-turn: ${firstOfTurn04}`);
console.log(`  type=0x04 at LAST-of-turn:  ${lastOfTurn04}`);
console.log(`  type=0x04 in-the-middle:    ${midOfTurn04}`);

// 4. Cookie distribution: type=0x01 vs type=0x04
function cookieStats(arr) {
  const m = new Map();
  let nulls=0;
  for (const e of arr) {
    if (e.cookie === 0) nulls++;
    m.set(e.cookie, (m.get(e.cookie)||0)+1);
  }
  return { unique: m.size, nulls, top: [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8) };
}
const cs01 = cookieStats(t01);
const cs04 = cookieStats(t04);
console.log(`\n=== Cookie distributions ===`);
console.log(`  type=0x01: ${cs01.unique} unique cookies, ${cs01.nulls} nulls`);
console.log(`  top type=0x01 cookies:`);
for (const [c,n] of cs01.top) console.log(`    0x${c.toString(16).padStart(8,"0")}: ${n}`);
console.log(`  type=0x04: ${cs04.unique} unique cookies, ${cs04.nulls} nulls`);
console.log(`  top type=0x04 cookies:`);
for (const [c,n] of cs04.top) console.log(`    0x${c.toString(16).padStart(8,"0")}: ${n}`);

// 5. Sub-id distribution per type
function subStats(arr) {
  const m = new Map();
  for (const e of arr) m.set(e.subId, (m.get(e.subId)||0)+1);
  return { unique: m.size, min: Math.min(...m.keys()), max: Math.max(...m.keys()) };
}
const ss01 = subStats(t01);
const ss04 = subStats(t04);
console.log(`\n=== Sub-id distributions ===`);
console.log(`  type=0x01: ${ss01.unique} unique sub-ids, range ${ss01.min}..${ss01.max}`);
console.log(`  type=0x04: ${ss04.unique} unique sub-ids, range ${ss04.min}..${ss04.max}`);

// 6. Are type=0x04 cookies = 0 (a "tick" marker with no payload)?
// Are type=0x04 sub-ids small (faction ids 0..21)?
console.log(`\n  type=0x04 first 20 raw events:`);
for (const e of t04.slice(0,20)) {
  console.log(`    turn=${e.turn} sub=${e.subId} cookie=0x${e.cookie.toString(16).padStart(8,"0")}`);
}

// 7. Per-turn ordering: do all 0x01 events for a turn precede or follow 0x04?
console.log(`\n=== Intra-turn ordering (sample: first 4 turns) ===`);
const turnsSeen = [...new Set(events.map(e=>e.turn))].slice(0,4);
for (const T of turnsSeen) {
  const evs = events.filter(e=>e.turn===T);
  const types = evs.map(e=>e.type.toString(16)).join(" ");
  console.log(`  turn ${T} (${evs.length} events): ${types}`);
}

// 8. Cross-ref top type=0x04 cookies w/ faction zone
// Look for top-cookie matches in entire file
const topCookies04 = cs04.top.slice(0,4).map(([c])=>c).filter(c=>c!==0);
console.log(`\n=== Top type=0x04 cookies → presence in file ===`);
for (const c of topCookies04) {
  const target = Buffer.alloc(4);
  target.writeUInt32LE(c);
  let hits = 0, firstHit = -1;
  for (let p = 0; p + 4 <= buf.length; p++) {
    if (buf[p]===target[0] && buf[p+1]===target[1] && buf[p+2]===target[2] && buf[p+3]===target[3]) {
      if (firstHit<0) firstHit = p;
      hits++;
      if (hits > 200) break;
    }
  }
  console.log(`  0x${c.toString(16).padStart(8,"0")}: ${hits}+ hits, first @ 0x${firstHit.toString(16)}`);
}

// 9. Sub-id range for 0x04 — is it 0..21 (faction count)?
console.log(`\n=== type=0x04 sub-id histogram ===`);
const sh04 = new Map();
for (const e of t04) sh04.set(e.subId, (sh04.get(e.subId)||0)+1);
const sh04arr = [...sh04.entries()].sort((a,b)=>a[0]-b[0]);
console.log(`  unique: ${sh04arr.length}`);
for (const [s,n] of sh04arr.slice(0,30)) console.log(`    sub=${s}: ${n}`);

// 10. Detect: in turn T, do 0x04 events sandwich 0x01 events (open/close)?
// Pattern test: for each pair of consecutive 0x04s, is there a 0x01 burst between?
console.log(`\n=== Pair-pattern: consecutive 0x04 distances (in event index) ===`);
const t04idx = [];
for (let i = 0; i < events.length; i++) if (events[i].type===0x04) t04idx.push(i);
const gaps = [];
for (let i = 1; i < t04idx.length; i++) gaps.push(t04idx[i]-t04idx[i-1]);
const gh = new Map();
for (const g of gaps) gh.set(g, (gh.get(g)||0)+1);
const ghArr = [...gh.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log(`  top gaps: ${ghArr.map(([g,n])=>`gap=${g}:${n}`).join(", ")}`);
console.log(`  gap=1 (adjacent 0x04s): ${gh.get(1)||0}`);

// 11. Per-turn: count of 0x04 events
const turnsAllSet = new Set(events.map(e=>e.turn));
console.log(`\n  Total unique turns w/ ANY event: ${turnsAllSet.size}`);
console.log(`  Total unique turns w/ 0x04 event: ${turns04Set.size}`);
console.log(`  Mean 0x04 per turn: ${(t04.length/turns04Set.size).toFixed(2)}`);
