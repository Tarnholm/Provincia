// High-res full-map PNG export (🖼, 2026-07-24). Renders the WHOLE map at
// `scale`× native resolution (nearest-neighbour, crisp region pixels) with the
// mode's vector overlays re-stroked at export resolution (not upscaled), a
// painted legend panel, and a title — then triggers a browser download.
// Self-contained: the caller passes everything explicitly (no App state reads).
export function exportMapPng({
  base,            // canvas holding the colored full map at native WxH
  W, H,            // native map size
  scale = 3,
  title,           // e.g. "Legionary Recruitment"
  subtitle,        // e.g. "RIS grand campaign — Provincia"
  legendRows,      // [{ color:[r,g,b], label, count?, line?: "road"|"sea" }] | null
  gradient,        // { stops:[[r,g,b],...], labels:[l,m,r] } | null
  borderPath,      // Path2D in map coords | null
  roadPath2D,      // Path2D in map coords | null (trade lanes mode)
  seaPolys,        // [[{x,y},...], ...] map coords | null (trade lanes mode)
  fileName,
}) {
  const c = document.createElement("canvas");
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, c.width, c.height);

  // vector overlays re-stroked at export scale (sharp at any zoom-in)
  if (borderPath) {
    ctx.save(); ctx.scale(scale, scale);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 0.5;
    ctx.stroke(borderPath);
    ctx.restore();
  }
  if (roadPath2D) {
    ctx.save(); ctx.scale(scale, scale);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(84,58,34,0.55)"; ctx.lineWidth = 2.2 / scale * 1.6; ctx.stroke(roadPath2D);
    ctx.strokeStyle = "rgba(202,170,120,0.95)"; ctx.lineWidth = 1.2 / scale * 1.6; ctx.stroke(roadPath2D);
    ctx.restore();
  }
  if (seaPolys && seaPolys.length) {
    ctx.save(); ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(225,238,255,0.7)";
    ctx.lineWidth = 1.1 / scale * 1.6;
    ctx.setLineDash([7 / scale * 1.6, 5 / scale * 1.6]);
    for (const poly of seaPolys) {
      if (!poly || poly.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k].x, poly[k].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── legend panel (top-left, translucent dark card) ──
  const fs = Math.max(11, Math.round(4.6 * scale));       // base font px
  const pad = fs, rowH = Math.round(fs * 1.35), sw = fs;  // padding, row height, swatch
  const rows = (legendRows || []).slice(0, 22);
  const more = (legendRows || []).length - rows.length;
  ctx.font = `bold ${Math.round(fs * 1.35)}px sans-serif`;
  let panelW = ctx.measureText(title || "").width;
  ctx.font = `${fs}px sans-serif`;
  if (subtitle) panelW = Math.max(panelW, ctx.measureText(subtitle).width);
  for (const r of rows) panelW = Math.max(panelW, sw + 8 + ctx.measureText(`${r.label}${r.count != null ? "  " + r.count : ""}`).width);
  if (gradient) panelW = Math.max(panelW, fs * 16);
  panelW += pad * 2;
  const panelH = pad * 2 + Math.round(fs * 1.6) + (subtitle ? rowH : 0)
    + rows.length * rowH + (more > 0 ? rowH : 0) + (gradient ? rowH * 2 : 0);
  ctx.save();
  ctx.fillStyle = "rgba(18,15,12,0.82)";
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = Math.max(1, scale * 0.4);
  const px0 = pad, py0 = pad;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px0, py0, panelW, panelH, fs * 0.8); else ctx.rect(px0, py0, panelW, panelH);
  ctx.fill(); ctx.stroke();
  let y = py0 + pad + Math.round(fs * 1.1);
  ctx.fillStyle = "#f0e8d8";
  ctx.font = `bold ${Math.round(fs * 1.35)}px sans-serif`;
  ctx.fillText(title || "", px0 + pad, y);
  y += subtitle ? rowH : Math.round(rowH * 0.6);
  if (subtitle) {
    ctx.fillStyle = "#b8ae9a";
    ctx.font = `${fs}px sans-serif`;
    ctx.fillText(subtitle, px0 + pad, y);
    y += Math.round(rowH * 0.8);
  }
  ctx.font = `${fs}px sans-serif`;
  if (gradient && gradient.stops && gradient.stops.length >= 2) {
    const gw = panelW - pad * 2, gh = Math.round(fs * 0.9);
    const g = ctx.createLinearGradient(px0 + pad, 0, px0 + pad + gw, 0);
    gradient.stops.forEach((s, i) => g.addColorStop(i / (gradient.stops.length - 1), `rgb(${s[0]},${s[1]},${s[2]})`));
    y += Math.round(gh * 0.4);
    ctx.fillStyle = g;
    ctx.fillRect(px0 + pad, y, gw, gh);
    y += gh + Math.round(fs * 1.1);
    ctx.fillStyle = "#cfc6b0";
    const labs = gradient.labels || [];
    if (labs[0]) ctx.fillText(labs[0], px0 + pad, y);
    if (labs[1]) ctx.fillText(labs[1], px0 + pad + gw / 2 - ctx.measureText(labs[1]).width / 2, y);
    if (labs[2]) ctx.fillText(labs[2], px0 + pad + gw - ctx.measureText(labs[2]).width, y);
    y += Math.round(rowH * 0.5);
  }
  for (const r of rows) {
    const cy = y - Math.round(fs * 0.75);
    if (r.line) {
      // line-style sample (roads / sea lanes)
      ctx.save(); ctx.lineCap = "round";
      if (r.line === "road") {
        ctx.strokeStyle = "rgba(84,58,34,0.9)"; ctx.lineWidth = Math.max(2, scale * 1.2);
        ctx.beginPath(); ctx.moveTo(px0 + pad, cy + sw / 2); ctx.lineTo(px0 + pad + sw, cy + sw / 2); ctx.stroke();
        ctx.strokeStyle = "rgba(202,170,120,0.95)"; ctx.lineWidth = Math.max(1, scale * 0.6);
        ctx.beginPath(); ctx.moveTo(px0 + pad, cy + sw / 2); ctx.lineTo(px0 + pad + sw, cy + sw / 2); ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(225,238,255,0.85)"; ctx.lineWidth = Math.max(1, scale * 0.6);
        ctx.setLineDash([scale * 2, scale * 1.5]);
        ctx.beginPath(); ctx.moveTo(px0 + pad, cy + sw / 2); ctx.lineTo(px0 + pad + sw, cy + sw / 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    } else if (r.color) {
      ctx.fillStyle = `rgb(${r.color[0]},${r.color[1]},${r.color[2]})`;
      ctx.fillRect(px0 + pad, cy, sw, sw);
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1;
      ctx.strokeRect(px0 + pad, cy, sw, sw);
    }
    ctx.fillStyle = "#e8e2d4";
    ctx.fillText(r.label, px0 + pad + sw + 8, y);
    if (r.count != null) {
      ctx.fillStyle = "#9a8f7a";
      const t = String(r.count);
      ctx.fillText(t, px0 + panelW - pad - ctx.measureText(t).width, y);
    }
    y += rowH;
  }
  if (more > 0) {
    ctx.fillStyle = "#9a8f7a";
    ctx.fillText(`+${more} more…`, px0 + pad, y);
  }
  ctx.restore();

  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = fileName || `provincia-map-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return { width: c.width, height: c.height };
}
