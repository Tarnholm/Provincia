#!/usr/bin/env python3
"""
starting_treasury.py — sets each faction's starting denari in descr_strat:

    denari = BASE_DENARI + PER_TIER * sum(max(0, level_tier - BUMP) per settlement)

with the suite-wide "bump" rule: settlements below tier BUMP contribute 0,
city → tier 1, large_city → tier 2, huge_city → tier 3 (default BUMP=2).
The bigger your cities, the bigger your treasury.

Certain factions are left exactly as-is (slave/dummies and the emergent/rebel
markers in KEEP). Pipeline step: .run(run_strat=, run_out=) — reads the strat it's
given and writes descr_strat.txt to run_out (does not edit files in place).
"""

import sys, re
sys.dont_write_bytecode = True
from pathlib import Path

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OUTPUT_DIR = BASE_DIR / "processed_output"
STRAT_FILE = CONFIG_DIR / "descr_strat.txt"

# Factions left untouched (no formula applied).
KEEP = {
    "slave", "dummies",
    "egypt", "greeks", "lycia", "chrysaoria",
    "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
}
BASE_DENARI = 5000
PER_TIER = 275     # money per tier-point summed across all settlements. Calibrated
                   # against seleucid's RIS imperial loadout (115 settlements, raw
                   # tier-sum 225) → ~67k denari. User's target was "around 65k"
                   # for seleucid as the peer empire at start of imperial campaign.
BUMP = 0           # how much to subtract from each settlement's raw tier before
                   # contributing. 0 = every non-village settlement counts at its
                   # raw tier (town=1, large_town=2, city=3, large_city=4,
                   # huge_city=5). Bump=2 was too aggressive — it floored 78% of
                   # seleucid's empire (town+large_town) at zero contribution.

# Settlement-level → raw tier (same convention as the other suite scripts).
LEVEL_TO_TIER = {
    "village": 0, "town": 1, "large_town": 2,
    "minor_city": 3, "city": 3, "large_city": 4, "huge_city": 5,
}

_faction_re = re.compile(r"^faction\s+(\S+?),")
_denari_re = re.compile(r"^(denari)(\s+)(-?\d+)\s*$")
_settlement_re = re.compile(r"^settlement\s*$")
_level_re = re.compile(r"^\s*level\s+(\w+)")


class StartingTreasuryProcessor:
    def __init__(self):
        self.changelog = []
        self.decisions = []

    def run(self, run_strat=None, run_out=None):
        _strat = Path(run_strat) if run_strat else STRAT_FILE
        _out = Path(run_out) if run_out else OUTPUT_DIR
        if not _strat.exists():
            print(f"ERROR: Strategy file not found: {_strat}")
            return
        lines = _strat.read_text(encoding="utf-8", errors="ignore").splitlines(keepends=True)

        # Pass 1: per faction, find its denari line index, count settlements, and
        # sum the effective tier (settlement_tier - BUMP, floored at 0).
        order, denari_idx, counts, tier_sums = [], {}, {}, {}
        cur = None
        cur_settlement_open = False  # True between `settlement` and its first `level`
        for i, line in enumerate(lines):
            m = _faction_re.match(line)
            if m:
                cur = m.group(1)
                order.append(cur)
                counts[cur] = 0
                tier_sums[cur] = 0
                denari_idx[cur] = None
                cur_settlement_open = False
                continue
            if cur is None:
                continue
            if denari_idx[cur] is None and _denari_re.match(line) and "denari_kings_purse" not in line:
                denari_idx[cur] = i
                continue
            if _settlement_re.match(line):
                counts[cur] += 1
                cur_settlement_open = True
                continue
            if cur_settlement_open:
                lm = _level_re.match(line)
                if lm:
                    raw_tier = LEVEL_TO_TIER.get(lm.group(1), 0)
                    tier_sums[cur] += max(0, raw_tier - BUMP)
                    cur_settlement_open = False  # only the first `level` line counts

        # Pass 2: rewrite denari lines.
        changed = 0
        for name in order:
            idx = denari_idx[name]
            if idx is None:
                self.decisions.append(f"WARN: no denari line for {name}")
                continue
            m = _denari_re.match(lines[idx])
            old = int(m.group(3))
            if name in KEEP:
                self.decisions.append(f"{name}: KEEP (denari {old})")
                continue
            tier_total = tier_sums[name]
            new = BASE_DENARI + PER_TIER * tier_total
            self.decisions.append(f"{name}: {counts[name]} settlements, tier-sum {tier_total} (bump={BUMP}) -> denari {new} (was {old})")
            if new != old:
                lines[idx] = f"{m.group(1)}{m.group(2)}{new}\n"
                self.changelog.append(f"{name}: denari {old} -> {new} ({counts[name]} settlements, tier-sum {tier_total})")
                changed += 1

        _out.mkdir(parents=True, exist_ok=True)
        (_out / "descr_strat.txt").write_text("".join(lines), encoding="utf-8")
        (_out / "changelog.txt").write_text("\n".join(self.changelog) if self.changelog else "No changes were made.", encoding="utf-8")
        (_out / "decisions.txt").write_text("\n".join(self.decisions), encoding="utf-8")
        print(f"Starting treasury: {changed} faction denari values changed. Output: {_out}")


if __name__ == "__main__":
    StartingTreasuryProcessor().run()
