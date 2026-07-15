// TGA encoding for building-icon replacement, extracted from main.js
// (2026-07-15). Pure — no state. RTW loads uncompressed TGAs only, so dropped
// PNG/JPG icons are decoded via Electron nativeImage (that part stays in the
// main-process handler) and re-encoded here as 32-bit BGRA.
"use strict";

// Build an uncompressed 32-bit BGRA TGA buffer, top-down (descriptor bit 5),
// from raw BGRA pixel bytes. 18-byte header + pixels.
function encodeTga32BGRA(width, height, bgraBuf) {
  const header = Buffer.alloc(18);
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[2] = 2;          // uncompressed true-color
  header[16] = 32;        // pixel depth
  header[17] = 8 | 0x20;  // 8 alpha bits, top-down
  return Buffer.concat([header, bgraBuf]);
}

module.exports = { encodeTga32BGRA };
