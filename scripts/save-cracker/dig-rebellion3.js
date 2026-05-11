// dig-rebellion3.js — The 75/76/95/144/159/213 count appears NOT to be 16-byte records.
// Each record looks variable-length, often starting with a hash followed by a selfPtr.
//
// Hypothesis: the records are TAW-style self-pointed sections:
//   [u32 hash][u32 selfPtr-to-next][...sub-data until next record start]
// Or:
//   [u32 selfPtr to end-of-this-record][u8/u16 data type][...]
//
// Find the actual stride pattern by walking from the first record forward to
// the position of the NEXT script path (gives the block end).

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const blocks = [
  { name: "chrysaoria", strLenOff: 0x18d3695, nextStrLenOff: 0x18d4821 },
  { name: "cilicians",  strLenOff: 0x18d4821, nextStrLenOff: 0x1956796 },
  { name: "egypt",      strLenOff: 0x1956796, nextStrLenOff: 0x1ab163f },
  { name: "lycia",      strLenOff: 0x1ab163f, nextStrLenOff: 0x1b0efc7 },
  { name: "miletus",    strLenOff: 0x1b0efc7, nextStrLenOff: 0x1c939bc },
  { name: "thessaly",   strLenOff: 0x1c939bc, nextStrLenOff: null },     // need to find end
];

function blockSize(b) {
  const charCount = buf.readUInt16LE(b.strLenOff);
  const strEnd = b.strLenOff + 2 + charCount * 2;
  const count = buf.readUInt32LE(strEnd + 10);
  const recStart = strEnd + 14;
  let blockEnd;
  if (b.nextStrLenOff) {
    // The next script's preamble likely starts with 16 zeros + `03 00 01` before strLen
    // Walk back from nextStrLenOff to find the previous block's last data
    blockEnd = b.nextStrLenOff - 16 - 3; // approximate
  } else {
    blockEnd = b.strLenOff + 0x10000; // generous probe
  }
  const payloadBytes = blockEnd - recStart;
  console.log(`${b.name}: payloadBytes=${payloadBytes} count=${count} avgPerRec=${(payloadBytes/count).toFixed(2)}`);
  return { ...b, charCount, strEnd, count, recStart, blockEnd, payloadBytes };
}

const decoded = blocks.map(blockSize);

// Now walk by hash + selfPtr to find record boundaries.
// Most records seem to start with: 4 bytes hash + u32 selfPtr+4 (i.e., second u32 points to record's own offset+4).
// E.g. chrysaoria rec[0] @0x18d3741: u32[0]=0xcc17acbf (hash) u32[1]=0x18d3745 (selfPtr+4)
// 0x18d3745 = 0x18d3741 + 4 ✓
//
// cilicians rec[0] @0x18d48cb: u32[0]=0x68531e36 (hash) u32[1]=0x18d48cf (selfPtr+4) ✓
// egypt rec[0] @0x1956838: u32[0]=0xa9b020a3 (hash) u32[1]=0x195683c (selfPtr+4) ✓
// lycia rec[0] @0x1ab16e1: u32[0]=0xf8416306 (hash) u32[1]=0x1ab16e5 (selfPtr+4) ✓
// miletus rec[0] @0x1b0f06d: u32[0]=0xbead7685 (hash) u32[1]=0x1b0f071 (selfPtr+4) ✓
// thessaly rec[0] @0x1c93a64: u32[0]=0xab106bdc (hash) u32[1]=0x1c93a68 (selfPtr+4) ✓
//
// So FIRST record is [u32 hash][u32 selfPtr+4][... variable ...]
// But what comes after? Look at chrysaoria rec[0]:
//   bf ac 17 cc 45 37 8d 01 0f 00 00 00 00 00 00 00
//   then 16 bytes of zero (rec[1]: 0,0,0, then 5d 37 8d 01)
//   then 0x18d375d = self-ptr at 0x18d375d-4 = 0x18d3759? no, 0x18d375d itself.
//
// Look at cilicians rec[0..]: starts at 0x18d48cb with hash. Second selfPtr-bearing
// position is 0x18d48cf, then 0x18d48d7 ('e7 48 8d 01' at 0x18d48d7), then 0x18d48eb
// (which is `39 00 00 00 01 00 00 00 ...`) — wait that's not a hash.
//
// Better: walk forward picking up any u32 in the chrysaoria range that equals its own offset+0 or +4.

for (const b of decoded) {
  console.log(`\n=== ${b.name} self-ptr chain ===`);
  const sentinels = [];
  for (let p = b.recStart; p < b.blockEnd - 4; p++) {
    const v = buf.readUInt32LE(p);
    if (v === p) sentinels.push({ off: p, type: "self" });
    else if (v === p + 4) sentinels.push({ off: p, type: "self+4" });
  }
  console.log(`  total self-ptr-bearing positions: ${sentinels.length}`);
  console.log(`  expected count: ${b.count}`);
  // First 20 sentinels
  for (let i = 0; i < Math.min(20, sentinels.length); i++) {
    const s = sentinels[i];
    console.log(`    [${i}] @0x${s.off.toString(16)} ${s.type}`);
  }
  // Stride deltas between consecutive sentinels
  const deltas = [];
  for (let i = 1; i < sentinels.length; i++) {
    deltas.push(sentinels[i].off - sentinels[i - 1].off);
  }
  // Histogram of deltas
  const hist = {};
  for (const d of deltas) hist[d] = (hist[d] || 0) + 1;
  const topDeltas = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`  delta histogram (top 10):`);
  for (const [d, c] of topDeltas) console.log(`    delta=${d} (×${c})`);
}
