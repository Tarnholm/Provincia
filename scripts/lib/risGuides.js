// The mod's in-game guides (asked for 2026-09-26): the pop-ups the campaign script shows when a
// player presses the advisor's "?" (monitor_event ScrollAdviceRequested, "== 97. GUIDES ==")
// and the save-and-reload advice ("== 96."). Only texts the script actually shows are read:
// expanded_bi.txt has many more entries after its GUIDES AND ADVICES heading (the denarii
// captured messages and others) that are not guides.
//
//   const g = require("./lib/risGuides.js").loadGuides(RIS);
//   g.general   -> [{ key, title, body }]  shown to every player, in the order the game shows them
//   g.byFaction -> Map(faction -> { key, title, body })  the one "Faction mechanics" pop-up
//   g.toMarkdown(body, headingLevel) -> the text as markdown
const fs = require("fs");
const path = require("path");

function loadText(RIS) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "expanded_bi.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toUpperCase()] = m[2].trim();
  } catch { /* no text file */ }
  return map;
}

function activeScript(RIS) {
  const dir = path.join(RIS, "world", "maps", "campaign", "imperial_campaign");
  try {
    const lines = fs.readFileSync(path.join(dir, "descr_strat.txt"), "latin1").split(/\r?\n/);
    const at = lines.findIndex((l) => /^\s*script\s*$/.test(l));
    const name = at >= 0 ? (lines.slice(at + 1).find((l) => l.trim() && !l.trim().startsWith(";")) || "").trim() : "";
    return name ? fs.readFileSync(path.join(dir, name), "latin1") : "";
  } catch { return ""; }
}

// A block of the script between its "== N. NAME ==" banner and the next banner.
function section(script, re) {
  // Split on the numbered banner line only (";== 97. GUIDES =="), not the ";=====" rules
  // above and below it, or the part would hold nothing but the banner.
  const parts = script.split(/\r?\n;\s*==\s*(?=\d)/);
  return parts.find((p) => re.test(p.split(/\r?\n/)[0])) || "";
}

function loadGuides(RIS) {
  const TEXT = loadText(RIS);
  const script = activeScript(RIS);
  const general = [], byFaction = new Map();
  const add = (list, title, body) => {
    const t = TEXT[title.toUpperCase()], b = TEXT[body.toUpperCase()];
    if (t && b) list.push({ key: body.toUpperCase(), title: t, body: b });
  };
  const guides = section(script, /^97\.\s*GUIDES/i);
  // Each title/body pair, with the `if I_LocalFaction a || I_LocalFaction b` around it, if any.
  let factions = [], title = null;
  for (const raw of guides.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    let m = /^(?:if|\|\|)\s+I_LocalFaction\s+(\w+)/i.exec(l);
    if (m) { factions.push(m[1].toLowerCase()); continue; }
    if (/^end_if\b/i.test(l)) { factions = []; continue; }
    m = /^title\s+(\w+)/i.exec(l);
    if (m) { title = m[1]; continue; }
    m = /^body\s+(\w+)/i.exec(l);
    if (m && title) {
      if (factions.length) {
        const one = [];
        add(one, title, m[1]);
        if (one[0]) for (const f of factions) if (!byFaction.has(f)) byFaction.set(f, one[0]);
      } else add(general, title, m[1]);
      title = null;
    }
  }
  const reload = section(script, /^96\./);
  const rt = /title\s+(\w+)/i.exec(reload), rb = /body\s+(\w+)/i.exec(reload);
  if (rt && rb) add(general, rt[1], rb[1]);
  return { general, byFaction, toMarkdown };
}

// The game's text uses a literal "\n" for a line break. A run of three starts a new part whose
// first line is its heading; a blank line separates paragraphs; a paragraph of several short
// lines is a list ("Levy and basic units - 2 turns").
function toMarkdown(body, level = 3) {
  const hashes = "#".repeat(level);
  const text = String(body).replace(/\\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  const out = [];
  text.split(/\n{3}/).forEach((part, pi) => {
    const paras = part.split(/\n{2}/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length) return;
    const head = paras[0];
    if ((pi > 0 || paras.length > 1) && !/\n/.test(head) && head.length <= 60 && !/[.:!?]$/.test(head)) {
      out.push(`${hashes} ${head}`);
      paras.shift();
    }
    for (const p of paras) {
      const lines = p.split("\n").map((x) => x.trim()).filter(Boolean);
      if (lines.length > 1 && lines.every((x) => x.length <= 140)) out.push(lines.map((x) => `- ${x.replace(/^[-•]\s*/, "")}`).join("\n"));
      // "Horses: Enables ...", "Tip: put any building ...": the label before the colon in bold.
      else out.push(lines.join(" ").replace(/^([A-Z][^:.]{1,40}):\s+/, "**$1:** "));
    }
  });
  return out.join("\n\n");
}

module.exports = { loadGuides, toMarkdown };
