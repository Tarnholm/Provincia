/* eslint-disable */
// Web Worker: decodes uncompressed and RLE 24/32-bit TGA off the main thread.
// Message protocol:
//   in:  { id, buffer }        — buffer is a transferable ArrayBuffer
//   out: { id, ok, width, height, pixels }   — pixels is a transferable ArrayBuffer (RGBA, row-major, top-origin)
//        or { id, ok: false, error }
//
// Ported from src/tga.js.

function decodeTga(data) {
  function getUint16(i) { return data[i] + (data[i + 1] << 8); }
  const idLength = data[0];
  const imageType = data[2];
  const width = getUint16(12);
  const height = getUint16(14);
  const pixelSize = data[16];
  const flags = data[17];

  if (!((imageType === 2 || imageType === 10) && (pixelSize === 24 || pixelSize === 32))) {
    throw new Error("Unsupported TGA type or pixel size");
  }

  let offset = 18 + idLength;
  const npixels = width * height;
  const pixels = new Uint8Array(npixels * 4);

  if (imageType === 2) {
    for (let i = 0, p = 0; i < npixels; ++i, p += 4) {
      const b = data[offset++], g = data[offset++], r = data[offset++];
      const a = pixelSize === 32 ? data[offset++] : 255;
      pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = a;
    }
  } else {
    let i = 0, p = 0;
    while (i < npixels) {
      const c = data[offset++];
      const count = (c & 0x7F) + 1;
      if (c & 0x80) {
        const b = data[offset++], g = data[offset++], r = data[offset++];
        const a = pixelSize === 32 ? data[offset++] : 255;
        for (let j = 0; j < count; ++j, ++i, p += 4) {
          pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = a;
        }
      } else {
        for (let j = 0; j < count; ++j, ++i, p += 4) {
          const b = data[offset++], g = data[offset++], r = data[offset++];
          const a = pixelSize === 32 ? data[offset++] : 255;
          pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = a;
        }
      }
    }
  }

  // Flip vertically if origin is bottom-left
  const originMask = 0x20;
  if (!(flags & originMask)) {
    const stride = width * 4;
    const tmp = new Uint8Array(stride);
    for (let y = 0; y < height / 2; ++y) {
      const top = y * stride;
      const bot = (height - y - 1) * stride;
      tmp.set(pixels.slice(top, top + stride));
      pixels.set(pixels.slice(bot, bot + stride), top);
      pixels.set(tmp, bot);
    }
  }

  return { width, height, pixels };
}

self.onmessage = (event) => {
  const { id, buffer } = event.data || {};
  try {
    const result = decodeTga(new Uint8Array(buffer));
    const out = result.pixels.buffer;
    self.postMessage({ id, ok: true, width: result.width, height: result.height, pixels: out }, [out]);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e.message || e) });
  }
};
