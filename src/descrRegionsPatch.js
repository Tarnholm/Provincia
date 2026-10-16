// src/descrRegionsPatch.js
//
// Patch descr_regions.txt IN PLACE from the current `regions` state — replaces
// only the editable per-region lines (rebel faction, culture, and the tags line
// that holds hidden_resources / port level / climate / AOR / farm / religion)
// while preserving the original tabs, blank-line block separators, header
// comments, rgb, farm_level, pop_level and ethnicities. Block format per region:
//   RegionName            (col 0, not indented)
//   \tSettlement / \tFaction / \tCulture / \tRGB / \tTags / \tFarm / \tPop / \tEthnicities
// then a blank line. Returns the patched text, always CRLF.
//
// Line 3 is the descr_regions faction (the rebel default / creator), which the
// app keeps in `rebelDefault`: `faction` is overlaid with the descr_strat OWNER
// at load (App.js "Overlay runtime-parsed descr_strat ownership"). Writing
// `faction` here put every region's starting owner into descr_regions — 352 of
// RIS Light's 605 regions changed on one hidden-resource save (2026-10-16).
export function patchDescrRegions(originalText, regions) {
  if (!originalText) return null;
  const byName = {};
  for (const r of Object.values(regions || {})) {
    if (r && r.region) byName[String(r.region).trim()] = r;
  }
  const eol = "\r\n"; // RTW:R game text files MUST be CRLF — LF silently breaks the engine's descr_* parser, regardless of the source file's EOL
  const lines = originalText.split(/\r?\n/);
  const indentOf = (s) => { const m = String(s).match(/^([ \t]*)/); return m ? m[1] : "\t"; };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    // A region header is a non-blank, non-comment line with NO leading whitespace.
    if (trimmed && !trimmed.startsWith(";") && !/^[ \t]/.test(line)) {
      const r = byName[trimmed];
      if (r) {
        // Collect the consecutive indented, non-comment field lines that follow.
        const fields = [];
        let j = i + 1;
        while (j < lines.length && /^[ \t]/.test(lines[j]) && lines[j].trim() && !lines[j].trim().startsWith(";")) {
          fields.push(j); j++;
        }
        // fields: [0]settlement [1]faction [2]culture [3]rgb [4]tags [5]farm [6]pop [7]ethnicities
        const rebel = r.rebelDefault != null ? r.rebelDefault : r.faction;
        if (fields[1] != null && rebel != null) lines[fields[1]] = indentOf(lines[fields[1]]) + rebel;
        if (fields[2] != null && r.culture != null) lines[fields[2]] = indentOf(lines[fields[2]]) + r.culture;
        if (fields[4] != null && r.tags != null) lines[fields[4]] = indentOf(lines[fields[4]]) + r.tags;
        i = j;
        continue;
      }
    }
    i++;
  }
  return lines.join(eol);
}
