// Worker thread that runs parseSettlementBuildings on the save buffer.
// Spawned in parallel with the chars worker and the main thread's
// parseSaveData so all three CPU-bound passes overlap. parseSettlements
// scans the save for settlement markers + chain records; on a 30MB save
// it costs ~200-400ms — main-thread time we recover by moving here.
//
// Communication:
//   in:  { saveBuf, whitelist (array of chain names), maxLevels (object) }
//   out: { ok: true, buildingsByCity, queuedByCity } | { ok: false, error }

"use strict";

const { parentPort } = require("worker_threads");
const { parseSettlements, findAllSettlementMarkers } = require("./buildingParser.js");
const { parseQueuesForSettlements, detectEngine } = require("./queueParser.js");

parentPort.on("message", (payload) => {
  try {
    const { saveBuf, whitelist, maxLevels } = payload;
    const buf = Buffer.isBuffer(saveBuf)
      ? saveBuf
      : Buffer.from(saveBuf.buffer, saveBuf.byteOffset, saveBuf.byteLength);
    const whitelistSet = new Set(whitelist);
    const { settlements } = parseSettlements(buf, whitelistSet, maxLevels || {});
    const buildingsByCity = {};
    const queuedByCity = {};
    for (const s of settlements) {
      buildingsByCity[s.name] = s.buildings;
      if (s.queued && s.queued.length > 0) queuedByCity[s.name] = s.queued;
    }
    // Session 36 queue parser — extracts construction queue chainId+turns and
    // recruitment queue unit names. Reuses settlement markers we just scanned.
    const markers = findAllSettlementMarkers(buf);
    const liveQueues = parseQueuesForSettlements(buf, markers);
    const recruitingByCity = {};
    const buildingQueueByCity = {};
    for (const [city, q] of liveQueues) {
      if (q.recruiting.length > 0) recruitingByCity[city] = q.recruiting;
      if (q.building.length > 0) buildingQueueByCity[city] = q.building;
    }
    // Engine of this save (queue layout differs RIS imperial vs Alexander/RR);
    // surfaced for provincia.log diagnostics. On Alexander only recruit queues
    // are decoded so far (build queue deferred — see queueParser.js).
    const queueEngine = detectEngine(buf);
    parentPort.postMessage({
      ok: true,
      buildingsByCity,
      queuedByCity,
      recruitingByCity,
      buildingQueueByCity,
      queueEngine,
      queueStats: {
        engine: queueEngine,
        recruitCities: Object.keys(recruitingByCity).length,
        buildingCities: Object.keys(buildingQueueByCity).length,
      },
    });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});
