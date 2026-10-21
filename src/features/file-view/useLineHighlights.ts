import { useEffect, useRef, useState } from "react";

import { highlightLines, type HighlightTheme } from "@/features/diff/highlight";
import type { HighlightLang } from "@/features/diff/language";
import type { Token } from "@/features/diff/segments";
import { useDocumentTheme } from "@/features/diff/useHighlights";

/** Lines tokenized together; constructs spanning a chunk boundary may start plain. */
const CHUNK = 250;

interface Source {
  lines: readonly string[];
  lang: HighlightLang;
  theme: HighlightTheme;
}

const sameSource = (a: Source | null, b: Source) =>
  a?.lines === b.lines && a.lang === b.lang && a.theme === b.theme;

/**
 * Syntax tokens for a whole file's lines, requested from the highlight worker one chunk at a
 * time around `[first, last]` (line indices in view). Lines render as plain text until their
 * chunk arrives.
 */
export function useLineHighlights(
  lines: readonly string[],
  lang: HighlightLang | null,
  first: number,
  last: number,
): (index: number) => Token[] | undefined {
  const theme = useDocumentTheme();
  const [results, setResults] = useState<
    (Source & { chunks: ReadonlyMap<number, Token[][]> }) | null
  >(null);
  const requested = useRef<(Source & { chunks: Set<number> }) | null>(null);

  useEffect(() => {
    if (!lang || lines.length === 0) return;
    const source: Source = { lines, lang, theme };
    if (!sameSource(requested.current, source)) {
      requested.current = { ...source, chunks: new Set() };
    }
    const done = requested.current!.chunks;
    const from = Math.max(0, Math.floor(first / CHUNK) - 1);
    const to = Math.min(Math.floor((lines.length - 1) / CHUNK), Math.floor(last / CHUNK) + 1);
    for (let chunk = from; chunk <= to; chunk++) {
      if (done.has(chunk)) continue;
      done.add(chunk);
      highlightLines(lines.slice(chunk * CHUNK, (chunk + 1) * CHUNK), lang, theme)
        .then((tokens) =>
          setResults((prev) => {
            const chunks = new Map(sameSource(prev, source) ? prev!.chunks : []);
            chunks.set(chunk, tokens);
            return { ...source, chunks };
          }),
        )
        // A chunk that fails to highlight stays plain text.
        .catch(() => {});
    }
  }, [lines, lang, theme, first, last]);

  return (index) =>
    lang && sameSource(results, { lines, lang, theme })
      ? results!.chunks.get(Math.floor(index / CHUNK))?.[index % CHUNK]
      : undefined;
}
