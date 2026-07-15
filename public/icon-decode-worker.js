/* eslint-disable */
// Web Worker: decodes a building-icon TGA to a PNG entirely OFF the main
// thread (TGA decode + OffscreenCanvas PNG encode). A pool of these lets many
// icons decode in parallel across cores during the startup warm-up, instead of
// the single main thread doing all ~900 decodes+encodes serially.
//
//   in:  { id, buffer }           — buffer is a transferable ArrayBuffer (TGA)
//   out: { id, ok, png }          — png is a transferable ArrayBuffer (PNG bytes)
//        or { id, ok: false }
//
// decodeTga is ported verbatim from tga-worker.js (uncompressed + RLE 24/32-bit).

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
  if (!width || !height || width > 8192 || height > 8192) {
    throw new Error("Bad TGA dimensions");
  }

  let offset = 18 + idLength;
  const npixels = width * height;
  const pixels = new Uint8ClampedArray(npixels * 4);

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

  // Flip vertically if origin is bottom-left (bit 5 = top-left).
  if (!(flags & 0x20)) {
    const stride = width * 4;
    const tmp = new Uint8ClampedArray(stride);
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

self.onmessage = async (event) => {
  const { id, buffer } = event.data || {};
  try {
    const { width, height, pixels } = decodeTga(new Uint8Array(buffer));
    // OffscreenCanvas + convertToBlob → PNG, all off the main thread.
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const png = await blob.arrayBuffer();
    self.postMessage({ id, ok: true, png }, [png]);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};
