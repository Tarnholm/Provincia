#!/usr/bin/env python3
"""Remove defunct building lines (old chains) from descr_strat settlements.

A chain is treated as defunct when EITHER:
  • its `building <chain>` line in export_descr_buildings.txt is flagged with a
    "remove ... prebuilts" comment (the modder's own marker, e.g.
    `building herds ;;remove this chain after removing prebuilts`), OR
  • it is listed (one per line) in config/defunct_buildings.txt.

Every `building { type <chain> <level> }` block whose chain is defunct is
removed from every settlement, so the chain can then be safely deleted from the
EDB. Writes the cleaned descr_strat.txt, a changelog.txt (one line per removed
building), and a report.txt to processed_output/.
"""
from __future__ import annotations

from pathlib import Path
import re
import sys
import traceback
from typing import Dict, List, Set, Tuple

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OUTPUT_DIR = BASE_DIR / "processed_output"

BUILDINGS_FILE_NAME = "export_descr_buildings.txt"
STRAT_FILE_NAME = "descr_strat.txt"
DEFUNCT_LIST_NAME = "defunct_buildings.txt"  # optional, one chain per line

TYPE_RE = re.compile(r"^\s*type\s+(\S+)\s+(\S+)")
REGION_RE = re.compile(r"^\s*region\s+(\S+)")
# building <chain> ... ;;... remove ... prebuilt(s)
EDB_DEFUNCT_RE = re.compile(r"^\s*building\s+([A-Za-z0-9_]+)\b.*;;.*remov.*prebuilt", re.IGNORECASE)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def detect_defunct_chains(edb_text: str) -> Set[str]:
    out: Set[str] = set()
    for line in edb_text.split("\n"):
        m = EDB_DEFUNCT_RE.match(line)
        if m:
            out.add(m.group(1))
    return out


def load_extra_defunct(path: Path) -> Set[str]:
    out: Set[str] = set()
    if not path.exists():
        return out
    for raw in read_text(path).split("\n"):
        s = raw.split(";")[0].strip()  # allow ; comments
        if s:
            out.add(s)
    return out


def process_strat(text: str, defunct: Set[str]) -> Tuple[str, List[dict]]:
    """Return (new_text, removed) where removed = [{region, chain, level}]."""
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.split("\n")
    # Strip a trailing \r left by splitting on \n when the file is CRLF, so we
    # can re-join cleanly with the detected newline.
    lines = [ln[:-1] if ln.endswith("\r") else ln for ln in lines]

    out: List[str] = []
    removed: List[dict] = []
    current_region = "(unknown)"
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        rm = REGION_RE.match(line)
        if rm:
            current_region = rm.group(1)
            out.append(line)
            i += 1
            continue
        if line.strip() == "building":
            # Capture the whole `building { ... }` block by brace balance.
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
            if chain is not None and chain in defunct:
                removed.append({"region": current_region, "chain": chain, "level": level})
                # drop the block (do not emit)
            else:
                out.extend(block)
            i = j + 1
            continue
        out.append(line)
        i += 1

    return newline.join(out), removed


def write_changelog(path: Path, removed: List[dict]) -> None:
    if not removed:
        path.write_text("No changes were made.\n", encoding="utf-8")
        return
    # Group by region so the GUI Changelog tab buckets it per settlement.
    by_region: Dict[str, List[dict]] = {}
    for r in removed:
        by_region.setdefault(r["region"], []).append(r)
    lines: List[str] = []
    for region in sorted(by_region):
        for r in by_region[region]:
            lines.append(f"{region}: Removed defunct building {r['chain']} {r['level']}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_report(path: Path, defunct: Set[str], removed: List[dict]) -> None:
    out = ["DEFUNCT BUILDING REMOVAL REPORT", "=" * 50, ""]
    out.append(f"Defunct chains targeted ({len(defunct)}): {', '.join(sorted(defunct)) or '(none)'}")
    out.append(f"Buildings removed: {len(removed)}")
    out.append("")
    per_chain: Dict[str, int] = {}
    for r in removed:
        per_chain[r["chain"]] = per_chain.get(r["chain"], 0) + 1
    for chain in sorted(per_chain):
        out.append(f"  {chain}: {per_chain[chain]}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def main(run_strat=None, run_out=None):
    out_dir = Path(run_out) if run_out else OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    strat_path = Path(run_strat) if run_strat else CONFIG_DIR / STRAT_FILE_NAME
    edb_path = CONFIG_DIR / BUILDINGS_FILE_NAME
    try:
        if not strat_path.exists():
            raise FileNotFoundError(f"descr_strat.txt not found at {strat_path}")
        defunct: Set[str] = set()
        if edb_path.exists():
            defunct |= detect_defunct_chains(read_text(edb_path))
        defunct |= load_extra_defunct(CONFIG_DIR / DEFUNCT_LIST_NAME)

        if not defunct:
            print("No defunct chains found (no EDB ';;remove ... prebuilts' flags, "
                  "no config/defunct_buildings.txt). Nothing to do.")
            # Still emit an unchanged copy + empty changelog so the pipeline chains.
            write_text = read_text(strat_path)
            (out_dir / "descr_strat.txt").write_text(write_text, encoding="utf-8")
            write_changelog(out_dir / "changelog.txt", [])
            write_report(out_dir / "report.txt", defunct, [])
            return

        print(f"Defunct chains: {', '.join(sorted(defunct))}")
        new_text, removed = process_strat(read_text(strat_path), defunct)
        (out_dir / "descr_strat.txt").write_text(new_text, encoding="utf-8")
        write_changelog(out_dir / "changelog.txt", removed)
        write_report(out_dir / "report.txt", defunct, removed)
        per_chain: Dict[str, int] = {}
        for r in removed:
            per_chain[r["chain"]] = per_chain.get(r["chain"], 0) + 1
        print(f"Done. Removed {len(removed)} defunct buildings across "
              f"{len(set(r['region'] for r in removed))} settlements.")
        for chain in sorted(per_chain):
            print(f"  {chain}: {per_chain[chain]} removed")
        print(f"Output saved to: {out_dir}")
    except Exception as e:
        tb = traceback.format_exc()
        (out_dir / "errors.log").write_text(f"Exception: {e}\n\n{tb}", encoding="utf-8")
        print(f"Error! See {out_dir}/errors.log", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
