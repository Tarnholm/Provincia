export function findIntsInBuf(buf, value, max = 256) {
  const u32 = [];
  const u16 = [];
  if (value >= 0 && value < 2 ** 32) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value, 0);
    let from = 0;
    while (u32.length < max) {
      const i = buf.indexOf(b, from);
      if (i < 0) break;
      u32.push(i); from = i + 1;
    }
  }
  if (value >= 0 && value < 2 ** 16) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value, 0);
    let from = 0;
    while (u16.length < max) {
      const i = buf.indexOf(b, from);
      if (i < 0) break;
      u16.push(i); from = i + 1;
    }
  }
  return { u32, u16 };
}
