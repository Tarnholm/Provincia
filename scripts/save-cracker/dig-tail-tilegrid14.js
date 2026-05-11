// dig-tail-tilegrid14.js — Cross-validate the tile-mask records against
// map_regions_large.tga. Test: does record [i]'s mask overlap regions that
// faction [i] is supposed to control / see?

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

const buf = fs.readFileSync(ROME10);
const W = 1020, H = 700;

// Find all records
const records = [];
for (let p = 0x1f00000; p < buf.length - 16; p++) {
  if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
    const a = buf.readUInt32LE(p + 4);
    const b = buf.readUInt32LE(p + 8);
    if (a === 0x3fc && b === 0x2bc) records.push(p - 8);
  }
}

function decodeMask(buf, p, nextP) {
  const payloadStart = p + 20;
  const payloadEnd = nextP > 24 ? nextP - 24 : nextP;
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  for (let q = payloadStart; q < payloadEnd - 1; q += 2) {
    const cell = buf.readUInt16LE(q);
    const value = cell & 0xff;
    const count = (cell >> 8) & 0xff;
    for (let k = 0; k < count && cursor < mask.length; k++) {
      mask[cursor++] = value;
    }
    if (cursor >= mask.length) break;
  }
  return mask;
}

// Load TGA
const tga = fs.readFileSync("C:/dev/Provincia/public/map_regions_large.tga");
const TGAW = tga.readUInt16LE(12);
const TGAH = tga.readUInt16LE(14);
const pixelDepth = tga.readUInt8(16);
const imageDescriptor = tga.readUInt8(17);
console.log(`TGA: ${TGAW}x${TGAH}, bpp=${pixelDepth}, desc=0x${imageDescriptor.toString(16)}`);
const tgaPixels = tga.subarray(18);
console.log(`TGA pixel data size: ${tgaPixels.length} (expected ${TGAW * TGAH * (pixelDepth / 8)})`);
const bpp = pixelDepth / 8;

function getPixel(x, y) {
  // TGA can be bottom-up or top-down. The image_descriptor bit 5 = top-down.
  const isTopDown = (imageDescriptor & 0x20) !== 0;
  const realY = isTopDown ? y : (TGAH - 1 - y);
  const off = (realY * TGAW + x) * bpp;
  if (bpp === 3) {
    // BGR
    return (tgaPixels[off + 2] << 16) | (tgaPixels[off + 1] << 8) | tgaPixels[off];
  } else if (bpp === 4) {
    return (tgaPixels[off + 2] << 16) | (tgaPixels[off + 1] << 8) | tgaPixels[off];
  }
  return 0;
}

// Sample some pixels
console.log(`Sample pixels: (100,100)=0x${getPixel(100,100).toString(16)}, (500,300)=0x${getPixel(500, 300).toString(16)}, (734, 380)=0x${getPixel(734, 380).toString(16)}`);

// For record 7 (centroid 734, 380 — likely Seleucid in Asia Minor), what TGA color
// dominates the non-zero cells?
function colorHistOfMask(buf, p, nextP, label) {
  const mask = decodeMask(buf, p, nextP);
  const colorHist = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] !== 0) {
        const c = getPixel(x, y);
        colorHist.set(c, (colorHist.get(c) || 0) + 1);
      }
    }
  }
  const sorted = [...colorHist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n${label}:`);
  console.log(`  ${sorted.length} distinct colors in non-zero cells`);
  console.log(`  Top 10: ${sorted.slice(0, 10).map(([c, n]) => `#${c.toString(16).padStart(6,"0")}=${n}`).join(" ")}`);
}

// Test 8 records
for (const i of [0, 1, 5, 6, 7, 67, 144, 238]) {
  const p = records[i];
  const nextP = i + 1 < records.length ? records[i + 1] : buf.length;
  colorHistOfMask(buf, p, nextP, `Record ${i}`);
}

// Now also: for each record, output the non-zero cells in compressed form, and the dominant color
console.log(`\n===== Summary: dominant color per record =====`);
const factionDescr = {
  // Approximate guess based on RIS major faction order
  0: "?",
  1: "Romans Julii (player)",
  2: "Romans Brutii",
  3: "Romans Scipii",
  4: "Romans SPQR (Senate)",
};
for (let i = 0; i < records.length; i++) {
  const p = records[i];
  const nextP = i + 1 < records.length ? records[i + 1] : buf.length;
  const mask = decodeMask(buf, p, nextP);
  const colorHist = new Map();
  let nonZero = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] !== 0) {
        nonZero++;
        const c = getPixel(x, y);
        colorHist.set(c, (colorHist.get(c) || 0) + 1);
      }
    }
  }
  if (nonZero === 0) continue;
  const sorted = [...colorHist.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (i < 25 || nonZero > 5000) {
    console.log(`  rec[${i}] nonZero=${nonZero}, top color #${top[0].toString(16).padStart(6,"0")}=${top[1]} (${(top[1]/nonZero*100).toFixed(1)}%); ${sorted.length} distinct colors`);
  }
}
