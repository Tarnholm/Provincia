// dig-section-around-splice.js
//
// Hypothesis: the "next < buffer_end Failed" infinite loop on TEST_D_splice
// means the engine walks by SECTION SIZE, not by record count. Our 462-byte
// splice at record #50's position broke a parent section's size header.
//
// Task: find every taw-section header {u32 self_offset, u32 size} where
// self_offset matches the actual byte position, then identify which ones
// CONTAIN the splice point at 0x1896d92 in the original save.
//
// Section validity check: at offset P, the u32 at P must equal P (the
// self-offset invariant), and the u32 at P+4 (= size) must be sane
// (8 <= size <= file_remaining).

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const SPLICE_OFF = 0x1896d92;        // record #50 lenPrefixOff (from test-dead-pool-splice output)
const SPLICE_BYTES = 462;

const buf = fs.readFileSync(SRC);
console.log(`source: ${buf.length.toLocaleString()} bytes`);
console.log(`splice point: 0x${SPLICE_OFF.toString(16)}  removing ${SPLICE_BYTES} bytes`);
console.log();

// Walk the whole file looking for section headers where u32@P == P.
// That alone is a noisy match — there'll be lots of spurious matches in
// dense binary regions. Apply secondary check: u32@P+4 (size) must fit.
const sections = [];
const STEP = 1; // exhaustive
for (let p = 0; p + 8 <= buf.length; p += STEP) {
  const self = buf.readUInt32LE(p);
  if (self !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 8 || p + size > buf.length) continue;
  sections.push({ off: p, size });
}
console.log(`raw section-header candidates: ${sections.length}`);

// Filter to "containers of the splice point". A section at offset P with
// size S contains the splice if  P <= SPLICE_OFF  AND  P + S > SPLICE_OFF.
const containers = sections.filter(s => s.off <= SPLICE_OFF && s.off + s.size > SPLICE_OFF);
console.log(`sections that CONTAIN the splice point: ${containers.length}`);
console.log();

// Sort by size descending so we see the largest enclosing first.
containers.sort((a, b) => b.size - a.size);
console.log(`offset      size           end          slack-after-splice`);
console.log(`----------  -------------  -----------  ------------------`);
for (const s of containers.slice(0, 40)) {
  const end = s.off + s.size;
  // After splicing 462 bytes out, the new data inside this section ends
  // 462 B earlier. If size isn't decremented, the iterator runs from
  // s.off+8 for (size-8) bytes and overshoots by 462.
  console.log(`0x${s.off.toString(16).padEnd(8)}  ${String(s.size).padStart(13)}  0x${end.toString(16).padEnd(9)}  needs -${SPLICE_BYTES}`);
}
console.log();
console.log(`Smallest container = innermost section containing the spliced record.`);
console.log(`That section's size u32 MUST be decremented by ${SPLICE_BYTES} for the iterator to terminate cleanly.`);
console.log(`Parent sections also need decrementing (since they contain the spliced bytes too).`);

// Also report: sections that START AFTER the splice point. Their self_offset
// u32 must be decremented in the spliced save (since their file position
// shifted by -462). Count them.
const downstreamSections = sections.filter(s => s.off > SPLICE_OFF);
console.log();
console.log(`sections starting AFTER splice point: ${downstreamSections.length}`);
console.log(`each one's self_offset u32 needs -${SPLICE_BYTES} adjustment`);
console.log(`first 5 downstream:`);
for (const s of downstreamSections.slice(0, 5)) {
  console.log(`  off=0x${s.off.toString(16)}  size=${s.size}`);
}
