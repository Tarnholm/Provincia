// taw's etwng/sav documents the section invariant:
//   { u32 absolute_offset, u32 size_bytes, payload[size-8] }
// where absolute_offset == position-of-this-record. So we can scan for any
// u32 at position X equal to X, then verify the next u32 (size) is sane and
// the section fits inside the file. Sections nest, so we only emit candidates;
// callers can then build the tree.
//
// This is the foundation of structural decoding — once we have the tree we
// can name each subtree by inspecting the header strings table.
export function findSelfPointers(buf, { minSize = 16, maxSize = 8 * 1024 * 1024 } = {}) {
  const candidates = [];
  const n = buf.length;
  for (let i = 0; i + 8 <= n; i++) {
    const off = buf.readUInt32LE(i);
    if (off !== i) continue;
    const size = buf.readUInt32LE(i + 4);
    if (size < minSize || size > maxSize) continue;
    if (i + size > n) continue;
    candidates.push({ offset: i, size });
  }
  return candidates;
}

// Build the tree: a section A contains B iff B.offset > A.offset and
// B.offset + B.size <= A.offset + A.size. Multiple top-level sections are
// allowed.
export function buildSectionTree(candidates) {
  const sorted = [...candidates].sort((a, b) => a.offset - b.offset || (b.size - a.size));
  const tree = [];
  const stack = []; // [{ section, children[] }]
  for (const c of sorted) {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (c.offset < top.section.offset + top.section.size) break;
      stack.pop();
    }
    const node = { section: c, children: [] };
    if (stack.length === 0) tree.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return tree;
}

export function summarizeTree(tree, depth = 0, max = 200) {
  const out = [];
  function walk(node, d) {
    if (out.length >= max) return;
    out.push({ depth: d, offset: node.section.offset, size: node.section.size, childCount: node.children.length });
    for (const c of node.children) walk(c, d + 1);
  }
  for (const n of tree) walk(n, depth);
  return out;
}

// Scan for the header strings table: an ASCIIZ string immediately followed by
// a small u32 (version, typically 1..16). Plus a count prefix at the start.
// Returns candidates ranked by run-length (a real table will have 50+
// consecutive name+u32 pairs).
export function findHeaderStringsTable(buf, { minRun = 4 } = {}) {
  const found = [];
  const n = buf.length;
  let i = 0;
  while (i < n - 8) {
    // Look for an ASCIIZ name
    if (!isAsciiNameChar(buf[i])) { i++; continue; }
    const nameStart = i;
    while (i < n && isAsciiNameChar(buf[i])) i++;
    if (i >= n || buf[i] !== 0) { continue; }
    const nameLen = i - nameStart;
    if (nameLen < 3 || nameLen > 64) { i++; continue; }
    const nameEnd = i + 1; // skip NUL
    if (nameEnd + 4 > n) break;
    const ver = buf.readUInt32LE(nameEnd);
    if (ver === 0 || ver > 64) { i = nameEnd; continue; }
    const name = buf.subarray(nameStart, i).toString("ascii");
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) { i = nameEnd; continue; }
    found.push({ offset: nameStart, name, version: ver, payloadEnd: nameEnd + 4 });
    i = nameEnd + 4;
  }
  // Group into runs
  const runs = [];
  let cur = null;
  for (const f of found) {
    if (cur && f.offset === cur.last.payloadEnd) { cur.entries.push(f); cur.last = f; }
    else { if (cur && cur.entries.length >= minRun) runs.push(cur); cur = { entries: [f], last: f, start: f.offset }; }
  }
  if (cur && cur.entries.length >= minRun) runs.push(cur);
  return runs.sort((a, b) => b.entries.length - a.entries.length);
}

function isAsciiNameChar(b) {
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39) || b === 0x5f; // [A-Z0-9_]
}
