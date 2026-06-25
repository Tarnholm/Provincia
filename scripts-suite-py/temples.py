#!/usr/bin/env python3
"""
temples.py — Adds a STANDARD temple (temples_standard) to every non-town
settlement, sized one tier below the settlement and capped at tier 3.

RULES (per user spec 2026-06-22):
  * Only settlements ABOVE town get a temple (large_town, city, large_city,
    huge_city). Towns and villages are skipped.
  * Temple level = settlement level − 1, CAPPED at tier 3 (large_temple):
        large_town  -> shrine        (tier 1)
        city        -> temple        (tier 2)
        large_city  -> large_temple  (tier 3)
        huge_city   -> large_temple  (tier 3)  <- capped; never awesome/pantheon
    The cap exists because the top-tier settlements start with low population
    and would otherwise be swimming in public order from a tier-4/5 temple.
  * If the settlement runs an INDIRECT government (governmentA / governmentB),
    the temple building gets a `creator <faction>` line mirroring the
    settlement's own `faction_creator` (the engine needs it to resolve the
    culture variant of the building in a non-homeland region).
  * The UNIQUE-temple regions are skipped entirely (they carry temples_unique):
        Hellas, Pytho, Attike, Roma, Media, Ioudaia, Qart-Khadasht, Ammonia
  * A settlement that already has ANY temple (temples_standard / temples_unique /
    temple_complex_* / temples_of_*) is left untouched — RTW allows one temple.

Modelled on the previous temples.py: same balanced-brace settlement parsing,
same `.run(run_strat=, run_out=)` contract so it slots into run_all.py /
master_processor.py. The temples_standard level list is parsed from
export_descr_buildings.txt so the script always emits a valid level name.

Reads:
    config/descr_strat.txt
    config/export_descr_buildings.txt

Writes (into run_out):
    descr_strat.txt          <- updated file
    temples_summary.txt      <- all temples + the CHANGES MADE block
    changelog.txt            <- one line per changed settlement
    decisions.txt            <- per-settlement decision log
    debug_log.txt            <- parsing details and warnings
"""

import sys, re
sys.dont_write_bytecode = True
from pathlib import Path

# --- CONFIG ---
BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OUTPUT_DIR = BASE_DIR / "processed_output"
STRAT_FILE = CONFIG_DIR / "descr_strat.txt"
BUILDINGS_FILE = CONFIG_DIR / "export_descr_buildings.txt"

# The standard temple chain to place, and the special/unique chain to detect.
STANDARD_CHAIN = "temples_standard"
UNIQUE_CHAIN = "temples_unique"

# Settlement level -> numeric tier (shared convention across the suite).
LEVEL_TO_TIER = {
    "village": 0, "town": 1, "large_town": 2,
    "minor_city": 3, "city": 3, "large_city": 4, "huge_city": 5,
}

# Temple tier cap. A settlement's temple = min(settlement_tier - 1, MAX_TEMPLE_TIER).
# tier 3 = large_temple (index 2). Keeps the top settlements from over-producing PO.
MAX_TEMPLE_TIER = 3

# Regions with their own unique temple (temples_unique) — never touched.
SKIP_REGIONS = {
    "Hellas", "Pytho", "Attike", "Roma", "Media",
    "Ioudaia", "Qart-Khadasht", "Ammonia",
}

# Factions whose settlements should be left untouched.
SKIP_FACTIONS = {"slave"}

# Any of these as a building `type` first-token means the settlement already
# has a temple → leave it alone (RTW allows one temple per settlement).
TEMPLE_CHAIN_PREFIXES = ("temples_standard", "temples_unique", "temple_complex_", "temples_of")


