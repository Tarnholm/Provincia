// dig-rebellion-head1.js — Decode the variable-length head section of the 6
// scripted-rebellion blocks. Session 16 noted these contain "fully embedded
// character data — portrait paths, settlement names, ~43 generals in the
// cilicians block." Goal: extract the structure.
//
// From session 14/16 we have boundaries:
//   rebellion block:
//     [u16 strLen][UTF-16LE path][u32 selfPtr][u32 0][u16 0][u32 count][HEAD][239×16 faction array][TAIL]
//
// Block offsets (rome10):
//   chrysaoria_revolt: block start 0x18d3741, faction array 0x18d3821
//     → head = (0x18d3821 - 0x18d3741) = 0xe0 = 224 bytes
//   cilicians_revolt:  0x18d48cb, faction array 0x18e7f4b
//     → head ≈ 0x13680 = ~78,464 bytes (big!)
//   egypt_revolt:     0x1956838, faction array 0x19af6f8
//     → head ≈ 0x58ec0 = ~364KB
//   lycia_revolt:     0x1ab16e1, faction array 0x1ace821
//     → head ≈ 0x1d140 = ~118KB
//   miletus_revolt:   0x1b0f06d, faction array 0x1b765dd
//     → head ≈ 0x67570 = ~423KB
//   thessaly_revolt:  0x1c93a64, faction array 0x1c99b64
//     → head ≈ 0x6100 = ~25KB

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(ROME10);

// First, locate the chrysaoria block precisely and dump its head.
function findPath(buf, name) {
  // Search for UTF-16LE path needle
  const needle = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    needle[i * 2] = name.charCodeAt(i);
    needle[i * 2 + 1] = 0;
  }
  return buf.indexOf(needle);
}

const scripts = [
  { name: "chrysaoria_revolt.txt", arrayStart: 0x18d3821 },
  { name: "cilicians_revolt.txt", arrayStart: 0x18e7f4b },
  { name: "egypt_revolt.txt", arrayStart: 0x19af6f8 },
  { name: "lycia_revolt.txt", arrayStart: 0x1ace821 },
  { name: "miletus_revolt.txt", arrayStart: 0x1b765dd },
  { name: "thessaly_revolt.txt", arrayStart: 0x1c99b64 },
];

for (const s of scripts) {
  const pathOff = findPath(buf, s.name);
  // The path is preceded by a u16 strLen.
  // Then: [u32 selfPtr][u32 0][u16 0][u32 count]
  const strLenOff = pathOff - 2;
  const strLen = buf.readUInt16LE(strLenOff);
  const pathEnd = pathOff + s.name.length * 2;
  const blockStart = strLenOff;
  // Skip path
  let p = pathEnd;
  const selfPtr = buf.readUInt32LE(p); p += 4;
  const zero1 = buf.readUInt32LE(p); p += 4;
  const zero2 = buf.readUInt16LE(p); p += 2;
  const count = buf.readUInt32LE(p); p += 4;
  const headStart = p;
  const headEnd = s.arrayStart;
  const headSize = headEnd - headStart;
  console.log(`\n===== ${s.name} =====`);
  console.log(`  path at 0x${pathOff.toString(16)}, strLen=${strLen}, blockStart=0x${blockStart.toString(16)}`);
  console.log(`  selfPtr=0x${selfPtr.toString(16)} (expected near 0x${pathEnd.toString(16)})`);
  console.log(`  count=${count}`);
  console.log(`  head: 0x${headStart.toString(16)}..0x${headEnd.toString(16)} = ${headSize} bytes`);

  // Dump first 256 bytes of head
  console.log(`  Head dump (first 192 bytes):`);
  for (let row = 0; row < 12; row++) {
    const off = headStart + row * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`    0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }

  // Count ASCII strings (portrait paths) in head
  const portraits = [];
  const portraitNeedle = Buffer.from("data/ui/", "ascii");
  let q = headStart;
  while ((q = buf.indexOf(portraitNeedle, q)) !== -1 && q < headEnd) {
    let end = q;
    while (end < headEnd && buf[end] >= 0x20 && buf[end] <= 0x7e) end++;
    portraits.push({ off: q, s: buf.slice(q, end).toString("ascii") });
    q = end;
  }
  console.log(`  ASCII portrait paths: ${portraits.length}`);
  for (const p of portraits.slice(0, 5)) console.log(`    0x${p.off.toString(16)}: ${p.s}`);

  // Count UTF-16LE strings (settlement names)
  const utf16Strings = [];
  for (let r = headStart; r < headEnd - 16; r++) {
    // Look for an ASCII letter followed by 0x00 (start of UTF-16LE)
    if (buf[r] >= 0x41 && buf[r] <= 0x7a && buf[r + 1] === 0x00 && buf[r + 2] >= 0x41 && buf[r + 2] <= 0x7a) {
      let str = "";
      let pp = r;
      while (pp < headEnd && buf[pp + 1] === 0x00 && buf[pp] >= 0x20 && buf[pp] <= 0x7e) {
        str += String.fromCharCode(buf[pp]);
        pp += 2;
      }
      if (str.length >= 4) {
        utf16Strings.push({ off: r, s: str });
        r = pp - 1;
      }
    }
  }
  console.log(`  UTF-16LE strings (len>=4): ${utf16Strings.length}`);
  for (const u of utf16Strings.slice(0, 8)) console.log(`    0x${u.off.toString(16)}: ${JSON.stringify(u.s)}`);
}
