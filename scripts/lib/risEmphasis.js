// Italic / bold / underline in RIS text files (RIS 2026-10-20, _tools/_Tarnholm-tools/emphasis/ris_emphasis.py).
// Wherever the style changes, the mod's text carries a marker of four characters: U+2028, then for
// italic, bold and underline in that order U+2029 = on or TAB = off. The game deletes them; RR
// Turbo / Speedo draw the run styled. Left in, they break the generators: `.` in a regex does not
// match U+2028, so `\{([^}]+)\}(.*)` cut a description off at its first styled word.
//
// Required by every generator that reads text/*.txt: from then on a UTF-16 read of a text file
// returns the same text with each styled run as <em>, <strong>, <ins> (the tags the wiki's
// renderer and GitHub's both keep; GitHub drops <u>). A run is closed at the end of its {KEY}
// value and around each literal \n, the paragraph break the generators split on, so every
// paragraph's tags are balanced.
const fs = require("fs");

const LS = String.fromCharCode(0x2028), ON = String.fromCharCode(0x2029);
const MARKER = new RegExp(LS + "[\t" + ON + "]{3}");
const AT = new RegExp(LS + "[\t" + ON + "]{3}", "y");
const TEXT_FILE = /[\\/]text[\\/][^\\/]+\.txt$/i;
const TAGS = [[2, "strong"], [1, "em"], [4, "ins"]];   // bold, italic, underline: outer to inner

function emphasisToHtml(text) {
  if (!MARKER.test(text)) return text;
  const open = (mask) => TAGS.filter(([b]) => mask & b).map(([, t]) => `<${t}>`).join("");
  const close = (mask) => TAGS.filter(([b]) => mask & b).reverse().map(([, t]) => `</${t}>`).join("");
  let out = "", mask = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    AT.lastIndex = i;
    if (c === LS && AT.test(text)) {
      const flags = text.substr(i + 1, 3);
      const next = (flags[0] === ON ? 1 : 0) | (flags[1] === ON ? 2 : 0) | (flags[2] === ON ? 4 : 0);
      out += close(mask) + open(next);
      mask = next;
      i += 3;
      continue;
    }
    if (mask && (c === "{" || c === "\r" || c === "\n")) { out += close(mask); mask = 0; }
    else if (mask && c === "\\" && text[i + 1] === "n") { out += close(mask) + "\\n" + open(mask); i++; continue; }
    out += c;
  }
  return out + close(mask);
}

if (!fs.__risEmphasis) {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (p, opts, ...rest) {
    const out = readFileSync.call(fs, p, opts, ...rest);
    if (typeof p !== "string" || !TEXT_FILE.test(p)) return out;
    const enc = typeof opts === "string" ? opts : opts && opts.encoding;
    if (typeof out === "string") return /^utf-?16le$|^ucs-?2$/i.test(enc || "") ? emphasisToHtml(out) : out;
    if (!Buffer.isBuffer(out) || out[0] !== 0xff || out[1] !== 0xfe) return out;
    const t = out.toString("utf16le");
    const h = emphasisToHtml(t);
    return h === t ? out : Buffer.from(h, "utf16le");
  };
  fs.__risEmphasis = true;
}

module.exports = { emphasisToHtml };
