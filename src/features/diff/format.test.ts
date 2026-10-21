import { describe, expect, it } from "vitest";

import { formatSize } from "./format";

describe("formatSize", () => {
  it("picks a unit", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(14_540)).toBe("14.2 KB");
    expect(formatSize(3_250_000)).toBe("3.1 MB");
  });
});
