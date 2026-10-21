import { describe, expect, it } from "vitest";

import { LruCache } from "./highlight";

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "b" is now the oldest
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("replaces and deletes entries", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });
});
