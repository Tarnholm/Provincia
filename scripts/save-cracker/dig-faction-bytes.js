// dig-faction-bytes.js — session 5
//
// Dump bytes around each faction-id-string occurrence with context. Look for
// the record header (self-pointer at -16 or -20).
const fs = require("fs");
const path = require("path");

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

function hex(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let s = "";
  for (let i = start; i < end; i += 1) {
    s += buf[i].toString(16).padStart(2, "0") + " ";
    if ((i - start) % 16 === 15) s += "\n  ";
  }
  return s;
}

function ascii(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let s = "";
  for (let i = start; i < end; i += 1) {
    const b = buf[i];
    s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return s;
}

function checkSelfPointer(buf, addr) {
  if (addr < 0 || addr + 4 > buf.length) return null;
  const v = buf.readUInt32LE(addr);
  return v === addr ? "SELF" : v.toString(16);
}

function main() {
  const filePath = process.argv[2];
  const buf = fs.readFileSync(filePath);
  console.log("File:", path.basename(filePath), buf.length);

  const tokens = ["romans_julii", "sparta", "carthage", "athens"];
  for (const tok of tokens) {
    const occ = findOccurrences(buf, tok);
    console.log(`\n## ${tok} (${occ.length}): first 3 contexts`);
    for (const o of occ.slice(0, 3)) {
      console.log(`\n  --- occurrence 0x${o.toString(16)} ---`);
      console.log(`  -32..-1: ${hex(buf, o - 32, 32)}\n         |${ascii(buf, o - 32, 32)}|`);
      console.log(`  +0..+47: ${hex(buf, o, 48)}\n         |${ascii(buf, o, 48)}|`);
      // Check self-pointers at common offsets
      for (const dist of [-4, -8, -12, -16, -20, -24, -28, -32, -40, -64, -96, -128, -256, -512, -1024, -1920, -1944]) {
        const r = checkSelfPointer(buf, o + dist);
        if (r === "SELF") console.log(`    SELF-POINTER at ${dist} from string start (= 0x${(o + dist).toString(16)})`);
      }
    }
  }
}

main();
