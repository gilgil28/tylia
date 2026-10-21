import { describe, expect, it } from "vitest";

import { checkBranchName, checkCommitMessage } from "./conventions";

describe("commit messages", () => {
  it.each([
    "graph: draw merge curves as beziers",
    "git: refuse finishing a flow branch that would conflict",
    "deps!: drop support for git 2.39",
    "terminal: open in the repository folder\n\nWindows Terminal ignores the working directory, so pass -d.",
    "deps: add tauri-plugin-updater 2.14.0\n\nDependency: tauri-plugin-updater (MIT OR Apache-2.0), signed updates.",
    "ui: support CRLF in diffs", // an acronym may start the summary
    "Merge branch 'feat/x'",
    'Revert "graph: draw merge curves as beziers"',
    "fixup! graph: draw merge curves",
    "release: v0.2.0\n# Please enter the commit message\n",
  ])("accepts %j", (message) => {
    expect(checkCommitMessage(message)).toEqual([]);
  });

  it.each([
    ["", /empty/],
    ["Draw merge curves", /<area>: <summary>/],
    ["graph:draw curves", /<area>: <summary>/],
    ["Graph: draw curves", /<area>: <summary>/],
    ["graphs: draw curves", /Unknown area "graphs"/],
    ["graph: Draw curves", /lowercase/],
    ["graph: added curves", /imperative/],
    ["graph: draw curves.", /full stop/],
    [`graph: ${"x".repeat(70)}`, /72 characters/],
    ["graph: draw curves\nmore text", /blank line/],
  ])("rejects %j", (message, problem) => {
    expect(checkCommitMessage(message).join("\n")).toMatch(problem);
  });

  it("ignores comment lines and the verbose diff", () => {
    const message =
      "history: keep scroll position\n\n# comment\n# ------------------------ >8 ------------------------\ndiff --git a b\nWhatever";
    expect(checkCommitMessage(message)).toEqual([]);
  });

  it("accepts Windows line endings", () => {
    expect(checkCommitMessage("graph: fix lanes\r\n\r\nWhy it broke.\r\n")).toEqual([]);
  });
});

describe("branch names", () => {
  it.each([
    "main",
    "feat/open-in-terminal",
    "fix/123-crlf-staging",
    "docs/releasing",
    "deps/bump-tauri",
    "release/v0.2.0",
    "release/v1.0.0-rc.1",
    "dependabot/cargo/serde-1.0.230",
  ])("accepts %s", (name) => {
    expect(checkBranchName(name)).toBeNull();
  });

  it.each([
    "my-branch",
    "feature/login", // the kind is "feat"
    "feat/Login",
    "feat/login_form",
    "feat/",
    "feat/a/b",
    "release/0.2.0",
    `feat/${"a".repeat(60)}`,
  ])("rejects %s", (name) => {
    expect(checkBranchName(name)).not.toBeNull();
  });
});
