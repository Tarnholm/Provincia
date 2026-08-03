"""RIS Crash Reporter — sits next to a tester's RTW Remastered session,
watches the engine + message logs, and POSTs a report to a Discord webhook
when the game exits. Auto-closes after the report goes out.

Single-file by design — packaged via PyInstaller into one .exe testers can
just double-click before launching the mod. No installer, no config UI.
"""

import atexit
import configparser
import io
import json
import lzma
import mimetypes
import os
import platform
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import struct
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path

APP_NAME = "RIS Crash Reporter"
APP_VERSION = "0.1.47"
CONFIG_FILENAME = "crash_reporter.ini"
LOG_FILENAME = "crash_reporter.log"

# Auto-update channel. Releases are published to this PUBLIC GitHub repo
# (releases only — no source, so the baked-in webhook below is never exposed).
# The updater reads the latest release unauthenticated, mirroring how Provincia
# and Manipula self-update via electron-updater against their GitHub releases.
GITHUB_REPO = "Tarnholm/CrashReporter"
GITHUB_LATEST_RELEASE_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Baked-in default so testers don't have to configure anything. Rotate the
# webhook (Discord → channel → Integrations → Webhooks → Delete + New) if it
# ever leaks; this constant is the only place to update.
DEFAULT_WEBHOOK_URL = "https://discord.com/api/webhooks/1509586141605531688/32aTJVpv1Au53i5CZtjEnFv5MEQiuCRz9_-jBtOZDIirEozPoPD97UrbyIng2iV52tVZ"

# Game-process matching. We compare against the FULL image-name (e.g.
# "RomeTW_BI.exe") case-insensitively — substring matching was unsafe:
# "rome.exe" as a substring hits "chrome.exe". RR's Remastered exe name has
# shifted between updates so the list errs on the broad side; users can
# add their own in the [reporter] rtw_process_names = ... config line.
DEFAULT_RTW_PROCESS_NAMES = {
    # Windows — verified from Task Manager
    "total war rome remastered.exe",
    "rometw.exe",                     # classic RTW
    "rometw_bi.exe",                  # Barbarian Invasion
    "rometw_alx.exe",                 # Alexander
    # macOS — Feral Mac bundle's binary is at
    # /Applications/Total War ROME REMASTERED.app/Contents/MacOS/Total War ROME REMASTERED
    # `ps comm=` returns just the basename (no .exe, no spaces escaped).
    "total war rome remastered",
}

# Lines we consider "interesting" enough to flag. Conservative — we'd rather
# false-positive a few warnings than miss a CTD precursor. Counted at runtime
# so the report can say "32 ERROR lines, 4 fatals".
ERROR_PATTERNS = [
    re.compile(r"\bERROR\b", re.IGNORECASE),
    re.compile(r"\bFATAL\b", re.IGNORECASE),
    re.compile(r"\bASSERT\b", re.IGNORECASE),
    re.compile(r"\bCTD\b"),
    re.compile(r"\bcrash\w*", re.IGNORECASE),
    # \b on both sides so "Exceptional" doesn't match "exception". Bit me
    # in the first batch of real reports — every Iberian trait gain was
    # being counted.
    re.compile(r"\bexceptions?\b", re.IGNORECASE),
    re.compile(r"failed to", re.IGNORECASE),
    re.compile(r"could not (?:find|load|open)", re.IGNORECASE),
]

# Known benign lines to suppress: setup chatter, engine fallback messages,
# anything that fires on every session and is not actionable. Substring
# match — case-sensitive (the engine prints them verbatim).
ERROR_IGNORE_SUBSTRINGS = (
    "Error dialogs disabled",                              # setup info line
    "Could not find a .rwm or needed files",               # expected first-run fallback
    "Music manager failed to get track",                   # cosmetic music fallback
    # The state-music fallback prints a slightly different sentence that slipped
    # past the line above and inflated the error count on otherwise-clean runs.
    "failed to get a track when falling back",             # cosmetic music fallback (variant)
)
FATAL_PATTERNS = [
    re.compile(r"\bFATAL\b", re.IGNORECASE),
    re.compile(r"\bCTD\b"),
    re.compile(r"crash", re.IGNORECASE),
    re.compile(r"unhandled exception", re.IGNORECASE),
]

# RTW Remastered prints assertion failures as "<expression> Failed" (capital F),
# NOT as the word ASSERT/ERROR/FATAL — so the patterns above miss them entirely,
# which is exactly how an assert-storm CTD reported as "clean exit". We detect
# the format directly. `.*?\bFailed` captures the expression up to (and incl.)
# the first "Failed", tolerating UI text that bleeds onto the same line
# ("...length Failedbuilding_browser scroll opened").
ASSERT_RE = re.compile(r".*?\bFailed")

# An engine RESOLUTION FAILURE, not an assert: the game could not resolve a name and
# says which one. These lines START with "Failed", so ASSERT_RE reduced them to the bare
# word and their content was lost — see the note above this block's history.
#
# The captured token is the actionable part. `descr_formations_ai.txt:80` +
# 'pilum_infantry' identifies a one-line fix in the mod, and Provincia's modLint finds
# the same token statically without running the game.
RESOLUTION_FAILURE_RE = re.compile(
    r"^Failed to (?P<what>[^.]+?)\.\s*Provided:\s*'(?P<token>[^']+)'"
)
# A file:line the engine printed just before the failure, so the report can point at it.
SOURCE_REF_RE = re.compile(r"([A-Za-z0-9_./\\-]+\.txt):(\d+)\s*$")


def is_resolution_failure(line):
    """True when a line is an engine name-resolution failure rather than an assert.

    Matched BEFORE ASSERT_RE so these never land in the assert counter as "Failed".
    Deliberately narrow: it requires the "Provided: '<token>'" clause, so an ordinary
    sentence beginning with "Failed" is not swallowed.
    """
    return bool(RESOLUTION_FAILURE_RE.match(line.strip()))


def parse_resolution_failure(line):
    """-> (what_failed, token) or None."""
    m = RESOLUTION_FAILURE_RE.match(line.strip())
    if not m:
        return None
    return m.group("what").strip(), m.group("token").strip()

# Benign/high-frequency asserts the engine + RIS scripts throw constantly and
# that do NOT indicate a crash. Substring match against the captured expression.
# These three alone account for ~7.9M lines in a long session — counting them
# would bury the real signal, so they're suppressed.
ASSERT_IGNORE_SUBSTRINGS = (
    # Engine resolution failures start with "Failed" and so collapse to that single
    # word under ASSERT_RE. They are counted separately, with their token, by
    # RESOLUTION_FAILURE_RE — not suppressed, re-routed.
    "Failed to find",
    "Failed to load",
    "Failed to open",
    "n < N Failed",
    "min <= max Failed",
    "bdg.construction_type_get()",
    "BUILDING_CONSTRUCTION_ITEM_BUILDING_NEW",
    "diplomatic_stance_get(",
)

# Engine teardown markers — written ONLY during a graceful quit-to-desktop. If
# any of these appears in the tail of message_log, the session ended cleanly.
# Validated against 600 real reports: every confirmed clean exit ends on one of
# these; no confirmed crash does.
CLEAN_SHUTDOWN_MARKERS = (
    "BATTLE_ALLIANCE_STATS::clear",
    "UI Texture Handler Closed",
    "sundry manager closed",
    "closing FMV",
)

# Last-line signatures that mean the log stopped mid turn-processing. A clean
# quit never ends here, so when the tail has NO shutdown marker and ends on one
# of these, it's a silent CTD (the Neep/Vader Hemeroskopeion-heir-reshuffle
# class — the engine died in post-battle inheritance handling).
GAMEPLAY_ENDER_PATTERNS = [
    re.compile(r"has gained a new trait"),
    re.compile(r"has lost a trait"),
    re.compile(r"has gained a level"),
    re.compile(r"death_type\("),
    re.compile(r"has been assessed"),
    re.compile(r"Setting battle result"),
    re.compile(r"surrenders .* to faction"),
    re.compile(r"CAPTURE_RESIDENCE"),
]

# Battle/map-LOAD enders. message_log stops on the last successful asset-load
# step because the CTD happens in the very next phase (model/texture/scene
# render), which doesn't write to message_log. Confirmed by the RIS team that
# the sound-descr load is a red herring — there's no audio problem; it's just
# the last thing logged before a battle-load crash. Ending on one of these (no
# clean-shutdown marker) is therefore a real CTD, not a mid-battle quit (a quit
# back to campaign writes post-battle lines).
LOAD_ENDER_PATTERNS = [
    re.compile(r"Loaded BG sound descr pack"),
    re.compile(r"TrueSky - Sequence File Loaded"),
    re.compile(r"Loading .*pack"),
    re.compile(r"Loading initial pack with vaiable enum hashes"),
    re.compile(r"Verifying \(\d+, ?\d+\)"),
    re.compile(r"File Path: .*[\\/](data|ui)[\\/]", re.IGNORECASE),
]

# Old-save ↔ new-map mismatch. When a tester loads a .sav made on a different
# version of the mod's campaign map, the engine logs this and aborts the load —
# usually followed by "num_frontiers == …count() Failed" / "byte <= buffer_end -
# buffer_start Failed" and an abnormal exit. After every RIS map update this
# flooded telemetry as 🔴SUSPECTED CRASH (12+ short-session reports in the v7.10
# wave alone), but it's tester-actionable (start a fresh campaign), not a mod
# defect — so it gets its own status instead of polluting the crash bucket.
SAVE_INCOMPAT_MARKER = "Incompatible save game with the current world map"

# A bare 3-float coordinate dump (camera/model position) — e.g.
# "-411.008992, 165.432544, 165.432544". These appear during scene LOAD but ALSO
# during end-turn/campaign processing (kvad88's Turn-11 hang), so a coordinate
# ender alone is NOT proof of a battle load — only when corroborated by actual
# load markers in the tail.
COORD_ENDER_RE = re.compile(r"^-?\d+\.\d+,\s*-?\d+\.\d+,\s*-?\d+\.\d+\s*$")

# A log that ends on the SAME line repeated many times = a stuck loop / hang
# (e.g. an AI unit that can't path, spamming its position until the OS kills the
# game). Clean shutdowns legitimately repeat teardown markers, so those are
# excluded from this check.
LOOP_MIN_REPEATS = 8

# Battle-setup lines, captured LIVE as the message_log streams. A battle/map-load
# CTD ends inside an asset-load block that's longer than any tail we'd attach, so
# the battle identity scrolls off — but if we record these lines as they go by
# during the watch loop, the last batch is the offending battle's setup
# (settlement, factions, conflict type) regardless of how long the load runs.
BATTLE_SETUP_PATTERNS = [
    re.compile(r"Battle Setup Phase Started"),
    re.compile(r"siege by .*? on [A-Z]"),
    re.compile(r":(?:ASSAULT|BESIEGE):"),
    re.compile(r"Conflict Type\("),
    re.compile(r"Initialising army data for battle:"),
    re.compile(r"surrenders .* to faction"),
]

# RIS is heavily scripted; the engine writes script faults to scripting_log.txt
# (which the reporter historically never read). These are the RIS team's OWN
# code — the most actionable class of issue. High-signal patterns only, to keep
# the verbose scripting_log from flooding the report.
SCRIPT_ERROR_PATTERNS = [
    re.compile(r"Script Error", re.IGNORECASE),
    re.compile(r"\berror in\b", re.IGNORECASE),
    re.compile(r"\bat line\b.*\bcolumn\b", re.IGNORECASE),
    re.compile(r"could not (?:find|load|open)", re.IGNORECASE),
    re.compile(r"unrecognised|unrecognized", re.IGNORECASE),
    re.compile(r"in expanded string table", re.IGNORECASE),
]

# Asset / model load failures — the direct cause of the battle/map-load CTDs
# (a settlement battle that references a missing model/texture, e.g. the
# construction-site models or a ground-type texture). Captured with the lines
# leading up to them, which usually name the model/settlement being built.
ASSET_FAIL_PATTERNS = [
    re.compile(r"PHYSICAL_GRID failed to open file"),
    re.compile(r"could not find named geometry", re.IGNORECASE),
    re.compile(r"MODEL_\w+ .*(?:could not|failed)", re.IGNORECASE),
    re.compile(r"could not (?:find|load|open) .*\.(?:cas|tga|dds|mesh)", re.IGNORECASE),
    re.compile(r"failed to (?:open|load|find) .*\.(?:cas|tga|dds|mesh)", re.IGNORECASE),
]

# Sessions shorter than this are not flagged for a missing teardown marker — a
# quick launch/quit or a crash during initial load is noise, not a play-session
# CTD we can act on.
UNCLEAN_MIN_MINUTES = 3.0

# Stale-log guard: if message_log wasn't written for the last STALE_LOG_SECONDS
# of a session of at least STALE_LOG_MIN_MINUTES, the game isn't logging
# gameplay (logging off/misconfigured) — the tail is meaningless, so we must NOT
# infer a crash from it (that produced false "asset-load CTD" reports for a
# tester whose reinstall reset RR logging; he played 20 min, log frozen at the
# startup sound-load). A real crash writes up to the crash, so its mtime is recent.
STALE_LOG_SECONDS = 120
STALE_LOG_MIN_MINUTES = 3.0

POLL_INTERVAL_SEC = 2
LOG_TAIL_LINES = 200
# Battle/map-load CTDs end inside a long asset-load block (hundreds of "Loading
# pack" / "Discarding duplicate sound" / texture lines). At 50 lines the tail was
# entirely consumed by that block and the battle identity (siege, factions, map)
# scrolled off — 0 of 37 such reports carried it. Widened so future load-crash
# reports include the battle context needed to pinpoint the offending map/unit.
MESSAGE_TAIL_LINES = 400
MAX_REPORT_BYTES = 7 * 1024 * 1024  # Discord file-attachment ceiling

# ---------------------- campaign_ai_log extract (AI Lab) ----------------------
# Provincia's AI Movement Lab reads campaign_ai_log.txt, and it is by far the
# richest thing the game writes: every AI decision, the strength each campaign
# demanded, what it managed to allocate, which garrisons got stripped, which wars
# were authorised. Until now the reporter did not collect it at all, so none of
# that ever reached the team.
#
# It cannot be attached raw — a 102-turn campaign produces ~330MB. It does not
# need to be: the Lab only reads 13 line shapes, 23% of the lines, and a verbatim
# extract of exactly those compresses from 107MB to ~3MB with lzma.
#
# The patterns come from ai_log_patterns.py, GENERATED from the analyser's own
# manifest by Provincia's scripts/gen-ailog-patterns.js. They are never typed by
# hand here: a hand-written copy got the faction turn header wrong on the first
# attempt ("+start" instead of "AI: <tabs>start"), matched nothing, and would
# have silently dropped every turn boundary. If the module is missing the extract
# is skipped with a note — it is never approximated with a guessed filter.
# The embeddable Python that Provincia bundles ships a ._pth file, and with one
# present Python does not put the script's own directory on sys.path — so a
# sibling module is not importable by default. A normal `python crash_reporter.py`
# does add it, which is why this only showed up once the reporter was bundled.
# Add it ourselves so the import works under any host. Frozen builds have the
# module inside the exe and need nothing.
if not getattr(sys, "frozen", False):
    try:
        _here = os.path.dirname(os.path.abspath(__file__))
        if _here and _here not in sys.path:
            sys.path.insert(0, _here)
    except Exception:  # pragma: no cover - __file__ absent in odd hosts
        pass

try:
    from ai_log_patterns import keep_ai_log_line as _keep_ai_line
    from ai_log_patterns import is_turn_block as _is_turn_block
    AI_LOG_FILTER_AVAILABLE = True
except Exception:  # pragma: no cover - missing generated module
    _keep_ai_line = None
    _is_turn_block = None
    AI_LOG_FILTER_AVAILABLE = False

AI_LOG_FILENAME = "campaign_ai_log.txt"
# lzma preset 6: 107MB -> ~3.2MB in ~8s. Preset 9|EXTREME reaches 2.5MB but takes
# 22s, which is a poor trade for a tester waiting on a crash report.
AI_LOG_LZMA_PRESET = 6

# Set by --non-interactive (Provincia passes it): never prompt on stdin. Bundled
# inside Provincia there is no console to type into and stdin is closed, so a
# prompt would raise EOFError and kill the reporter before it watched anything.
# Provincia collects the tester's name in its own UI and writes it to the ini.
NON_INTERACTIVE = "--non-interactive" in sys.argv


