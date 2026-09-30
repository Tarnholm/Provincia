// Campaign variants for the wiki (asked for 2026-09-30: Four Romans, RIS Light, RIS Classic).
// Loaded before a generator with `node --require lib/risOverlay.js`; it makes the generator see
// a submod the way the game does: a file the submod ships replaces the base mod's, everything
// else comes from the base mod. Nothing in the generators changes.
//
//   RIS_BASE_DATA     the base mod's data folder              (default C:/RIS/RIS/data)
//   RIS_OVERLAY_DATA  the submod's data folder                (e.g. C:/RIS/_submods/RIS_Light/data)
//   RIS_CAMPAIGN      the submod's campaign, if not imperial_campaign (ris_light, ris_classic)
//
// With RIS_CAMPAIGN set, every path naming imperial_campaign (the campaign folder, and text
// files such as imperial_campaign_regions_and_settlement_names.txt) is read from the submod's
// campaign instead, with NO fallback to the base mod: a campaign file the submod does not have
// (RIS Classic has no campaign script) does not exist for that campaign.
const fs = require("fs");
const path = require("path");

const OVER = process.env.RIS_OVERLAY_DATA;
if (OVER) {
  const norm = (p) => path.resolve(p).replace(/\\/g, "/");
  const BASE = norm(process.env.RIS_BASE_DATA || "C:/RIS/RIS/data");
  const OVERN = norm(OVER);
  const CAMP = process.env.RIS_CAMPAIGN || "imperial_campaign";
  const orig = {
    existsSync: fs.existsSync, readFileSync: fs.readFileSync, statSync: fs.statSync, lstatSync: fs.lstatSync,
    readdirSync: fs.readdirSync, openSync: fs.openSync, createReadStream: fs.createReadStream,
  };
  const exists = (p) => { try { return orig.existsSync(p); } catch { return false; } };

  // The file a read of `p` should really open.
  function redirect(p) {
    if (typeof p !== "string" && !(p instanceof URL)) return p;
    const full = norm(String(p instanceof URL ? p.pathname.replace(/^\/([A-Za-z]:)/, "$1") : p));
    if (full.toLowerCase() !== BASE.toLowerCase() && !full.toLowerCase().startsWith(BASE.toLowerCase() + "/")) return p;
    const rel = full.slice(BASE.length + 1);
    const relC = CAMP !== "imperial_campaign" ? rel.replace(/imperial_campaign/gi, CAMP) : rel;
    const cand = OVERN + "/" + relC;
    if (relC !== rel) return cand;           // campaign file: the submod's own, or none
    return exists(cand) ? cand : p;
  }
  const wrap1 = (name) => { fs[name] = function (p, ...rest) { return orig[name].call(fs, redirect(p), ...rest); }; };
  for (const n of ["existsSync", "readFileSync", "statSync", "lstatSync", "openSync", "createReadStream"]) wrap1(n);

  // text/campaign_descriptions.txt keys each campaign's faction titles and briefs by the
  // campaign's name ({RIS_LIGHT_ROMANS_JULII_TITLE}); the generators read the main campaign's
  // {IMPERIAL_CAMPAIGN_…}. The campaign's own keys are handed to them under that name. RIS
  // Classic's file carries only RIS Light's keys, so Classic has no titles or briefs, as in game.
  if (CAMP !== "imperial_campaign") {
    const own = new RegExp(`\\{${CAMP.toUpperCase()}_`, "g");
    // With no titles of its own, a faction is called what the game calls it everywhere else:
    // its descr_sm_factions "string" key, looked up in expanded_bi.txt.
    let fallback = null;
    const fallbackTitles = () => {
      if (fallback != null) return fallback;
      fallback = "";
      try {
        const facs = fs.readFileSync(path.join(BASE, "descr_sm_factions.txt"), "latin1");
        const bi = fs.readFileSync(path.join(BASE, "text", "expanded_bi.txt"), "utf16le");
        const names = {};
        for (const m of bi.matchAll(/^\{([A-Za-z0-9_]+)\}[ \t]*([^\r\n]*)/gm)) names[m[1].toUpperCase()] = m[2].trim();
        for (const m of facs.matchAll(/"([a-z0-9_]+)":[^\n]*\n\s*\{(?:\s*;[^\n]*)*\s*"string":\s*"([A-Za-z0-9_]+)"/g)) {
          const name = names[m[2].toUpperCase()];
          if (name) fallback += `\r\n{IMPERIAL_CAMPAIGN_${m[1].toUpperCase()}_TITLE}${name}`;
        }
      } catch { /* no names */ }
      return fallback;
    };
    const readFile = fs.readFileSync;
    fs.readFileSync = function (p, ...rest) {
      const out = readFile.call(fs, p, ...rest);
      if (typeof p !== "string" || !/[\\/]text[\\/]campaign_descriptions\.txt$/i.test(p)) return out;
      let text = (typeof out === "string" ? out : out.toString("utf16le"))
        .replace(/\{IMPERIAL_CAMPAIGN_/g, "{UNUSED_CAMPAIGN_").replace(own, "{IMPERIAL_CAMPAIGN_");
      if (!/\{IMPERIAL_CAMPAIGN_[A-Z0-9_]+_TITLE\}/.test(text)) text += fallbackTitles();
      return typeof out === "string" ? text : Buffer.from(text, "utf16le");
    };
  }

  // A folder lists what either mod has in it (the submod's campaign folder alone, for a
  // campaign folder).
  fs.readdirSync = function (p, opts) {
    const full = norm(String(p));
    const inBase = full.toLowerCase().startsWith(BASE.toLowerCase());
    if (!inBase) return orig.readdirSync.call(fs, p, opts);
    const rel = full.slice(BASE.length + 1);
    const relC = CAMP !== "imperial_campaign" ? rel.replace(/imperial_campaign/gi, CAMP) : rel;
    const overDir = OVERN + "/" + relC;
    if (relC !== rel) return exists(overDir) ? orig.readdirSync.call(fs, overDir, opts) : [];
    const a = exists(full) ? orig.readdirSync.call(fs, full, opts) : [];
    const b = exists(overDir) ? orig.readdirSync.call(fs, overDir, opts) : [];
    if (!b.length) return a;
    const nameOf = (x) => (typeof x === "string" ? x : x.name);
    const seen = new Set(a.map(nameOf));
    return a.concat(b.filter((x) => !seen.has(nameOf(x))));
  };
}
