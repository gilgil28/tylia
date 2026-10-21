import { describe, expect, it } from "vitest";

import type { DiffLine } from "@/ipc/bindings/DiffLine";
import type { Hunk } from "@/ipc/bindings/Hunk";

import {
  hunkSides,
  lineNumberDigits,
  lineRowHeight,
  numberColumns,
  splitRows,
  unchangedBefore,
  unifiedRows,
  widestLine,
  type DiffRow,
} from "./rows";

/** Builds a hunk from `" ctx"`, `"-del"`, `"+add"` lines, numbering them like Git. */
function hunk(oldStart: number, newStart: number, lines: string[], heading = ""): Hunk {
  let o = oldStart;
  let n = newStart;
  const parsed: DiffLine[] = lines.map((raw) => {
    const kind = raw[0] === "+" ? "add" : raw[0] === "-" ? "del" : "context";
    return {
      kind,
      oldLine: kind === "add" ? null : o++,
      newLine: kind === "del" ? null : n++,
      text: raw.slice(1),
      noNewline: false,
      emphasis: [],
    };
  });
  return {
    heading,
    oldStart,
    oldLines: o - oldStart,
    newStart,
    newLines: n - newStart,
    lines: parsed,
  };
}

/** Compact picture of rows: `gap:N`, `@@`, `+text`, `old|new`. */
function describeRows(rows: DiffRow[]): string[] {
  const mark = { add: "+", del: "-", context: " " } as const;
  return rows.map((row) => {
    switch (row.kind) {
      case "gap":
        return `gap:${row.count}`;
      case "hunk":
        return "@@";
      case "line":
        return `${mark[row.cell.line.kind]}${row.cell.line.text}`;
      case "pair":
        return `${row.old ? row.old.line.text : "·"}|${row.new ? row.new.line.text : "·"}`;
    }
  });
}

describe("unchangedBefore", () => {
  it("counts lines before the first hunk", () => {
    expect(unchangedBefore([hunk(1, 1, [" a", "-b"])], 0)).toBe(0);
    expect(unchangedBefore([hunk(10, 10, [" a", "-b"])], 0)).toBe(9);
  });

  it("counts lines between hunks on the new side", () => {
    // First hunk covers new lines 3–5, second starts at new line 12: 6–11 are hidden.
    const hunks = [hunk(3, 3, [" a", "-b", "+c", " d"]), hunk(11, 12, [" e", "+f", " g"])];
    expect(unchangedBefore(hunks, 1)).toBe(6);
  });

  it("handles zero-length ranges, which name the line before the change", () => {
    // `@@ -5,2 +4,0 @@`: old lines 5–6 deleted after new line 4.
    const deletion: Hunk = { ...hunk(5, 4, ["-x", "-y"]), newStart: 4, newLines: 0 };
    // `@@ -20,0 +19,2 @@`: two lines inserted after new line 18.
    const insertion: Hunk = { ...hunk(20, 19, ["+p", "+q"]), oldStart: 20, oldLines: 0 };
    expect(unchangedBefore([deletion], 0)).toBe(4);
    expect(unchangedBefore([deletion, insertion], 1)).toBe(14);
  });

  it("is zero for adjacent hunks and out-of-range indices", () => {
    expect(unchangedBefore([hunk(1, 1, [" a"]), hunk(2, 2, [" b"])], 1)).toBe(0);
    expect(unchangedBefore([], 0)).toBe(0);
  });
});

describe("unifiedRows", () => {
  it("adds gap and header rows around each hunk's lines", () => {
    const hunks = [hunk(4, 4, [" a", "-b", "+c"]), hunk(20, 20, ["+d", " e"])];
    expect(describeRows(unifiedRows(hunks))).toEqual([
      "gap:3",
      "@@",
      " a",
      "-b",
      "+c",
      "gap:14",
      "@@",
      "+d",
      " e",
    ]);
  });

  it("indexes each line into its side's text", () => {
    const h = hunk(1, 1, [" a", "-b", "+c", " d"]);
    const sides = hunkSides(h);
    expect(sides).toEqual({ old: ["a", "b", "d"], new: ["a", "c", "d"] });
    const cells = unifiedRows([h]).flatMap((row) => (row.kind === "line" ? [row.cell] : []));
    for (const cell of cells) expect(sides[cell.side][cell.index]).toBe(cell.line.text);
    // Context reads from the new side, removals from the old.
    expect(cells.map((c) => `${c.side}${c.index}`)).toEqual(["new0", "old1", "new1", "new2"]);
    expect(cells.map((c) => c.lineIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe("splitRows", () => {
  it("pairs removals with additions in order and leaves the rest facing empty cells", () => {
    const h = hunk(1, 1, [" a", "-b1", "-b2", "-b3", "+c1", " d", "+e1", "+e2", "-f1"]);
    expect(describeRows(splitRows([h]))).toEqual([
      "@@",
      "a|a",
      "b1|c1",
      "b2|·",
      "b3|·",
      "d|d",
      "f1|e1",
      "·|e2",
    ]);
  });

  it("puts context on both sides with matching side indices", () => {
    const h = hunk(1, 1, ["-x", " a"]);
    const pairs = splitRows([h]).filter((row) => row.kind === "pair");
    expect(pairs[1]).toMatchObject({
      old: { side: "old", index: 1 },
      new: { side: "new", index: 0 },
    });
  });
});

describe("numberColumns", () => {
  it("drops the column a whole-file addition or deletion doesn't have", () => {
    const addedFile: Hunk = { ...hunk(1, 1, ["+a", "+b"]), oldStart: 0 };
    const deletedFile: Hunk = { ...hunk(1, 1, ["-a"]), newStart: 0 };
    expect(numberColumns([hunk(1, 1, [" a", "+b"])])).toEqual(["old", "new"]);
    expect(numberColumns([addedFile])).toEqual(["new"]);
    expect(numberColumns([deletedFile])).toEqual(["old"]);
  });
});

describe("lineNumberDigits", () => {
  it("fits the largest line number on either side", () => {
    expect(lineNumberDigits([])).toBe(1);
    expect(lineNumberDigits([hunk(1, 1, [" a"])])).toBe(1);
    expect(
      lineNumberDigits([
        hunk(95, 990, [" a", " b", " c", "+d", "+e", "+f", "+g", "+h", "+i", "+j", "+k"]),
      ]),
    ).toBe(4);
  });
});

describe("widestLine", () => {
  it("expands tabs and respects the side", () => {
    const h = hunk(1, 1, ["-\t\tx", "+abcdefg", " ab"]);
    expect(widestLine([h], "both")).toBe("\t\tx");
    expect(widestLine([h], "new")).toBe("abcdefg");
    expect(widestLine([h], "old")).toBe("\t\tx");
  });
});

describe("lineRowHeight", () => {
  it("rounds 1.6 × the diff font size to whole pixels", () => {
    expect(lineRowHeight(12.5)).toBe(20);
    expect(lineRowHeight(14.42)).toBe(23);
  });
});
