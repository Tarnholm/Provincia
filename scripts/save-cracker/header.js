// Walk the first ~256 bytes and label what we already know.
// Confirmed empirically on RIS sample saves (sample-turn1-end.sav, sample-turn2-start.sav).
export function decodeHeader(buf) {
  const out = [];
  const u8  = (o) => buf.readUInt8(o);
  const u16 = (o) => buf.readUInt16LE(o);
  const u32 = (o) => buf.readUInt32LE(o);
  const f32 = (o) => buf.readFloatLE(o);

  out.push({ off: 0x00, len: 4, name: "magic_or_version", u32: u32(0x00), interp: `0x${u32(0x00).toString(16)} (observed: 0x0000070a — likely engine save version)` });
  out.push({ off: 0x04, len: 4, name: "f32_at_4", f32: f32(0x04), interp: `f32 = ${f32(0x04)} (observed ~1338.34 — possibly campaign clock or game-day fraction)` });
  out.push({ off: 0x08, len: 8, name: "zeros_8b", interp: "8 bytes of 0x00 — padding/reserved" });
  out.push({ off: 0x14, len: 4, name: "u32_at_0x14", u32: u32(0x14), interp: `${u32(0x14)} (observed 1024 — possibly buffer size or AI seed?)` });
  out.push({ off: 0x18, len: 4, name: "u32_at_0x18", u32: u32(0x18), interp: `${u32(0x18)} (observed 1024)` });
  out.push({ off: 0x1c, len: 4, name: "u32_at_0x1c", u32: u32(0x1c), interp: `${u32(0x1c)} (two u16: ${u16(0x1c)}, ${u16(0x1e)})` });
  out.push({ off: 0x20, len: 4, name: "u32_at_0x20", u32: u32(0x20), interp: `${u32(0x20)} — could be region/faction count` });
  // 0x24..0x33 looks like a 16-byte hash/uuid
  out.push({ off: 0x24, len: 16, name: "guid_16b", interp: "16 random-looking bytes — save GUID or hash" });
  out.push({ off: 0x34, len: 6, name: "u16_u32_at_0x34", interp: `u16 ${u16(0x34)}, u32 ${u32(0x36)}` });
  // pstr16le at 0x3a — decoded as campaign folder name
  const len = u16(0x3a);
  const strEnd = 0x3c + len * 2;
  let str = "";
  for (let i = 0; i < len; i++) str += String.fromCharCode(u16(0x3c + i * 2));
  out.push({ off: 0x3a, len: 2 + len * 2, name: "campaign_name (pstr16le)", interp: `len=${len}, value="${str}"` });
  // After string, another small float
  out.push({ off: strEnd, len: 4, name: "u32_after_str", u32: u32(strEnd), interp: `${u32(strEnd)} (observed 0)` });
  out.push({ off: strEnd + 4, len: 4, name: "f32_after_str", f32: f32(strEnd + 4), interp: `f32 = ${f32(strEnd + 4)}` });

  return { strEnd: strEnd + 8, items: out };
}
