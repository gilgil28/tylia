import { describe, expect, it } from "vitest";

import { joinPath, repoNameFromUrl } from "./paths";

describe("repoNameFromUrl", () => {
  it("handles common URL forms", () => {
    expect(repoNameFromUrl("https://github.com/tylia-dev/tylia.git")).toBe("tylia");
    expect(repoNameFromUrl("https://github.com/tylia-dev/tylia/")).toBe("tylia");
    expect(repoNameFromUrl("git@github.com:owner/my-repo.git")).toBe("my-repo");
    expect(repoNameFromUrl("ssh://git@host:2222/team/proj")).toBe("proj");
    expect(repoNameFromUrl("C:\\src\\local repo")).toBe("local repo");
    expect(repoNameFromUrl("")).toBe("");
  });
});

describe("joinPath", () => {
  it("uses the parent's separator", () => {
    expect(joinPath("C:\\Users\\me", "x")).toBe("C:\\Users\\me\\x");
    expect(joinPath("/home/me/", "x")).toBe("/home/me/x");
  });
});
