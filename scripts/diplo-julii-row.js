// Dump romans_julii's full diplomacy row from the matrix alongside all 3
// descr_strat cribs, to crack how war/alliance/trade STATE is encoded.
// Orientation: agg locked at transpose=true => matrix(r,c) holds crib[col][row].
// So romans_julii's OUTGOING row = cells where col=romans_julii (i.e. fix c=Julii,
// vary r) OR with transpose it's row=Julii reading crib[c][Julii]. We print both
// the (Julii,X) and (X,Julii) cells to be safe.
"use strict";
const fs = require("fs");
const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const SMF   = "C:/RIS/RIS/data/descr_sm_factions.txt";
const SAVE  = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii turn1.sav";
const STRIDE = 267, N = 239, CELL0 = 0x10aad6 - STRIDE;

function parseSection(text, kw) {
  const re = new RegExp("^\\s*" + kw + "\\s+([a-z0-9_]+),?\\s+(-?\\d+)\\s+([a-z0-9_]+)", "i");
  const g = {};
  for (const raw of text.split(/\r?\n/)) { const m = raw.match(re); if (!m) continue;
    (g[m[1].toLowerCase()] ||= {})[m[3].toLowerCase()] = parseInt(m[2], 10); }
  return g;
}
const t = fs.readFileSync(STRAT, "utf8");
const core = parseSection(t, "core_attitudes");
const rel  = parseSection(t, "faction_relationships");
const agg  = parseSection(t, "faction_agression");
const names = [];
for (const line of fs.readFileSync(SMF, "utf8").split(/\r?\n/)) { const m = line.match(/^\t"([a-z_0-9]+)":/); if (m) names.push(m[1].toLowerCase()); }
const idx = new Map(names.map((n, i) => [n, i]));
const buf = fs.readFileSync(SAVE);
const v = (r, c, fo) => { const o = CELL0 + (r * N + c) * STRIDE + fo; return buf.readInt32LE(o); };

const J = idx.get("romans_julii");
console.log(`save=${SAVE.split(/[\\/]/).pop()}  romans_julii idx=${J}\n`);
console.log(`col faction            | (J,X): att bond agg | (X,J): att bond agg | rel  core agg(strat)`);
// Show rows where ANYTHING is non-default (bond!=6, or att/agg non-200, or rel known)
let shown = 0;
for (let c = 0; c < N; c++) {
  if (c === J) continue;
  const nm = names[c];
  const a1 = v(J, c, 12), b1 = v(J, c, 20), g1 = v(J, c, 24);
  const a2 = v(c, J, 12), b2 = v(c, J, 20), g2 = v(c, J, 24);
  const relv = (rel[nm] && rel[nm]["romans_julii"]) ?? (rel["romans_julii"] && rel["romans_julii"][nm]);
  const interesting = b1 !== 6 || b2 !== 6 || a1 !== 200 || a2 !== 200 || (relv != null && relv !== 200);
  if (!interesting) continue;
  const cs = (core[nm] && core[nm]["romans_julii"]);
  const gs = (agg[nm] && agg[nm]["romans_julii"]);
  console.log(`${nm.padEnd(22)} | ${String(a1).padStart(4)} ${String(b1).padStart(4)} ${String(g1).padStart(4)} | ${String(a2).padStart(4)} ${String(b2).padStart(4)} ${String(g2).padStart(4)} | ${String(relv??'').padStart(4)} ${String(cs??'').padStart(4)} ${String(gs??'').padStart(4)}`);
  shown++;
}
console.log(`\n${shown} non-default rows for romans_julii`);
console.log(`\nLegend: rel 199=ally 200=neutral 201=war | bond 6=normal 54=alliance 55=special`);
