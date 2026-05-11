// Typed readers over a Buffer. All RTW save fields are little-endian.
// Strings observed so far: u16le length-prefix + UTF-16LE payload.
// We expose every plausible decoding so the scanner can probe each offset.
import fs from "node:fs";

export function loadSave(path) {
  const buf = fs.readFileSync(path);
  return {
    path,
    size: buf.length,
    buf,
    u8:  (o) => buf.readUInt8(o),
    i8:  (o) => buf.readInt8(o),
    u16: (o) => buf.readUInt16LE(o),
    i16: (o) => buf.readInt16LE(o),
    u32: (o) => buf.readUInt32LE(o),
    i32: (o) => buf.readInt32LE(o),
    f32: (o) => buf.readFloatLE(o),
    f64: (o) => buf.readDoubleLE(o),
    // u16le-prefixed UTF-16LE — confirmed at offset 0x3a in sample saves
    pstr16le: (o) => {
      if (o + 2 > buf.length) return null;
      const len = buf.readUInt16LE(o);
      if (len === 0 || len > 1024) return null;
      const end = o + 2 + len * 2;
      if (end > buf.length) return null;
      // Decode as UTF-16LE
      let s = "";
      for (let i = 0; i < len; i++) {
        const c = buf.readUInt16LE(o + 2 + i * 2);
        if (c === 0 || c > 0xfffd) return null;
        if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return null; // reject control chars
        s += String.fromCharCode(c);
      }
      return { value: s, len, byteLen: 2 + len * 2 };
    },
    // u16le-prefixed UTF-8
    pstr8: (o) => {
      if (o + 2 > buf.length) return null;
      const len = buf.readUInt16LE(o);
      if (len === 0 || len > 1024) return null;
      const end = o + 2 + len;
      if (end > buf.length) return null;
      const slice = buf.subarray(o + 2, end);
      // Reject if any control bytes or non-utf8
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return null;
        if (b === 0xfe || b === 0xff) return null;
      }
      const s = slice.toString("utf-8");
      if (s.includes("�")) return null;
      return { value: s, len, byteLen: 2 + len };
    },
    // null-terminated cstring (utf-8). Bounded by maxLen for sanity.
    cstring: (o, maxLen = 256) => {
      let end = o;
      while (end < buf.length && end - o < maxLen && buf[end] !== 0) end++;
      if (end === o || end >= buf.length) return null;
      const s = buf.subarray(o, end).toString("utf-8");
      if (s.includes("�")) return null;
      // Reject if first char is non-printable
      if (buf[o] < 0x20 || buf[o] > 0x7e) return null;
      return { value: s, len: end - o, byteLen: end - o + 1 };
    },
  };
}

export function hex(buf, o, n = 16) {
  return Array.from(buf.subarray(o, o + n)).map(b => b.toString(16).padStart(2, "0")).join(" ");
}

export function ascii(buf, o, n = 16) {
  return Array.from(buf.subarray(o, o + n)).map(b => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")).join("");
}