def extract_ai_log(log_dir: Path, max_bytes: int = MAX_REPORT_BYTES,
                   turn_cap: int = 0) -> tuple[bytes, str] | None:
    """Filter campaign_ai_log.txt to the lines Provincia's Lab reads, lzma-compressed.

    Returns (compressed_bytes, human_summary) or None when there is nothing to send.

    Streams and compresses incrementally so a 330MB log never lands in memory.
    When the result would exceed max_bytes the OLDEST turn blocks are dropped and
    it is rebuilt — trimming whole blocks keeps every retained record complete,
    where a byte-truncated file would end mid-line and lose the newest turn.
    """
    if not AI_LOG_FILTER_AVAILABLE:
        return None
    path = log_dir / AI_LOG_FILENAME
    try:
        if not path.exists() or path.stat().st_size == 0:
            return None
    except OSError:
        return None

    src_bytes = path.stat().st_size

    def sweep(skip_blocks: int) -> tuple[bytes, int, int, int]:
        """One pass. Returns (compressed, kept_lines, total_lines, blocks_kept)."""
        comp = lzma.LZMACompressor(preset=AI_LOG_LZMA_PRESET)
        out = bytearray()
        kept = total = blocks = 0
        seen_blocks = 0
        # pattern 0 is the faction turn header; recognise it cheaply
        with path.open("r", encoding="latin-1", errors="replace") as fh:
            for line in fh:
                total += 1
                line = line.rstrip("\r\n")
                # Use the GENERATED regex, not a string heuristic: a
                # startswith/in guess counted 23,337 turn blocks in a log that
                # has 51, which would have made the trim logic nonsense.
                is_block = _is_turn_block(line)
                if is_block:
                    seen_blocks += 1
                # Off-by-one guard: with skip_blocks == 0 nothing may be
                # skipped. `seen_blocks <= 0` is true for everything BEFORE the
                # first faction header, which silently dropped the log's preamble
                # (one finance line on the reference log, and with it one
                # faction's economy record).
                if skip_blocks and seen_blocks <= skip_blocks:
                    continue
                if not _keep_ai_line(line):
                    continue
                if is_block:
                    blocks += 1
                kept += 1
                out += comp.compress((line + "\n").encode("latin-1", errors="replace"))
        out += comp.flush()
        return bytes(out), kept, total, blocks

    blob, kept, total, blocks = sweep(0)
    total_blocks = blocks
    dropped = 0
    # Halve the RETAINED block count, monotonically, against the total from the
    # first sweep. Recomputing the skip from the already-reduced count (the
    # original bug) makes each pass skip fewer blocks than the last, so the loop
    # oscillates and never converges: a 256 KB ceiling settled at 2,182 KB.
    retained = total_blocks
    guard = 0
    while len(blob) > max_bytes and retained > 1 and guard < 24:
        guard += 1
        retained = max(1, retained // 2)
        dropped = total_blocks - retained
        blob, kept, total, blocks = sweep(dropped)

    if kept == 0:
        return None

    summary = (
        f"campaign_ai_log: {src_bytes // (1024*1024)} MB / {total:,} lines -> "
        f"{kept:,} analysed lines, {len(blob) // 1024} KB xz, {blocks} turn blocks"
    )
    if dropped:
        summary += f" (oldest {dropped} blocks dropped to fit)"
    if turn_cap:
        summary += f" [turn_cap={turn_cap}]"
    return blob, summary


def extract_script_errors(scripting_log: Path, max_lines: int = 4000) -> bytes | None:
    """Verbatim `Script Error` / `Error while executing` lines from scripting_log.

    Provincia's script analyser matches on the ENGINE's own wording, anchored at
    the start of the line, so these must be passed through untouched. The existing
    script_faults attachment prefixes each line with a "xN " count, which is fine
    for a human but unparseable for the Lab — hence a second, verbatim file.
    """
    try:
        if not scripting_log.exists():
            return None
    except OSError:
        return None
    keep = []
    try:
        with scripting_log.open("r", encoding="latin-1", errors="replace") as fh:
            for line in fh:
                s = line.rstrip("\r\n")
                if "Error" not in s:            # cheap reject; >99.9% of lines
                    continue
                if s.lstrip().startswith("Script Error in") or s.lstrip().startswith("Error while executing"):
                    keep.append(s)
                    if len(keep) >= max_lines:
                        break
    except OSError:
        return None
    if not keep:
        return None
    return "\n".join(keep).encode("utf-8", errors="replace")


# ----------------------------- config + paths -----------------------------

def script_dir() -> Path:
    """Folder containing the running .exe (or .py during dev)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def log_line(line: str):
    """Append a timestamped line to crash_reporter.log next to the exe. This is
    the persistent record for diagnosing an unexplained close — the console
    window vanishes on exit, but this file survives. Best-effort + size-capped so
    it never grows without bound or crashes the app if the file is locked."""
    try:
        p = script_dir() / LOG_FILENAME
        try:
            if p.exists() and p.stat().st_size > 1_000_000:
                tail = p.read_bytes()[-200_000:]
                p.write_bytes(b"...[older log trimmed]...\n" + tail)
        except OSError:
            pass
        with open(p, "a", encoding="utf-8") as f:
            for ln in str(line).splitlines() or [""]:
                f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {ln}\n")
    except Exception:
        pass


def load_config():
    cfg = configparser.ConfigParser()
    cfg["reporter"] = {
        "webhook_url": DEFAULT_WEBHOOK_URL,
        # Your RTR Imperium Surrectum (RIS) DISCORD name — NOT your PC name.
        # Left blank on purpose: the reporter asks for it on first run.
        "tester_name": "",
        "name_confirmed": "false",  # set true once a real RIS Discord name is saved, so we stop asking
        "log_dir": "",
        "mod_name": "",
        "auto_update": "true",    # check GitHub for a newer reporter at startup and self-install it (set false to pin your version)
        "always_report": "true",  # send even on clean exit (use false to only report on suspected crash)
        "flag_unclean_shutdown": "true",  # flag sessions that ended with no clean-shutdown marker as ORANGE "unclean" (set false to treat those as clean)
        "upload_save": "true",    # zip + attach the most recent .sav with each report
        "max_save_mb": "8",       # skip the save if the ZIP exceeds this (Discord webhook ceiling; raise on a boosted server)
        "sample_memory": "true",  # sample the game's peak working set during the session and show the memory trend in the report (helps spot leaks/exhaustion behind late-session CTDs)
        # Comma-separated extra process names to watch for (case-insensitive,
        # full filename match). Useful if RR's exe gets renamed in a future
        # Steam update. The built-in defaults are always included.
        "rtw_process_names": "",
        # Mods sanctioned for beta sessions: comma-separated substrings matched
        # CASE-SENSITIVELY against each enabled mod's display name ("RIS" hits
        # "[PublicBETA] RIS 0.7.0" and "4 Romans RIS" but not "Rise of ...").
        # Any enabled mod matching none of these is flagged 🚫 in the report —
        # beta results with a foreign mod loaded aren't trustworthy.
        "allowed_mod_substrings": "RIS",
    }
    path = script_dir() / CONFIG_FILENAME
    if path.exists():
        cfg.read(path, encoding="utf-8")
    else:
        # Write the template so testers can override tester_name etc.
        with open(path, "w", encoding="utf-8") as f:
            cfg.write(f)
    return cfg["reporter"]


def save_config_values(values: dict):
    """Persist key/values into [reporter] in crash_reporter.ini, preserving the
    rest of the file. Best-effort — a read-only dir just means we re-prompt."""
    path = script_dir() / CONFIG_FILENAME
    cfg = configparser.ConfigParser()
    if path.exists():
        cfg.read(path, encoding="utf-8")
    if not cfg.has_section("reporter"):
        cfg.add_section("reporter")
    for k, v in values.items():
        cfg.set("reporter", k, v)
    try:
        with open(path, "w", encoding="utf-8") as f:
            cfg.write(f)
    except OSError:
        pass


def _looks_autofilled(name: str) -> bool:
    """True if tester_name looks like a placeholder we should replace rather
    than a deliberately-entered Discord name: blank, 'anonymous', or an exact
    match for the Windows account name (how older builds auto-populated it)."""
    name = (name or "").strip().lower()
    if not name or name == "anonymous":
        return True
    pc = os.environ.get("USERNAME", "").strip().lower()
    return bool(pc) and name == pc


def prompt_for_discord_name() -> str:
    """Ask for the tester's RIS Discord name, making crystal-clear it's the
    Discord handle and NOT the PC name. Returns '' if they just hit Enter."""
    banner("=" * 68)
    banner("  " + bold("WHAT IS YOUR NAME ON THE ") + red("RIS") + bold(" DISCORD SERVER?"))
    banner("")
    banner("  Discord lets you use a different nickname on each server.")
    banner("  Enter the name you go by on the " + red("RIS server specifically") + " — that")
    banner("  is how we match your crash reports to you.")
    banner("")
    banner("  " + red("Use your RIS server name, NOT your global Discord handle."))
    banner("=" * 68)
    try:
        return input(bold("  Your name on the RIS Discord server: ")).strip()
    except EOFError:
        return ""


def resolve_tester_name(cfg) -> str:
    """Return the tester's RIS Discord name, prompting once if the stored value
    is missing or just an auto-filled PC name. The answer is saved back to the
    ini and flagged confirmed so we never nag again."""
    name = cfg.get("tester_name", "").strip()
    confirmed = cfg.get("name_confirmed", "false").strip().lower() in ("1", "true", "yes", "on")
    if confirmed and name:
        return name
    # --non-interactive: there is no console to prompt on. Use whatever the ini
    # has; if that is empty or an auto-filled PC name, say so plainly in the
    # report rather than blocking, and let the host app fix it.
    if NON_INTERACTIVE:
        if name and not _looks_autofilled(name):
            return name
        banner("  [non-interactive] no confirmed tester name in the config -"
               " reports will be tagged 'unnamed (set it in Provincia)'")
        return "unnamed (set it in Provincia)"
    if _looks_autofilled(name):
        entered = prompt_for_discord_name()
        if entered:
            save_config_values({"tester_name": entered, "name_confirmed": "true"})
            banner(f"  Thanks — reports will be tagged as: {entered}")
            banner("")
            return entered
        banner("  (left blank — reports will be tagged 'anonymous' until set)")
        banner("")
        return "anonymous"
    return name or "anonymous"


def auto_detect_log_dirs():
    """Return a list of plausible RR log dirs (most-recently-modified first).

    Windows: %LOCALAPPDATA%\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\<camp>\\logs
    macOS:   ~/Library/Application Support/Feral Interactive/Total War Rome Remastered/VFS/Local/<camp>/logs
            (note: macOS path uses "Rome Remastered", Windows "ROME REMASTERED" — Feral spells them differently)
    """
    candidates = []
    bases = []
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            bases.append(Path(local) / "Feral Interactive" / "Total War ROME REMASTERED" / "VFS" / "Local")
    elif sys.platform == "darwin":
        home = Path.home()
        bases.append(home / "Library" / "Application Support" / "Feral Interactive" / "Total War Rome Remastered" / "VFS" / "Local")
    for base in bases:
        for camp in ("Rome", "Alexander", "Barbarian Invasion"):
            d = base / camp / "logs"
            if d.exists():
                candidates.append(d)
    # Sort by message_log mtime so the campaign actually being played wins.
    def mtime(d):
        try: return (d / "message_log.txt").stat().st_mtime
        except OSError: return 0
    candidates.sort(key=mtime, reverse=True)
    return candidates


def resolve_log_dir(cfg) -> Path | None:
    override = cfg.get("log_dir", "").strip()
    if override:
        p = Path(override)
        return p if p.exists() else None
    found = auto_detect_log_dirs()
    return found[0] if found else None


# ----------------------------- mod detection -------------------------------

def detect_active_mods(log_dir: Path) -> list[str]:
    """Read mod_loading.txt and return EVERY enabled mod's display name, ordered
    by load order (load order 0 first). The game rewrites this log every launch.
    The enabled-mod line looks like:
        Mod <path> (<id>, , <DISPLAY NAME>, <desc>) enabled, load order: 0
    Each entry is the display name (e.g. "[PublicBETA] RIS 0.7.0 v7.1"), falling
    back to the mod folder name. Returns [] if nothing parseable."""
    try:
        text = (log_dir / "mod_loading.txt").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    candidates = []  # (load_order, display_or_folder)
    for line in text.splitlines():
        m = re.match(r"\s*Mod\s+(.+?)\s+\(([^)]*)\)\s+enabled,\s+load order:\s+(\d+)", line)
        if not m:
            continue
        path_str, inner, order = m.group(1), m.group(2), int(m.group(3))
        parts = [p.strip() for p in inner.split(",")]
        display = parts[2] if len(parts) >= 3 and parts[2] else ""
        folder = path_str.replace("\\", "/").rstrip("/").split("/")[-1]
        name = display or folder
        if name:
            candidates.append((order, name))
    candidates.sort(key=lambda c: c[0])
    return [name for _, name in candidates]


def detect_mod_name(log_dir: Path) -> str | None:
    """Lowest-load-order active mod's display name (the "primary" mod), or None.
    Thin wrapper over detect_active_mods for the single-name report header."""
    mods = detect_active_mods(log_dir)
    return mods[0] if mods else None


def find_unapproved_mods(active_mods: list[str], allowed_subs: list[str]) -> list[str]:
    """Enabled mods whose display name matches NONE of the allowed substrings.
    Matching is deliberately case-sensitive: the default allowlist token "RIS"
    must hit "[PublicBETA] RIS 0.7.0" / "4 Romans RIS" without also matching a
    lowercase "ris" buried in e.g. "Rise of Persia"."""
    return [m for m in active_mods if not any(s in m for s in allowed_subs)]


# ----------------- on-disk verification of engine file:line claims -----------------
# v0.1.46. The engine's "could not resolve '<token>' at <file>:<line>" describes the
# file the game LOADED AT LAUNCH — not necessarily what is on disk NOW. Steam updates
# workshop items in place, sometimes while the game is running, so a fixed file can
# still produce a full session of resolution failures from the pre-update copy (field
# case: v7.13 removed the bare `unit_type pilum_infantry`, and two testers still
# reported it at descr_formations_ai.txt:80 — the v7.12 layout — from stale copies).
# Reporting that as "a DATA defect, fixable" sends the mod team chasing a fix that
# already shipped. The reporter runs on the tester's machine, so it can settle the
# question by reading the real file.

_RTWR_APP_ID = "885970"


def _steam_workshop_roots() -> list[Path]:
    """All existing .../steamapps/workshop/content/885970 dirs across Steam libraries."""
    roots: list[Path] = []
    if sys.platform != "win32":
        return roots
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            steam = Path(winreg.QueryValueEx(k, "SteamPath")[0])
    except OSError:
        return roots
    libs = [steam]
    vdf = steam / "steamapps" / "libraryfolders.vdf"
    try:
        for m in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace")):
            libs.append(Path(m.group(1).replace("\\\\", "\\")))
    except OSError:
        pass
    for lib in libs:
        d = lib / "steamapps" / "workshop" / "content" / _RTWR_APP_ID
        if d.is_dir() and d not in roots:
            roots.append(d)
    return roots


def map_engine_path(engine_path: str, workshop_roots: list[Path] | None = None) -> Path | None:
    """Map an engine VFS path (q:/feral/...) to the real file, or None.

    Two shapes seen in the field:
      q:/feral/steam/workshop/<id>/<rel>                   → <library>/steamapps/workshop/content/885970/<id>/<rel>
      q:/feral/users/default/appdata/local/<rel>           → %LOCALAPPDATA%/Feral Interactive/Total War ROME REMASTERED/VFS/Local/<rel>
        (same mapping the logs themselves use: .../local/rome/logs ↔ VFS/Local/Rome/logs;
         covers "My Mods" dev copies at .../local/mods/my mods/<name>/...)
    """
    p = engine_path.replace("\\", "/")
    low = p.lower()
    m = re.search(r"/steam/workshop/(\d+)/(.+)$", low)
    if m:
        rel = p[m.start(2):]  # original casing of the tail (paths on disk are case-insensitive anyway)
        for root in (workshop_roots if workshop_roots is not None else _steam_workshop_roots()):
            cand = root / m.group(1) / rel
            if cand.is_file():
                return cand
        return None
    m = re.search(r"/users/default/appdata/local/(.+)$", low)
    if m and sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            cand = Path(local) / "Feral Interactive" / "Total War ROME REMASTERED" / "VFS" / "Local" / p[m.start(1):]
            if cand.is_file():
                return cand
    return None


def check_token_on_disk(token: str, engine_path: str, line_no: int,
                        workshop_roots: list[Path] | None = None):
    """Does the CURRENT on-disk file still contain <token> where the engine said?

    Returns (verdict, detail):
      ("confirmed", "")            token on the named line — live defect, location verified
      ("elsewhere", "lines a,b")   token not on that line but standalone elsewhere in the file
      ("stale", "")                token nowhere in the file → the game loaded an older copy
      (None, reason)               file unmappable/unreadable — no claim either way

    The token must appear as a standalone word: `pilum_infantry` must NOT match
    inside the valid class-prefixed `heavy_pilum_infantry`. `;` comments are
    stripped first so a commented-out remnant does not resurrect the defect.
    """
    real = map_engine_path(engine_path, workshop_roots)
    if real is None:
        return None, "file not found locally"
    try:
        lines = real.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        return None, "unreadable (%s)" % exc.__class__.__name__
    word = re.compile(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % re.escape(token))
    def has(ln: str) -> bool:
        return bool(word.search(ln.split(";", 1)[0]))
    if 1 <= line_no <= len(lines) and has(lines[line_no - 1]):
        return "confirmed", ""
    hits = [i + 1 for i, ln in enumerate(lines) if has(ln)]
    if hits:
        return "elsewhere", "line(s) %s" % ",".join(str(h) for h in hits[:3])
    return "stale", ""


def find_latest_save(log_dir: Path) -> Path | None:
    """Newest .sav in the campaign's saves folder (sibling of logs/)."""
    saves_dir = log_dir.parent / "saves"
    try:
        saves = [p for p in saves_dir.glob("*.sav") if p.is_file()]
    except OSError:
        return None
    if not saves:
        return None
    return max(saves, key=lambda p: p.stat().st_mtime)


def zip_save(save_path: Path) -> bytes | None:
    """Zip a save in-memory (saves are large binaries that compress well)."""
    try:
        raw = save_path.read_bytes()
    except OSError:
        return None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr(save_path.name, raw)
    return buf.getvalue()


def zip_file(path: Path) -> bytes | None:
    """Zip an arbitrary file in-memory under its own name (crash dumps are big
    XML and compress ~15×)."""
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr(path.name, raw)
    return buf.getvalue()


# ----------------------------- crash dumps -----------------------------

def find_crash_dumps(log_dir: Path, since_ts: float) -> list[Path]:
    """Feral crash dumps written during this session — the most reliable CTD
    signal (present even when both logs flush cleanly with no FATAL/ERROR text).

    Feral writes "<timestamp>_FeralCrashDump <hex>.xml" to
        <game root>/Crash Reports/{,pending,processing,sent,previous,temp}
    which is SEVERAL levels ABOVE the logs dir (a sibling of VFS) — earlier
    builds only scanned around the logs dir and so found nothing. We walk up to
    the "Crash Reports" folder and scan its subfolders, plus keep the old
    logs-dir guesses. Only files newer than since_ts count — but mtime alone is
    NOT proof the crash happened this session: Feral moves dumps between the
    Crash Reports work subfolders (pending/processing/sent), refreshing mtime,
    and writes the large XML twin AFTER the .dmp — sometimes not until the next
    game launch. Callers must therefore also date each dump with
    dump_crash_time() before treating it as this session's crash."""
    candidates = [log_dir, log_dir.parent, log_dir.parent.parent]
    for b in list(candidates):
        candidates += [b / "CrashDumps", b / "crashes"]
    # The real location — walk up from the logs dir to the game root's
    # "Crash Reports" folder and add all of its work subfolders.
    for anc in [log_dir, *log_dir.parents]:
        cr = anc / "Crash Reports"
        if cr.exists():
            candidates.append(cr)
            candidates += [cr / s for s in ("pending", "processing", "sent", "previous", "temp")]
            break
    search_dirs, seen = [], set()
    for d in candidates:
        try:
            rp = d.resolve()
        except Exception:
            continue
        if rp not in seen and d.exists():
            seen.add(rp); search_dirs.append(d)
    found = {}
    for d in search_dirs:
        for pat in ("*FeralCrashDump*", "*.dmp"):
            try:
                for p in d.glob(pat):
                    try:
                        if p.is_file() and p.stat().st_mtime >= since_ts:
                            found[p.resolve()] = p
                    except OSError:
                        pass
            except OSError:
                pass
    return list(found.values())


_DUMP_TS_RX = re.compile(r"(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})")
_DUMP_ID_RX = re.compile(r"FeralCrashDump\s+([0-9a-f]+)", re.IGNORECASE)


def dump_crash_time(path: Path, siblings=()) -> float | None:
    """The moment the crash behind this dump actually happened, from the dump's
    own filename — or None when it cannot say.

    Feral names the XML "<YYYY-MM-DD_HH-MM-SS>_FeralCrashDump <hex>.xml" with the
    crash time; the paired minidump is a bare "FeralCrashDump <hex>.dmp", so it
    is dated through a timestamped sibling carrying the same hex id when one is
    in view. Telemetry proved mtime is not a substitute: every XML landed in the
    session AFTER its crash (back-to-back relaunches), and one day-old XML
    resurfaced inside a later session's mtime window when Feral shuffled it
    between work subfolders."""
    m = _DUMP_TS_RX.search(path.name)
    if m is None:
        idm = _DUMP_ID_RX.search(path.name)
        if idm:
            for sib in siblings:
                if sib is not path and idm.group(1) in sib.name:
                    sm = _DUMP_TS_RX.search(sib.name)
                    if sm:
                        m = sm
                        break
    if m is None:
        return None
    try:
        return datetime(*(int(g) for g in m.groups())).timestamp()
    except ValueError:
        return None


def read_crash_dump_info(path: Path) -> str:
    """Best-effort one-liner from a Feral crash dump's header (game version, the
    crash signal/message if present, GPU, crash-id) for the report summary."""
    try:
        head = path.read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        return ""
    def tag(name):
        m = re.search(rf"<{name}>(.*?)</{name}>", head, re.DOTALL)
        return m.group(1).strip() if m else ""
    bits = []
    if tag("version"): bits.append(f"game {tag('version')}")
    if tag("crash-msg"): bits.append(f"signal: {tag('crash-msg')}")
    if tag("gpushortname"): bits.append(tag("gpushortname"))
    if tag("crash-id"): bits.append(f"id {tag('crash-id')}")
    return ", ".join(bits)


_MDMP_EXC_NAMES = {
    0xC0000005: "ACCESS_VIOLATION", 0xC00000FD: "STACK_OVERFLOW",
    0xC000001D: "ILLEGAL_INSTRUCTION", 0x80000003: "BREAKPOINT",
    0xC0000094: "INT_DIVIDE_BY_ZERO", 0xC0000374: "HEAP_CORRUPTION",
    0xE06D7363: "C++ exception (throw)", 0xC0000409: "STACK_BUFFER_OVERRUN",
}


def extract_dump_minidump(path: Path) -> bytes | None:
    """The Feral dump's <log> element is a base64/zlib-wrapped Windows minidump
    (MDMP). Decode it to raw bytes (or None if absent/empty/undecodable)."""
    import base64, zlib
    try:
        xml = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    m = re.search(r'<log encoding="base64/zlib"[^>]*>\s*<!\[CDATA\[(.*?)\]\]>', xml, re.DOTALL)
    if not m:
        return None
    try:
        raw = zlib.decompress(base64.b64decode("".join(m.group(1).split())))
    except Exception:
        return None
    return raw if raw[:4] == b"MDMP" else None


def parse_minidump_summary(raw: bytes) -> str | None:
    """Parse a Windows minidump (no symbols / no debugger) for the exception code
    and the faulting MODULE+offset — enough to tell game-code vs driver vs overlay
    and to group crashes (same offset = same bug). Also lists injected overlays.
    Returns a one-line summary, or None. Best-effort; never raises."""
    try:
        if raw[:4] != b"MDMP":
            return None
        nstreams, dirrva = struct.unpack_from("<II", raw, 8)
        streams = {}
        for i in range(nstreams):
            st, _ds, rva = struct.unpack_from("<III", raw, dirrva + i * 12)
            streams[st] = rva
        def mstr(rva):
            ln = struct.unpack_from("<I", raw, rva)[0]
            return raw[rva + 4:rva + 4 + ln].decode("utf-16-le", "replace")
        mods = []  # (base, size, name)
        if 4 in streams:  # ModuleListStream
            rva = streams[4]; n = struct.unpack_from("<I", raw, rva)[0]; off = rva + 4
            for _ in range(n):
                base, size = struct.unpack_from("<QI", raw, off)
                nm = mstr(struct.unpack_from("<I", raw, off + 20)[0]).replace("\\", "/").split("/")[-1]
                mods.append((base, size, nm)); off += 108
        if 6 not in streams:  # ExceptionStream
            return None
        rva = streams[6]
        code = struct.unpack_from("<I", raw, rva + 8)[0]
        addr = struct.unpack_from("<Q", raw, rva + 24)[0]
        fault = [m for m in mods if m[0] <= addr < m[0] + m[1]]
        where = f"{fault[0][2]}+0x{addr - fault[0][0]:X}" if fault else f"0x{addr:X} (no module)"
        out = f"{_MDMP_EXC_NAMES.get(code, hex(code))} in {where}"
        overlays = sorted({nm for _, _, nm in mods
                           if re.search(r"gameoverlay|DiscordHook|EOSOVH|rtsshooks|overlay", nm, re.I)})
        if overlays:
            out += f"; overlays injected: {', '.join(overlays)}"
        return out
    except Exception:
        return None


def extract_dump_logs(path: Path, wanted: tuple[str, ...], tail_kb: int = 64) -> dict[str, str]:
    """Decode the base64/zlib logs Feral embeds inside a crash dump (the logs AS
    OF the crash). Returns {filename: text_tail}. This is the only way to see
    campaign_ai_log.txt / battle_ai_log.txt, which the reporter never otherwise
    captures. Best-effort: any decode failure is skipped, never raised."""
    import base64, zlib
    out: dict[str, str] = {}
    try:
        xml = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for m in re.finditer(
        r'<file encoding="base64/zlib" filename="([^"]+)"[^>]*>\s*<!\[CDATA\[(.*?)\]\]>',
        xml, re.DOTALL,
    ):
        name = m.group(1)
        if name not in wanted:
            continue
        try:
            raw = zlib.decompress(base64.b64decode("".join(m.group(2).split())))
            text = raw.decode("utf-8", errors="replace")
            out[name] = text[-tail_kb * 1024:] if len(text) > tail_kb * 1024 else text
        except Exception:
            pass
    return out


# ----------------------------- process watcher -----------------------------

def find_rtw_process(allowed_names: set[str]) -> tuple[str | None, bool]:
    """Return (image_name_or_None, check_ok).

    check_ok is False when the process list could NOT be read (tasklist/ps
    timed out or errored — common when the box is busy running a game). The
    caller MUST NOT treat a failed check as "the game exited": that false
    positive made the reporter close mid-game. Only (None, True) — a successful
    listing with no match — means the game is genuinely gone.

    Match is EXACT (full filename, case-insensitive) — substring matching
    fired false positives like "chrome.exe" containing "rome.exe". Uses the
    OS's native process-list tool so we don't take a psutil dependency.
    """
    try:
        if sys.platform == "win32":
            # /fo csv /nh = CSV without header. Image name is field 0.
            out = subprocess.run(
                ["tasklist", "/fo", "csv", "/nh"],
                capture_output=True, text=True, timeout=8,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            ).stdout
            for line in out.splitlines():
                if not line.startswith('"'):
                    continue
                name = line.split('"', 2)[1]
                if name.lower() in allowed_names:
                    return name, True
        else:
            # ps -A -c -o comm — on macOS, -c prints the short comm (no path,
            # no args), which matches how we store names in allowed_names.
            out = subprocess.run(
                ["ps", "-A", "-c", "-o", "comm="],
                capture_output=True, text=True, timeout=8,
            ).stdout
            for line in out.splitlines():
                name = line.strip()
                if name and name.lower() in allowed_names:
                    return name, True
    except (OSError, subprocess.TimeoutExpired):
        return None, False  # couldn't check — inconclusive, NOT an exit
    return None, True       # checked successfully, game not running


def sample_game_memory(allowed_names: set[str]) -> tuple[int, int, int] | None:
    """Best-effort memory snapshot of the running game process, in BYTES:
    (working_set, peak_working_set, private). Returns None if the process
    isn't found or the query failed.

    Why: late-session CTDs (the dominant +0x266FD3 null-deref) look like a
    failed allocation under resource pressure — fow-off / all_ai marathons.
    Capturing the peak working set per session lets telemetry SHOW the memory
    trend instead of guessing at a leak. On Windows we read the OS-tracked
    PeakWorkingSet64 (monotonic over the process lifetime), so one late sample
    already yields the true session peak. No psutil dependency — same native
    tooling as find_rtw_process (PowerShell on Windows, ps on macOS).
    """
    try:
        if sys.platform == "win32":
            names = {n[:-4] if n.lower().endswith(".exe") else n for n in allowed_names}
            ps_list = ",".join("'" + n.replace("'", "''") + "'" for n in names)
            script = (
                f"Get-Process -Name {ps_list} -ErrorAction SilentlyContinue | "
                "Sort-Object WorkingSet64 -Descending | Select-Object -First 1 | "
                "ForEach-Object { '{0} {1} {2}' -f "
                "$_.WorkingSet64,$_.PeakWorkingSet64,$_.PrivateMemorySize64 }"
            )
            out = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                capture_output=True, text=True, timeout=10,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            ).stdout.strip()
            if out:
                ws, peak, priv = (int(x) for x in out.split()[:3])
                return ws, peak, priv
        else:
            # macOS: rss only (no per-process peak/private without extra tools).
            out = subprocess.run(
                ["ps", "-A", "-c", "-o", "rss=,comm="],
                capture_output=True, text=True, timeout=10,
            ).stdout
            best = 0
            for line in out.splitlines():
                parts = line.strip().split(None, 1)
                if len(parts) == 2 and parts[1].lower() in allowed_names:
                    best = max(best, int(parts[0]) * 1024)  # rss is in KiB
            if best:
                return best, 0, 0
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None
    return None


