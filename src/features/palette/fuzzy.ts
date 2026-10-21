// Fuzzy matching for the command palette: the query's characters must appear in order;
// matches at word starts and runs of consecutive characters rank higher.

export interface FuzzyMatch {
  score: number;
  /** Indices in the text of the matched characters (for highlighting). */
  indices: number[];
}

const isBoundary = (text: string, i: number) => {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  const cur = text[i]!;
  return /[\s\-_./:]/.test(prev) || (prev === prev.toLowerCase() && cur !== cur.toLowerCase());
};

/** Scores `text` against `query` (case-insensitive); `null` if it doesn't match. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const lower = text.toLowerCase();

  // A contiguous match beats any scattered one; earlier and at a word start is better.
  const at = lower.indexOf(q);
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: 100 + (isBoundary(text, at) ? 20 : 0) - at, indices };
  }

  // Two greedy passes: earliest occurrences, and next word-start occurrences (which can skip
  // past characters a later query letter needs). The better match wins.
  const earliest = subsequence(q, text, lower, false);
  const wordStarts = subsequence(q, text, lower, true);
  if (!earliest) return wordStarts;
  if (!wordStarts) return earliest;
  return wordStarts.score > earliest.score ? wordStarts : earliest;
}

function subsequence(
  q: string,
  text: string,
  lower: string,
  preferWordStarts: boolean,
): FuzzyMatch | null {
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    let found = -1;
    for (let i = from; i < lower.length; i++) {
      if (lower[i] !== ch) continue;
      if (found < 0) found = i;
      if (!preferWordStarts || isBoundary(text, i)) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    const prev = indices[indices.length - 1];
    score += isBoundary(text, found) ? 8 : 1;
    if (prev !== undefined && found === prev + 1) score += 4;
    if (prev !== undefined) score -= Math.min(3, found - prev - 1);
    indices.push(found);
    from = found + 1;
  }
  return { score, indices };
}
