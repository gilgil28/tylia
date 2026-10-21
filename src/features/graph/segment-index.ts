// Finds the straight lane segments (from Rust: `[lane, color, start, end]` in half rows)
// that overlap the visible window, without scanning all of them.

export type Segment = [number, number, number, number];

/** Rows per bucket. A segment is listed in every bucket it overlaps. */
const BUCKET_ROWS = 64;
const BUCKET = BUCKET_ROWS * 2;

export class SegmentIndex {
  private buckets: Segment[][] = [];
  /** Segments still growing at the end of the loaded rows; replaced by each batch. */
  private open: Segment[] = [];

  add(segments: Segment[]) {
    for (const s of segments) {
      const last = Math.floor(Math.max(s[2], s[3] - 1) / BUCKET);
      for (let b = Math.floor(s[2] / BUCKET); b <= last; b++) {
        (this.buckets[b] ??= []).push(s);
      }
    }
  }

  setOpen(open: Segment[]) {
    this.open = open;
  }

  clear() {
    this.buckets = [];
    this.open = [];
  }

  /** Segments overlapping half rows `[from, to)`. */
  query(from: number, to: number): Segment[] {
    const seen = new Set<Segment>();
    const out: Segment[] = [];
    const take = (s: Segment) => {
      if (s[2] < to && s[3] > from && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    };
    const last = Math.floor(Math.max(from, to - 1) / BUCKET);
    for (let b = Math.floor(from / BUCKET); b <= last; b++) {
      for (const s of this.buckets[b] ?? []) take(s);
    }
    for (const s of this.open) take(s);
    return out;
  }
}