# ----------------------------- log tailing -----------------------------

class LogTail:
    """Append-only follower. Re-opens the file if it shrinks (truncation /
    log rotation between sessions). All reads are utf-8 with replacement so a
    stray non-UTF byte never crashes the watcher mid-session.
    """
    def __init__(self, path: Path):
        self.path = path
        self.pos = 0
        self.buffer = []
        self.error_count = 0
        self.fatal_count = 0
        # Distinct non-benign engine asserts ("<expr> Failed") → occurrence count.
        # Counted by distinct expression so a million repeats of one assert show
        # as one entry with a big count, not a million flagged lines.
        self.asserts: Counter = Counter()
        # Engine name-resolution failures, keyed "<what>: '<token>'", plus the file:line
        # the engine printed just before each. These are NOT asserts — they start with
        # the word "Failed", so ASSERT_RE reduced them to that single word and their
        # content was lost. Grimel's three consecutive crash reports each listed
        # "Failed ×14" as one of only three distinct asserts; what it really said was
        # "descr_formations_ai.txt:80 / Provided: 'pilum_infantry'".
        self.resolution_failures: Counter = Counter()
        self.resolution_source: dict = {}
        # v0.1.46: the FULL engine path + line for each resolution failure (the
        # display string above keeps only basename:line). Needed to verify the
        # token against the real on-disk file — see check_token_on_disk().
        self.resolution_fullsrc: dict = {}
        # Optional live capture: lines matching any regex in capture_res are kept
        # (most-recent, capped) so the report can show e.g. the last battle setup
        # even when it scrolled far past any attachable tail.
        self.capture_res: list = []
        self.captured: list[str] = []
        # v0.1.20: pin down the building-browser string-overflow. RTW often
        # concatenates the next log event onto the assert line, so the text
        # AFTER "uni_char_string->length Failed" reveals which UI was rendering
        # (e.g. "…Failedbuilding_browser_scroll scroll opened"). We also snapshot
        # context around the engine's "Uknown settlement level" message.
        self.overflow_suffixes: Counter = Counter()
        self.level_ctx: list[str] = []
        # v0.1.21: first-seen context for each distinct assert — the few lines
        # leading up to its FIRST occurrence, so the report shows WHAT triggered
        # each assert type, not just how many times it fired.
        self.assert_first_ctx: dict[str, str] = {}
        # v0.1.24: asset/model load failures (the cause of battle-load CTDs) with
        # the preceding lines, which usually name the model/settlement loading.
        self.asset_fails: Counter = Counter()
        self.asset_fail_ctx: dict[str, str] = {}
        # Keep every line that matched a pattern, capped — so reports show
        # WHAT was flagged, not just a number. Cap prevents runaway memory
        # on a session with thousands of script-error lines.
        self.matched_lines: list[str] = []
        # v0.1.29: end-turns seen this session ("between turns" lines in
        # message_log) — cheap progress context for the report ("crashed ~turn
        # N of the session", distinguishes a 3-hour marathon from a 3-hour idle).
        self.turn_count = 0

    @property
    def assert_count(self) -> int:
        """Total occurrences of non-benign asserts this session."""
        return sum(self.asserts.values())

    def top_asserts(self, n: int = 5) -> list[tuple[str, int]]:
        return self.asserts.most_common(n)

    def poll(self):
        if not self.path.exists():
            return []
        try:
            size = self.path.stat().st_size
        except OSError:
            return []
        if size < self.pos:
            # File was truncated / replaced — restart from start.
            self.pos = 0
        if size == self.pos:
            return []
        with open(self.path, "rb") as f:
            f.seek(self.pos)
            chunk = f.read(size - self.pos)
            self.pos = size
        text = chunk.decode("utf-8", errors="replace")
        lines = text.splitlines()
        for ln in lines:
            self.buffer.append(ln)
            # RR's log files open with banners like
            #   ==== error log start, build date: Jan 17 2022 ===
            # which match \bERROR\b and inflate the count to 1 every session.
            # Skip lines that are pure separator/banner.
            stripped = ln.strip()
            if stripped == "between turns":
                self.turn_count += 1
            if stripped.startswith("====") or stripped.startswith("----"):
                continue
            if any(ig in ln for ig in ERROR_IGNORE_SUBSTRINGS):
                continue
            # RTW assertion ("<expr> Failed") — invisible to ERROR_PATTERNS, so
            # detected separately and deduped by expression. Cheap "Failed in"
            # guard first so we only run the regex on candidate lines.
            if "Failed" in ln:
                # A resolution failure NAMES what the engine could not resolve, which is
                # the most actionable line a report can carry. Handled before ASSERT_RE
                # because these start with "Failed" and would otherwise be filed as an
                # assert whose expression is that bare word.
                rf = parse_resolution_failure(ln)
                if rf:
                    what, token = rf
                    key = "%s: '%s'" % (what, token)
                    if key not in self.resolution_failures:
                        src = ""
                        for prev in reversed(self.buffer[-4:]):
                            sm = SOURCE_REF_RE.search(prev.strip())
                            if sm:
                                src = "%s:%s" % (sm.group(1).replace("\\", "/").split("/")[-1], sm.group(2))
                                self.resolution_fullsrc[key] = (
                                    sm.group(1).replace("\\", "/"), int(sm.group(2)))
                                break
                        self.resolution_source[key] = src
                    self.resolution_failures[key] += 1
                    continue
                am = ASSERT_RE.search(ln)
                if am:
                    expr = am.group(0).strip()
                    if not any(ig in expr for ig in ASSERT_IGNORE_SUBSTRINGS):
                        if expr not in self.asserts:  # first time we've seen it
                            self.assert_first_ctx[expr] = "\n".join(
                                s.strip()[:120] for s in self.buffer[-4:])
                        self.asserts[expr] += 1
                # Bleed text after a string-overflow assert names the UI that was
                # rendering when it blew up. Normalize ids/numbers and dedupe.
                if "uni_char_string" in ln and len(self.overflow_suffixes) < 40:
                    suf = ln.split("Failed", 1)[1].strip()
                    if suf:
                        suf = re.sub(r"\(?[0-9a-fx]{4,}\)?", "#", suf)
                        suf = re.sub(r"\d+", "#", suf).strip()[:60]
                        if suf:
                            self.overflow_suffixes[suf] += 1
            if ("Uknown settlement level" in ln or "Unknown settlement level" in ln) and len(self.level_ctx) < 3:
                self.level_ctx.append(" | ".join(s.strip()[:80] for s in self.buffer[-8:]))
            # Asset/model load failure — the direct battle-load CTD cause. Record
            # the failure line + the few lines before it (which name the model).
            if ("PHYSICAL_GRID" in ln or "geometry" in ln or "could not find" in ln
                    or "could not load" in ln or "could not open" in ln or "failed to open" in ln
                    or "failed to load" in ln) and any(p.search(ln) for p in ASSET_FAIL_PATTERNS):
                key = re.sub(r"\b[0-9a-fx]{4,}\b", "#", ln.strip())[:120]
                if key not in self.asset_fails and len(self.asset_fails) < 40:
                    self.asset_fail_ctx[key] = "\n".join(s.strip()[:110] for s in self.buffer[-4:])
                self.asset_fails[key] += 1
            is_err = any(p.search(ln) for p in ERROR_PATTERNS)
            is_fatal = any(p.search(ln) for p in FATAL_PATTERNS)
            if is_err: self.error_count += 1
            if is_fatal: self.fatal_count += 1
            if (is_err or is_fatal) and len(self.matched_lines) < 2000:
                self.matched_lines.append(ln)
            # Live capture (e.g. battle-setup context) — keep only the most
            # recent window so the last battle before exit survives a long load.
            if self.capture_res and any(p.search(ln) for p in self.capture_res):
                self.captured.append(ln)
                if len(self.captured) > 60:
                    self.captured = self.captured[-60:]
        # Cap memory — we only ship the tail anyway.
        if len(self.buffer) > 5000:
            self.buffer = self.buffer[-2000:]
        return lines


# ----------------------------- discord upload -----------------------------

