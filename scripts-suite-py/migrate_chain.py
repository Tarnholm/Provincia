#!/usr/bin/env python3
"""Migrate an old building chain onto one or more new chains across the mod.

Reusable, config-driven step. `config/chain_migration.txt` holds one
`[migration]` block per old chain (farms now; herds and others later); they are
all applied in a single run. For each migration the tool:

  • EDB (export_descr_buildings.txt) — re-points every
    `building_present[_min_level] <old> <lvl>` reference in OTHER buildings onto
    the mapped replacement token (the modder's `cropfarming_level_N` aliases,
    which already OR all the new chains — the "tie to all five" hook), then
    removes the old `building <old> { ... }` block.
  • descr_strat.txt — removes the old chain's `building { type <old> <lvl> }`
    prebuilts (you can't be in five exclusive chains at once; the Farms step
    re-assigns afterwards).
  • traits / ancillaries / localization / UI — SCANS and REPORTS references and
    content gaps (missing new-chain text keys, per-culture .tga, trigger
    rewrites). It never fabricates localization or art, and never rewrites
    trigger conditions automatically (alias syntax is EDB-only) — it lists them
    with file:line context so you can finish by hand.

Idempotent: re-running after a migration is a no-op (no old block, no refs).
Unrelated chains are left untouched. Writes the migrated files plus
changelog.txt and report.txt to processed_output/.
"""
from __future__ import annotations

from pathlib import Path
import re
import sys
import traceback
from typing import Dict, List, Optional, Set, Tuple

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OUTPUT_DIR = BASE_DIR / "processed_output"

CFG_NAME = "chain_migration.txt"
EDB_NAME = "export_descr_buildings.txt"
STRAT_NAME = "descr_strat.txt"
TRAITS_NAME = "export_descr_character_traits.txt"
ANCILS_NAME = "export_descr_ancillaries.txt"
TEXT_NAME = "export_buildings.txt"  # localization (data/text/export_buildings.txt)

TYPE_RE = re.compile(r"^\s*type\s+(\S+)\s+(\S+)")
REGION_RE = re.compile(r"^\s*region\s+(\S+)")


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def detect_newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def split_lines(text: str) -> List[str]:
    lines = text.split("\n")
    return [ln[:-1] if ln.endswith("\r") else ln for ln in lines]


# ── config ────────────────────────────────────────────────────────────────

class Migration:
    def __init__(self) -> None:
        self.old_chain: str = ""
        self.old_levels: List[str] = []
        self.new_chains: List[str] = []
        self.remap: Dict[str, str] = {}        # old level -> replacement token
        self.descr_strat: str = "remove"        # remove | keep

    def __repr__(self) -> str:
        return f"<Migration {self.old_chain} -> {self.new_chains}>"


def parse_config(text: str) -> List[Migration]:
    migs: List[Migration] = []
    cur: Optional[Migration] = None
    for raw in text.split("\n"):
        line = raw.split(";")[0].strip()      # allow ; comments
        if not line:
            continue
        if line.lower() == "[migration]":
            cur = Migration()
            migs.append(cur)
            continue
        if cur is None or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip().lower()
        val = val.strip()
        if key == "old_chain":
            cur.old_chain = val
        elif key == "old_levels":
            cur.old_levels = val.split()
        elif key == "new_chains":
            cur.new_chains = val.split()
        elif key == "descr_strat":
            cur.descr_strat = val.lower()
        elif key == "remap":
            for pair in val.split():
                if "->" in pair:
                    a, b = pair.split("->", 1)
                    cur.remap[a.strip()] = b.strip()
    return [m for m in migs if m.old_chain]


# ── EDB parsing ─────────────────────────────────────────────────────────────

def parse_edb_chains(text: str) -> Dict[str, List[str]]:
    """Map each `building <name>` to its declared `levels ...` list."""
    chains: Dict[str, List[str]] = {}
    cur: Optional[str] = None
    for raw in split_lines(text):
        code = raw.split(";", 1)[0]
        m = re.match(r"^building[ \t]+(\S+)", code)
        if m:
            cur = m.group(1)
            chains.setdefault(cur, [])
            continue
        lm = re.match(r"^\s*levels[ \t]+(.+)$", code)
        if lm and cur is not None and not chains[cur]:
            chains[cur] = lm.group(1).split()
    return chains


