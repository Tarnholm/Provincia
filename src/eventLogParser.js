// src/eventLogParser.js
//
// RTW Remastered .sav END-OF-TURN EVENT LOG parser. Cracked 2026-05-31
// (rtw-sav-parser/docs/findings-event-log-2026-05-31.md). The player-facing
// "what happened" event scroll is a contiguous run of fixed-grammar records
// in the save trailer; it ACCUMULATES across turns, so the new tail between
// two consecutive saves = the events of the turn that elapsed.
//
// RECORD GRAMMAR (all little-endian):
//   u32  self_offset   // == byte position of this field (self-pointer guard)
//   u32  record_class  // event-type enum (EVENT_CLASS)
//   u32  sentinel      // == 0xFFFFFEF2 (bytes f2 fe ff ff) — scan anchor
//   u32  scope         // 2 = settlement event, 0 = family/character event
//   u32  faction_id    // descr_strat faction index (238 = slave/rebels)
//   pstr16 subject     // u16 charCount + UTF-16LE: settlement OR character name
//   pstr16 title       // UI title ("Settlement Under Siege")
//   pstr16 body        // full descriptive text
//
// NOT the trailer offset-index ({self,u16 tag,coords}) — that's a static,
// cross-campaign map-anchor registry, not the event log.

"use strict";

const SENTINEL = Buffer.from([0xf2, 0xfe, 0xff, 0xff]);

const EVENT_CLASS = {
  2: "marriage",
  3: "adoption",
  4: "blockade",
  5: "agent_discovered",
  7: "governor_appointed",
  8: "settlement_under_siege",
  9: "settlement_lost",
  10: "settlement_gained",
  12: "natural_death",
  13: "birth",
  15: "new_faction_leader",
  16: "new_faction_heir",
  17: "faction_defeated",
};

function readPstr16(buf, p) {
  if (p + 2 > buf.length) return null;
  const len = buf.readUInt16LE(p);
  if (len === 0 || len > 400) return null;
  const bytes = 2 * len;
  if (p + 2 + bytes > buf.length) return null;
  let s = "";
  for (let i = 0; i < len; i++) {
    const ch = buf.readUInt16LE(p + 2 + i * 2);
    if (ch < 32 || ch > 0x2122) return null; // printable BMP only
    s += String.fromCharCode(ch);
  }
  return { s, next: p + 2 + bytes };
}

// Parse every event-log record. `factionOrder` (descr_sm_factions / descr_strat
// declaration order) is optional; when given, each event gets a `.faction` name.
function parseEventLog(buf, factionOrder = null) {
  const out = [];
  let from = 0;
  while (true) {
    const sp = buf.indexOf(SENTINEL, from);
    if (sp < 0) break;
    from = sp + 1;
    const selfPos = sp - 8;
    if (selfPos < 0) continue;
    if (buf.readUInt32LE(selfPos) !== selfPos) continue; // self-pointer guard
    const recordClass = buf.readUInt32LE(sp - 4);
    const scope = buf.readUInt32LE(sp + 4);
    const factionId = buf.readUInt32LE(sp + 8);
    let p = sp + 12;
    const subject = readPstr16(buf, p);
    if (!subject) continue;
    p = subject.next;
    const title = readPstr16(buf, p);
    let titleS = null;
    if (title) { titleS = title.s; p = title.next; }
    const body = readPstr16(buf, p);
    out.push({
      offset: selfPos,
      recordClass,
      type: EVENT_CLASS[recordClass] || `class_${recordClass}`,
      scope,
      factionId,
      faction: factionOrder && factionOrder[factionId] ? factionOrder[factionId] : null,
      subject: subject.s,
      title: titleS,
      body: body ? body.s : null,
    });
  }
  return out;
}

// Events present in `after` but not `before` = happened during the turn between.
function diffTurn(beforeEvents, afterEvents) {
  const key = (e) => `${e.recordClass}|${e.factionId}|${e.subject}|${e.title}|${e.body}`;
  const seen = new Set(beforeEvents.map(key));
  return afterEvents.filter((e) => !seen.has(key(e)));
}

module.exports = { parseEventLog, diffTurn, EVENT_CLASS };
