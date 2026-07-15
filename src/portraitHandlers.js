// Trait/ancillary/portrait icon-resolution IPC handlers, extracted from main.js
// (2026-07-15). register(ipcMain, deps) wires resolve-trait-icon /
// resolve-ancillary-icon / resolve-portrait. No caches here; the portrait
// helpers (loadPortraitMapping / resolvePortraitPool) and getVanillaDataDir stay
// in main.js and are injected. Logic unchanged.
"use strict";
const fs = require("fs");
const path = require("path");
const { hashName } = require("./mainUtils.js");

function registerPortraitHandlers(ipcMain, { getVanillaDataDir, loadPortraitMapping, resolvePortraitPool }) {
ipcMain.handle("resolve-trait-icon", async (_event, modDataDir, culture, levelName) => {
  if (!levelName) return { ok: false };
  const VANILLA_DATA = getVanillaDataDir();
  const dataDirs = [modDataDir || null, VANILLA_DATA].filter(Boolean);
  const cultures = [
    String(culture || "").toLowerCase(),
    "roman", "greek", "eastern", "egyptian", "carthaginian", "barbarian",
  ].filter(Boolean);
  for (const dir of dataDirs) {
    for (const c of cultures) {
      const candidate = path.join(dir, "ui", c, "vnvs", `${levelName}.tga`);
      try {
        if (fs.existsSync(candidate)) {
          const buffer = fs.readFileSync(candidate);
          return {
            ok: true,
            buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            path: candidate,
          };
        }
      } catch {}
    }
  }
  return { ok: false };
});

// 0.9.418: resolve an ancillary icon TGA. RTW Remastered DOES ship these,
// at `data/ui/ancillaries/<ancillary_name>.tga` (one big shared dir, not
// per-culture). Search mod dir first, then vanilla.
ipcMain.handle("resolve-ancillary-icon", async (_event, modDataDir, ancillaryName) => {
  if (!ancillaryName) return { ok: false };
  const VANILLA_DATA = getVanillaDataDir();
  const dirs = [modDataDir || null, VANILLA_DATA].filter(Boolean);
  for (const dir of dirs) {
    for (const sub of ["ancillaries", "ancillaries_cards"]) {
      const candidate = path.join(dir, "ui", sub, `${ancillaryName}.tga`);
      try {
        if (fs.existsSync(candidate)) {
          const buffer = fs.readFileSync(candidate);
          return {
            ok: true,
            buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            path: candidate,
          };
        }
      } catch {}
    }
  }
  return { ok: false };
});

let _savePathMissLogged = null;
let _hashPickLogged = null;
ipcMain.handle("resolve-portrait", async (_event, modDataDir, culture, slot, charContext) => {
  // 0.9.520: REMOVED the 0.9.517 leader_pic override. leader_pic_<faction>.tga
  // is used by RTW's faction-selection menu, NOT for in-game character
  // portraits. The engine uses the regular portrait pool (greek/old/generals/
  // NNN.tga) for the leader's family-tree/bodyguard card — same as every
  // other char. User-labeled in-game portraits confirmed AntigonosII shows
  // pool portrait 000, not the leader_pic file. Override was making
  // Provincia diverge from the actual game for every faction leader.
  // Crack 2026-05-18 fast-path: if the caller passes an exact save-derived
  // portrait path (`charContext.savePath` like "data/ui/greek/portraits/
  // cards/young/generals/149.tga"), load it directly — no culture mapping
  // or hash needed. This is the in-game-exact portrait.
  if (charContext && charContext.savePath && typeof charContext.savePath === "string") {
    const rel = charContext.savePath.replace(/^\/+/, "");
    // Try mod dir first, then vanilla. The save path is rooted at "data/..."
    // so we strip that prefix to get "ui/..." and prepend each search dir.
    const subPath = rel.replace(/^data\//, "");
    // RIS-layout fallback (0.9.882): the save stores the vanilla
    // "…/portraits/cards/<bucket>/generals/NNN.tga" path, but RIS ships its
    // portraits as "…/portraits/portraits/<bucket>/NNN.tga" — no `cards/` and no
    // `generals/` subdir. Without this rewrite EVERY character whose save path
    // points at the cards/ layout misses the fast-path and falls to a hash-pool
    // face (wrong portrait, sometimes a different-culture-looking one). Try the
    // rewritten path so the character gets their REAL indexed face.
    // Two on-disk layouts host the same indexed pool:
    //   vanilla RTW: …/portraits/portraits/<age>/generals/NNN.tga(.dds)  (KEEPS generals/)
    //   RIS mod:     …/portraits/portraits/<age>/NNN.tga                 (DROPS generals/)
    // The save's index points at the FULL vanilla pool (e.g. roman 249 — RIS's
    // own folder only ships ~130, so without the vanilla path a high index falls
    // to a hash face = wrong portrait). Try the cards→portraits rewrite BOTH with
    // and without the generals/ subdir so the index resolves in whichever pool
    // actually has it (vanilla generals/ first since that's where the index lives).
    const subPathVanilla = subPath.replace(/\/portraits\/cards\//, "/portraits/portraits/");
    const subPathRis = subPathVanilla.replace(/\/generals\//, "/");
    const subPaths = [...new Set([subPath, subPathVanilla, subPathRis])];
    // Also try adding .dds — RTW stores the actual files as .tga.dds, save
    // references them as .tga.
    const VANILLA_DATA = getVanillaDataDir();
    const dataDirs = [
      modDataDir ? modDataDir : null,
      VANILLA_DATA,
    ].filter(Boolean);
    // 0.9.885: try ALL .tga.dds candidates before ANY plain .tga. The game loads
    // .tga.dds portraits and IGNORES loose .tga (RIS ships its roman portraits as
    // .tga, which the engine doesn't use — it falls back to the vanilla .tga.dds
    // pool). So a real mod override (.tga.dds) still wins over vanilla, but RIS's
    // unused .tga roman folder no longer shadows the vanilla face the game shows.
    const dds = [], tga = [];
    for (const d of dataDirs) {
      for (const sp of subPaths) {
        dds.push(path.join(d, sp + ".dds"));
        tga.push(path.join(d, sp));
      }
    }
    const candidates = [...dds, ...tga];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const buffer = fs.readFileSync(candidate);
          return {
            ok: true,
            buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            path: candidate,
            encoded: candidate.endsWith(".dds") ? "rtw-tga-dds" : null,
          };
        }
      } catch {}
    }
    // 0.9.449: log fast-path miss once per savePath so we can see which
    // portrait paths the save points at but the filesystem doesn't have.
    // Helps diagnose "wrong portrait" reports — when the fast-path file
    // doesn't exist, we fall through to the deterministic hash pool which
    // can collide across same-firstName chars.
    if (!_savePathMissLogged) _savePathMissLogged = new Set();
    if (!_savePathMissLogged.has(charContext.savePath)) {
      _savePathMissLogged.add(charContext.savePath);
      console.log(`[resolve-portrait] fast-path MISS for savePath="${charContext.savePath}" (name="${charContext.name || ""}" faction="${charContext.faction || ""}") — falling back to hash pool`);
    }
  }
  if (!culture || !slot) return { ok: false };
  const c = String(culture).toLowerCase();
  const s = String(slot).toLowerCase();
  const _vd = getVanillaDataDir();
  const VANILLA_UI = _vd ? path.join(_vd, "ui") : null;
  const dirs = [
    modDataDir ? path.join(modDataDir, "ui") : null,
    VANILLA_UI,
  ].filter(Boolean);
  // Try the requested culture first, then the mod's declared
  // `"portrait mapping"` from descr_cultures.txt (e.g. RIS's `e_hellenistic`
  // → `greek`), then the six vanilla RTW cultures. The portrait mapping is
  // what RTW itself uses for character art when the culture doesn't ship
  // its own pool — without it, e_hellenistic factions would mis-fall-back
  // to roman (alphabetically first) instead of the intended greek base.
  const VANILLA_CULTURES = ["roman", "greek", "eastern", "egyptian", "carthaginian", "barbarian"];
  const mapping = loadPortraitMapping(modDataDir);
  const mappedBase = mapping[c] || null;
  const tryCultures = [c];
  if (mappedBase && mappedBase !== c) tryCultures.push(mappedBase);
  for (const v of VANILLA_CULTURES) {
    if (!tryCultures.includes(v)) tryCultures.push(v);
  }

  // For the "general" slot, prefer the per-character RTW portrait pool
  // (`<culture>/portraits/portraits/{young,old}/generals/NNN.tga.dds`) so
  // each general renders with their own face like the in-game family tree,
  // rather than every general showing the same generic portrait.
  //
  // NOTE: the *real* portrait index is stored in the save and (sometimes)
  // in descr_strat as `portrait_index N`. Until that byte is cracked we
  // fall back to a deterministic DJB2 hash so the same character always
  // gets the same face. The hash includes firstName + lastName + faction
  // so two characters with the same first name don't collide.
  if (s === "general" && charContext && charContext.name) {
    // Explicit index from descr_strat wins outright (vanilla uses this).
    const explicit = (charContext.portraitIndex != null) ? Number(charContext.portraitIndex) | 0 : null;
    const ageNum = charContext.age != null ? Number(charContext.age) : null;
    const ageBucket = (ageNum != null && ageNum >= 35) ? "old" : "young";
    // 0.9.455: hash input KEEPS the 3-element shape (name|lastName|faction)
    // but FORCES lastName to "" regardless of what the caller passed. The
    // 0.9.449 family tree (which user confirmed was correct) hashed with
    // empty lastName → idx 38 for AntigonosB. Garrison live mode was
    // passing the epitheted lastName ("II Gonatas the Kind") → different
    // input → idx 000. By normalising lastName to "" here, both paths
    // produce idx 38 again, matching the user-confirmed correct portrait.
    // The 3-element join shape is preserved so the hash result matches
    // what 0.9.449 produced for the family tree.
    const hashInput = [
      charContext.name,
      "",
      charContext.faction || "",
    ].join("|");
    const nameHash = hashName(hashInput);
    for (const tc of tryCultures) {
      // 0.9.885: pick the BEST pool for this culture across dirs — prefer the
      // .tga.dds pool the engine actually loads over a plain-.tga mod pool it
      // ignores (RIS ships its roman portraits as .tga, which the game doesn't
      // use — it falls back to vanilla's .tga.dds; that .tga pool was shadowing
      // the vanilla face and giving every floored commander a nomadic face).
      // Mod dirs come first, so a real mod .tga.dds override still wins.
      let pool = null;
      for (const d of dirs) {
        const p = resolvePortraitPool(path.join(d, tc, "portraits", "portraits", ageBucket));
        if (!p || p.files.length === 0) continue;
        if (!pool || (pool.ext === ".tga" && p.ext === ".tga.dds")) pool = p;
        if (pool.ext === ".tga.dds") break;
      }
      if (!pool || pool.files.length === 0) continue;
      const files = pool.files;
      // Explicit portrait_index (descr_strat / future save) bypasses the hash.
      // Clamp into the pool's bounds in case the index was written for a
      // different (larger) pool.
      const idx = (explicit != null) ? (explicit % files.length) : (nameHash % files.length);
      const file = files[idx];
      const isVanilla = pool.dir.includes("Total War ROME REMASTERED");
      console.log(`[portrait] hash-pool pick name="${charContext.name}" lastName="${charContext.lastName || ""}" faction="${charContext.faction || ""}" culture=${tc} (requested=${c}) bucket=${ageBucket} ageRaw=${charContext.age} source=${isVanilla ? "VANILLA" : "MOD"} layout=${pool.ext === ".tga.dds" && pool.dir.endsWith("generals") ? "A/generals-dds" : pool.ext === ".tga.dds" ? "B/bucket-dds" : "B/bucket-tga"} → idx=${idx}/${files.length} file=${file} dir="${pool.dir}"`);
      try {
        const buf = fs.readFileSync(path.join(pool.dir, file));
        return {
          ok: true,
          buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          path: path.join(pool.dir, file),
          encoded: pool.ext === ".tga.dds" ? "rtw-tga-dds" : null,
        };
      } catch {}
    }
    // Fall through to the static general_portrait.tga fallback below.
  }

  const candidates = [];
  for (const tc of tryCultures) {
    for (const d of dirs) {
      if (s === "wife" || s === "son" || s === "daughter") {
        candidates.push(path.join(d, tc, "portraits", "family", s + ".tga"));
      } else if (s === "general") {
        // Static fallback if no per-character pool was found. Only roman +
        // barbarian ship this file in vanilla; greek/eastern/etc inherit it.
        candidates.push(path.join(d, tc, "portraits", "general_portrait.tga"));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const buffer = fs.readFileSync(candidate);
        return { ok: true, buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), path: candidate };
      }
    } catch {}
  }
  // 0.9.821: nothing resolved — no save fast-path, no per-character pool, no
  // static general_portrait.tga. We used to return {ok:false} SILENTLY, so a
  // "generals have no portraits" report showed only the renderer's
  // [bodyguard-swap] FAIL with no way to see WHY. Log the search roots + which
  // actually exist on disk, the cultures tried, and a sample pool path we
  // looked for — so the cause (wrong/partial mod dir, missing vanilla install,
  // unexpected portrait layout) is one grep away. Throttled per culture|slot.
  try {
    if (!global._portraitMissLogged) global._portraitMissLogged = new Set();
    const mk = `${c}|${s}`;
    if (!global._portraitMissLogged.has(mk)) {
      global._portraitMissLogged.add(mk);
      const rootState = dirs.map((d) => `${d}=${fs.existsSync(d) ? "exists" : "MISSING"}`).join("  |  ");
      const samplePool = path.join(dirs[0] || "(no dir)", tryCultures[0] || c, "portraits", "portraits", "young");
      const samplePoolState = `${samplePool}=${fs.existsSync(samplePool) ? "exists" : "MISSING"}`;
      console.log(`[resolve-portrait] NO PORTRAIT for culture="${c}" slot="${s}" — every source empty. tried cultures=[${tryCultures.join(",")}]. roots: ${rootState}. sample pool dir: ${samplePoolState}. modDataDir="${modDataDir || "(none)"}"`);
    }
  } catch {}
  return { ok: false };
});


}

module.exports = { registerPortraitHandlers };