def repoint_edb(text: str, mig: Migration, stats: dict) -> str:
    """Re-point building_present[_min_level] <old> <lvl> refs to the remap token."""
    old = mig.old_chain

    pat_ml = re.compile(
        r"building_present_min_level[ \t]+" + re.escape(old) + r"[ \t]+(\S+)"
    )

    def repl_ml(m: "re.Match[str]") -> str:
        lvl = m.group(1)
        token = mig.remap.get(lvl)
        if token:
            stats["edb_repointed"].append((old, lvl, token))
            return token
        stats["edb_unremapped"].add((old, lvl))
        return m.group(0)

    text = pat_ml.sub(repl_ml, text)

    # bare `building_present <old>` (level 1+) -> remap of the base level
    base_token = mig.remap.get(mig.old_levels[0]) if mig.old_levels else None
    if base_token:
        pat_bare = re.compile(r"building_present[ \t]+" + re.escape(old) + r"\b")

        def repl_bare(m: "re.Match[str]") -> str:
            stats["edb_repointed"].append((old, mig.old_levels[0] if mig.old_levels else "(any)", base_token))
            return base_token

        text = pat_bare.sub(repl_bare, text)
    return text


def remove_edb_block(text: str, old: str, stats: dict) -> str:
    """Delete the `building <old> { ... }` block via brace balance."""
    nl = detect_newline(text)
    lines = split_lines(text)
    hdr = re.compile(r"^building[ \t]+" + re.escape(old) + r"\b")
    out: List[str] = []
    i, n = 0, len(lines)
    while i < n:
        if hdr.match(lines[i]):
            depth = 0
            started = False
            j = i
            while j < n:
                seg = lines[j].split(";", 1)[0]   # ignore braces inside comments
                depth += seg.count("{") - seg.count("}")
                if "{" in seg:
                    started = True
                if started and depth <= 0:
                    break
                j += 1
            stats["edb_block_removed"].append(old)
            i = j + 1
            if i < n and lines[i].strip() == "":   # swallow one trailing blank
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return nl.join(out)


# ── descr_strat ─────────────────────────────────────────────────────────────

def process_strat(text: str, old_chains: Set[str]) -> Tuple[str, List[dict]]:
    nl = detect_newline(text)
    lines = split_lines(text)
    out: List[str] = []
    removed: List[dict] = []
    region = "(unknown)"
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        rm = REGION_RE.match(line)
        if rm:
            region = rm.group(1)
            out.append(line)
            i += 1
            continue
        if line.strip() == "building":
            block = [line]
            depth = 0
            started = False
            j = i + 1
            while j < n:
                block.append(lines[j])
                s = lines[j].strip()
                if s == "{":
                    depth += 1
                    started = True
                elif s == "}":
                    depth -= 1
                    if started and depth == 0:
                        break
                j += 1
            chain = level = None
            for bl in block:
                tm = TYPE_RE.match(bl)
                if tm:
                    chain, level = tm.group(1), tm.group(2)
                    break
            if chain is not None and chain in old_chains:
                removed.append({"region": region, "chain": chain, "level": level})
            else:
                out.extend(block)
            i = j + 1
            continue
        out.append(line)
        i += 1
    return nl.join(out), removed


# ── scans (read-only) ───────────────────────────────────────────────────────

def scan_refs(text: str, old: str) -> List[Tuple[int, str]]:
    """Lines mentioning the old chain as a whole word (file is not modified)."""
    hits: List[Tuple[int, str]] = []
    word = re.compile(r"\b" + re.escape(old) + r"\b")
    for n, raw in enumerate(split_lines(text), 1):
        code = raw.split(";", 1)[0]
        if word.search(code):
            hits.append((n, raw.strip()))
    return hits


def localization_gaps(text: str, mig: Migration, edb_chains: Dict[str, List[str]]
                      ) -> Tuple[List[str], List[str]]:
    """(orphan old keys present, new-chain level keys missing)."""
    orphan: List[str] = []
    for lvl in mig.old_levels + [mig.old_chain]:
        if ("{" + lvl + "}") in text or ("{" + lvl + "_") in text:
            orphan.append(lvl)
    missing: List[str] = []
    for nc in mig.new_chains:
        for lvl in edb_chains.get(nc, []):
            if ("{" + lvl + "}") not in text:
                missing.append(lvl)
    return sorted(set(orphan)), missing


