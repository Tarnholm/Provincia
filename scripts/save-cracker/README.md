# save-cracker

Differential reverse-engineering tooling for RTW `.sav` files. Aims to identify every field by combining:

1. **Public RE knowledge** (taw/etwng, Rafkos, TWC threads) — see `RESEARCH.md`
2. **Known-token oracle** — scans the buffer for every faction/region/character/unit/building/trait name from descr_strat / descr_regions / descr_sm_factions in 5 encodings
3. **Self-pointing-section scanner** — finds taw's `{u32 offset==pos, u32 size, payload}` records to build the section tree
4. **Header strings table finder** — locates the schema-version manifest (`(asciiz, u32)` pairs) listing record types like `WORLD_MAP v=3`, `DIPLOMATIC_ATTITUDE v=6`, etc.
5. **Bounded-shift diff** — diffs two consecutive saves with shift-aware resync so single-record growth doesn't light up the whole file
6. **Field locator** — co-occurrence of known integers (treasury values) near known strings (faction names) → discovers field offsets within records

## Usage

```sh
# Single save: header + sections + HST + oracle hits
node scripts/save-cracker/index.js sample-turn1-end.sav

# Two saves: above + diff + field correlations
node scripts/save-cracker/index.js sample-turn1-end.sav --vs sample-turn2-start.sav
```

Outputs land in `scripts/save-cracker/out/<basename>.html` (interactive hex view with annotations) and `<basename>.json` (machine-readable).

## Files

- `index.js` — CLI entrypoint
- `loader.js` — typed buffer readers (u8/u16/u32/f32, pstr8, pstr16le, cstring)
- `oracle.js` — token extractor + multi-encoding scanner
- `sections.js` — self-pointer scanner + tree builder + HST finder
- `diff.js` — naive byte-diff + bounded-shift smart diff
- `locator.js` — int-near-string co-occurrence correlator
- `header.js` — labels for known leading-bytes structure
- `report.js` — HTML report renderer
- `scan-helpers.js` — shared int-finder
- `out/` — generated reports
- `RESEARCH.md` — public-knowledge dossier
