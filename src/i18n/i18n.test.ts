import { describe, expect, it } from "vitest";

import { plural, t } from ".";

describe("plural", () => {
  it("picks one/other and formats the count", () => {
    expect(plural("count.files", 1)).toBe("1 file");
    expect(plural("count.files", 0)).toBe("0 files");
    expect(plural("count.commits", 12345)).toBe("12,345 commits");
  });
});

describe("t", () => {
  it("returns plain messages", () => {
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(t("shell.gitFound", { version: "2.50.1" })).toBe("Git 2.50.1");
    expect(t("shell.gitFound")).toBe("Git {version}");
  });
});
