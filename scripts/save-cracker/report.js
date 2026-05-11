// HTML report. Renders an interactive view of the save with:
//   - Header summary
//   - Oracle hit map (string locations colored by token kind)
//   - Diff overlay (which bytes changed between two saves)
//   - Hex grid with hover-tooltip annotations
//
// Output is a single self-contained HTML file (no external assets).
import fs from "node:fs";
import path from "node:path";

const KIND_COLORS = {
  region:     "#4a90e2",
  city:       "#6bb6ff",
  faction:    "#e8a030",
  culture:    "#aa66cc",
  tag:        "#7eb567",
  character:  "#ff7e5f",
  trait:      "#d54f8d",
  ancillary:  "#c2a455",
  unit:       "#5fb7b7",
  building:   "#a87cd8",
};

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]); }

export function renderReport({ savePath, save, oracle, header, diffRuns, diffSummary, otherPath }, outPath) {
  // Sort hits for fast lookup
  const annotations = []; // [{offset, len, label, kind, color, sample}]
  for (const t of Object.values(oracle.tokens)) {
    for (const h of t.hits) {
      const kind = t.kinds[0] || "unknown";
      annotations.push({
        offset: h.offset,
        len: h.len,
        label: `${t.token} [${t.kinds.join(",")}, ${h.encoding}]`,
        kind,
        color: KIND_COLORS[kind] || "#888",
      });
    }
  }
  annotations.sort((a, b) => a.offset - b.offset);

  // Stats by kind
  const kindCounts = {};
  for (const a of annotations) kindCounts[a.kind] = (kindCounts[a.kind] || 0) + 1;

  // Top oracle hits ordered by offset for the rail
  const railEntries = annotations.slice(0, 5000);

  // Sample first 4096 bytes of buf for the hex view
  const HEX_PREVIEW = 4096;
  const hexSlice = save.buf.subarray(0, Math.min(HEX_PREVIEW, save.buf.length));
  const hexBytes = Array.from(hexSlice);

  // Build offset -> annotation index map (just for the preview region)
  const offToAnno = new Map();
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    if (a.offset >= HEX_PREVIEW) break;
    for (let k = 0; k < a.len; k++) {
      const o = a.offset + k;
      if (o >= HEX_PREVIEW) break;
      if (!offToAnno.has(o)) offToAnno.set(o, i);
    }
  }
  // Build offset -> diff for preview
  const diffMask = new Uint8Array(HEX_PREVIEW);
  for (const r of diffRuns || []) {
    for (let o = r.start; o < r.end && o < HEX_PREVIEW; o++) diffMask[o] = 1;
  }

  // Render hex grid
  let hexHtml = "";
  for (let row = 0; row < hexSlice.length; row += 16) {
    const offHex = row.toString(16).padStart(8, "0");
    let cells = "";
    let asciiCells = "";
    for (let c = 0; c < 16 && row + c < hexSlice.length; c++) {
      const off = row + c;
      const b = hexBytes[off];
      const annoIdx = offToAnno.get(off);
      const anno = annoIdx != null ? annotations[annoIdx] : null;
      const isDiff = diffMask[off];
      const bg = anno ? anno.color + "40" : (isDiff ? "rgba(232,160,48,0.35)" : "transparent");
      const title = anno ? escapeHtml(anno.label) : (isDiff ? "DIFF (bytes changed between saves)" : "");
      cells += `<span class="hexcell" style="background:${bg}" data-off="${off}" title="${title}">${b.toString(16).padStart(2, "0")}</span>`;
      const ch = (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
      asciiCells += `<span class="ascell" style="background:${bg}" data-off="${off}" title="${title}">${escapeHtml(ch)}</span>`;
    }
    hexHtml += `<div class="hexrow"><span class="hexoff">${offHex}</span>${cells}<span class="sep"></span>${asciiCells}</div>`;
  }

  // Header table
  const headerRows = header.items.map(h =>
    `<tr><td class="off">0x${h.off.toString(16).padStart(4, "0")}</td><td>${h.len}</td><td>${escapeHtml(h.name)}</td><td>${escapeHtml(h.interp || "")}</td></tr>`
  ).join("");

  // Top oracle hits by kind
  const kindBars = Object.entries(kindCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
    `<div class="kindrow"><span class="kdot" style="background:${KIND_COLORS[k] || "#888"}"></span><span class="kname">${k}</span><span class="kn">${n}</span></div>`
  ).join("");

  // Sources summary
  const srcRows = Object.entries(oracle.sources).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

  // Diff summary
  const diffStats = diffSummary
    ? `<div class="card"><h2>Diff vs ${escapeHtml(otherPath || "(other save)")}</h2>
        <div class="row"><span>Runs:</span><b>${diffSummary.runCount}</b></div>
        <div class="row"><span>Total changed bytes:</span><b>${diffSummary.totalChanged.toLocaleString()}</b></div>
        <div class="row"><span>% of file:</span><b>${diffSummary.pctChanged}</b></div>
        <div class="row"><span>Size delta:</span><b>${diffSummary.sizeDelta} bytes</b></div>
       </div>`
    : "";

  // Top 50 diff runs annotated with nearest oracle hit
  const annoOffsets = annotations.map(a => a.offset);
  function nearestAnno(off) {
    let lo = 0, hi = annoOffsets.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (annoOffsets[mid] <= off) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    return annotations[best];
  }
  const diffRows = (diffRuns || []).slice(0, 100).map(r => {
    const len = r.end - r.start;
    const near = nearestAnno(r.start);
    const distance = near ? r.start - near.offset : null;
    return `<tr>
      <td class="off">0x${r.start.toString(16)}</td>
      <td>${len}</td>
      <td>${near ? `${escapeHtml(near.label)} (+${distance}B)` : "—"}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>save-cracker — ${escapeHtml(path.basename(savePath))}</title>
<style>
  body { font-family: ui-monospace, "JetBrains Mono", Consolas, monospace; background:#1a1a1a; color:#eee; margin:0; padding:18px; font-size:12px; }
  h1 { color:#e8a030; font-size:18px; margin:0 0 12px 0; }
  h2 { color:#dca64a; font-size:14px; margin:16px 0 8px 0; }
  .card { background:#222; border:1px solid #333; border-radius:8px; padding:12px 16px; margin-bottom:12px; }
  .grid { display:grid; grid-template-columns: 320px 1fr; gap:14px; align-items:start; }
  table { border-collapse:collapse; width:100%; font-size:11px; }
  th, td { text-align:left; padding:3px 6px; border-bottom:1px solid #333; }
  td.off { color:#888; }
  .hexrow { display:flex; align-items:center; line-height:1.5; white-space:nowrap; }
  .hexoff { color:#666; margin-right:10px; min-width:75px; }
  .hexcell { padding:0 3px; cursor:default; }
  .ascell { padding:0 1px; min-width:8px; display:inline-block; text-align:center; }
  .sep { display:inline-block; width:14px; }
  .row { display:flex; justify-content:space-between; padding:2px 0; }
  .kindrow { display:flex; align-items:center; gap:8px; padding:2px 0; }
  .kdot { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .kname { flex:1; }
  .kn { color:#888; }
  .footer { color:#666; margin-top:20px; font-size:10px; }
</style></head><body>
<h1>save-cracker — ${escapeHtml(path.basename(savePath))}</h1>
<div class="card"><b>Path:</b> ${escapeHtml(savePath)} &nbsp; <b>Size:</b> ${save.size.toLocaleString()} bytes</div>

<div class="grid">
  <div>
    <div class="card"><h2>Oracle source counts</h2><table>${srcRows}</table></div>
    <div class="card"><h2>Hits by kind</h2>${kindBars}</div>
    ${diffStats}
    <div class="card"><h2>Top 100 diff runs (nearest known token)</h2>
      <table><thead><tr><th>Offset</th><th>Len</th><th>Nearest known</th></tr></thead>
      <tbody>${diffRows}</tbody></table></div>
  </div>
  <div>
    <div class="card"><h2>Header (first ~${header.strEnd} bytes)</h2>
      <table><thead><tr><th>Offset</th><th>Len</th><th>Name</th><th>Interpretation</th></tr></thead>
      <tbody>${headerRows}</tbody></table></div>
    <div class="card"><h2>Hex preview (first ${HEX_PREVIEW} bytes)</h2>
      <div style="overflow-x:auto">${hexHtml}</div></div>
  </div>
</div>

<div class="footer">save-cracker · ${new Date().toISOString()}</div>
</body></html>`;
  fs.writeFileSync(outPath, html);
}
