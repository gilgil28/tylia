/** One syntax token from the highlight worker; `color` is absent for the theme's plain text. */
export interface Token {
  content: string;
  color?: string;
  italic?: boolean;
}

/** A run of a line that renders with one style. */
export interface Segment {
  text: string;
  color?: string;
  italic?: boolean;
  /** Inside a word-level change range. */
  emphasis: boolean;
}

/**
 * Splits a line into styled runs: syntax tokens cut at word-emphasis boundaries, so both
 * apply. Tokens that don't reproduce `text` exactly (stale or truncated) are ignored.
 */
export function mergeSegments(
  text: string,
  tokens: readonly Token[] | undefined,
  emphasis: readonly (readonly [number, number])[],
): Segment[] {
  if (text.length === 0) return [];
  const usable = tokens && tokens.map((tok) => tok.content).join("") === text;
  const runs: readonly Token[] = usable ? tokens : [{ content: text }];
  const ranges = emphasis
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)] as const)
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0]);

  const out: Segment[] = [];
  let pos = 0;
  let r = 0;
  for (const tok of runs) {
    const end = pos + tok.content.length;
    while (pos < end) {
      while (r < ranges.length && ranges[r]![1] <= pos) r++;
      const range = ranges[r];
      const inside = range !== undefined && range[0] <= pos;
      const cut = inside ? Math.min(range[1], end) : Math.min(range?.[0] ?? end, end);
      out.push({
        text: text.slice(pos, cut),
        color: tok.color,
        italic: tok.italic,
        emphasis: inside,
      });
      pos = cut;
    }
  }
  return out;
}
