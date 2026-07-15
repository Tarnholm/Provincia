// buildLastTurnSummary — extracted from main.js (2026-07-15). Pure: diffs the
// previous vs current event-log snapshots and reduces the newly-appeared events
// to the renderer-facing shape (the fields the live "last turn" panel groups on).
// Returns null unless both inputs are arrays (e.g. the first live load).
"use strict";
const { diffTurn } = require("./eventLogParser.js");

function buildLastTurnSummary(prevEventLog, currEventLog) {
  if (!Array.isArray(prevEventLog) || !Array.isArray(currEventLog)) return null;
  const newEvents = diffTurn(prevEventLog, currEventLog);
  // Keep the shape close to the parser's records so the renderer can group.
  return newEvents.map((e) => ({
    type: e.type,
    recordClass: e.recordClass,
    faction: e.faction || null,
    subject: e.subject,
    title: e.title || null,
    body: e.body || null,
  }));
}

module.exports = { buildLastTurnSummary };
