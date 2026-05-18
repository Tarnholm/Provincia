// src/portraitDecoder.js
//
// Decodes RTW per-character portrait files (`.tga.dds` despite the
// extension — the actual content is LZ4-frame-compressed DDS with DXT1
// texture data). Returns an ImageData-ready RGBA buffer.
//
// Pipeline:
//   raw bytes -> LZ4 decompress -> DDS header parse -> DXT1 unpack -> RGBA

"use strict";

import LZ4 from "lz4js";

// DDS magic "DDS " little-endian = 0x20534444
const DDS_MAGIC = 0x20534444;
// LZ4 frame magic 0x184D2204
const LZ4_MAGIC = 0x184d2204;

// Decompress an LZ4 frame buffer; if the input isn't LZ4-framed, returns
// it unchanged (some RTW assets ship raw, others compressed).
function tryLz4Decompress(bytes) {
  if (bytes.length < 4) return bytes;
  const magic = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  if (magic >>> 0 !== LZ4_MAGIC) return bytes;
  return LZ4.decompress(bytes);
}

// Convert RGB565 (16-bit) -> {r,g,b} 0-255.
function rgb565(c) {
  const r5 = (c >> 11) & 0x1f;
  const g6 = (c >> 5) & 0x3f;
  const b5 = c & 0x1f;
  return {
    r: (r5 << 3) | (r5 >> 2),
    g: (g6 << 2) | (g6 >> 4),
    b: (b5 << 3) | (b5 >> 2),
  };
}

// Decompress a single DXT1 block (8 bytes) into a 4x4 RGBA tile written
// into `out` at position (bx*4, by*4) of a width-`stride` image.
function decodeDxt1Block(block, off, out, x, y, w, h) {
  const c0 = block[off] | (block[off + 1] << 8);
  const c1 = block[off + 2] | (block[off + 3] << 8);
  const a = rgb565(c0);
  const b = rgb565(c1);
  const palette = [a, b, null, null];
  if (c0 > c1) {
    palette[2] = {
      r: ((2 * a.r + b.r + 1) / 3) | 0,
      g: ((2 * a.g + b.g + 1) / 3) | 0,
      b: ((2 * a.b + b.b + 1) / 3) | 0,
    };
    palette[3] = {
      r: ((a.r + 2 * b.r + 1) / 3) | 0,
      g: ((a.g + 2 * b.g + 1) / 3) | 0,
      b: ((a.b + 2 * b.b + 1) / 3) | 0,
    };
  } else {
    palette[2] = {
      r: ((a.r + b.r) >> 1),
      g: ((a.g + b.g) >> 1),
      b: ((a.b + b.b) >> 1),
    };
    palette[3] = { r: 0, g: 0, b: 0 };
  }
  const indices = block[off + 4] | (block[off + 5] << 8) |
    (block[off + 6] << 16) | (block[off + 7] << 24);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const idx = (indices >>> (2 * (4 * py + px))) & 0x3;
      const dx = x + px, dy = y + py;
      if (dx >= w || dy >= h) continue;
      const p = palette[idx];
      const o = (dy * w + dx) * 4;
      out[o] = p.r;
      out[o + 1] = p.g;
      out[o + 2] = p.b;
      out[o + 3] = (c0 <= c1 && idx === 3) ? 0 : 255;
    }
  }
}

// Parse a DDS file (after any LZ4 decompression) and return decoded
// `{width, height, rgba}`. Supports DXT1 only — sufficient for every RTW
// portrait file we've inspected.
function decodeDds(bytes) {
  if (bytes.length < 128) throw new Error("DDS too short");
  const magic = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  if (magic >>> 0 !== DDS_MAGIC) throw new Error("Not a DDS file");
  // DDS_HEADER fields we care about (offsets from start of file):
  //   12: height (u32)
  //   16: width  (u32)
  //   84: pixelformat.dwFourCC (4 chars)
  const height = bytes[12] | (bytes[13] << 8) | (bytes[14] << 16) | (bytes[15] << 24);
  const width = bytes[16] | (bytes[17] << 8) | (bytes[18] << 16) | (bytes[19] << 24);
  const fourCC = String.fromCharCode(bytes[84], bytes[85], bytes[86], bytes[87]);
  if (fourCC !== "DXT1") throw new Error("Unsupported DDS format: " + fourCC);
  const pixelOff = 128;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let off = pixelOff;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      decodeDxt1Block(bytes, off, rgba, bx, by, width, height);
      off += 8;
    }
  }
  return { width, height, rgba };
}

export function decodeRtwPortraitBytes(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dds = tryLz4Decompress(bytes);
  return decodeDds(dds);
}
