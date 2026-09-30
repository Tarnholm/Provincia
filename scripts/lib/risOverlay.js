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
