import { describe, expect, it } from "vitest";

import { avatarLane, initials } from "./Avatar";

describe("avatarLane", () => {
  it("is stable and case-insensitive", () => {
    expect(avatarLane("ada@example.com")).toBe(avatarLane(" ADA@example.com "));
  });

  it("stays within the 8 lane colours", () => {
    for (const key of ["a", "b", "someone@example.org", "名前", ""]) {
      const lane = avatarLane(key);
      expect(lane).toBeGreaterThanOrEqual(1);
      expect(lane).toBeLessThanOrEqual(8);
    }
  });
});

describe("initials", () => {
  it("uses first and last word", () => {
    expect(initials("Ada King Lovelace")).toBe("AL");
    expect(initials("grace")).toBe("G");
    expect(initials("  ")).toBe("?");
  });
});
