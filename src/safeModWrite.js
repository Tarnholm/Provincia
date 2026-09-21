// One door for every write Provincia makes into a user's mod (2026-09-21).
//
// Before this module each handler did a bare fs.writeFileSync straight onto the
// live file — a crash, an antivirus lock or a full disk mid-write left a
// TRUNCATED descr_strat, which the game reports as a campaign that will not
// start. There were also four backup schemes (a rolling .provincia-bak that a
// second apply overwrote with the already-edited file, a bare <stamp>.bak, the
// stamped .provincia-<stamp>.bak, and none at all), only one of which
// restore-mod-backup could restore.
//
// Contract:
//   • the new content is written to a sibling temp file, flushed, then renamed
//     over the target — the target is always either the old file or the new
//     one, never a partial;
//   • an in-place write of an existing file takes a stamped
//     <file>.provincia-<stamp>.bak FIRST (the format list/restore-mod-backup
//     read), and a backup that cannot be made ABORTS the write;
//   • export mode (outPath !== livePath) leaves the live file alone, so it
//     takes no backup;
//   • text is decoded utf8 only when the bytes ARE valid utf8, latin1
//     otherwise, and written back the same way — byte-exact for whatever the
//     edit did not touch (a plain "utf8" read turns an ANSI high-bit byte into
//     U+FFFD and writes it back as three bytes, permanently).
"use strict";
const fs = require("fs");
const path = require("path");

const KEEP_BACKUPS = 10;
const BAK_MID = ".provincia-";
const BAK_EXT = ".bak";

function newStamp(d) { return (d || new Date()).toISOString().replace(/[:.]/g, "-"); }

// Decode a mod text file without losing bytes. utf16le (text/*.txt) is the
// caller's business — those files carry a BOM and are read as "utf16le".
function readModText(p) {
  const buf = fs.readFileSync(p);
  let text, encoding;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); encoding = "utf8"; }
  catch { text = buf.toString("latin1"); encoding = "latin1"; }
  return { text, encoding };
}

function _sleepMs(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { } }

