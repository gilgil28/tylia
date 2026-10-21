import { describe, expect, it } from "vitest";

import { mergeSegments, type Segment } from "./segments";

/** `text` with emphasised runs in brackets and coloured runs as `text:color`. */
function show(segments: Segment[]): string {
  return segments
    .map((s) => {
      const body = s.color ? `${s.text}:${s.color}` : s.text;
      return s.emphasis ? `[${body}]` : body;
    })
    .join("·");
}

describe("mergeSegments", () => {
  const tokens = [
    { content: "let", color: "kw" },
    { content: " y = " },
    { content: "compute", color: "fn" },
    { content: "();" },
  ];

  it("passes tokens through when there is no emphasis", () => {
    expect(show(mergeSegments("let y = compute();", tokens, []))).toBe(
      "let:kw· y = ·compute:fn·();",
    );
  });

  it("splits tokens at emphasis boundaries so both styles apply", () => {
    // Emphasis covers "y = comp".
    expect(show(mergeSegments("let y = compute();", tokens, [[4, 12]]))).toBe(
      "let:kw· ·[y = ]·[comp:fn]·ute:fn·();",
    );
  });

  it("handles several ranges, unsorted and out of bounds", () => {
    expect(
      show(
        mergeSegments("abcdef", undefined, [
          [4, 99],
          [0, 1],
          [2, 2],
        ]),
      ),
    ).toBe("[a]·bcd·[ef]");
  });

  it("keeps italics", () => {
    expect(mergeSegments("// x", [{ content: "// x", color: "c", italic: true }], [])).toEqual([
      { text: "// x", color: "c", italic: true, emphasis: false },
    ]);
  });

  it("falls back to plain text when tokens don't match the line", () => {
    expect(show(mergeSegments("let z", tokens, [[4, 5]]))).toBe("let ·[z]");
  });

  it("returns nothing for an empty line", () => {
    expect(mergeSegments("", [], [[0, 3]])).toEqual([]);
  });

  it("works with UTF-16 offsets", () => {
    // "😀" is two code units.
    expect(show(mergeSegments("a😀b", undefined, [[1, 3]]))).toBe("a·[😀]·b");
  });
});
