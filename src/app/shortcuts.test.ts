import { describe, expect, it } from "vitest";

import { shortcutKeys } from "./shortcuts";

describe("shortcutKeys", () => {
  it("uses symbols on macOS", () => {
    expect(shortcutKeys("Mod+Shift+K", "macos")).toEqual(["⌘", "⇧", "K"]);
    expect(shortcutKeys("Mod+Enter", "macos")).toEqual(["⌘", "↵"]);
  });

  it("maps Mod to Ctrl elsewhere", () => {
    expect(shortcutKeys("Mod+K", "windows")).toEqual(["Ctrl", "K"]);
    expect(shortcutKeys("Mod+Shift+B", "linux")).toEqual(["Ctrl", "Shift", "B"]);
  });
});