def post_to_discord(webhook_url: str, message: str, attachments: list[tuple[str, bytes]],
                    status: str = "clean"):
    """Multipart POST to a Discord webhook.

    attachments: [(filename, raw_bytes), ...]. Discord accepts up to 10 files
    per webhook call; we currently only send 2 (system.log tail, message_log
    tail) so we don't bother with chunked uploads.

    The report is sent as a colored EMBED so severity is obvious at a glance in
    the channel. `status` is one of:
      "crash"    → RED, a hard abnormal-termination signal (fatal text, crash
                   dump, mid-line truncation, mid-turn/load log end). A real CTD.
      "unstable" → YELLOW, the game exited CLEANLY (teardown markers present) but
                   threw a high volume of asserts/errors during play. Bugs to
                   fix, but NOT a crash this session.
      "unclean"  → ORANGE, no clean-shutdown marker but ended on a battle/load
                   line — could be a mid-battle quit OR a CTD; needs a human look.
      "clean"    → GREEN, engine teardown markers present; genuinely clean.
    The colored left-edge bar is Discord's native way to signal this — far more
    scannable than plain text.
    """
    # JSON payload part — a colored embed carries the human-readable summary.
    if status == "crash":
        title, color = "🔴 SUSPECTED CRASH", 0xE74C3C        # red
    elif status == "unstable":
        title, color = "🟡 Clean exit — unstable (high assert volume)", 0xF1C40F  # yellow
    elif status == "unclean":
        title, color = "🟠 Unclean shutdown (no crash signature)", 0xE67E22  # orange
    elif status == "nolog":
        title, color = "⚪ message_log not updating — game logging off?", 0x95A5A6  # grey
    elif status == "savemap":
        title, color = "🟣 Old save ↔ current map mismatch (tester-side, not a mod crash)", 0x9B59B6  # purple
    else:
        title, color = "🟢 Clean exit", 0x2ECC71             # green
    payload = {"embeds": [{
        "title": title,
        "description": message[:4000],  # embed description ceiling is 4096
        "color": color,
    }]}

    # Send with retries (v0.1.29): a 429 rate-limit is honoured (Retry-After,
    # a few retries) instead of losing the report on a busy channel, and a 413
    # payload-too-large drops the largest attachment and retries — a report with
    # fewer files beats no report at all.
    attachments = [(fn, blob) for fn, blob in attachments if blob]

    def send(chunk_payload, files):
        rate_retries = 0
        while True:
            boundary = "----RISCR" + uuid.uuid4().hex
            body = io.BytesIO()
            def write(s):
                if isinstance(s, str): s = s.encode("utf-8")
                body.write(s)
            write(f"--{boundary}\r\n")
            write('Content-Disposition: form-data; name="payload_json"\r\n')
            write("Content-Type: application/json\r\n\r\n")
            write(json.dumps(chunk_payload))
            write("\r\n")
            for idx, (filename, blob) in enumerate(files):
                if len(blob) > MAX_REPORT_BYTES:
                    blob = blob[-MAX_REPORT_BYTES:]
                ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                write(f"--{boundary}\r\n")
                write(f'Content-Disposition: form-data; name="files[{idx}]"; filename="{filename}"\r\n')
                write(f"Content-Type: {ctype}\r\n\r\n")
                write(blob)
                write("\r\n")
            write(f"--{boundary}--\r\n")

            req = urllib.request.Request(
                webhook_url, data=body.getvalue(), method="POST",
                headers={
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "User-Agent": f"{APP_NAME}/{APP_VERSION}",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return resp.status
            except urllib.error.HTTPError as e:
                if e.code == 429 and rate_retries < 5:
                    rate_retries += 1
                    try:
                        delay = float(e.headers.get("Retry-After") or 2.0)
                    except (TypeError, ValueError):
                        delay = 2.0
                    time.sleep(min(delay, 30.0) + 0.5)
                    continue
                if e.code == 413 and files:
                    dropped = max(files, key=lambda a: len(a[1]))
                    files = [a for a in files if a is not dropped]
                    continue
                raise

    # Discord hard-caps a webhook message at 10 files — files[10]+ is rejected
    # with HTTP 400 (bit Neep's 88-min crash report: 4 base tails + asserts +
    # 2 script files + save zip + 3 dump-embedded logs = 12). Chunk into as many
    # messages as needed instead of losing the whole report; the first chunk
    # carries the summary embed, follow-ups a short continuation embed.
    chunks = [attachments[i:i + 10] for i in range(0, len(attachments), 10)] or [[]]
    http_status = send(payload, list(chunks[0]))
    for part_no, extra in enumerate(chunks[1:], 2):
        send({"embeds": [{"title": f"{title} — attachments (part {part_no})",
                          "color": color}]}, list(extra))
    return http_status


def last_nonblank_lines(path: Path, n: int) -> list[str]:
    """Return the last n non-blank lines of a (possibly huge) log, reading only
    the final 64 KB so a 400 MB message_log doesn't have to be slurped. Used to
    classify how the session ended (clean teardown vs mid-turn CTD)."""
    try:
        with open(path, "rb") as f:
            try:
                f.seek(-65536, 2)
            except OSError:
                f.seek(0)  # file smaller than the window
            data = f.read()
    except OSError:
        return []
    lines = [ln for ln in data.decode("utf-8", errors="replace").splitlines() if ln.strip()]
    return lines[-n:]


def classify_shutdown(message_log: Path, duration_min: float) -> tuple[str, str | None]:
    """Decide how the session ended from the tail of message_log.

    Returns (verdict, signal) where verdict is "clean", "crash", or "unclean":
      clean   — a teardown marker is present (graceful quit-to-desktop).
      crash   — ends mid turn-processing, on an asset-load step, or in a stuck
                repeated-line loop (hang) — all silent CTDs.
      unclean — no marker, ended on an ambiguous line (e.g. a bare coordinate with
                no load markers — could be a mid-battle quit, an end-turn hang, or
                a CTD). Below UNCLEAN_MIN_MINUTES we treat it as clean.
    `signal` is a human-readable note for the report, or None.
    """
    # Read a wide window so a hang's pre-loop trigger line is still in view even
    # after a long spam; the clean-marker scan is restricted to the last lines.
    tail = last_nonblank_lines(message_log, 120)
    if not tail:
        return "clean", None
    last = tail[-1]
    has_clean_marker = any(m in "\n".join(tail[-20:]) for m in CLEAN_SHUTDOWN_MARKERS)

    # Gameplay-ender on the LAST line wins over everything. A crash in post-battle
    # processing leaves autoresolve teardown lines (incl. BATTLE_ALLIANCE_STATS::
    # clear, a shutdown marker) a few lines up — so this must come first or those
    # crashes get falsely cleared.
    if any(p.search(last) for p in GAMEPLAY_ENDER_PATTERNS):
        return "crash", (f"message_log ends mid turn-processing with no clean-shutdown "
                         f"markers (silent CTD signature) — last line: {last.strip()[:160]}")

    # Stuck-loop / hang: the tail ends on the SAME line repeated. Excludes clean
    # teardown markers (a clean exit legitimately repeats BATTLE_ALLIANCE_STATS::
    # clear). This is kvad88's end-turn position-spam class.
    reps = 0
    for ln in reversed(tail):
        if ln == last:
            reps += 1
        else:
            break
    if reps >= LOOP_MIN_REPEATS and not any(m in last for m in CLEAN_SHUTDOWN_MARKERS):
        # The spammed line is usually a bare coordinate, and the lines right before
        # it are often MORE coordinate spam — so scan back past all coordinate
        # triples to the last REAL activity line (e.g. "Verifying … road_joiner",
        # "Battle Loaded"), which is what actually triggered the hang.
        start = len(tail) - reps
        trigger = ""
        for s in reversed(tail[:start]):
            st = s.strip()
            if st and not COORD_ENDER_RE.match(st):
                trigger = st[:170]
                break
        sig = f"ended in a repeated-line loop (hang/stuck) — \"{last.strip()[:80]}\" ×{reps}+ at the tail"
        if trigger:
            sig += f"; trigger (last real activity before the loop): {trigger}"
        return "crash", sig

    # Asset-load ender (sound/pack/TrueSky/settlement_plans/texture) → battle/map
    # load CTD. Checked before the marker scan so a stray marker can't clear it.
    if any(p.search(last) for p in LOAD_ENDER_PATTERNS):
        return "crash", (f"message_log ends on an asset-load step with no clean-shutdown "
                         f"markers — CTD during scene/asset load (battle or map load); "
                         f"last line: {last.strip()[:160]}")

    # Bare coordinate ender — only a battle/map load if corroborated by actual
    # load markers in the tail; otherwise it's ambiguous (end-turn/campaign).
    if COORD_ENDER_RE.match(last):
        if any(p.search(l) for l in tail for p in LOAD_ENDER_PATTERNS):
            return "crash", (f"message_log ends on a coordinate dump amid load markers — "
                             f"CTD during scene/asset load; last line: {last.strip()[:120]}")
        return "unclean", (f"ends on a coordinate dump with no load/teardown markers — "
                           f"ambiguous (end-turn/campaign hang or CTD); last line: {last.strip()[:120]}")

    if has_clean_marker:
        return "clean", None
    if duration_min < UNCLEAN_MIN_MINUTES:
        return "clean", None
    return "unclean", (f"no clean-shutdown markers — session may have ended during a battle/load "
                       f"or crashed; last line: {last.strip()[:160]}")


def summarize_battle(captured: list[str]) -> str | None:
    """Distil the live-captured battle-setup lines into 'settlement=X,
    factions=A/B, conflict=Y' so a battle/map-load CTD report names the offending
    battle even though the setup scrolled far past the attachable tail. Falls back
    to the last raw captured line, or None if nothing was captured."""
    if not captured:
        return None
    text = "\n".join(captured)
    bits = []
    m = re.search(r"siege by .*? on ([A-Z][\w' .-]+?)\(", text)
    if m:
        bits.append(f"settlement={m.group(1).strip()}")
    facs = []
    for mm in re.finditer(r"Initialising army data for battle: \w+, (\w+)", text):
        if mm.group(1) not in facs:
            facs.append(mm.group(1))
    if facs:
        bits.append(f"factions={'/'.join(facs)}")
    m = re.search(r"Conflict Type\((\w+)\)", text)
    if m:
        bits.append(f"conflict={m.group(1)}")
    if not bits:
        return f"last battle line: {captured[-1].strip()[:160]}"
    return ", ".join(bits)


def decide_status(hard_crash: bool, shutdown_verdict: str, soft_unstable: bool,
                  flag_unclean: bool, log_stale: bool = False,
                  save_incompat: bool = False) -> str:
    """Combine the session's signals into a final status. The key rule (added in
    v0.1.18): a confirmed CLEAN shutdown is never a crash, even with thousands of
    asserts — soft instability only downgrades a clean exit to "unstable", and
    only escalates to "crash" when there was NO clean shutdown.

      hard_crash      — a definitive abnormal-termination signal fired (fatal
                        text, crash dump, mid-line truncation, or a mid-turn/
                        load-step log end). Wins over everything, incl. a stale log
                        (a crash dump is valid even if message_log stopped logging).
      shutdown_verdict— classify_shutdown(): "clean" | "crash" | "unclean".
      soft_unstable   — asserts present or 5+ ERROR lines (instability, not proof
                        of a crash).
      flag_unclean    — config: surface ambiguous (battle/load-quit) endings.
      log_stale       — message_log stopped updating mid-session (game logging
                        off): the tail is meaningless, so we can't assess — "nolog"
                        instead of a false crash, unless a HARD signal fired.
      save_incompat   — the session ENDED on the engine refusing to load an
                        old save ("Incompatible save game with the current world
                        map"). Wins over hard_crash: the truncation/load-ender
                        signals are downstream of the refused load, not a
                        gameplay CTD — reporting them as SUSPECTED CRASH flooded
                        telemetry after every map update.
    """
    if save_incompat:
        return "savemap"
    if hard_crash:
        return "crash"
    if log_stale:
        return "nolog"
    if shutdown_verdict == "clean":
        return "unstable" if soft_unstable else "clean"
    if soft_unstable:
        return "crash"            # no clean teardown + instability ≈ silent CTD
    if shutdown_verdict == "unclean" and flag_unclean:
        return "unclean"
    return "clean"


def tail_bytes(path: Path, max_lines: int) -> bytes:
    if not path.exists():
        return b""
    try:
        data = path.read_bytes()
    except OSError as e:
        return f"[crash_reporter] could not read {path.name}: {e}\n".encode("utf-8")
    if not data:
        return b""
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return ("\n".join(lines[-max_lines:])).encode("utf-8")


# ----------------------------- self update -----------------------------

def _version_tuple(v: str):
    """Parse '0.1.5' / 'v0.1.5' into a comparable int tuple. Non-numeric parts
    are dropped so a stray suffix can never crash the compare."""
    nums = re.findall(r"\d+", v or "")
    return tuple(int(n) for n in nums) if nums else (0,)


def check_for_update():
    """Return (latest_version, installer_url) if a NEWER release exists on
    GitHub, else None. Public repo → no auth needed. Never raises: any network
    or parse failure returns None so a flaky connection can't stop a tester
    from launching the game."""
    try:
        req = urllib.request.Request(
            GITHUB_LATEST_RELEASE_API,
            headers={"User-Agent": f"{APP_NAME}/{APP_VERSION}",
                     "Accept": "application/vnd.github+json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    latest = (data.get("tag_name") or "").strip().lstrip("vV")
    if not latest or _version_tuple(latest) <= _version_tuple(APP_VERSION):
        return None
    # Prefer the Inno installer asset (…Setup.exe); fall back to any .exe.
    assets = data.get("assets") or []
    url = next((a.get("browser_download_url") for a in assets
                if (a.get("name") or "").lower().endswith("setup.exe")), None)
    if not url:
        url = next((a.get("browser_download_url") for a in assets
                    if (a.get("name") or "").lower().endswith(".exe")), None)
    return (latest, url) if url else None


def _progress_bar(done: int, total: int, width: int = 38):
    """Render an in-place download progress bar on the current console line."""
    if total > 0:
        frac = max(0.0, min(1.0, done / total))
        filled = int(width * frac)
        bar = "#" * filled + "-" * (width - filled)
        print(f"\r  [{bar}] {frac * 100:5.1f}%  ({done // 1024}/{total // 1024} KB)",
              end="", flush=True)
    else:  # server didn't send Content-Length — show bytes only
        print(f"\r  Downloaded {done // 1024} KB...", end="", flush=True)


def download_update(latest: str, url: str) -> Path | None:
    """Download the installer to a temp file, showing a progress bar. Returns the
    path, or None on failure (never raises — a failed download just defers the
    update to the next session)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"{APP_NAME}/{APP_VERSION}"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            total = int(resp.headers.get("Content-Length", "0") or 0)
            # pid-suffixed so a stale copy locked by a previous failed install
            # can never block this download ([Errno 13] dead-ended v0.1.15
            # users: the fixed-name file stayed locked and every subsequent
            # session's download failed forever).
            tmp = Path(tempfile.gettempdir()) / f"RIS-CrashReporter-Setup-{latest}-{os.getpid()}.exe"
            done = 0
            with open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    _progress_bar(done, total)
        print()  # finish the progress-bar line
        return tmp
    except Exception as e:
        print()
        banner(f"[warn] Update download failed ({e}) — you'll get v{latest} next launch.")
        return None


def install_update_on_exit(installer: Path) -> bool:
    """Spawn a detached helper that waits for THIS process to exit (so the .exe
    lock is released), then runs the installer silently. The new version is
    active the next time the tester launches the reporter — no relaunch, no lost
    run. The helper must be spawned BEFORE we die; it does the waiting + install
    afterwards, so this works even when the OS is force-closing us (window X).

    Earlier builds ran the installer directly while we were still alive + slept,
    so Inno hit our in-use .exe and hung forever; the wait-then-install helper
    fixes that. Returns True if the helper was launched."""
    if not getattr(sys, "frozen", False):
        return False  # nothing to install from source
    try:
        bat = Path(tempfile.gettempdir()) / "ris_crashreporter_update.bat"
        bat.write_text(
            "@echo off\r\n"
            "ping 127.0.0.1 -n 3 >nul\r\n"  # ~2s: let the parent fully exit + unlock
            f'start "" /wait "{installer}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART '
            "/NORESTARTAPPLICATIONS /CLOSEAPPLICATIONS\r\n"
            f'del "{installer}" >nul 2>&1\r\n'
            'del "%~f0" >nul 2>&1\r\n',
            encoding="ascii",
        )
        # CREATE_NO_WINDOW: run the helper hidden (DETACHED_PROCESS made cmd pop
        # a visible console). It still gets its own console, so it survives our
        # exit and the parent console's close signal.
        subprocess.Popen(
            ["cmd", "/c", str(bat)],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            close_fds=True,
        )
    except Exception:
        return False
    return True


def apply_update_now(installer: Path) -> bool:
    """Install a downloaded update NOW, at startup: spawn a helper that waits
    ~2s for THIS process to exit, runs the installer silently, then RELAUNCHES
    the updated reporter with --no-update. The caller must exit immediately
    after this returns True.

    Why startup and not exit: the install-on-exit flow (v0.1.5–0.1.29) lost a
    race whenever the tester closed and quickly reopened the reporter — the new
    instance re-locked the .exe before Inno copied it, the silent install
    failed, and the helper then deleted the downloaded installer, so the tester
    stayed on the old version through endless "Update ready" cycles (the
    v0.1.15 loop, 2026-07-08). At startup nothing else holds the .exe and the
    game isn't running yet, so this is the one reliable install point — and the
    auto-relaunch means the tester's flow is a single ~10 s pause, not a lost
    run. Returns False when running from source or the helper couldn't spawn
    (caller falls back to staging the install for exit)."""
    if not getattr(sys, "frozen", False):
        return False
    exe = Path(sys.executable)
    try:
        bat = Path(tempfile.gettempdir()) / f"ris_crashreporter_update_{os.getpid()}.bat"
        # The helper must PROVE the exe is unlocked before running the installer
        # — a fixed 2 s wait raced the reporter's own "read this" sleep + the
        # PyInstaller onefile PARENT bootloader (which outlives the Python child
        # and holds the exe lock). Inno's /CLOSEAPPLICATIONS Restart Manager
        # then poked the mid-teardown bootloader and WEDGED it: the exe stayed
        # locked forever, the install failed, and even the relaunch got access-
        # denied (observed 2026-07-08, v0.1.30→31). A zero-byte append fails
        # with a sharing violation while ANY process still has the image loaded,
        # so it's a perfect lock probe: retry ~1 s × 60, then fall through and
        # let /FORCECLOSEAPPLICATIONS deal with whatever is stuck.
        bat.write_text(
            "@echo off\r\n"
            "set TRIES=0\r\n"
            ":waitunlock\r\n"
            "ping 127.0.0.1 -n 2 >nul\r\n"
            "set /a TRIES+=1\r\n"
            "if %TRIES% geq 60 goto install\r\n"
            f'(type nul >> "{exe}") 2>nul\r\n'
            "if errorlevel 1 goto waitunlock\r\n"
            ":install\r\n"
            f'start "" /wait "{installer}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART '
            "/NORESTARTAPPLICATIONS /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS\r\n"
            f'del "{installer}" >nul 2>&1\r\n'
            # Relaunch the (now updated) reporter so the tester doesn't have to.
            # --no-update: even if the install failed, never loop back into
            # another download-install cycle within the same relaunch.
            "ping 127.0.0.1 -n 2 >nul\r\n"
            f'start "" "{exe}" --no-update\r\n'
            'del "%~f0" >nul 2>&1\r\n',
            encoding="ascii",
        )
        subprocess.Popen(
            ["cmd", "/c", str(bat)],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            close_fds=True,
        )
    except Exception:
        return False
    return True


# A staged installer (downloaded at startup) and the machinery to apply it on
# ANY exit — clean return, Ctrl+C, OR the user clicking the console's X button.
# Since v0.1.30 this is only the FALLBACK path (apply_update_now failed).
_pending_installer: Path | None = None
_update_launched = False
_update_lock = threading.Lock()
_ctrl_handler_ref = None  # keep the ctypes callback alive for the process lifetime


def launch_pending_update():
    """Fire the staged update exactly once. Safe to call from atexit, the Ctrl
    handler, or the normal close path — whichever happens first wins."""
    global _update_launched
    with _update_lock:
        if _update_launched or _pending_installer is None:
            return
        _update_launched = True
    install_update_on_exit(_pending_installer)


def arm_pending_update(installer: Path):
    """Stage a downloaded installer so it installs on exit. The console-close
    handler (installed at startup) and atexit both fire launch_pending_update,
    so it applies however the tester closes the reporter."""
    global _pending_installer
    _pending_installer = installer
    atexit.register(launch_pending_update)  # clean exit / sys.exit / Ctrl+C


def _console_ctrl_handler(ctrl_type):
    """Logs WHY the window closed (helps diagnose 'it randomly closed') and fires
    any staged update. Returning False lets default handling terminate us."""
    names = {0: "CTRL_C", 1: "CTRL_BREAK", 2: "CTRL_CLOSE (window X)",
             5: "CTRL_LOGOFF", 6: "CTRL_SHUTDOWN"}
    log_line(f"[close] console event {names.get(ctrl_type, ctrl_type)} - reporter is closing")
    launch_pending_update()
    return False


def install_ctrl_handler():
    """Always-on console control handler: records window-close/Ctrl events to the
    log (so an unexplained close leaves a trace) and applies a staged update."""
    global _ctrl_handler_ref
    if sys.platform != "win32" or _ctrl_handler_ref is not None:
        return
    try:
        import ctypes
        from ctypes import wintypes
        cb = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)(_console_ctrl_handler)
        ctypes.windll.kernel32.SetConsoleCtrlHandler(cb, True)
        _ctrl_handler_ref = cb  # prevent GC of the callback
    except Exception:
        pass


# ----------------------------- console color -----------------------------

_ANSI_ENABLED = False


def enable_ansi():
    """Turn on ANSI escape processing for the console so bold/red text renders
    instead of showing raw codes. No-op on a redirected/legacy console — color
    helpers then fall back to plain text."""
    global _ANSI_ENABLED
    if sys.platform != "win32":
        _ANSI_ENABLED = sys.stdout.isatty()
        return
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return  # not a real console (e.g. output piped to a file)
        ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
        if kernel32.SetConsoleMode(handle, mode.value | ENABLE_VIRTUAL_TERMINAL_PROCESSING):
            _ANSI_ENABLED = True
    except Exception:
        _ANSI_ENABLED = False


def _style(text: str, *codes: str) -> str:
    """Wrap text in ANSI codes when color is on; return it unchanged otherwise,
    so a console without ANSI never shows escape gibberish. Segments are wrapped
    independently (each self-resets), so they concatenate cleanly."""
    if not _ANSI_ENABLED:
        return text
    return "".join(f"\033[{c}m" for c in codes) + text + "\033[0m"


def bold(text: str) -> str:
    return _style(text, "1")


def red(text: str) -> str:
    return _style(text, "1", "91")  # bold + bright red, so it really stands out


# ----------------------------- main loop -----------------------------

def pause_for_user(prompt: str = "Press Enter to close...") -> None:
    """Wait for the tester, unless there is nobody there to wait for.

    In --non-interactive mode (Provincia runs the reporter as a child process
    with stdin closed) this returns immediately. A bare input() there raises
    EOFError and prints a traceback at the end of an otherwise fine run.
    """
    if NON_INTERACTIVE:
        return
    try:
        input(prompt)
    except (EOFError, KeyboardInterrupt):
        pass


def banner(line=""):
    # Never let an un-encodable character (e.g. the ⚠️/emoji in summaries) crash
    # the reporter on a legacy/redirected console — fall back to ASCII.
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)
    log_line(line)  # mirror everything to the persistent log


def main():
    enable_ansi()  # so bold/red prompts render in color
    install_ctrl_handler()  # log window-close events + fire any staged update
    banner(f"=== {APP_NAME} v{APP_VERSION} ===")
    banner("Launch RTW Remastered after this window is open. It will auto-close after the game exits and send a report.")
    banner(f"(If this window ever closes unexpectedly, send this file: {script_dir() / LOG_FILENAME})")
    banner("")

    cfg = load_config()

    # --tester-name "Some Name": let a host application supply the name without
    # editing the ini by hand. Persisted so it survives into later runs.
    if "--tester-name" in sys.argv:
        try:
            supplied = sys.argv[sys.argv.index("--tester-name") + 1].strip()
        except IndexError:
            supplied = ""
        if supplied:
            save_config_values({"tester_name": supplied, "name_confirmed": "true"})
            cfg = load_config()
            banner("Tester name set to: %s" % supplied)

    # Check + DOWNLOAD + INSTALL any update now, before the game launches: the
    # reporter exits, a helper installs silently and relaunches the updated exe
    # (--no-update) — a ~10 s pause instead of a lost run. Installing on exit
    # (the old flow) raced a quick close-and-reopen and could never win; see
    # apply_update_now. --no-update also lets a tester pin a build for debugging.
    auto_update = cfg.get("auto_update", "true").strip().lower() in ("1", "true", "yes", "on")
    if auto_update and "--no-update" not in sys.argv:
        banner("Checking for updates...")
        upd = check_for_update()
        if upd:
            latest, url = upd
            banner(f"Update v{latest} found (you have v{APP_VERSION}). Downloading it now...")
            inst = download_update(latest, url)
            if inst:
                if apply_update_now(inst):
                    banner(f"Installing v{latest} — this window will close and the reporter")
                    banner("will REOPEN ITSELF updated in ~10 seconds. If it doesn't, just")
                    banner("start it again from the desktop shortcut.")
                    time.sleep(3)  # let the tester read that before the window goes
                    return 0       # exiting releases the .exe; the helper takes over
                # Running from source / helper failed — fall back to the old
                # stage-on-exit path rather than dropping the update entirely.
                arm_pending_update(inst)
                banner(f"Update v{latest} is ready — it'll apply when you close this window.")
        else:
            banner(f"Up to date (v{APP_VERSION}).")
        banner("")

    webhook = cfg.get("webhook_url", "").strip()
    if not webhook:
        banner("[warn] Webhook URL is blank in config — reports won't upload.")
        banner(f"       Edit {CONFIG_FILENAME} next to this exe to set it, or delete the line to use the baked-in default.")
        banner("")

    log_dir = resolve_log_dir(cfg)
    if not log_dir:
        banner("[error] Could not auto-detect RTW Remastered log folder.")
        banner("        Set log_dir = ... in crash_reporter.ini")
        pause_for_user()
        return 1
    banner(f"Watching logs in: {log_dir}")

    # RR's engine-error log is "error_log.txt"; classic RTW used "system.log".
    # Prefer the RR name, fall back to classic so the tool still works if a
    # tester is on the original RTW for some reason.
    error_log = log_dir / "error_log.txt"
    if not error_log.exists():
        for alt in (log_dir / "system.log.txt", log_dir / "system.log"):
            if alt.exists():
                error_log = alt
                break
    message_log = log_dir / "message_log.txt"
    # RIS script faults land in scripting_log.txt — historically unread.
    scripting_log = log_dir / "scripting_log.txt"

    sys_tail = LogTail(error_log)
    msg_tail = LogTail(message_log)
    # Capture battle-setup context live, so a battle/map-load CTD report can name
    # the settlement/factions even though the setup scrolls past any tail.
    msg_tail.capture_res = BATTLE_SETUP_PATTERNS
    # Watch the scripting log for the RIS team's own script faults; capture the
    # high-signal error lines so the report shows the script + line number.
    script_tail = LogTail(scripting_log)
    script_tail.capture_res = SCRIPT_ERROR_PATTERNS

    tester = resolve_tester_name(cfg)
    # Config value wins (explicit override); otherwise auto-detect from
    # mod_loading.txt after the game runs (resolved just before the report).
    mod_name_cfg = cfg.get("mod_name", "").strip()
    always_report = cfg.get("always_report", "true").strip().lower() in ("1", "true", "yes", "on")

    allowed_proc_names = set(DEFAULT_RTW_PROCESS_NAMES)
    extras = cfg.get("rtw_process_names", "").strip()
    if extras:
        for n in extras.split(","):
            n = n.strip().lower()
            if n: allowed_proc_names.add(n)

    # Wait for the game to start. Cap at 10 minutes so a forgotten-open
    # reporter doesn't sit idle forever.
    banner("Waiting for RTW Remastered to start...")
    waited = 0
    proc_name = None
    while waited < 600:
        proc_name, _ = find_rtw_process(allowed_proc_names)
        if proc_name:
            break
        # Drain logs while waiting too — catches errors from the loading
        # screen / shader compile pass which run before the main game window.
        sys_tail.poll(); msg_tail.poll(); script_tail.poll()
        time.sleep(POLL_INTERVAL_SEC)
        waited += POLL_INTERVAL_SEC
    if not proc_name:
        banner("[info] No RTW process seen in 10 minutes. Exiting.")
        return 0

    started_at = datetime.now()
    banner(f"Detected RTW process: {proc_name}")
    banner(f"Session start: {started_at.isoformat(timespec='seconds')}")
    banner("Monitoring... (close the game normally — report is sent on exit)")
    banner("")

    last_status_print = 0
    # Require several CONSECUTIVE confirmed-absent polls before declaring the
    # game gone — one transient tasklist failure used to close the reporter
    # mid-game. ~3 polls × 2s ≈ 6s of the process truly being absent.
    EXIT_CONFIRMATIONS = 3
    absent_streak = 0
    # Peak-memory tracking (bytes). Sampled on a slow cadence (PowerShell spawn
    # is ~200ms; the watch poll is every 2s, so gate to ~60s). PeakWorkingSet64
    # is OS-tracked + monotonic, so we keep the max seen; mem_first_ws gives the
    # start→peak growth trend that distinguishes a leak from a flat footprint.
    sample_mem = cfg.get("sample_memory", "true").strip().lower() not in ("false", "0", "no", "off")
    mem_peak_ws = mem_peak_priv = mem_first_ws = 0
    mem_samples = 0
    last_mem_sample = 0.0
    # v0.1.29: watch-dir self-correction + live no-logging warning. 83 of 501
    # telemetry reports (17%) were ⚪NOLOG — sessions we couldn't assess at all.
    # One fixable cause: we auto-detect the log dir by the PREVIOUS session's
    # mtime, so a tester who switches campaign (Rome ↔ BI ↔ Alexander) has us
    # watching the wrong dir all session. If OUR message_log never writes after
    # the game starts but another candidate dir's does, switch to it live.
    # The other cause (RR logging genuinely off) gets a visible console warning
    # DURING the session, when the tester can still do something about it.
    log_dir_pinned = bool(cfg.get("log_dir", "").strip())  # explicit config: never second-guess
    msg_flowing = False
    last_dir_check = time.time()
    last_msg_growth = time.time()
    stale_warned = False
    while True:
        new_sys = sys_tail.poll()
        new_msg = msg_tail.poll()
        script_tail.poll()
        if new_msg:
            msg_flowing = True
            last_msg_growth = time.time()
        for ln in new_sys:
            if any(p.search(ln) for p in FATAL_PATTERNS):
                banner(f"[FATAL] {ln.strip()[:200]}")
            elif any(p.search(ln) for p in ERROR_PATTERNS):
                banner(f"[err]   {ln.strip()[:200]}")
        for ln in new_msg:
            if any(p.search(ln) for p in FATAL_PATTERNS):
                banner(f"[FATAL/msg] {ln.strip()[:200]}")
        now = time.time()
        # Wrong-dir self-correction: our message_log is silent but another
        # campaign dir's was freshly written after game start → that's the one
        # actually being played; switch the tails to it. auto_detect returns
        # candidates most-recently-written first, so the first fresh hit wins.
        if not msg_flowing and not log_dir_pinned and now - last_dir_check > 30:
            last_dir_check = now
            for cand in auto_detect_log_dirs():
                try:
                    fresh = (cand / "message_log.txt").stat().st_mtime >= started_at.timestamp()
                except OSError:
                    fresh = False
                if not fresh:
                    continue
                if cand != log_dir:
                    banner(f"[watch] {message_log} is silent but {cand} is being written — "
                           "switching to it (game is logging to a different campaign dir).")
                    log_dir = cand
                    message_log = cand / "message_log.txt"
                    scripting_log = cand / "scripting_log.txt"
                    error_log = cand / "error_log.txt"
                    if not error_log.exists():
                        for alt in (cand / "system.log.txt", cand / "system.log"):
                            if alt.exists():
                                error_log = alt
                                break
                    sys_tail = LogTail(error_log)
                    msg_tail = LogTail(message_log)
                    msg_tail.capture_res = BATTLE_SETUP_PATTERNS
                    script_tail = LogTail(scripting_log)
                    script_tail.capture_res = SCRIPT_ERROR_PATTERNS
                    msg_flowing = True
                    last_msg_growth = now
                break  # first fresh candidate decides (ours or the switch target)
        # Live no-logging warning — surfaced while the tester can still see it,
        # not just buried in a post-session ⚪NOLOG report.
        if (not stale_warned and now - last_msg_growth > 180
                and now - started_at.timestamp() > 300):
            stale_warned = True
            banner("[warn] message_log.txt has not been written for 3+ minutes.")
            banner("       If the game is running normally, RTW-R logging is probably OFF")
            banner("       (an update/reinstall can reset it) — this session can't be")
            banner("       assessed for crashes until logging is back on.")
        if sample_mem and now - last_mem_sample > 60:
            last_mem_sample = now
            mem = sample_game_memory(allowed_proc_names)
            if mem:
                ws, peak, priv = mem
                if not mem_first_ws:
                    mem_first_ws = ws
                mem_peak_ws = max(mem_peak_ws, peak or ws)
                mem_peak_priv = max(mem_peak_priv, priv)
                mem_samples += 1
        if now - last_status_print > 60:
            banner(f"  ... still running. errors so far: system={sys_tail.error_count} (fatal {sys_tail.fatal_count}), message={msg_tail.error_count} (fatal {msg_tail.fatal_count})")
            last_status_print = now
        # Check the game is still running. Only a SUCCESSFUL check that finds no
        # RTW process counts toward exit; a failed check (tasklist timeout/error)
        # is inconclusive and must not close the reporter mid-game.
        name, check_ok = find_rtw_process(allowed_proc_names)
        if name:
            absent_streak = 0
        elif not check_ok:
            log_line("[watch] process check failed (transient) — not treating as game exit")
            # leave absent_streak unchanged; retry next poll
        else:
            absent_streak += 1
            if absent_streak >= EXIT_CONFIRMATIONS:
                log_line(f"[watch] RTW absent for {absent_streak} consecutive checks — game exited")
                # Drain one more poll cycle (RR sometimes flushes the last log
                # lines a tick after the process exits) then break.
                time.sleep(POLL_INTERVAL_SEC)
                sys_tail.poll(); msg_tail.poll(); script_tail.poll()
                break
        time.sleep(POLL_INTERVAL_SEC)

    ended_at = datetime.now()
    duration_min = (ended_at - started_at).total_seconds() / 60.0
    crash_signals = []

    # Stale-log guard — if message_log wasn't written for the tail end of a
    # multi-minute session, the game isn't logging gameplay (logging off): the
    # tail is meaningless and must NOT be read as a crash. A real crash leaves a
    # recent mtime (it logs up to the crash).
    try:
        _msg_mtime = message_log.stat().st_mtime
    except OSError:
        _msg_mtime = 0.0
    log_stale = bool(_msg_mtime) and duration_min >= STALE_LOG_MIN_MINUTES \
        and (ended_at.timestamp() - _msg_mtime) > STALE_LOG_SECONDS
    stale_min = (ended_at.timestamp() - _msg_mtime) / 60.0 if log_stale else 0.0
    # The stale-log message itself is appended AFTER crash-dump detection (v0.1.46):
    # its old wording ("could NOT be assessed for crashes") printed even when a
    # same-session Feral dump proved a crash — two contradictory verdicts in one
    # report (Jonnet's 458-min marathon). log_stale still gates every message_log-
    # derived inference below either way; only the human-facing text is deferred.

    # ---- Signal classification ----
    # HARD signals = the session terminated abnormally (a real CTD this run).
    # SOFT signals = instability that fired DURING play but does NOT prove a
    # crash — RTW asserts are mostly non-fatal warnings, and a session can throw
    # thousands and still quit cleanly (Jonnet's Turn-154 run: 4376 asserts, then
    # a textbook clean shutdown). So soft signals must NOT override a confirmed
    # clean exit — they only escalate when the shutdown was NOT clean, and
    # otherwise downgrade a clean exit to "unstable" rather than "crash".
    hard_crash = False

    # Engine asserts ("<expr> Failed") — invisible to FATAL/ERROR patterns.
    # Reported by distinct expression. SOFT: counted, surfaced, but not proof of
    # a crash on their own.
    assert_total = sys_tail.assert_count + msg_tail.assert_count
    if assert_total > 0:
        combined = Counter()
        combined.update(sys_tail.asserts); combined.update(msg_tail.asserts)
        # Ordered by measured crash-association, then volume - see ASSERT_RISK. The
        # loudest asserts in this mod are the ones sessions most often SURVIVE, so a
        # plain most_common() ranking buries the informative ones.
        top = ", ".join(rank_asserts(combined, 5))
        crash_signals.append(f"engine asserts: {assert_total} total, {len(combined)} distinct — {top}")
        # Resolution failures, with the token and the file:line the engine named. This is
        # the one signal a modder can act on without any further investigation.
        _res = Counter()
        _src = {}
        _full = {}
        for _t in (sys_tail, msg_tail):
            _res.update(getattr(_t, "resolution_failures", {}) or {})
            _src.update(getattr(_t, "resolution_source", {}) or {})
            _full.update(getattr(_t, "resolution_fullsrc", {}) or {})
        if _res:
            # v0.1.46: the engine describes the file it loaded AT LAUNCH; Steam may
            # have updated it since (mid-session or pending a restart). Verify each
            # token against the real on-disk file before calling it a data defect —
            # two v7.13 sessions reported the already-removed pilum token from stale
            # copies and the old wording sent the team chasing a shipped fix.
            _items = []
            _verdicts = []
            for _k, _n in _res.most_common(5):
                _where = _src.get(_k) or ""
                _note = ""
                _v = None
                _tm = re.search(r"'([^']+)'$", _k)
                if _tm and _k in _full:
                    _v, _detail = check_token_on_disk(_tm.group(1), _full[_k][0], _full[_k][1])
                    if _v == "confirmed":
                        _note = " [verified in the on-disk file]"
                    elif _v == "elsewhere":
                        _note = " [on disk the token moved to %s — file changed since launch]" % _detail
                    elif _v == "stale":
                        _note = " [NOT in the on-disk file anymore — the game loaded an older copy]"
                _verdicts.append(_v)
                _items.append("%s x%d%s%s" % (_k, _n, (" at %s" % _where) if _where else "", _note))
            if _verdicts and all(_v == "stale" for _v in _verdicts):
                crash_signals.append(
                    "⚠ the engine could not resolve %d name(s), but NONE of them exist in the "
                    "current on-disk file(s) — the game loaded a STALE copy (Steam updated the "
                    "mod during/after launch). Not a live data defect; the tester should "
                    "restart the game to pick up the updated files: %s"
                    % (len(_res), "; ".join(_items))
                )
            else:
                crash_signals.append(
                    "⚠ the engine could not resolve %d name(s) — this is a DATA defect with a "
                    "named location, fixable without reproducing the crash: %s"
                    % (len(_res), "; ".join(_items))
                )
        _high = [e for e in combined if assert_risk(e)[0] > 0]
        if _high:
            # A raw "136 crashes, 200 survivors" is not interpretable: 40% sounds alarming or
            # reassuring depending on what the reader assumes the normal rate is. Quoted
            # against the measured baseline instead, so the number means something.
            #
            # Measured 2026-07-27 over the 486 telemetry sessions carrying a Session line
            # (counting messages instead double-counts: the reporter splits large posts and the
            # continuation parts repeat the status without a session, which inflated the
            # baseline to 43% and hid the effect):
            #   baseline crash rate .................. 31% (152/486)
            #   sessions with this assert family ..... 68% (23/34)  = 2.4x the baseline
            #   the high-volume asserts, by contrast, are PROTECTIVE, not neutral:
            #     man_in_front_index ................. 25% (0.76x)
            #     smp_2 != STRATEGY_MAP_POSITION ..... 25% (0.73x)
            #   peak working set >=12 GB ............. 34% (1.17x) — no signal; 205 of 486
            #     sessions exceed 12 GB, so a large working set is normal for this engine and
            #     is not evidence of anything on its own.
            crash_signals.append(
                "⚠ %d assert type(s) here are associated with CRASHED sessions: sessions "
                "carrying them crash 68%% of the time against a 31%% baseline (2.4x), measured "
                "over 486 telemetry sessions: %s. The high-volume asserts above them are not "
                "merely survivable, they are PROTECTIVE (25%% crash rate, 0.76x) - do not "
                "triage by count alone."
                % (len(_high), ", ".join(sorted(_high)[:4]))
            )
        # Auto-tag the dominant long-session CTD class so it's triaged on sight:
        # RTW-R's string ref-count is 16 bits and wraps after hours of play
        # (uni_char_string length/sharing_count asserts). Engine limit, not a
        # RIS data defect — verified 2026-05-31 against the v7.2 crash wave.
        if duration_min >= 90 and any(
                "uni_char_string" in e or "sharing_count" in e for e in combined):
            crash_signals.append(
                "⚠ matches the KNOWN engine string-refcount overflow (16-bit sharing_count "
                "wraps on multi-hour sessions — engine limit, not a mod defect). "
                "Mitigation: save & restart the game every ~2 hours.")
        # v0.1.47: auto-tag the season/date-ordering assert as the known 4TPY
        # artifact. RIS gets 4 turns/year by forcing `console_command season
        # summer` on 2 of every 4 turns (ris_campaign_script.txt, section
        # "99. 4-TURNS-PER-YEAR"); the engine's date model only knows
        # summer-then-winter within a year, so dates stamped around a forced
        # flip sort out of order and every later date comparison (ages, trait
        # gains, event timers) trips this assert. Root-caused 2026-08-03 on
        # the shipped script; telemetry shows it on v7.9 through v7.13 at
        # 20-218 hits/session with empty context and no crash-family
        # membership. Structural to 4TPY — not a defect.
        if any(is_4tpy_season_assert(e) for e in combined):
            crash_signals.append(
                "⚠ the season/date-ordering assert here is a KNOWN 4TPY artifact — the "
                "campaign script forces the season back to summer to get 4 turns per year, "
                "so same-year dates sort out of order and date comparisons assert. "
                "Structural to the 4TPY design, harmless, not a mod defect — ignore in triage.")

    # v0.1.20: pin the string-overflow source — which UI rendered when it blew up,
    # and any "Uknown settlement level" context.
    overflow_ctx = Counter()
    overflow_ctx.update(sys_tail.overflow_suffixes); overflow_ctx.update(msg_tail.overflow_suffixes)
    if overflow_ctx:
        ui = ", ".join(f"{s} ×{n}" for s, n in overflow_ctx.most_common(6))
        crash_signals.append(f"string-overflow UI context (text after the assert): {ui}")
    level_ctx = sys_tail.level_ctx + msg_tail.level_ctx
    if level_ctx:
        crash_signals.append(f"'Uknown settlement level' context: {level_ctx[0][:240]}")

    # Asset/model load failures — names the missing model behind a battle-load CTD.
    asset_fails = Counter(); asset_fails.update(sys_tail.asset_fails); asset_fails.update(msg_tail.asset_fails)
    asset_fail_ctx = {**sys_tail.asset_fail_ctx, **msg_tail.asset_fail_ctx}
    asset_fail_total = sum(asset_fails.values())
    if asset_fails:
        top = "; ".join(f"{k} ×{n}" for k, n in asset_fails.most_common(5))
        crash_signals.append(f"asset/model load failures: {asset_fail_total} total, {len(asset_fails)} distinct — {top}")

    # RIS script faults (scripting_log.txt) — the team's own code; the most
    # actionable class. SOFT signal; surfaced with distinct lines + counts.
    script_faults = Counter()
    for ln in script_tail.captured:
        script_faults[re.sub(r"\b\d+\b", "#", ln.strip())[:120]] += 1
    script_fault_total = sum(script_faults.values())
    if script_fault_total > 0:
        top = "; ".join(f"{s} ×{n}" for s, n in script_faults.most_common(4))
        crash_signals.append(f"script faults (scripting_log): {script_fault_total} total, {len(script_faults)} distinct — {top}")

    # Fatal text + a flood of ERROR lines. Fatal text is HARD; a high error count
    # is SOFT (same not-necessarily-a-crash reasoning as asserts).
    if sys_tail.fatal_count > 0 or msg_tail.fatal_count > 0:
        hard_crash = True
    error_total = sys_tail.error_count + msg_tail.error_count + script_fault_total

    # Truncated-log heuristic — the process was killed mid-write (message_log
    # ends WITHOUT a trailing newline; clean quits always flush a complete line).
    # HARD signal.
    for log_path in (message_log, error_log):
        if not log_path.exists(): continue
        try:
            with open(log_path, "rb") as f:
                f.seek(-2, 2) if log_path.stat().st_size >= 2 else f.seek(0)
                last_bytes = f.read()
            if last_bytes and not last_bytes.endswith(b"\n"):
                crash_signals.append(f"{log_path.name} ends mid-line (no trailing newline — OS-killed-process signature)")
                hard_crash = True
        except OSError:
            pass

    # Old-save ↔ new-map mismatch — only counts when the session ENDED on it
    # (marker in the tail window). A tester who hit it, then loaded a good save
    # and played on, scrolls it out of the tail and is assessed normally.
    save_incompat = False
    if not log_stale:
        save_incompat = any(SAVE_INCOMPAT_MARKER in ln
                            for ln in last_nonblank_lines(message_log, 120))
    if save_incompat:
        crash_signals.append(
            f'engine refused the save: "{SAVE_INCOMPAT_MARKER}" — the .sav was made on a '
            "different (usually older) version of the mod's campaign map. Any abnormal-exit "
            "signals below are downstream of the failed load, NOT a gameplay CTD. "
            "Tester fix: start a new campaign, or load a save made on the current mod version.")

    # Clean-shutdown classification — the most reliable signal for a SILENT CTD.
    # "crash" (ends mid turn-processing / on a load step) is HARD; "clean" means
    # engine teardown markers are present (a genuine quit-to-desktop, which soft
    # signals must not override); "unclean" is ambiguous (mid-battle quit or CTD).
    flag_unclean = cfg.get("flag_unclean_shutdown", "true").strip().lower() in ("1", "true", "yes", "on")
    # Skip all message_log-derived inference when the log is stale — its tail is
    # meaningless and would otherwise produce a false "asset-load CTD".
    shutdown_verdict, shutdown_signal = "clean", None
    if not log_stale:
        shutdown_verdict, shutdown_signal = classify_shutdown(message_log, duration_min)
        if shutdown_verdict == "crash":
            hard_crash = True
        if shutdown_signal and (shutdown_verdict == "crash" or flag_unclean):
            crash_signals.append(shutdown_signal)

    # Name the offending battle for a battle/map-load CTD (or an ambiguous
    # battle-quit). Captured live, so it survives a load block longer than any
    # tail. Only surfaced when the session ended in/around a battle.
    if not log_stale and shutdown_verdict in ("crash", "unclean"):
        battle_ctx = summarize_battle(msg_tail.captured)
        if battle_ctx:
            crash_signals.append(f"last battle before exit: {battle_ctx}")

    # Feral crash dump — the DEFINITIVE crash signal. HARD — but only when the
    # dump's own crash time falls in THIS session. Telemetry showed the XML twin
    # consistently arriving one report late (it is written after the .dmp,
    # sometimes on the next launch) and Feral's folder-shuffling refreshing the
    # mtime of a day-old dump, either of which used to flip a later session to
    # SUSPECTED CRASH and pin the minidump analysis on the wrong session.
    crash_dumps = find_crash_dumps(log_dir, started_at.timestamp() - 300)
    stale_dumps = {cd for cd in crash_dumps
                   if (dump_crash_time(cd, crash_dumps) or started_at.timestamp())
                   < started_at.timestamp() - 300}
    banner(f"Crash-dump scan: {len(crash_dumps)} found in the session window"
           + (f" ({len(stale_dumps)} from an earlier session)." if stale_dumps else "."))
    seen_md_summaries = set()
    for cd in crash_dumps:
        prev = cd in stale_dumps
        if not prev:
            hard_crash = True
        info = read_crash_dump_info(cd)
        tag = ""
        if prev:
            ct = dump_crash_time(cd, crash_dumps)
            tag = (" — written %s, BEFORE this session started: it belongs to the previous "
                   "session's crash (usually the late XML twin of a .dmp already reported)"
                   % datetime.fromtimestamp(ct).strftime("%Y-%m-%d %H:%M"))
        crash_signals.append(
            f"Feral crash dump{' (previous session)' if prev else ''}: {cd.name}"
            + (f" ({info})" if info else "") + tag)
        # Parse the Windows minidump for the exception + faulting module —
        # ground-truth (game-code vs driver vs overlay), no symbols needed. The
        # .dmp IS a raw minidump, parsed directly (before v0.1.42 only the XML's
        # embedded copy was parsed, so the fault address always arrived one
        # report late); the XML wraps the same bytes in base64/zlib.
        try:
            md = None
            if cd.suffix.lower() == ".dmp":
                raw = cd.read_bytes()
                md = raw if raw[:4] == b"MDMP" else None
            if md is None:
                md = extract_dump_minidump(cd)
            summary = parse_minidump_summary(md) if md else None
        except Exception:
            summary = None
        if summary and (prev, summary) not in seen_md_summaries:
            seen_md_summaries.add((prev, summary))
            crash_signals.append(f"⮑ minidump{' (previous session)' if prev else ''}: {summary}")
            # Recognise a fault address seen repeatedly across testers, so the report
            # arrives already triaged instead of looking like a one-off.
            _note = known_fault_note(summary)
            if _note:
                crash_signals.append("  " + _note)

    # Deferred stale-log message (v0.1.46) — worded to agree with the dump
    # evidence. A same-session dump proves the crash; the silent log window is
    # then most plausibly the hang/crash itself, not logging turned off, and the
    # old "could NOT be assessed" claim contradicted the 🔴 verdict one line up.
    if log_stale:
        _fresh_dump = any(cd not in stale_dumps for cd in crash_dumps)
        if _fresh_dump:
            crash_signals.insert(0, (
                f"message_log stopped updating ~{stale_min:.0f} min before the end of this "
                f"{duration_min:.0f}-min session, but a crash dump from THIS session exists — "
                f"the dump is the authority (the silent window is likely the hang/crash itself). "
                f"Log-tail inference was still skipped for safety."))
        else:
            crash_signals.insert(0, (
                f"message_log not updated for the last ~{stale_min:.0f} min of a {duration_min:.0f}-min "
                f"session — game logging appears OFF/misconfigured, so this session could NOT be assessed "
                f"for crashes (check RR in-game logging / verify message_log.txt grows while playing)"))

    # ---- Final status ----
    # Priority: a HARD signal → crash. Otherwise a confirmed clean shutdown is
    # NEVER a crash, even with thousands of asserts — it's at most "unstable".
    # With no clean marker, soft instability tips it to crash (the assert-storm
    # CTD); otherwise it's an unclean (ambiguous) shutdown or genuinely clean.
    soft_unstable = (assert_total > 0) or (error_total >= 5) or (asset_fail_total > 0)
    report_status = decide_status(hard_crash, shutdown_verdict, soft_unstable, flag_unclean,
                                  log_stale, save_incompat)
    # kept for the always_report gate below
    suspected_crash = report_status == "crash"
    status_label = {
        "crash": "**SUSPECTED CRASH**",
        "unstable": "clean exit, but **UNSTABLE** (high assert volume — bugs fired but the game exited cleanly)",
        "unclean": "**UNCLEAN SHUTDOWN** (no crash signature — possible mid-battle exit or CTD)",
        "nolog": "**LOGGING NOT UPDATING** — message_log went stale mid-session; game logging appears off, so this session was not assessed. Tester: check that message_log.txt grows while playing and re-enable RTW-R logging if not (updates/reinstalls can reset it)",
        "savemap": "**SAVE↔MAP MISMATCH** — the engine refused to load a save made on a different version of the campaign map (tester-side: needs a new campaign or a current-version save; NOT a mod crash)",
        "clean": "clean exit",
    }[report_status]

    # Resolve the mod(s) now (mod_loading.txt has been rewritten by this
    # session's launch). active_mods lists EVERY enabled mod by load order so
    # the report flags stacked/conflicting setups, not just the primary mod.
    active_mods = detect_active_mods(log_dir)
    mod_name = mod_name_cfg or (active_mods[0] if active_mods else None) or "(unspecified mod)"
    # End-turns advanced this session — separates "crashed 5 turns in" from a
    # long idle sit, and lets telemetry correlate crash classes with turn churn.
    turns_note = f", {msg_tail.turn_count} end-turns" if msg_tail.turn_count else ""
    summary = [
        f"**{APP_NAME} v{APP_VERSION}** — {tester} / {mod_name}",
        f"Session: {started_at:%Y-%m-%d %H:%M} → {ended_at:%H:%M} ({duration_min:.1f} min{turns_note})",
        f"OS: {platform.platform()}",
        f"Errors: error_log={sys_tail.error_count} (fatal {sys_tail.fatal_count}) · message_log={msg_tail.error_count} (fatal {msg_tail.fatal_count})",
        f"Asserts: {assert_total} ({len(sys_tail.asserts) + len(msg_tail.asserts)} distinct) · Script faults: {script_fault_total} ({len(script_faults)} distinct)",
        f"Status: {status_label}",
    ]
    # Peak memory (if sampled) — surfaces the leak/exhaustion trend that the
    # late-session +0x266FD3 CTDs point at. Inserted right after the OS line.
    if mem_samples:
        _gb = lambda b: f"{b / 1073741824:.2f} GB"
        parts = [f"peak working set {_gb(mem_peak_ws)}"]
        if mem_peak_priv:
            parts.append(f"peak private {_gb(mem_peak_priv)}")
        if mem_first_ws and mem_peak_ws > mem_first_ws:
            parts.append(f"trend {_gb(mem_first_ws)} → {_gb(mem_peak_ws)}")
        summary.insert(3, f"Memory: {' · '.join(parts)} ({mem_samples} samples)")
    # Mod policy: only the RIS beta and its official submods (e.g. "4 Romans
    # RIS") are sanctioned for beta sessions. Any other enabled mod is called
    # out loudly — a crash with a foreign mod loaded isn't evidence against
    # the beta, and telemetry already caught testers running e.g. "Swagger's
    # Blood Mod". A pure RIS+submod stack just gets a neutral load-order line.
    # "Imperium Surrectum" covers the DEV build, whose display name
    # ("[OPEN BETA] RTR: Imperium Surrectum 0.7.0") contains no literal "RIS" —
    # it was being 🚫-flagged on Balbor's sessions despite being the mod itself.
    allowed_subs = [s.strip() for s in
                    cfg.get("allowed_mod_substrings", "RIS,Imperium Surrectum").split(",") if s.strip()]
    unapproved = find_unapproved_mods(active_mods, allowed_subs)
    if unapproved:
        summary.append(f"🚫 UNAPPROVED MOD(S) ACTIVE: {', '.join(unapproved)} — only the RIS "
                       "beta and its official submods are allowed while beta testing; this "
                       "session's results may not reflect the mod")
    if len(active_mods) > 1:
        summary.append(f"Mods active ({len(active_mods)}, in load order): "
                       + " → ".join(active_mods))
    if crash_signals:
        summary.append("Crash signals:")
        for cs in crash_signals: summary.append(f"  • {cs}")
    summary_text = "\n".join(summary)
    banner("")
    banner("--- Session summary ---")
    banner(summary_text)
    banner("")
    if report_status == "savemap":
        # Tell the tester directly — this one is theirs to fix, and every one of
        # these they retry shows up as another false crash in telemetry.
        banner(red("Your save was made on a DIFFERENT version of the mod's campaign map,"))
        banner(red("so the game could not load it. This is NOT a crash bug."))
        banner(red("Fix: start a NEW campaign, or load a save made on the current version."))
        banner("")
    if unapproved:
        banner(red("UNAPPROVED MOD(S) DETECTED: " + ", ".join(unapproved)))
        banner(red("Only the RIS beta and its official submods may be enabled while"))
        banner(red("beta testing — please disable the mod(s) above for your next session."))
        banner("")

    if (not always_report and report_status == "clean"
            and sys_tail.error_count == 0 and msg_tail.error_count == 0
            and assert_total == 0 and script_fault_total == 0):
        banner("[info] Clean exit and always_report=false — not sending a report.")
        return 0

    if not webhook:
        banner("[info] No webhook configured — skipping upload.")
        pause_for_user()
        return 0

    mod_loading_log = log_dir / "mod_loading.txt"
    # Build a single "what fired the error count" attachment that interleaves
    # error_log + message_log matches, tagged by source. This is the most
    # useful artifact — the *_tail files only show the LAST 50 lines, which
    # usually scroll past the actual errors during long sessions.
    matched_summary_parts = []
    if sys_tail.matched_lines:
        matched_summary_parts.append(f"=== error_log.txt — {len(sys_tail.matched_lines)} matched line(s) ===\n" + "\n".join(sys_tail.matched_lines))
    if msg_tail.matched_lines:
        matched_summary_parts.append(f"\n=== message_log.txt — {len(msg_tail.matched_lines)} matched line(s) ===\n" + "\n".join(msg_tail.matched_lines))
    matched_blob = ("\n".join(matched_summary_parts) if matched_summary_parts else "").encode("utf-8", errors="replace")

    # Full asserts breakdown — EVERY distinct assert with its count and the
    # context that triggered its FIRST occurrence. The embed only lists the top
    # 5; this artifact gives the dev the complete, diagnosable picture.
    all_asserts = Counter(); all_asserts.update(sys_tail.asserts); all_asserts.update(msg_tail.asserts)
    first_ctx = {**sys_tail.assert_first_ctx, **msg_tail.assert_first_ctx}
    assert_parts = [f"{assert_total} total, {len(all_asserts)} distinct\n"]
    for expr, n in all_asserts.most_common():
        assert_parts.append(f"=== ×{n}  {expr}")
        if first_ctx.get(expr):
            assert_parts.append("    first-seen context:\n" + "\n".join("      " + l for l in first_ctx[expr].splitlines()))
    asserts_blob = "\n".join(assert_parts).encode("utf-8", errors="replace") if all_asserts else b""

    attachments = [
        (f"matched_errors_{ended_at:%Y%m%d_%H%M%S}.txt", matched_blob),
        (f"error_log_tail_{ended_at:%Y%m%d_%H%M%S}.txt", tail_bytes(error_log, LOG_TAIL_LINES)),
        (f"message_log_tail_{ended_at:%Y%m%d_%H%M%S}.txt", tail_bytes(message_log, MESSAGE_TAIL_LINES)),
        # Whole mod_loading.txt — it's ~1KB and tells us exactly which mod +
        # load order the tester ran with.
        (f"mod_loading_{ended_at:%Y%m%d_%H%M%S}.txt", tail_bytes(mod_loading_log, 10000)),
    ]
    if asserts_blob:
        attachments.append((f"asserts_{ended_at:%Y%m%d_%H%M%S}.txt", asserts_blob))
    # Asset/model load failures with the context that names the model/settlement.
    if asset_fails:
        af = ["{} total, {} distinct\n".format(asset_fail_total, len(asset_fails))]
        for k, n in asset_fails.most_common():
            af.append(f"=== ×{n}  {k}")
            if asset_fail_ctx.get(k):
                af.append("    context:\n" + "\n".join("      " + l for l in asset_fail_ctx[k].splitlines()))
        attachments.append((f"asset_failures_{ended_at:%Y%m%d_%H%M%S}.txt", "\n".join(af).encode("utf-8", errors="replace")))
    # Scripting-log artifacts — only when there were script faults (the file is
    # huge and otherwise irrelevant). The distinct fault lines + a tail.
    if script_fault_total > 0:
        sf = "\n".join(f"×{n}  {s}" for s, n in script_faults.most_common(200)).encode("utf-8", errors="replace")
        attachments.append((f"script_faults_{ended_at:%Y%m%d_%H%M%S}.txt", sf))
        attachments.append((f"scripting_log_tail_{ended_at:%Y%m%d_%H%M%S}.txt", tail_bytes(scripting_log, LOG_TAIL_LINES)))

    # -- FOR PROVINCIA'S AI MOVEMENT LAB --------------------------------------
    # The two files below are for machine analysis rather than reading, so both
    # are VERBATIM: the Lab's parsers match the engine's own wording anchored at
    # the start of a line, and the script_faults file above (which prefixes each
    # line with a repeat count, fine for a human) is unparseable to it.
    #
    # Script errors: every "Script Error in <file>, at line N, column C." and
    # "Error while executing ..." line, untouched. These are the highest-value
    # thing the game writes about the mod - each names a data file and a line
    # number - so they are sent whenever they exist, not only after a crash.
    try:
        se = extract_script_errors(scripting_log)
        if se:
            attachments.append((f"script_errors_verbatim_{ended_at:%Y%m%d_%H%M%S}.txt", se))
            summary_text += "\nScript errors: {} line(s) captured verbatim for the AI Lab".format(se.count(b"\n") + 1)
    except Exception as exc:  # an extra attachment must never lose the whole report
        log_line("[ailab] script-error extract failed: {!r}".format(exc))

    # campaign_ai_log: the AI's own decision record - every campaign's required vs
    # allocated strength, garrison splits, war authorisations, agent usage. Sent as
    # a filtered, lzma-compressed extract because the raw file reaches ~330MB.
    if cfg.get("upload_ai_log", "true").strip().lower() in ("1", "true", "yes", "on"):
        try:
            if not AI_LOG_FILTER_AVAILABLE:
                summary_text += "\nAI log: skipped (ai_log_patterns.py missing from this build)"
                log_line("[ailab] ai_log_patterns.py not importable - AI log extract skipped")
            else:
                t_ai = time.time()
                got = extract_ai_log(log_dir, MAX_REPORT_BYTES)
                if got:
                    blob, ai_summary = got
                    attachments.append((f"campaign_ai_extract_{ended_at:%Y%m%d_%H%M%S}.txt.xz", blob))
                    summary_text += "\nAI log: {} ({:.0f}s)".format(ai_summary, time.time() - t_ai)
                    log_line("[ailab] " + ai_summary)
                else:
                    summary_text += "\nAI log: not found (the game writes it only with -ai_log on its command line)"
        except Exception as exc:
            log_line("[ailab] AI log extract failed: {!r}".format(exc))
            summary_text += "\nAI log: extract failed (see crash_reporter.log)"

    # Latest save game — zipped (saves are large binaries). Attach only if the
    # zip fits the configured Discord ceiling; otherwise note it in the summary
    # rather than failing the whole upload.
    # savemap: the save is from a stale map version — attaching it helps nobody,
    # and these get retried back-to-back (3 in 5 min in telemetry), so don't
    # ship megabytes per attempt.
    if (report_status != "savemap"
            and cfg.get("upload_save", "true").strip().lower() in ("1", "true", "yes", "on")):
        latest_save = find_latest_save(log_dir)
        if latest_save is None:
            summary_text += "\nSave: none found"
        else:
            zbytes = zip_save(latest_save)
            limit = int(float(cfg.get("max_save_mb", "8")) * 1024 * 1024)
            if zbytes is None:
                summary_text += f"\nSave: {latest_save.name} (could not read)"
            elif len(zbytes) <= limit:
                attachments.append((f"{latest_save.stem}.zip", zbytes))
                summary_text += f"\nSave: {latest_save.name} ({latest_save.stat().st_size // (1024*1024)} MB, {len(zbytes) // 1024} KB zipped)"
            else:
                summary_text += f"\nSave: {latest_save.name} too large to upload ({len(zbytes) // (1024*1024)} MB zipped > {limit // (1024*1024)} MB limit)"

    # Zip any Feral crash dump (large XML, compresses well). These are sent in a
    # SEPARATE follow-up message — never co-attached with the save — so a big
    # save can't push the combined upload over Discord's limit and drop the
    # crash proof along with it.
    dump_attachments = []
    any_fresh_dump_attached = False
    for cd in crash_dumps:
        zbytes = zip_file(cd)
        if zbytes is None:
            summary_text += f"\nCrash dump: {cd.name} (could not read)"
        elif len(zbytes) <= MAX_REPORT_BYTES:
            dump_attachments.append((f"{cd.stem}.zip", zbytes))
            any_fresh_dump_attached = any_fresh_dump_attached or cd not in stale_dumps
            summary_text += f"\nCrash dump: {cd.name} ({cd.stat().st_size // 1024} KB, {len(zbytes) // 1024} KB zipped) — sent below"
        else:
            summary_text += f"\nCrash dump {cd.name} too large to attach ({len(zbytes) // (1024*1024)} MB zipped)"

    # Decode the logs Feral embeds in the newest dump (the snapshot AS OF the
    # crash) and attach their tails as readable text. campaign_ai_log.txt and
    # battle_ai_log.txt are otherwise never captured; the dump's message_log is
    # the guaranteed-complete one (no truncation). Best-effort.
    if crash_dumps:
        # Prefer a dump from THIS session — a stale XML from an earlier crash
        # carries an earlier session's log snapshot, which would be mislabelled
        # with this session's end time.
        _fresh = [p for p in crash_dumps if p not in stale_dumps]
        newest_dump = max(_fresh or crash_dumps, key=lambda p: p.stat().st_mtime)
        try:
            embedded = extract_dump_logs(
                newest_dump, ("battle_ai_log.txt", "campaign_ai_log.txt", "message_log.txt"))
        except Exception:
            embedded = {}
        for fname, text in embedded.items():
            tail = "\n".join(text.splitlines()[-LOG_TAIL_LINES:])
            if tail.strip():
                attachments.append(
                    (f"dump_{fname.replace('.txt','')}_{ended_at:%Y%m%d_%H%M%S}.txt",
                     tail.encode("utf-8", errors="replace")))
        if embedded:
            summary_text += f"\nCrash-dump logs decoded: {', '.join(embedded)}"

    rc = 0
    try:
        banner("Uploading report to Discord...")
        http_status = post_to_discord(webhook, summary_text, attachments, report_status)
        banner(f"Upload OK (HTTP {http_status}).")
    except urllib.error.HTTPError as e:
        # Show Discord's actual response — a 400 is a malformed payload (e.g.
        # the 10-file cap), NOT a bad webhook; blaming the webhook sent us
        # chasing the wrong cause on Neep's report.
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = ""
        banner(f"[error] Discord rejected the report: HTTP {e.code} {e.reason}")
        if detail:
            banner(f"        Discord says: {detail}")
        banner("        (401/404 = webhook wrong or revoked; 400 = malformed report — send crash_reporter.log)")
        rc = 2
    except Exception as e:
        banner(f"[error] Upload failed: {e}")
        rc = 2

    # Crash dump(s) as their own message so they're never dropped with the save.
    # When every dump aboard is from a PREVIOUS session (the late XML twin), the
    # title must say so — a hardcoded "🔴 CTD" over a session that exited cleanly
    # read as a crash in the channel (seen on a v0.1.43 UNSTABLE report).
    if dump_attachments:
        if any_fresh_dump_attached:
            dump_title, dump_status = f"🔴 Feral crash dump (CTD) — {tester} / {mod_name}", "crash"
        else:
            dump_title, dump_status = (f"🟠 Feral crash dump from a PREVIOUS session (late XML twin, "
                                       f"no new crash) — {tester} / {mod_name}", "unclean")
        try:
            banner("Uploading crash dump...")
            post_to_discord(webhook, dump_title, dump_attachments, status=dump_status)
            banner("Crash dump uploaded.")
        except Exception as e:
            banner(f"[warn] Crash dump upload failed: {e}")

    # A staged update (downloaded at startup) installs automatically when this
    # process exits — via atexit and the console-close handler armed earlier —
    # so closing the window or the game both apply it. Nothing to do here but
    # let the tester know and finish.
    staged = _pending_installer is not None
    if rc == 2:
        if staged:
            banner("The downloaded update will install once you close this window.")
        pause_for_user()
        return 2

    if staged:
        for remaining in range(3, 0, -1):
            print(f"\rReport sent. Closing & updating in {remaining}s...   ", end="", flush=True)
            time.sleep(1)
        print()
        return 0

    # Linger so testers can read the OK line — silent auto-close was being
    # mistaken for a silent failure.
    for remaining in range(8, 0, -1):
        print(f"\rReport sent. Closing in {remaining}s...   ", end="", flush=True)
        time.sleep(1)
    print()
    return 0


# One verbatim line per pattern in ai_log_patterns.AI_LOG_LINE_PATTERNS, lifted
# from the 4.4M-line reference campaign_ai_log by Provincia's
# scripts/harvest-ailog-samples.js. Every pattern is proven to have a real example,
# so none is speculative.
#
# The selftest asserts this build keeps all of them. That is the check that catches
# the failure mode with no symptom: a pattern added on the Provincia side, never
# regenerated here, so the extract quietly arrives missing lines the Lab needs.
REAL_AI_LOG_SAMPLES = [
    "AI: \t\t\t\tstart 'dummies' for year -270, season summer",
    "AI: campaign: mission move nonlocal: char 'Captain Proteus' moving towards sett 'Pella', priority 400.",
    "AI: named cc: army 'Bellovesus' told to move to 'Decetia', priority 100.",
    "AI: campaign: res for char 'Captain Nabag' assigned to reg 1017 at priority 1.",
    "AI: resource for char 'Captain Bodmelqart' released by controller",
    "AI: campaign for region '1040' aborted because of insufficient available strength.",
    "AI: campaign: campaign for 'Armenian Rebels Settlement' (reg 1306, des 129) using strategy ACS_DEFEND_BORDER. required str 0 (ACZ_STAY_AT_HOME), allocated str 0; num res 0.",
    "AI: finance: est income 101, est maintenance 378, est outgoings 378 -- spending max 0, spending norm -277; balance AFB_EARN_MINUTE, state AFS_PAUPER",
    "AI: -- building 'Small Treasury' at priority 171.",
    "AI: campaign: garrison of settlement 'Carthage' told to split, 10 units leaving, priority 650.",
    "AI: mildir: invade_<other> attack authorised against 'slave'.",
    "AI: 0 spies assigned this turn",
    "AI: ltgd: army strength 2125, free army strength 2125, navy strength 0.",
    "AI: ltgd: 'carthage' invade 'corsi', not at war, good production against strongest neighbour >> ALI_START_PLAN (200).",
    "AI: ltgd: defend (frontline .000132, free 9.486274, product 21.18303) vs fac 'acragas': not at war, bad frontline, decent free strength >> ALD_DEFEND_DEEP.",
    "AI: -- troop type 'Caetrati Infantry' at priority 40.",
    "AI: region control: settlement 'Roman Rebels 1 Settlement', (pop 400, old order 0), tax TAX_LEVEL_LOW due to enough money",
    "AI: production: started recruitment of 'hyrkanian foot archers' at 'Parnon Taphai', priority 25, prod type AI_PROD_TYPE_BALANCED.",
    "AI: production: started 'building new, garrison' at 'Sexi', priority 6496, prod type AI_PROD_TYPE_MILITARY.",
    "AI: ltgd: number of invasion targets: 0",
    "AI: number of spies 0, number of assassins 0.",
    "AI: named cc: leader status 'free', heir status 'free', ungoverned cities 0 / 1, adoptees 0, resources 0 (total str 0).",
    "AI: production: settlement 'Iol' is busy constructing building upgrade, military_industrial_complex to level 1, considering repairs.",
    "AI: campaign: mission move: char 'Admiral Baalshafot' moving towards tile (123, 356) in region (0), priority 924 (move towards a position to take on a passenger).",
    "AI: worldwide: char 'Ptolemaios' assigned (in region 1256) at priority 0.",
    "AI: resource for char 'Ptolemaios' released by worldwide controller in region 1252.",
    "AI: Diplomat CC: Character \"Cassivellaunus\" told to move to settlement \"Vesontio\". Task: DIPLOMACY. Initiate: Yes. Priority 1000",
    "AI: production: sufficient numbers of troops but enough cash for more, so continuing to recruit.",
    "err: no building of this type in settlement",
    "AI: campaign: campaign for 'Armenian Rebels Settlement' (reg 1306, des 129) using strategy ACS_DEFEND_BORDER. required str 0 (ACZ_STAY_AT_HOME), allocated str 0; num res 0.sudo set_building_health local hinterland_region",
    "AI: naval controller: ARMY resource for char 'Admiral Yahua' assigned for reg 0.",
]



# ── ASSERT RISK, from telemetry (see the note in this file's header history) ──
# Measured 2026-07-26 across 336 sessions: 136 suspected crashes vs 200 that survived
# a high assert volume. Values are (crash-session share) - (survivor share), so a
# positive score means "seen far more often in sessions that died".
#
# WHY THIS EXISTS: ranking crash signals by COUNT surfaces exactly the wrong asserts.
# The two loudest in this mod - the string ref-count overflow and the texture-manager
# assert - are MORE common in sessions that exit cleanly (87-89% of survivors against
# 40-43% of crashes). A report that leads with them buries the handful that actually
# track a dead process.
ASSERT_RISK = [
    # (substring to match, score, short note shown beside it)
    ("unit_class != UCL_NUM_CLASSES", 11,
     "unit type/category enum - tracks descr_formations_ai unit_type tokens"),
    ("m_class != UCL_NUM_CLASSES", 8,
     "unit type/category enum - same family as the above"),
    ("flee_dx", 9, "rout vector out of range during a battle"),
    ("m_locomotive->tile_path.count()", 7, "empty movement path"),
    ("m_garrison_residence", 7, "garrison with no residence"),
    ("num_frontiers ==", 5, "region frontier count mismatch"),
    ("byte <= buffer_end - buffer_start", 5, "buffer overrun"),
    # Negative = commonly survived. Never hidden, only de-prioritised and labelled,
    # because "loud but survivable" is itself useful to know.
    ("m_status == TEX_MANAGER_DISPLAY_OPEN", -49, "very common; sessions usually survive it"),
    ("index < this->uni_char_string->length", -44, "string ref-count overflow; engine limit, usually survived"),
    ("length_squared > 0", -28, "very common; sessions usually survive it"),
    ("path_handle == -1", -25, "common in battles; usually survived"),
]


def is_4tpy_season_assert(expr):
    """The season/date-ordering assert produced by RIS's 4-turns-per-year script.

    The full expression is `(year > date.year) || ((year == date.year) &&
    (!(season == SE_SUMMER && date.season == SE_WINTER))) Failed`. Requiring BOTH
    tokens keeps the "not a defect, ignore in triage" annotation from firing on
    any other season-ish assert the engine might emit.
    """
    return "SE_SUMMER" in expr and "date.season" in expr


def assert_risk(expr):
    """Score an assert by its measured association with a crashed session.

    Returns (score, note). Unknown asserts score 0 - neither promoted nor demoted,
    which is the honest default for a signature the telemetry has not seen.
    """
    for needle, score, note in ASSERT_RISK:
        if needle in expr:
            return score, note
    return 0, ""


def rank_asserts(counter, limit=5):
    """Order asserts by risk first, volume second, and annotate the known ones.

    Volume still breaks ties, so a high-risk assert firing once does not outrank a
    high-risk assert firing a thousand times. An assert the telemetry has never seen
    keeps its volume ordering rather than being pushed to the bottom.
    """
    scored = []
    for expr, n in counter.items():
        score, note = assert_risk(expr)
        scored.append((score, n, expr, note))
    scored.sort(key=lambda t: (-t[0], -t[1]))
    out = []
    for score, n, expr, note in scored[:limit]:
        tag = ""
        if score > 0:
            tag = " [HIGH-RISK: %s]" % note
        elif score < 0:
            tag = " [%s]" % note
        out.append("%s x%d%s" % (expr, n, tag))
    return out



# ── KNOWN CRASH SIGNATURES, from minidump fault addresses in telemetry ──
# Measured 2026-07-26 over 50 reports carrying a parsed minidump. Fault addresses are
# far from uniform: one accounts for nearly half of them.
#
#   24x  ACCESS_VIOLATION @ Total War ROME REMASTERED.exe+0x266FD3   <- dominant
#    8x  ACCESS_VIOLATION @ VCRUNTIME140.dll+0x128D0
#    5x  INT_DIVIDE_BY_ZERO @ ...+0x868C71
#    5x  ACCESS_VIOLATION @ ...+0x91FCD0
#
# REMEASURED 2026-07-27 over 486 sessions, 54 of them with a parsed minidump. The shape
# held, one claim did not, and two of the smaller addresses turned out to be a distinct
# failure class rather than a thin tail:
#
#   26x (48%)  +0x266FD3   7 testers   <- dominant, unchanged
#    6x (11%)  +0x128D0    2 testers   <- carries NO asserts at all (see below)
#    5x ( 9%)  +0x868C71   2 testers   <- likewise
#    4x ( 7%)  +0x91FCD0   2 testers
#
# +0x266FD3, against crashes at every other address:
#
#   !m_current_image || image == m_current_image      50% vs 29%   1.8x
#   m_locomotive->tile_path.count()                   35% vs 11%   3.2x
#   unit_class != UCL_NUM_CLASSES || unit_category    27% vs 11%   2.5x
#   m_class != UCL_NUM_CLASSES || m_category          23% vs 11%   2.2x
#   siege battle before exit                          23% vs  7%   3.2x   <- new
#   descr_formations_ai script error                  27% vs 14%   1.9x
#   man_in_front_index                                 4% vs 11%   0.36x  <- DEPLETED
#   naval battle before exit                           0% vs  7%
#
# CORRECTION. The earlier note said the unit-enum asserts appear in "0% of other-address
# crashes", and built the argument on that exclusivity. With 54 dumps instead of 50 it is
# 11%, not 0% — the enrichment is real (2.5x) but NOT exclusive, and the old wording
# overstated it. The 0% was four extra dumps away from being wrong, which is what a
# denominator of ~28 buys you.
#
# The unit-enum pair is still what a bad `unit_type` token in descr_formations_ai.txt
# produces, and sessions carrying the enum assert crash 68% of the time against a 31%
# baseline (2.4x).
#
# WHICH TOKEN IS WRONG, since I got this backwards once: the defect is the BARE
# `unit_type pilum_infantry`, of which the v7.12 Workshop copy has 7 — line 80 being
# exactly the `descr_formations_ai.txt:80` the engine names. The class-prefixed forms
# (`heavy_pilum_infantry`, `light_pilum_infantry`, `spearmen_pilum_infantry`) are VALID and
# vanilla ships them, so they must not be "fixed".
#
# FIXED IN v7.13: the new beta's descr_formations_ai.txt carries 0 bare tokens (verified
# 2026-07-28 against C:\RIS\RIS\data — 181 prefixed pilum tokens remain, all valid). The
# enum-assert family should disappear from v7.13 sessions; if it does NOT, something else
# is feeding the same assert and this note's v7.12 attribution must be re-examined.
#
# The trap: this file's header comment lists `pilum_infantry` among the standalone keywords,
# which reads as though bare is the correct form and prefixed is the error. Remastered's
# engine says otherwise, and the engine is the authority. Reading the header instead of the
# engine's own output produces a 177-entry "fix list" that would break working formations.
# Provincia's lint had this right first; the file to check is the Workshop copy the engine
# loads, not another branch's copy of the same filename.
#
# HONEST LIMITS: co-occurrence at one fault address is not proof of cause; the strongest
# enrichment is an IMAGE assert, which may be nearer the actual fault; and only ~7 of the 26
# carry the enum assert, so the absolute count is small. The note says "associated with",
# never "caused by".
KNOWN_FAULT_SIGNATURES = [
    {
        "match": "+0x266FD3",
        "label": "the most common crash signature in RIS telemetry",
        "detail": (
            "26 of 54 parsed minidumps land here (48%), across seven testers — roughly four "
            "times the next-commonest address. Sessions hitting it are enriched for "
            "m_locomotive->tile_path.count() (35% vs 11% elsewhere, 3.2x), a siege battle "
            "before exit (23% vs 7%, 3.2x), unit_class/m_class != UCL_NUM_CLASSES (27%/23% "
            "vs 11%, ~2.4x) and !m_current_image (50% vs 29%). man_in_front_index is "
            "DEPLETED here (4% vs 11%), and no session at this address ended after a naval "
            "battle. The unit-enum pair is what an unrecognised unit_type token in "
            "descr_formations_ai.txt produces - in the v7.12-and-earlier betas that was the "
            "BARE `unit_type pilum_infantry` (7 in the shipped file, line 80 the one the "
            "engine named), REMOVED in v7.13. On a v7.13+ session, check whether this report "
            "carries the unit-enum asserts at all before chasing formations; all stats here "
            "were measured on v7.12-and-earlier sessions. The class-prefixed pilum forms are "
            "valid vanilla tokens - do not change those. Association, not proven cause."
        ),
    },
    {
        # Two addresses share a property worth stating outright: sessions crashing there
        # carry NONE of the assert families above - 0% for every one of them, against 20-44%
        # among the other dump sessions. Triage that goes looking for an assert will find
        # nothing and conclude the report is empty, when the absence IS the signature.
        "match": "+0x128D0",
        "label": "second-commonest crash address, and a different failure class",
        "detail": (
            "6 of 54 parsed minidumps (11%), two testers. Distinctive for what is absent: "
            "0% carry !m_current_image, the unit-enum asserts, m_locomotive->tile_path, "
            "uni_char_string or a descr_formations_ai script error, against 19-44% among "
            "crashes at other addresses. This is not the formation-token family and looking "
            "for asserts here is the wrong search. Small sample (n=6) - treat the absence as "
            "a lead, not a conclusion."
        ),
    },
    {
        "match": "+0x868C71",
        "label": "third-commonest crash address, also assert-free",
        "detail": (
            "5 of 54 parsed minidumps (9%), two testers, reported as INT_DIVIDE_BY_ZERO. "
            "Like +0x128D0 it carries none of the assert families (0% for !m_current_image, "
            "the unit-enum pair, uni_char_string), so it is a separate failure from the "
            "dominant address. Small sample (n=5)."
        ),
    },
]


def known_fault_note(summary):
    """Annotate a minidump summary when it matches a signature seen across testers.

    One report cannot know it is the 24th of its kind, so the aggregate lives here and
    travels with the build. Returns None for an unrecognised address rather than
    guessing - a new fault address is information too.
    """
    if not summary:
        return None
    for sig in KNOWN_FAULT_SIGNATURES:
        if sig["match"] in summary:
            return "⚠ %s — %s" % (sig["label"], sig["detail"])
    return None


def selftest() -> int:
    """Report whether this build can do everything it claims. Exit 0 = healthy.

    Exists because the AI-log filter is a conditional import: a frozen build that
    failed to bundle ai_log_patterns.py would keep working and just stop sending
    the AI decision log, silently. build.bat runs this and refuses to ship a build
    that fails it.
    """
    ok = True
    print("%s v%s" % (APP_NAME, APP_VERSION))
    print("frozen:", bool(getattr(sys, "frozen", False)))

    print("ai_log_patterns importable:", AI_LOG_FILTER_AVAILABLE)
    if not AI_LOG_FILTER_AVAILABLE:
        print("  FAIL: the AI Movement Lab extract would be skipped in every report.")
        print("        Add ai_log_patterns to the PyInstaller hiddenimports, and make")
        print("        sure the file exists (Provincia generates it:")
        print("        npm run gen:ailog-patterns).")
        ok = False
    else:
        # Prove the filter actually works, not merely that the module loaded.
        header = "AI: \t\t\t\tstart 'dummies' for year -270, season summer"
        checks = [
            ("faction turn header", _keep_ai_line(header), True),
            ("is_turn_block on it", _is_turn_block(header), True),
            ("unanchored char mention", _keep_ai_line("AI: ltgd: army 'Ulkos' considered"), True),
            ("unrelated line dropped", _keep_ai_line("AI: ltgd: considering invade of epirus"), False),
        ]
        for label, got, want in checks:
            good = (bool(got) == want)
            print("  %-26s %-5s %s" % (label, str(bool(got)), "ok" if good else "FAIL (expected %s)" % want))
            if not good:
                ok = False

        # Every pattern's real example must survive the filter. A dropped line means
        # this build's ai_log_patterns.py is behind Provincia's.
        try:
            import ai_log_patterns as _alp
            n_patterns = len(_alp.AI_LOG_LINE_PATTERNS)
        except Exception:
            n_patterns = -1
        dropped = [x for x in REAL_AI_LOG_SAMPLES if not _keep_ai_line(x)]
        print("  %-26s %d patterns, %d/%d real lines kept"
              % ("pattern coverage", n_patterns, len(REAL_AI_LOG_SAMPLES) - len(dropped),
                 len(REAL_AI_LOG_SAMPLES)))
        if dropped:
            ok = False
            for x in dropped[:6]:
                print("      DROPPED: %s" % x[:88])
            print("      This build is behind Provincia. Regenerate with")
            print("      'npm run gen:ailog-patterns' in C:/dev/Provincia and rebuild.")
        if n_patterns != len(REAL_AI_LOG_SAMPLES):
            # Not fatal on its own — a pattern can legitimately share a sample — but
            # a mismatch means the fixture was not re-harvested and is worth saying.
            print("      note: %d patterns vs %d samples; re-harvest the fixture."
                  % (n_patterns, len(REAL_AI_LOG_SAMPLES)))

    # The assert ranking must put a rare HIGH-RISK assert above a very loud benign one.
    # That inversion is the whole point: the two loudest asserts in this mod are the ones
    # sessions most often survive (87-89% of survivors vs 40-43% of crashes), so ranking
    # by count buries the informative ones. Checked here so a future edit to ASSERT_RISK
    # cannot quietly restore volume ordering.
    try:
        from collections import Counter as _C
        _mix = _C({
            "length_squared > 0": 14314,                                        # loud, survivable
            "unit_class != UCL_NUM_CLASSES || unit_category != UC_NUM_CATEGORIES": 14,  # rare, deadly
        })
        _ranked = rank_asserts(_mix, 2)
        _ok = ("unit_class" in _ranked[0]) and ("HIGH-RISK" in _ranked[0]) and ("length_squared" in _ranked[1])
        print("  %-26s %-5s %s" % ("assert-risk ranking", str(_ok),
                                   "ok" if _ok else "FAIL (loud benign assert outranked a high-risk one)"))
        if not _ok:
            ok = False
    except Exception as _exc:
        print("  %-26s FAIL: %r" % ("assert-risk ranking", _exc))
        ok = False

    # The dominant fault address must be recognised, and an unknown one must NOT be
    # (a matcher that fires on everything would label every crash as the common one).
    try:
        _hit = known_fault_note("ACCESS_VIOLATION in Total War ROME REMASTERED.exe+0x266FD3")
        _miss = known_fault_note("ACCESS_VIOLATION in Total War ROME REMASTERED.exe+0xDEADBEEF")
        _ok = bool(_hit) and _miss is None
        print("  %-26s %-5s %s" % ("known fault signature", str(_ok),
                                   "ok" if _ok else "FAIL (matcher too broad or not matching)"))
        if not _ok:
            ok = False
    except Exception as _exc:
        print("  %-26s FAIL: %r" % ("known fault signature", _exc))
        ok = False

    # The 4TPY season/date assert must be recognised from its real telemetry text,
    # and a merely season-ish assert must NOT be — the annotation says "not a
    # defect, ignore in triage", so a too-broad matcher would talk testers out of
    # reporting a genuine new season bug.
    try:
        _hit = is_4tpy_season_assert(
            "(year > date.year) || ((year == date.year) && "
            "(!(season == SE_SUMMER && date.season == SE_WINTER))) Failed")
        _miss = is_4tpy_season_assert("season == SE_SUMMER Failed")
        _ok = _hit and not _miss
        print("  %-26s %-5s %s" % ("4TPY season assert", str(_ok),
                                   "ok" if _ok else "FAIL (matcher too broad or not matching)"))
        if not _ok:
            ok = False
    except Exception as _exc:
        print("  %-26s FAIL: %r" % ("4TPY season assert", _exc))
        ok = False

    # Grimel's three consecutive crash reports each showed "Failed x14" as one of only
    # three distinct asserts. The real line named the file, the line and the token. This
    # asserts the token is recovered and that a genuine assert is still parsed as one.
    try:
        _rf = parse_resolution_failure(
            "Failed to find either a unit class or unit category. Provided: 'pilum_infantry'")
        _real = ASSERT_RE.search("unit_class != UCL_NUM_CLASSES || unit_category != UC_NUM_CATEGORIES Failed")
        _ok = bool(_rf) and _rf[1] == "pilum_infantry"             and not is_resolution_failure("unit_class != UCL_NUM_CLASSES Failed")             and _real is not None and _real.group(0).strip().startswith("unit_class")
        print("  %-26s %-5s %s" % ("resolution failure", str(_ok),
                                   "ok" if _ok else "FAIL (token not recovered, or an assert misfiled)"))
        if not _ok:
            ok = False
    except Exception as _exc:
        print("  %-26s FAIL: %r" % ("resolution failure", _exc))
        ok = False

    # Dump dating (v0.1.42): the XML twin of a crash arrives one session late and
    # Feral's folder-shuffling refreshes mtime, so session membership is decided by
    # the filename's crash time. Filenames here are real ones from telemetry.
    try:
        _xml = Path("2026-07-27_00-52-09_FeralCrashDump 5f3029a342217d7.xml")
        _dmp = Path("FeralCrashDump 5f3029a342217d7.dmp")
        _lone = Path("FeralCrashDump 9ba604701f2c33ec.dmp")
        _t = dump_crash_time(_xml)
        _want = datetime(2026, 7, 27, 0, 52, 9).timestamp()
        _session_start = datetime(2026, 7, 27, 0, 54, 0).timestamp()
        _ok = (_t == _want
               and dump_crash_time(_dmp, [_xml, _dmp]) == _want   # dated via XML twin
               and dump_crash_time(_lone, [_xml, _lone]) is None  # no twin -> undatable
               and not (_t < _session_start - 300))               # 2 min before start = grace, not stale
        # And the actual staleness rule: a crash from the previous evening must be stale.
        _old = dump_crash_time(Path("2026-07-26_19-59-53_FeralCrashDump 71c1837e41dc4df8.xml"))
        _ok = _ok and (_old < _session_start - 300)
        print("  %-26s %-5s %s" % ("dump crash-time dating", str(_ok),
                                   "ok" if _ok else "FAIL (dump would be pinned on the wrong session)"))
        if not _ok:
            ok = False
    except Exception as _exc:
        print("  %-26s FAIL: %r" % ("dump crash-time dating", _exc))
        ok = False

    # On-disk verification (v0.1.46): a resolution failure must be re-checked against
    # the REAL file before the report calls it a fixable data defect — two v7.13
    # sessions reported the already-removed pilum token from stale Steam copies.
    # Fixture mirrors the fixed v7.13 file: class-prefixed tokens are valid and a
    # `;`-commented bare token must NOT resurrect the defect.
    try:
        import tempfile
        with tempfile.TemporaryDirectory() as _td:
            _root = Path(_td)
            _modfile = _root / "3535851864" / "data" / "descr_formations_ai.txt"
            _modfile.parent.mkdir(parents=True)
            _modfile.write_text(
                ";\t\t\t\t\t\tpilum_infantry\n"          # line 1: comment — must not count
                "\tunit_type\theavy_pilum_infantry 2.0\n"  # line 2: prefixed — must not count
                "\tunit_type\tbare_token_here 1.0\n",       # line 3: standalone token
                encoding="utf-8")
            _ep = "q:/feral/steam/workshop/3535851864/data/descr_formations_ai.txt"
            _v_stale = check_token_on_disk("pilum_infantry", _ep, 2, workshop_roots=[_root])
            _v_conf = check_token_on_disk("bare_token_here", _ep, 3, workshop_roots=[_root])
            _v_elsew = check_token_on_disk("bare_token_here", _ep, 1, workshop_roots=[_root])
            _v_nofile = check_token_on_disk("x", "q:/feral/steam/workshop/999/data/nope.txt", 1,
                                            workshop_roots=[_root])
            _ok = (_v_stale[0] == "stale" and _v_conf[0] == "confirmed"
                   and _v_elsew[0] == "elsewhere" and _v_nofile[0] is None)
            print("  %-26s %-5s %s" % ("on-disk token verify", str(_ok),
                                       "ok" if _ok else "FAIL (got %s/%s/%s/%s)" % (
                                           _v_stale[0], _v_conf[0], _v_elsew[0], _v_nofile[0])))
            if not _ok:
                ok = False
    except Exception as _exc:
        print("  %-26s FAIL: %r" % ("on-disk token verify", _exc))
        ok = False

    for mod in ("lzma", "zipfile", "ctypes", "urllib.request"):
        try:
            __import__(mod)
            print("  module %-16s ok" % mod)
        except Exception as exc:
            print("  module %-16s FAIL: %r" % (mod, exc))
            ok = False

    print("SELFTEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    # --selftest must run before the update check and before any log watching:
    # it is a build-verification step, not a mode of the reporter.
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    log_line(f"===== process start: v{APP_VERSION} argv={sys.argv[1:]} =====")
    try:
        code = main()
        log_line(f"===== exited normally, code={code} =====")
        sys.exit(code)
    except KeyboardInterrupt:
        log_line("===== KeyboardInterrupt (Ctrl+C) =====")
        print("\nCancelled by user.")
        sys.exit(130)
    except SystemExit:
        raise
    except BaseException:
        # An unhandled error is the prime suspect for "it randomly closed" — log
        # the full traceback and hold the window so the tester can see it.
        import traceback
        tb = traceback.format_exc()
        log_line("===== UNCAUGHT EXCEPTION — reporter is exiting =====\n" + tb)
        try:
            banner("")
            banner("[fatal] The reporter hit an unexpected error and must close:")
            banner(tb)
            banner(f"Details were saved to: {script_dir() / LOG_FILENAME}")
            pause_for_user()
        except Exception:
            pass
        sys.exit(1)
