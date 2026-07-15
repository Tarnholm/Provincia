// Tests for the pure main-process utilities extracted from main.js.
import { describe, test, expect } from "vitest";
import { gameTextCRLF, hashName, makeLRU, parseTextDictionary } from "./mainUtils.js";

describe("gameTextCRLF", () => {
  test("normalizes LF and lone CR to CRLF for .txt paths", () => {
    expect(gameTextCRLF("descr_strat.txt", "a\nb\rc\r\nd")).toBe("a\r\nb\r\nc\r\nd");
  });
  test("leaves non-.txt content untouched", () => {
    expect(gameTextCRLF("map.tga", "a\nb")).toBe("a\nb");
  });
  test("passes through non-string content", () => {
    const buf = Buffer.from([1, 2, 3]);
    expect(gameTextCRLF("x.txt", buf)).toBe(buf);
  });
  test("already-CRLF text is unchanged", () => {
    expect(gameTextCRLF("a.txt", "x\r\ny")).toBe("x\r\ny");
  });
});

describe("hashName", () => {
  test("deterministic unsigned 32-bit djb2", () => {
    const a = hashName("romans_julii");
    expect(a).toBe(hashName("romans_julii"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(a)).toBe(true);
  });
  test("different strings hash differently", () => {
    expect(hashName("carthage")).not.toBe(hashName("seleucid"));
  });
  test("empty string → seed 5381", () => {
    expect(hashName("")).toBe(5381);
  });
});

describe("makeLRU", () => {
  test("stores and retrieves", () => {
    const c = makeLRU(3);
    c.set("a", 1);
    expect(c.has("a")).toBe(true);
    expect(c.get("a")).toBe(1);
    expect(c.get("missing")).toBeUndefined();
  });
  test("evicts the least-recently-used past the limit", () => {
    const c = makeLRU(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");        // touch a → b is now LRU
    c.set("c", 3);     // evicts b
    expect(c.has("a")).toBe(true);
    expect(c.has("c")).toBe(true);
    expect(c.has("b")).toBe(false);
  });
  test("re-setting an existing key refreshes recency without growing size", () => {
    const c = makeLRU(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10);    // a refreshed → b is LRU
    c.set("c", 3);     // evicts b
    expect(c.get("a")).toBe(10);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
  });
});

describe("parseTextDictionary", () => {
  test("parses {key}value lines", () => {
    const d = parseTextDictionary("{forum}Forum\n{agora}Agora");
    expect(d).toEqual({ forum: "Forum", agora: "Agora" });
  });
  test("continuation lines append to the current value; trims result", () => {
    const d = parseTextDictionary("{desc}line one\nline two\n{next}x");
    expect(d.desc).toBe("line one\nline two");
    expect(d.next).toBe("x");
  });
  test("literal \\n escapes become real newlines", () => {
    expect(parseTextDictionary("{k}a\\nb").k).toBe("a\nb");
  });
  test("leading text before the first key is ignored", () => {
    expect(parseTextDictionary("junk header\n{k}v")).toEqual({ k: "v" });
  });
  test("empty input → empty object", () => {
    expect(parseTextDictionary("")).toEqual({});
  });
});
