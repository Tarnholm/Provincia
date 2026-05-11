// Session 26 — Decode the 149KB scripted-events table interior at 0x846d1..0xa8beb.
// Session 25 found 33 named strings (volcanoes, earthquakes, floods, 7 wonders).
// Goal: find per-event record stride and decode year/region/triggered fields.
//
// Volcano year hints (BC unless _ce noted):
//   etna_140  -> 140 BC (event year = 270-140 = 130 from start = idB 130)
//   etna_135  -> 135 BC -> idB 135?  Actually depending on whether 270 BC = year 0 or year 270
//   But we just learned idB cluster is 275-696. So 270 BC = year 0 makes:
//     etna_140 BC = year 130 (270-140)? OR year 130 means events fire at game-year 130
//   Or game starts at 270 BC = year 270 (calendar-style: |270 BC|)
//     etna_140 BC = year 140 (calendar). The event log idB=275 suggests year 275 = game year 275
//     since 275 BC > 270 BC (start), wait actually 275 BC < 270 BC chronologically (more BC = earlier)
//   Let me check: imperial campaign starts at 270 BC. 5 turns into the game (T5) = year 265 BC.
//   But idB max for T5 save is 696 — so idB grows OVER time. Hence idB is a turn counter, not calendar.
//   Each turn = 1 year. 696 turns from start = 270 BC + 696 = 426 AD. Imperial campaign cap!
//   So idB = (start_year - calendar_year) + 270 ... actually idB IS the running year counter.
//   So idB=275 = 270 BC + 5 = ... no wait.
//
//   Simpler: idB=275, save is T5. 270 BC start year. So turn N maps to idB=270+N? 270+5=275. Confirmed!
//   So:
//     idB = 270 + turn_number  (turn N=0 = 270 BC, but stored as idB=270)
//     etna_140 BC means... calendar year 140 BC = turn (270-140) = 130. But the log uses idB=270+turn=400.
//     So etna_140 should trigger at idB=400 (= 140 BC).
//   OR
//     idB is calendar-style: idB=275 BC, idB=696 AD with crossover at some idB.
//   To distinguish: save_rome10 is T5 imperial. Year = 270 BC + 5 = 265 BC.
//   First event year=275: BC.
//   idB=696 = AD ... 270 BC - 270 = 0 = 1 BC, 271 = AD 1, so idB AD = idB - 270 = AD 426. Yes!
//   So idB increments LINEARLY from 270 BC (idB=0) to AD 426 (idB=696).
//   etna_140 (BC) at year 140 BC = idB=130
//   But our log starts at idB=275 = 270 - 275 = ... wait, what's "idB=275" decoded?
//   If idB=270 -> 270 BC start (turn 0), then idB=275 -> 265 BC = turn 5 = save's current turn.
//   For etna_140 BC (140 BC) -> idB = 270 - 140 = 130.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846d1, END = 0xa8beb;
console.log('Scripted-events table:', '0x' + START.toString(16), '..', '0x' + END.toString(16), '= ' + (END-START) + ' bytes');

// Step 1: enumerate all length-prefixed ASCII strings in this region.
// Format: [u16 lenPlus1][ASCII chars][u8 nul]
const strings = [];
for (let o = START; o < END - 4; ) {
  // Try u16le length prefix
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 > 2 && lenP1 < 128 && o + 2 + lenP1 <= END) {
    // Read lenP1 - 1 chars then a nul
    let s = '';
    let ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c = buf[o + 2 + j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      s += String.fromCharCode(c);
    }
    if (ok && buf[o + 2 + lenP1 - 1] === 0) {
      strings.push({off: o, str: s, len: lenP1});
      o += 2 + lenP1;
      continue;
    }
  }
  o++;
}
console.log('Length-prefixed ASCII strings:', strings.length);
console.log('First 50:');
strings.slice(0, 50).forEach(s=>console.log('  0x' + s.off.toString(16).padStart(7,'0') + ' len=' + s.len.toString().padStart(3) + ' "' + s.str + '"'));

// Print all unique strings
const uniq = new Set(strings.map(s=>s.str));
console.log('\nUnique strings (' + uniq.size + '):');
for (const u of uniq) console.log('  "' + u + '"');

// Step 2: Stride analysis between adjacent string offsets
const stridesAll = [];
for (let i = 1; i < strings.length; i++) stridesAll.push(strings[i].off - strings[i-1].off);
const strideH = {};
stridesAll.forEach(s=>strideH[s]=(strideH[s]||0)+1);
console.log('\nString-to-string stride distribution (top 15):');
Object.entries(strideH).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([s,c])=>console.log('  Δ=' + s.padStart(5) + ' bytes: ' + c));

