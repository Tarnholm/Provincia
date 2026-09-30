// The map window's localStorage view: reads fall through to the main window's
// values, writes stay its own, and the main window's keys are never touched.
import { describe, it, expect } from "vitest";
import { createOverlayStorage, MAP_STORAGE_PREFIX } from "./windowRole";

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    _m: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe("map window storage overlay", () => {
  it("reads the main window's value until it sets its own", () => {
    const real = memoryStorage({ colorMode: "faction" });
    const s = createOverlayStorage(real);
    expect(s.getItem("colorMode")).toBe("faction");
    s.setItem("colorMode", "tradelanes");
    expect(s.getItem("colorMode")).toBe("tradelanes");
    expect(real.getItem("colorMode")).toBe("faction");
    expect(real.getItem(MAP_STORAGE_PREFIX + "colorMode")).toBe("tradelanes");
  });

  it("re-writing the main window's value stores no copy, so the key keeps following it", () => {
    const real = memoryStorage({ statsCache: "big", colorMode: "faction" });
    const s = createOverlayStorage(real);
    s.setItem("statsCache", "big"); // the mount-time persist effects do this
    expect(real.getItem(MAP_STORAGE_PREFIX + "statsCache")).toBe(null);
    real.setItem("statsCache", "newer");
    expect(s.getItem("statsCache")).toBe("newer");
    // Setting a different value and then the main window's again drops the copy.
    s.setItem("colorMode", "religion");
    s.setItem("colorMode", "faction");
    expect(real.getItem(MAP_STORAGE_PREFIX + "colorMode")).toBe(null);
    real.setItem("colorMode", "culture");
    expect(s.getItem("colorMode")).toBe("culture");
  });

  it("campaign and live-folder keys always follow the main window", () => {
    const real = memoryStorage({ lastImport_imperial: '{"at":1}', mapCampaign: "imperial", liveLogDir: "C:/a" });
    const s = createOverlayStorage(real);
    s.setItem("lastImport_imperial", '{"at":2}');
    s.setItem("mapCampaign", "classic");
    s.removeItem("liveLogDir");
    expect(real._m.size).toBe(3); // nothing of its own stored
    expect(s.getItem("lastImport_imperial")).toBe('{"at":1}');
    expect(s.getItem("mapCampaign")).toBe("imperial");
    expect(s.getItem("liveLogDir")).toBe("C:/a");
  });

  it("still sees the main window's later changes to keys it never set", () => {
    const real = memoryStorage();
    const s = createOverlayStorage(real);
    real.setItem("liveLogDir", "C:/logs");
    expect(s.getItem("liveLogDir")).toBe("C:/logs");
  });

  it("removing hides the main window's value without deleting it", () => {
    const real = memoryStorage({ "widget.minimap": "{}" });
    const s = createOverlayStorage(real);
    s.removeItem("widget.minimap");
    expect(s.getItem("widget.minimap")).toBe(null);
    expect(real.getItem("widget.minimap")).toBe("{}");
    s.setItem("widget.minimap", "{\"x\":1}");
    expect(s.getItem("widget.minimap")).toBe("{\"x\":1}");
  });

  it("key()/length list the merged view (what Movable's reset iterates)", () => {
    const real = memoryStorage({ "widget.a": "1", "widget.b": "2", other: "x" });
    const s = createOverlayStorage(real);
    s.setItem("widget.c", "3");
    s.removeItem("widget.b");
    const keys = [];
    for (let i = 0; i < s.length; i++) keys.push(s.key(i));
    expect(keys.sort()).toEqual(["other", "widget.a", "widget.c"]);
    expect(keys.some((k) => k.startsWith(MAP_STORAGE_PREFIX))).toBe(false);
  });

  it("clear() drops only the map window's own settings", () => {
    const real = memoryStorage({ colorMode: "faction" });
    const s = createOverlayStorage(real);
    s.setItem("colorMode", "religion");
    s.setItem("zoom", "3");
    s.clear();
    expect(s.getItem("colorMode")).toBe("faction");
    expect(s.getItem("zoom")).toBe(null);
    expect(real.getItem("colorMode")).toBe("faction");
  });
});
