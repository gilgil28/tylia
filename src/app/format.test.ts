import { describe, expect, it } from "vitest";

import { middleEllipsis, relativeTime } from "./format";

describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);
  const ago = (s: number) => relativeTime(now / 1000 - s, now);

  it("formats recent times", () => {
    expect(ago(10)).toBe("just now");
    expect(ago(5 * 60)).toBe("5 minutes ago");
    expect(ago(3 * 3600)).toBe("3 hours ago");
    expect(ago(30 * 3600)).toBe("yesterday");
    expect(ago(10 * 24 * 3600)).toBe("last week");
  });

  it("shows a date for old commits", () => {
    expect(ago(400 * 24 * 3600)).toMatch(/2025/);
  });
});

describe("middleEllipsis", () => {
  it("keeps short paths", () => {
    expect(middleEllipsis("src/app.ts", 40)).toBe("src/app.ts");
  });

  it("keeps the first segment and as much of the end as fits", () => {
    const p = "src/features/history/rows/Row.tsx";
    expect(middleEllipsis(p, 22)).toBe("src/…/rows/Row.tsx");
    expect(middleEllipsis(p, 16)).toBe("src/…/Row.tsx");
  });

  it("cuts the middle when even the name doesn't fit", () => {
    const out = middleEllipsis("a/averyveryverylongfilename.txt", 12);
    expect(out).toHaveLength(12);
    expect(out).toContain("…");
  });

  it("handles Windows paths", () => {
    expect(middleEllipsis("C:\\Users\\me\\code\\project", 20)).toBe("C:\\…\\me\\code\\project");
  });
});