// Step 3: examine bytes between consecutive strings — these should hold per-event metadata
console.log('\n=== Bytes following each named string (first 8 entries) ===');
strings.slice(0, 8).forEach(s=>{
  const after = s.off + 2 + s.len;
  const trail = buf.subarray(after, Math.min(after + 32, END));
  const hex = Array.from(trail).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  "' + s.str + '" (post=0x' + after.toString(16) + '): ' + hex);
});

// Step 4: try to find year fields after etna_140 etc — search for the integer 140 (BC year) NEARBY
console.log('\n=== Searching for year-hints near volcano names ===');
const volcanoYearMap = {
  'eruption_at_etna_140':   { bc: 140, idB: 270-140 }, // = 130
  'eruption_at_etna_135':   { bc: 135, idB: 270-135 },
  'eruption_at_etna_126':   { bc: 126, idB: 270-126 },
  'eruption_at_etna_122':   { bc: 122, idB: 270-122 },
  'eruption_at_etna_49':    { bc: 49,  idB: 270-49 },
  'eruption_at_etna_44':    { bc: 44,  idB: 270-44 },
  'eruption_at_etna_36':    { bc: 36,  idB: 270-36 },
  'eruption_at_etna_32':    { bc: 32,  idB: 270-32 },
  'eruption_at_etna_10_20_ce': { ce: 10, idB: 270+10 }, // 280 — actually AD 10..20, midpoint
  'eruption_at_etna_38_40_ce': { ce: 38, idB: 270+38 },
  'eruption_at_vulcano_183': { bc: 183, idB: 270-183 },
  'eruption_at_vulcano_126': { bc: 126, idB: 270-126 },
  'eruption_at_vulcano_91':  { bc: 91,  idB: 270-91 },
  'eruption_at_ischia_91':   { bc: 91,  idB: 270-91 },
  'eruption_at_santorini_197': { bc: 197, idB: 270-197 },
  'eruption_at_santorini_46_ce': { ce: 46,  idB: 270+46 },
  'flood_in_rome_241': { bc: 241, idB: 270-241 },
};

// For each known year-anchored event string, scan ±64 bytes for any matching u16/u32 value
const RANGE = 80;
for (const s of strings) {
  const v = volcanoYearMap[s.str];
  if (!v) continue;
  // Scan around the string for likely year values
  const cands = [];
  const start = Math.max(START, s.off - RANGE);
  const end = Math.min(END, s.off + 2 + s.len + RANGE);
  for (let o = start; o < end - 4; o++) {
    const u16 = buf.readUInt16LE(o);
    const u32 = buf.readUInt32LE(o);
    if (u16 === v.idB) cands.push({off: o, val: u16, type: 'u16', delta: o - s.off});
    if (u32 === v.idB) cands.push({off: o, val: u32, type: 'u32', delta: o - s.off});
    if (v.bc !== undefined) {
      if (u16 === v.bc) cands.push({off: o, val: u16, type: 'u16-BCyear', delta: o - s.off});
      if (u32 === v.bc) cands.push({off: o, val: u32, type: 'u32-BCyear', delta: o - s.off});
    }
    if (v.ce !== undefined) {
      if (u16 === v.ce) cands.push({off: o, val: u16, type: 'u16-CEyear', delta: o - s.off});
      if (u32 === v.ce) cands.push({off: o, val: u32, type: 'u32-CEyear', delta: o - s.off});
    }
  }
  console.log('  "' + s.str + '" expect idB=' + v.idB + ': cands ' + cands.slice(0,8).map(c => c.type + '@Δ' + c.delta + '=' + c.val).join(', '));
}

// Step 5: scan the whole table for u32 values matching valid idB-year-range (0..700)
// and find offset patterns relative to string positions
console.log('\n=== Global view: zero/nonzero byte ratio in the table ===');
let zeros = 0, ones = 0, others = 0;
for (let o = START; o < END; o++) {
  const b = buf[o];
  if (b === 0) zeros++;
  else if (b === 0xff) ones++;
  else others++;
}
console.log('  zeros: ' + zeros + ' (' + (100*zeros/(END-START)).toFixed(1) + '%)');
console.log('  0xff:  ' + ones);
console.log('  other: ' + others);

// Step 6: look at the first 0x100 bytes for a header
console.log('\n=== First 256 bytes of scripted-events table ===');
for (let o = START; o < START + 256; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}

// Step 7: count of each string in the table — most are "volcano", "eruption", "earthquake"
const strCount = {};
strings.forEach(s=>strCount[s.str]=(strCount[s.str]||0)+1);
console.log('\nString frequency (all):');
Object.entries(strCount).sort((a,b)=>b[1]-a[1]).forEach(([s,c])=>console.log('  ' + s.padEnd(35) + ' = ' + c));
