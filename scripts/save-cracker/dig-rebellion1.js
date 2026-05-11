// dig-rebellion1.js — Decode the 16-byte rebellion records inside the 6 scripted-rebellion blocks.
//
// Each block has shape:
//   [u16-LE strLen][UTF-16LE path][selfPtr][zero][count][count × 16-byte records]
//
// Block locations in rome10:
//   0x18d3693 chrysaoria  count=75
//   0x18d481f cilicians   count=76
//   0x1956794 egypt       count=95
//   0x1ab163d lycia       count=144
//   0x1b0efc5 miletus     count=159
//   0x1c939ba thessaly    count=213

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const blocks = [
  { name: "chrysaoria", strOff: 0x18d3693 },
  { name: "cilicians",  strOff: 0x18d481f },
  { name: "egypt",      strOff: 0x1956794 },
  { name: "lycia",      strOff: 0x1ab163d },
  { name: "miletus",    strOff: 0x1b0efc5 },
  { name: "thessaly",   strOff: 0x1c939ba },
];

// Re-derive the path & header for each. session 14 noted that strOff points to
// just before the u16 strLen (so .s[0] starts at strOff+2). But session 14's
// "Body offset" column likely is the string start byte.
// Let's just locate each script path again the robust way: scan around strOff
// for `2e 00 74 00 78 00 74 00` (".txt" in UTF-16LE) within +/- 200 bytes.

for (const block of blocks) {
  console.log(`\n=== ${block.name} ===`);
  // Find ".txt" in nearby region
  let dotTxt = -1;
  for (let p = block.strOff; p < block.strOff + 400; p++) {
    if (buf[p] === 0x2e && buf[p + 1] === 0 && buf[p + 2] === 0x74 && buf[p + 3] === 0 &&
        buf[p + 4] === 0x78 && buf[p + 5] === 0 && buf[p + 6] === 0x74 && buf[p + 7] === 0) {
      dotTxt = p;
      break;
    }
  }
  if (dotTxt < 0) { console.log("  no .txt found"); continue; }
  // Walk back to find string start (ASCII chars even index, zero odd)
  let strStart = dotTxt;
  while (strStart - 2 >= 0 && buf[strStart - 1] === 0 && buf[strStart - 2] >= 0x20 && buf[strStart - 2] <= 0x7e) {
    strStart -= 2;
  }
  const pathEnd = dotTxt + 8;
  const path = buf.slice(strStart, pathEnd).toString("utf16le");
  console.log(`  pathStart=0x${strStart.toString(16)} pathEnd=0x${pathEnd.toString(16)} path=${path}`);
  // After path: [selfPtr u32][zero u32][count u32][count × 16 bytes]
  const afterPath = pathEnd;
  const selfPtr = buf.readUInt32LE(afterPath);
  const zero = buf.readUInt32LE(afterPath + 4);
  const count = buf.readUInt32LE(afterPath + 8);
  console.log(`  afterPath=0x${afterPath.toString(16)} selfPtr=0x${selfPtr.toString(16)} zero=${zero} count=${count}`);
  // selfPtr should equal afterPath
  if (selfPtr === afterPath) console.log(`  selfPtr matches afterPath`);
  else console.log(`  selfPtr DOES NOT match (delta=${selfPtr - afterPath})`);

  // Record start
  const recStart = afterPath + 12;
  console.log(`  recStart=0x${recStart.toString(16)} expected bytes=${count * 16}`);
  // Hex dump of first 5 records
  for (let i = 0; i < Math.min(5, count); i++) {
    const off = recStart + i * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    // also decode as 4 u32s
    const u32s = [];
    for (let k = 0; k < 4; k++) u32s.push(buf.readUInt32LE(off + k * 4));
    console.log(`    [${i}] @0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}  u32s=[${u32s.join(", ")}]`);
  }
  console.log(`  ... (showing 5 of ${count})`);
  // last record
  if (count >= 1) {
    const off = recStart + (count - 1) * 16;
    const u32s = [];
    for (let k = 0; k < 4; k++) u32s.push(buf.readUInt32LE(off + k * 4));
    console.log(`    [last @${count - 1}] u32s=[${u32s.join(", ")}]`);
  }
}