# -----------------------------------------------------------------------------
class StandardTempleProcessor:
    def __init__(self):
        self.standard_levels = []   # ["shrine","temple","large_temple","awesome_temple","pantheon"]
        self.changelog = []
        self.decisions = []
        self.debug_logs = []
        self.all_temples = []       # "City (region): temples_standard <level>"

    # ---- EDB: parse temples_standard level names (in order) -----------------
    def load_standard_levels(self):
        if not BUILDINGS_FILE.exists():
            self.debug_logs.append(f"WARNING: EDB not found: {BUILDINGS_FILE}")
            return
        text = BUILDINGS_FILE.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"(?m)^building\s+" + re.escape(STANDARD_CHAIN) + r"\b", text)
        if not m:
            self.debug_logs.append(f"WARNING: '{STANDARD_CHAIN}' chain not found in EDB")
            return
        lm = re.search(r"levels\s+([^\n{]+)", text[m.end():m.end() + 4000])
        if lm:
            self.standard_levels = lm.group(1).split()
        self.debug_logs.append(f"{STANDARD_CHAIN} levels: {self.standard_levels}")

    def level_for_tier(self, sett_tier):
        """min(sett_tier - 1, MAX_TEMPLE_TIER); returns the temples_standard level
        name, or None if the settlement is too small (town/village)."""
        temple_tier = min(sett_tier - 1, MAX_TEMPLE_TIER)
        if temple_tier < 1:
            return None
        idx = temple_tier - 1                       # shrine=tier1=index0
        if not self.standard_levels:
            return None
        idx = max(0, min(idx, len(self.standard_levels) - 1))
        return self.standard_levels[idx]

    # ---- settlement meta ----------------------------------------------------
    @staticmethod
    def _extract_meta(block):
        region, level, creator = None, "town", None
        for l in block:
            s = l.strip()
            if s.startswith("region"):
                mm = re.match(r"region\s+([\w_&\-]+)", s)
                if mm:
                    region = mm.group(1)
            elif s.startswith("level"):
                parts = s.split()
                if len(parts) >= 2:
                    level = parts[1]
            elif s.startswith("faction_creator"):
                parts = s.split()
                if len(parts) >= 2:
                    creator = parts[1]
        return region, level, creator

    @staticmethod
    def _scan_buildings(block):
        """Return (has_temple, has_indirect_gov) by scanning the building types."""
        has_temple = False
        has_indirect_gov = False
        for l in block:
            s = l.strip()
            if not s.startswith("type"):
                continue
            parts = s.split()
            if len(parts) < 2:
                continue
            chain = parts[1]
            if any(chain.startswith(p) for p in TEMPLE_CHAIN_PREFIXES):
                has_temple = True
            # Indirect government = governmentA (Dependency) or governmentB (Indirect Rule).
            if chain in ("governmentA", "governmentB"):
                has_indirect_gov = True
        return has_temple, has_indirect_gov

    # ---- per-settlement -----------------------------------------------------
    def process_settlement_block(self, block, faction_id):
        region, level, creator = self._extract_meta(block)
        info = {"region": region, "level": level, "faction": faction_id,
                "new": None, "reason": ""}

        if faction_id in SKIP_FACTIONS:
            info["reason"] = f"faction '{faction_id}' skipped"
            return block, False, info
        if region in SKIP_REGIONS:
            info["reason"] = f"region '{region}' has a unique temple — skipped"
            return block, False, info

        sett_tier = LEVEL_TO_TIER.get(level, 0)
        if sett_tier < 2:
            info["reason"] = f"level '{level}' is town or below — no temple"
            return block, False, info

        has_temple, indirect_gov = self._scan_buildings(block)
        if has_temple:
            info["reason"] = "already has a temple — left unchanged"
            return block, False, info

        level_name = self.level_for_tier(sett_tier)
        if not level_name:
            info["reason"] = f"no temples_standard level for tier {sett_tier}"
            return block, False, info

        target = f"{STANDARD_CHAIN} {level_name}"
        info["new"] = target
        info["indirect_gov"] = indirect_gov
        info["creator"] = creator if indirect_gov else None

        # Build the new temple block (creator line only under indirect government).
        nb = ["\tbuilding\n", "\t{\n", f"\t\ttype {target}\n"]
        if indirect_gov and creator:
            nb.append(f"\t\tcreator {creator}\n")
        nb.append("\t}\n")

        # Insert just before the settlement's closing brace.
        new_block = list(block)
        idx = -1
        for k in range(len(new_block) - 1, -1, -1):
            if new_block[k].strip() == "}":
                idx = k
                break
        if idx == -1:
            info["reason"] = "could not find settlement closing brace"
            return block, False, info
        while idx > 0 and new_block[idx - 1].strip() == "":
            idx -= 1
        new_block = new_block[:idx] + nb + new_block[idx:]

        self.all_temples.append(f"{region}: {target}" + (f" (creator {creator})" if (indirect_gov and creator) else ""))
        return new_block, True, info

    # ---- settlement block finder (same as the previous module) --------------
    @staticmethod
    def _find_settlement_blocks(text):
        blocks = []
        idx = 0
        while True:
            m = re.search(r"settlement\s*\{", text[idx:], flags=re.IGNORECASE)
            if not m:
                break
            start = idx + m.start()
            brace_start = start + text[start:].find("{")
            depth = 0
            j = brace_start
            while j < len(text):
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        blocks.append((start, j + 1))
                        idx = j + 1
                        break
                j += 1
            else:
                break
        return blocks

    def run(self, run_strat=None, run_out=None):
        _strat = Path(run_strat) if run_strat else STRAT_FILE
        _out = Path(run_out) if run_out else OUTPUT_DIR
        if not _strat.exists():
            print(f"ERROR: Strategy file not found: {_strat}")
            return

        content = _strat.read_text(encoding="utf-8")
        self.load_standard_levels()

        blocks = self._find_settlement_blocks(content)
        print(f"Loaded temples_standard levels {self.standard_levels}; found {len(blocks)} settlements")

        # region -> owning faction (last `faction` decl before the settlement).
        settlement_to_faction = {}
        for start, _end in blocks:
            fm = list(re.finditer(r"^faction\s+([^\s,]+)", content[:start], re.MULTILINE))
            fac = fm[-1].group(1) if fm else None
            region, _, _ = self._extract_meta(content[start:_end].splitlines(keepends=True))
            if region and fac:
                settlement_to_faction[region] = fac

        rebuilt = []
        last_end = 0
        settlements_changed = 0
        for start, end in blocks:
            rebuilt.append(content[last_end:start])
            block_lines = content[start:end].splitlines(keepends=True)
            region, _, _ = self._extract_meta(block_lines)
            faction_id = settlement_to_faction.get(region)
            new_block, changed, info = self.process_settlement_block(block_lines, faction_id)
            if changed:
                settlements_changed += 1
            self._log_decision(info)
            rebuilt.append("".join(new_block))
            last_end = end
        rebuilt.append(content[last_end:])

        _out.mkdir(parents=True, exist_ok=True)
        (_out / "descr_strat.txt").write_text("".join(rebuilt), encoding="utf-8")
        (_out / "changelog.txt").write_text(
            "\n".join(self.changelog) if self.changelog else "No changes were made.", encoding="utf-8")
        (_out / "decisions.txt").write_text("\n".join(self.decisions), encoding="utf-8")
        (_out / "debug_log.txt").write_text("\n".join(self.debug_logs), encoding="utf-8")
        self._write_summary(_out, len(blocks), settlements_changed)

        print(f"\nDone. Temples added: {settlements_changed} (of {len(blocks)} settlements)")
        print(f"Output saved to: {_out}")

    # ---- logging ------------------------------------------------------------
    def _log_decision(self, info):
        region = info.get("region")
        new = info.get("new")
        if new and info.get("reason") != "already has a temple — left unchanged":
            cr = f"  +creator {info.get('creator')}" if info.get("creator") else ""
            self.changelog.append(f"[ADDED] {region}: {new}{cr}")
        self.decisions.append(
            f"--- {region} ---\n"
            f"Faction: {info.get('faction')}  Level: {info.get('level')}  "
            f"IndirectGov: {info.get('indirect_gov')}\n"
            f"Temple: {new or '(none)'}  Reason: {info.get('reason')}\n")

    def _write_summary(self, out_dir, total, changed):
        out = ["=" * 80, "STANDARD TEMPLES SUMMARY", "=" * 80, "",
               f"Total settlements processed: {total}",
               f"Temples added:               {changed}", "",
               "=" * 80, "CHANGES MADE", "=" * 80, ""]
        out.extend([c.replace("[ADDED] ", "") for c in self.changelog] or ["No changes were made."])
        out += ["", "=" * 80, "ALL TEMPLES ADDED", "=" * 80, ""]
        out.extend(sorted(self.all_temples) or ["None."])
        (out_dir / "temples_summary.txt").write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    StandardTempleProcessor().run()
