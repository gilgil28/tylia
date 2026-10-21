import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Hunk } from "@/ipc/bindings/Hunk";

import { highlightLines, type HighlightTheme } from "./highlight";
import type { HighlightLang } from "./language";
import { hunkSides, type Side } from "./rows";
import type { Token } from "./segments";

function subscribeToRoot(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

/** The resolved theme on `<html data-theme>`, which changes at runtime. */
export function useDocumentTheme(): HighlightTheme {
  return useSyncExternalStore(subscribeToRoot, () =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
}

export type HunkTokens = Record<Side, Token[][]>;

/** Hunks on either side of the viewport to highlight ahead of scrolling. */
const LOOKAHEAD = 2;

/** What a set of tokens was computed for; any change invalidates them. */
interface Source {
  hunks: readonly Hunk[];
  lang: HighlightLang;
  theme: HighlightTheme;
}

const sameSource = (a: Source | null, b: Source) =>
  a?.hunks === b.hunks && a.lang === b.lang && a.theme === b.theme;

/**
 * Syntax tokens for the hunks around `[first, last]` (hunk indices in view), requested
 * lazily from the worker. Lines render as plain text until their hunk's tokens arrive.
 */
export function useHunkHighlights(
  hunks: readonly Hunk[],
  lang: HighlightLang | null,
  first: number,
  last: number,
): (hunk: number) => HunkTokens | undefined {
  const theme = useDocumentTheme();
  const [results, setResults] = useState<
    (Source & { tokens: ReadonlyMap<number, HunkTokens> }) | null
  >(null);
  const requested = useRef<(Source & { hunkIndices: Set<number> }) | null>(null);

  useEffect(() => {
    if (!lang) return;
    const source: Source = { hunks, lang, theme };
    if (!sameSource(requested.current, source)) {
      requested.current = { ...source, hunkIndices: new Set() };
    }
    const done = requested.current!.hunkIndices;
    const highlight = (lines: string[]) =>
      lines.length > 0 ? highlightLines(lines, lang, theme) : Promise.resolve([]);
    const end = Math.min(hunks.length - 1, last + LOOKAHEAD);
    for (let i = Math.max(0, first - LOOKAHEAD); i <= end; i++) {
      if (done.has(i)) continue;
      done.add(i);
      const sides = hunkSides(hunks[i]!);
      Promise.all([highlight(sides.old), highlight(sides.new)])
        .then(([old, next]) =>
          setResults((prev) => {
            const tokens = new Map(sameSource(prev, source) ? prev!.tokens : []);
            tokens.set(i, { old, new: next });
            return { ...source, tokens };
          }),
        )
        // A hunk that fails to highlight stays plain text.
        .catch(() => {});
    }
  }, [hunks, lang, theme, first, last]);

  return (hunk) =>
    lang && sameSource(results, { hunks, lang, theme }) ? results!.tokens.get(hunk) : undefined;
}