// temp + fsync + rename. Windows can refuse the rename for a moment while an
// indexer/antivirus holds the target open — retry briefly, then give up with
// the target untouched and the temp removed.
function writeFileAtomic(target, data, encoding) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.provincia-tmp-${process.pid}-${Date.now().toString(36)}`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, data, encoding);
    try { fs.fsyncSync(fd); } catch { }
    fs.closeSync(fd); fd = null;
    let lastErr = null;
    for (let i = 0; i < 6; i++) {
      try { fs.renameSync(tmp, target); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        if (!e || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) break;
        _sleepMs(40 * (i + 1));
      }
    }
    if (lastErr) throw lastErr;
  } catch (e) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { } }
    try { fs.unlinkSync(tmp); } catch { }
    throw e;
  }
}

function listBackupStamps(p) {
  const dir = path.dirname(p), base = path.basename(p);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((f) => f.startsWith(base + BAK_MID) && f.endsWith(BAK_EXT) && !f.startsWith(base + ".provincia-tmp-"))
    .map((f) => f.slice((base + BAK_MID).length, -BAK_EXT.length))
    .sort();
}

function pruneBackups(p, keep) {
  const stamps = listBackupStamps(p);
  const n = keep == null ? KEEP_BACKUPS : keep;
  while (stamps.length > n) {
    const s = stamps.shift();
    try { fs.unlinkSync(`${p}${BAK_MID}${s}${BAK_EXT}`); } catch { }
  }
}

// Copy p to its stamped backup and verify the copy landed whole. Throws on
// failure — callers must not write without it.
function backupStamped(p, stamp) {
  const s = stamp || newStamp();
  const bak = `${p}${BAK_MID}${s}${BAK_EXT}`;
  fs.copyFileSync(p, bak);
  const a = fs.statSync(p).size, b = fs.statSync(bak).size;
  if (a !== b) { try { fs.unlinkSync(bak); } catch { } throw new Error(`backup of ${path.basename(p)} is ${b} bytes, source is ${a}`); }
  pruneBackups(p);
  return { stamp: s, path: bak };
}

function _hasFreshBackup(p, freshMs) {
  if (!freshMs) return false;
  const stamps = listBackupStamps(p);
  if (!stamps.length) return false;
  try {
    const st = fs.statSync(`${p}${BAK_MID}${stamps[stamps.length - 1]}${BAK_EXT}`);
    return Date.now() - st.mtimeMs < freshMs && st.size === fs.statSync(p).size;
  } catch { return false; }
}

// Which file an EDIT should start from. In export mode every handler used to
// read the LIVE file and write the export copy, so a second edit rebuilt the
// export from the untouched original and silently threw the first edit away.
// The exported copy is the base once it exists — but only while it is at least
// as new as the live file: an export folder left over from last month must not
// become the base for today's edits.
function editBasePath(livePath, outPath) {
  if (!outPath || path.resolve(outPath) === path.resolve(livePath)) return livePath;
  try {
    const out = fs.statSync(outPath);
    if (!fs.existsSync(livePath) || out.mtimeMs >= fs.statSync(livePath).mtimeMs) return outPath;
  } catch { /* no exported copy yet */ }
  return livePath;
}

// The one write call. opts:
//   outPath  where the bytes go (export mode); defaults to livePath
//   backup   take the stamped backup first (default true; ignored in export
//            mode and when the live file does not exist yet)
//   stamp    share one stamp across a multi-file edit
//   freshMs  skip the backup when one younger than this already holds the
//            live file's exact size (the renderer's backup-mod-files ran a
//            moment ago) — avoids burning two of the ten kept slots per Save
// Returns { path, exported, backupStamp, backupPath }.
function safeWriteModFile(livePath, data, encoding, opts) {
  const o = opts || {};
  const outPath = o.outPath || livePath;
  const exported = path.resolve(outPath) !== path.resolve(livePath);
  let bak = null;
  if (!exported && o.backup !== false && fs.existsSync(livePath) && !_hasFreshBackup(livePath, o.freshMs)) {
    try { bak = backupStamped(livePath, o.stamp); }
    catch (e) { throw new Error(`backup failed, nothing was written: ${e && e.message ? e.message : e}`); }
  }
  writeFileAtomic(outPath, data, encoding);
  return { path: outPath, exported, backupStamp: bak ? bak.stamp : null, backupPath: bak ? bak.path : null };
}

// Several files that must land together (a new general = descr_strat + names +
// lookup + namelists). Callers compose ALL content before calling, so a failure
// while producing it changes nothing. Each live file's bytes are held while the
// set is written; if a write fails part-way, the files already replaced are put
// back. files: [{ livePath, outPath?, data, encoding }], written in order — put
// the file whose half-applied state is harmless first.
function safeWriteModFiles(files, opts) {
  const o = opts || {};
  const stamp = o.stamp || newStamp();
  const done = [];
  try {
    for (const f of files) {
      const out = f.outPath || f.livePath;
      const prev = fs.existsSync(out) ? fs.readFileSync(out) : null;
      const r = safeWriteModFile(f.livePath, f.data, f.encoding, { outPath: f.outPath, backup: o.backup, stamp });
      done.push({ out, prev, r });
    }
  } catch (e) {
    const undone = [];
    for (const d of done.reverse()) {
      try {
        if (d.prev) writeFileAtomic(d.out, d.prev); else fs.unlinkSync(d.out);
        undone.push(path.basename(d.out));
      } catch { }
    }
    const msg = e && e.message ? e.message : String(e);
    throw new Error(undone.length ? `${msg} — rolled back ${undone.join(", ")}` : msg);
  }
  return { stamp, results: done.map((d) => d.r) };
}

module.exports = { editBasePath, newStamp, readModText, writeFileAtomic, listBackupStamps, pruneBackups, backupStamped, safeWriteModFile, safeWriteModFiles, KEEP_BACKUPS };
