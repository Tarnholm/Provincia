// Worker thread that runs findCharacterRecords on the save buffer in
// parallel with the main thread's parseSaveData. Total Live-load time
// drops from "scan-buf-then-scan-buf-again" to "max of the two scans"
// — about a 1-1.5s saving on a 30MB save where both scans are ~1s.
//
// Also applies trait-driven cognomen/nickname overrides while we have
// the records here, so the main thread doesn't redo that pass.
//
// Communication:
//   in:  { saveBuf, nameLookup, traitNames, traitEpithets }
//   out: { ok: true, characters } | { ok: false, error }

"use strict";

const { parentPort } = require("worker_threads");
const { findCharacterRecords } = require("./characterParser.js");

const isNicknameEpithet = (s) => /^(the|de|der|le|la|el|il|den)\s/i.test(s);

function applyEpithets(characters, modTraitEpithets) {
  if (!modTraitEpithets) return;
  for (const c of characters) {
    if (!c.traits || c.traits.length === 0) continue;
    let surname = null, nickname = null;
    for (const t of c.traits) {
      const candidates = modTraitEpithets[t.name];
      if (!candidates) continue;
      let best = null;
      for (const cand of candidates) {
        if (!best || cand.level > best.level) best = cand;
      }
      if (!best) continue;
      if (isNicknameEpithet(best.text)) nickname = best.text;
      else if (!surname || best.level > (surname.level || 0)) surname = best;
    }
    // Preserve the BIRTH lastName so the live-log match cascade can
    // still pair save records with log lines (the engine continues to
    // emit the birth name in MOVING_NORMAL and similar events even
    // after a trait grants a cognomen). Without this, Marcus
    // Livius_Drusus → Marcus Messapivs after his RomanConquerorMessapians
    // trait fired, and his marker stopped updating live because the
    // log still said 'Marcus Livius Drusus'. lastName holds the
    // displayed name (with epithet); originalLastName holds the
    // birth-record value for matching.
    if (surname || nickname) {
      c.originalLastName = c.lastName || null;
    }
    if (surname) c.lastName = surname.text;
    if (nickname) c.lastName = (c.lastName ? c.lastName + " " : "") + nickname;
  }
}

parentPort.on("message", (payload) => {
  try {
    const { saveBuf, nameLookup, traitNames, traitEpithets } = payload;
    // postMessage delivers Buffers as Uint8Array on the worker side —
    // wrap back into a real Buffer so byte-reading helpers work.
    const buf = Buffer.isBuffer(saveBuf) ? saveBuf : Buffer.from(saveBuf.buffer, saveBuf.byteOffset, saveBuf.byteLength);
    const characters = findCharacterRecords(buf, nameLookup, traitNames, null);
    applyEpithets(characters, traitEpithets);
    parentPort.postMessage({ ok: true, characters });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});