def suggest_alias(mig: Migration, edb_chains: Dict[str, List[str]]) -> List[str]:
    """For each old level, an alias body ORing each new chain at that tier."""
    out: List[str] = []
    for idx, old_lvl in enumerate(mig.old_levels):
        parts = []
        for nc in mig.new_chains:
            levels = edb_chains.get(nc, [])
            if idx < len(levels):
                parts.append(f"building_present_min_level {nc} {levels[idx]}")
        token = mig.remap.get(old_lvl, f"<alias_for_{old_lvl}>")
        out.append(f"  {token}  =  " + " or ".join(parts) if parts else f"  {token}  =  (no new-chain level at this tier)")
    return out


# ── reporting ───────────────────────────────────────────────────────────────

def write_changelog(path: Path, lines: List[str]) -> None:
    path.write_text(("\n".join(lines) + "\n") if lines else "No changes were made.\n",
                    encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        cfg_path = CONFIG_DIR / CFG_NAME
        edb_path = CONFIG_DIR / EDB_NAME
        if not cfg_path.exists():
            print(f"No {CFG_NAME} in config/. Nothing to migrate.")
            write_changelog(OUTPUT_DIR / "changelog.txt", [])
            (OUTPUT_DIR / "report.txt").write_text(
                f"No {CFG_NAME} found in config/. Add one [migration] block per old "
                "chain and re-run.\n", encoding="utf-8")
            return
        if not edb_path.exists():
            raise FileNotFoundError(f"{EDB_NAME} not found in config/ — import the mod first.")

        migs = parse_config(read_text(cfg_path))
        if not migs:
            print(f"{CFG_NAME} has no [migration] blocks. Nothing to do.")
            write_changelog(OUTPUT_DIR / "changelog.txt", [])
            (OUTPUT_DIR / "report.txt").write_text("No [migration] blocks defined.\n",
                                                   encoding="utf-8")
            return

        print(f"Migrations: {', '.join(m.old_chain + '->' + '/'.join(m.new_chains) for m in migs)}")

        stats = {
            "edb_repointed": [],          # (old, lvl, token)
            "edb_unremapped": set(),      # (old, lvl)
            "edb_block_removed": [],      # old
        }

        # --- EDB: re-point first (so old block's own refs are irrelevant), then remove ---
        edb_text = read_text(edb_path)
        edb_orig = edb_text
        edb_chains = parse_edb_chains(edb_text)
        for mig in migs:
            edb_text = repoint_edb(edb_text, mig, stats)
        for mig in migs:
            if mig.old_chain in edb_chains:
                edb_text = remove_edb_block(edb_text, mig.old_chain, stats)
        edb_changed = edb_text != edb_orig

        changelog: List[str] = []
        for (old, lvl, token) in stats["edb_repointed"]:
            changelog.append(f"EDB: re-pointed building_present {old} {lvl} -> {token}")
        for old in stats["edb_block_removed"]:
            changelog.append(f"EDB: removed building {old} {{ ... }} block")

        # --- descr_strat: remove old prebuilts ---
        strat_removed: List[dict] = []
        strat_path = CONFIG_DIR / STRAT_NAME
        old_chains_strat = {m.old_chain for m in migs if m.descr_strat != "keep"}
        if strat_path.exists() and old_chains_strat:
            strat_text, strat_removed = process_strat(read_text(strat_path), old_chains_strat)
            (OUTPUT_DIR / STRAT_NAME).write_text(strat_text, encoding="utf-8")
            for r in strat_removed:
                changelog.append(f"{r['region']}: removed prebuilt {r['chain']} {r['level']}")
        elif strat_path.exists():
            # keep mode — still emit a copy so the pipeline chains
            (OUTPUT_DIR / STRAT_NAME).write_text(read_text(strat_path), encoding="utf-8")

        # --- write migrated EDB only when it changed (keeps re-runs idempotent) ---
        if edb_changed:
            (OUTPUT_DIR / EDB_NAME).write_text(edb_text, encoding="utf-8")

        # --- scans (read-only): traits, ancillaries, localization ---
        report: List[str] = ["BUILDING CHAIN MIGRATION REPORT", "=" * 50, ""]
        report.append(f"Migrations: {len(migs)}")
        report.append("")

        for mig in migs:
            report.append(f"[{mig.old_chain}] -> {', '.join(mig.new_chains) or '(none)'}")
            rp = [r for r in stats["edb_repointed"] if r[0] == mig.old_chain]
            report.append(f"  EDB references re-pointed: {len(rp)}")
            report.append(f"  EDB chain block removed:   "
                          f"{'yes' if mig.old_chain in stats['edb_block_removed'] else 'no (not found / already gone)'}")
            n_strat = len([r for r in strat_removed if r['chain'] == mig.old_chain])
            report.append(f"  descr_strat prebuilts removed: {n_strat}"
                          + (" (descr_strat=keep)" if mig.descr_strat == 'keep' else ""))

            unmapped = sorted(l for (o, l) in stats["edb_unremapped"] if o == mig.old_chain)
            if unmapped:
                report.append(f"  ! NO remap for levels: {', '.join(unmapped)} "
                              "(left unchanged — add a remap= entry / alias).")

            # traits + ancillaries (report only — alias syntax is EDB-only)
            for fname in (TRAITS_NAME, ANCILS_NAME):
                fp = CONFIG_DIR / fname
                if not fp.exists():
                    report.append(f"  {fname}: not loaded — check it manually.")
                    continue
                hits = scan_refs(read_text(fp), mig.old_chain)
                if hits:
                    report.append(f"  {fname}: {len(hits)} reference(s) — rewrite by hand:")
                    for ln, txt in hits[:40]:
                        report.append(f"      line {ln}: {txt}")
                    if len(hits) > 40:
                        report.append(f"      ... and {len(hits) - 40} more")
                else:
                    report.append(f"  {fname}: no references. OK.")

            # localization
            tp = CONFIG_DIR / TEXT_NAME
            if tp.exists():
                orphan, missing = localization_gaps(read_text(tp), mig, edb_chains)
                if orphan:
                    report.append(f"  text/export_buildings.txt: orphan old keys to DELETE: "
                                  + ", ".join("{" + o + "}" for o in orphan))
                if missing:
                    report.append(f"  text/export_buildings.txt: MISSING new-chain keys to AUTHOR "
                                  f"({len(missing)}): " + ", ".join("{" + m + "}" for m in missing))
                if not orphan and not missing:
                    report.append("  text/export_buildings.txt: localization OK.")
            else:
                report.append("  text/export_buildings.txt: not loaded — check localization manually.")
            report.append("")

        # manual follow-ups
        report.append("MANUAL FOLLOW-UPS (content the tool will not fabricate)")
        report.append("-" * 50)
        report.append("• UI art: create data/ui/<culture>/buildings/#<culture>_<newlevel>.tga "
                      "(+ _constructed and construction/ frames) for every culture that uses the chain.")
        report.append("• Localization: author the MISSING new-chain keys listed above, and remove "
                      "the orphan old keys across ALL ~60 text/<locale>/export_buildings.txt copies "
                      "(only the primary text/export_buildings.txt is loaded here).")
        report.append("• Triggers: finish any trait/ancillary rewrites listed above. EDB aliases "
                      "(cropfarming_level_N) do NOT work in trait/ancillary conditions — use the raw "
                      "`building_present_min_level <newchain> <level> or ...` form there.")
        report.append("• Campaign scripts: search RIS_Campaign_Script.txt for "
                      "`create_building ... <oldlevel>` and re-point.")
        report.append("• Battlefield: check descr_building_battle*.txt for the old chain.")
        report.append("")
        report.append("Suggested alias bodies (each old tier -> OR of every new chain at that tier):")
        for mig in migs:
            report.append(f"  [{mig.old_chain}]")
            report.extend("  " + s for s in suggest_alias(mig, edb_chains))
        report.append("")
        report.append("FILES WRITTEN to processed_output/: "
                      + ", ".join(filter(None, [
                          EDB_NAME if edb_changed else None,
                          STRAT_NAME if strat_path.exists() else None,
                      ])) + " (review, then Save to Mod).")

        write_changelog(OUTPUT_DIR / "changelog.txt", changelog)
        (OUTPUT_DIR / "report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")

        print(f"Done. EDB refs re-pointed: {len(stats['edb_repointed'])}, "
              f"chains removed: {len(stats['edb_block_removed'])}, "
              f"prebuilts removed: {len(strat_removed)}.")
        if not edb_changed:
            print("EDB unchanged (already migrated or no references) — no EDB written.")
        print(f"Output: {OUTPUT_DIR}")
    except Exception as e:
        tb = traceback.format_exc()
        (OUTPUT_DIR / "errors.log").write_text(f"Exception: {e}\n\n{tb}", encoding="utf-8")
        print(f"Error! See {OUTPUT_DIR}/errors.log", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
