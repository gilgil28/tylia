import { describe, expect, it } from "vitest";

import { detectLanguage } from "./language";

describe("detectLanguage", () => {
  it.each([
    ["src/app/App.tsx", "tsx"],
    ["src/main.ts", "typescript"],
    ["vite.config.mts", "typescript"],
    ["crates/tylia-git/src/diff.rs", "rust"],
    ["Cargo.toml", "toml"],
    ["Cargo.lock", "toml"],
    [".github/workflows/ci.yml", "yaml"],
    ["README.md", "markdown"],
    ["styles/index.CSS", "css"],
    ["scripts\\build.ps1", "powershell"],
    ["tools/run.sh", "shellscript"],
    ["Dockerfile", "docker"],
    ["docker/Dockerfile.dev", "docker"],
    ["build.dockerfile", "docker"],
    ["Makefile", "make"],
    ["tsconfig.json", "jsonc"],
    ["package.json", "json"],
    ["include/parser.hpp", "cpp"],
    ["icons/logo.svg", "xml"],
  ])("%s → %s", (path, lang) => {
    expect(detectLanguage(path)).toBe(lang);
  });

  it.each(["LICENSE", "assets/logo.png", ".gitignore", "notes.unknownext", "dir.ts/README"])(
    "%s → plain text",
    (path) => {
      expect(detectLanguage(path)).toBeNull();
    },
  );
});
