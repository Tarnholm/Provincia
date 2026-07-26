/**
 * TGA → PNG for the wiki generators. One copy, because there were two and they were
 * identically wrong.
 *
 * HISTORY, so the trap is not re-entered. The building icons and unit cards shipped as
 * horizontal colour stripes. The generators were not at fault: `tgaToRaw` assumed 24bpp
 * source pixels and advanced its read pointer 3 bytes per pixel, so on the 32bpp RLE files
 * these art assets use, the source drifted 1 byte per pixel. Output was the right SIZE
 * with progressively rotated channels — which is why the byte-count checks all passed, why
 * row 0 looked correct, and why nothing threw. Size checks cannot see this class of bug;
 * only looking at the image can.
 *
 * ALPHA. Roughly half of a building icon is fully transparent (10,033 of 19,344 px on
 * #roman_agroforestry_1). Writing opaque RGB paints whatever BGR sits under the
 * transparent pixels — usually black — as a solid slab. So a source with an alpha channel
 * becomes an RGBA PNG (colour type 6) and keeps its transparency.
 */
const fs = require("fs");
const zlib = require("zlib");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * Encode pixels as a PNG. `channels` is 3 (RGB, colour type 2) or 4 (RGBA, colour type 6).
 * `px` is tightly packed, top row first, no filter bytes — they are added here.
 */
function png(w, h, px, channels = 3) {
  const stride = w * channels;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;                       // bit depth
  ihdr[9] = channels === 4 ? 6 : 2;  // colour type: 6 = RGBA, 2 = RGB
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;       // filter: none
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Read a TGA and return { buf, w, h, channels } for a PNG of it, downscaled by `scale`
 * (nearest neighbour — these are UI assets shown at or below source size).
 *
 * `dg` is the descrStratGeneral module, passed in so this file does not reach across the
 * repo for it. It hands back BGR triples in storage order plus, for 32bpp sources, a
 * separate alpha plane.
 */
function convert(dg, file, scale) {
  const t = dg.tgaToRaw(fs.readFileSync(file));
  if (!t || !t.W || !t.raw) return null;
  const bottomUp = !(t.desc & 0x20);
  const channels = t.alpha ? 4 : 3;
  const ow = Math.max(1, Math.floor(t.W / scale));
  const oh = Math.max(1, Math.floor(t.H / scale));
  const out = Buffer.alloc(ow * oh * channels);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(t.W - 1, x * scale);
      const ry = Math.min(t.H - 1, y * scale);
      const sy = bottomUp ? t.H - 1 - ry : ry;
      const si = (sy * t.W + sx) * 3;
      const o = (y * ow + x) * channels;
      out[o] = t.raw[si + 2];        // R ← BGR
      out[o + 1] = t.raw[si + 1];
      out[o + 2] = t.raw[si];
      if (channels === 4) out[o + 3] = t.alpha[sy * t.W + sx];
    }
  }
  return { buf: png(ow, oh, out, channels), w: ow, h: oh, channels };
}

module.exports = { png, convert, crc32 };
