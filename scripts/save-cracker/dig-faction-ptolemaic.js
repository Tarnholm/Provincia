// dig-faction-ptolemaic.js — session 5
//
// The value 20000 (Ptolemaic starting wealth) appears only TWICE in the
// turn-1 save: at 0x162f838 and 0x162f910 (delta=216 bytes). Dump the
// surrounding bytes to see the faction record context, then look for the
// faction internal name string nearby.
const fs = require("fs");
const path = require("path");

function ascii(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let s = "";
  for (let i = start; i < end; i += 1) {
    const b = buf[i];
    s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return s;
}

function dump(buf, start, len) {
  console.log(`\n=== 0x${start.toString(16)}..0x${(start + len).toString(16)} ===`);
  for (let i = 0; i < len; i += 32) {
    const here = start + i;
    let hexp = "";
    let asc = "";
    for (let k = 0; k < 32 && here + k < buf.length; k += 1) {
      hexp += buf[here + k].toString(16).padStart(2, "0") + " ";
      const c = buf[here + k];
      asc += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ".";
    }
    console.log(`  0x${here.toString(16).padStart(8, "0")}  ${hexp.padEnd(96)} |${asc}|`);
  }
}

function findAsciiString(buf, addr, maxBack = 4096, maxLen = 64) {
  // Find the nearest ASCII string ending before `addr`.
  let i = addr - 1;
  let stringEnd = null;
  let stringStart = null;
  while (i > addr - maxBack && i >= 0) {
    // Look for an ASCIIZ before us
    const b = buf[i];
    if (b === 0) {
      // Check if there's a string ending just before
      if (i > 0 && buf[i - 1] >= 0x20 && buf[i - 1] <= 0x7e) {
        stringEnd = i;
        // walk back to find start
        let j = i - 1;
        while (j >= 0 && buf[j] >= 0x20 && buf[j] <= 0x7e) j -= 1;
        stringStart = j + 1;
        if (stringEnd - stringStart >= 3 && stringEnd - stringStart <= maxLen) {
          return { start: stringStart, end: stringEnd, text: ascii(buf, stringStart, stringEnd - stringStart) };
        }
      }
    }
    i -= 1;
  }
  return null;
}

function findOccurrences(buf, tok) {
  const out = [];
  const tokBytes = Buffer.from(tok, "utf8");
  for (let i = 0; i < buf.length - tokBytes.length; i += 1) {
    if (buf[i] !== tokBytes[0]) continue;
    let ok = true;
    for (let k = 1; k < tokBytes.length; k += 1) {
      if (buf[i + k] !== tokBytes[k]) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

function main() {
  const filePath = process.argv[2];
  const buf = fs.readFileSync(filePath);
  console.log("File:", path.basename(filePath), buf.length);

  const positions = [0x162f838, 0x162f910];
  for (const pos of positions) {
    console.log(`\n## 20000 at 0x${pos.toString(16)}`);
    dump(buf, pos - 96, 200);
  }

  // Find all "ptolemaic" / "egyptian" string occurrences
  for (const tok of ["ptolemaic", "egyptian", "Ptolemaic", "PTOLEMAIC", "egypt"]) {
    const occ = findOccurrences(buf, tok);
    if (occ.length === 0) continue;
    console.log(`\n${tok}: ${occ.length} occurrences. First 10:`);
    for (const o of occ.slice(0, 10)) console.log(`  0x${o.toString(16)}`);
  }
}

main();
