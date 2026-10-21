// Holds a repository's streamed history outside React state (it can be 100k rows); views
// subscribe to a version number with useSyncExternalStore.

import { useEffect, useState, useSyncExternalStore } from "react";

import { SegmentIndex, type Segment } from "@/features/graph/segment-index";
import { ipc, type HistoryRow, type LogOptions } from "@/ipc";

export class HistoryStream {
  rows: HistoryRow[] = [];
  /** Row index by commit id. */
  index = new Map<string, number>();
  /** Straight lane segments of the graph. */
  segments = new SegmentIndex();
  /** All rows have arrived. */
  done = false;
  error: unknown = null;
  version = 0;
  private generation = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** (Re)starts streaming. Old rows stay visible until the first new batch arrives. */
  start(repo: string, options: LogOptions, head: string | null) {
    const generation = ++this.generation;
    let fresh = true;
    const reset = () => {
      if (!fresh) return;
      fresh = false;
      this.rows = [];
      this.index = new Map();
      this.segments.clear();
      this.done = false;
      this.error = null;
    };
    ipc
      .streamHistory(repo, options, head, (event) => {
        if (generation !== this.generation) return;
        reset();
        if (event.kind === "rows") {
          for (const row of event.rows) {
            this.index.set(row.oid, this.rows.length);
            this.rows.push(row);
          }
          this.segments.add(event.segments as Segment[]);
          this.segments.setOpen(event.open as Segment[]);
        } else {
          this.done = true;
        }
        this.emit();
      })
      .catch((err: unknown) => {
        if (generation !== this.generation) return;
        reset();
        this.error = err;
        this.done = true;
        this.emit();
      });
  }

  stop() {
    this.generation++;
  }
}

/**
 * Streams history for `repo` as soon as it mounts (in parallel with loading refs), and
 * restarts when the options change or when `refs` changes after it first loaded (a commit,
 * checkout, fetch…).
 */
export function useHistoryStream(repo: string, options: LogOptions, refs: unknown): HistoryStream {
  const [stream] = useState(() => new HistoryStream());
  // Counts refs changes after the first snapshot (which doesn't restart the stream that
  // is already running). Derived state, updated during render.
  const [seen, setSeen] = useState<{ refs: unknown; restarts: number }>({
    refs: undefined,
    restarts: 0,
  });
  if (refs !== undefined && refs !== seen.refs) {
    setSeen({ refs, restarts: seen.refs === undefined ? 0 : seen.restarts + 1 });
  }
  useEffect(() => {
    stream.start(repo, options, null);
    return () => stream.stop();
    // `options` is compared by value: scope and order are its only fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, repo, options.scope, options.order, seen.restarts]);
  useSyncExternalStore(stream.subscribe, stream.getVersion);
  return stream;
}
