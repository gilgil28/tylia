// Main-thread side of syntax highlighting: Shiki runs in src/workers/highlight.worker.ts,
// created on first use; results are cached so re-renders and theme flips back are instant.

import type { HighlightLang } from "./language";
import type { Token } from "./segments";

export type HighlightTheme = "light" | "dark";

export interface HighlightRequest {
  id: number;
  lines: string[];
  lang: HighlightLang;
  theme: HighlightTheme;
}

export type HighlightResponse = { id: number; tokens: Token[][] } | { id: number; error: string };

/** Map with least-recently-used eviction. */
export class LruCache<K, V> {
  readonly #map = new Map<K, V>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  get(key: K): V | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#capacity) this.#map.delete(this.#map.keys().next().value!);
  }

  delete(key: K): void {
    this.#map.delete(key);
  }
}

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (t: Token[][]) => void; reject: (e: Error) => void }>();
const cache = new LruCache<string, Promise<Token[][]>>(256);

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/highlight.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent<HighlightResponse>) => {
    const request = pending.get(e.data.id);
    if (!request) return;
    pending.delete(e.data.id);
    if ("tokens" in e.data) request.resolve(e.data.tokens);
    else request.reject(new Error(e.data.error));
  };
  return worker;
}

/** Tokenizes consecutive lines of one file as a unit, so multi-line constructs carry over. */
export function highlightLines(
  lines: string[],
  lang: HighlightLang,
  theme: HighlightTheme,
): Promise<Token[][]> {
  const key = `${theme}\0${lang}\0${lines.join("\n")}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const id = nextId++;
  const result = new Promise<Token[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, lines, lang, theme } satisfies HighlightRequest);
  });
  cache.set(key, result);
  // Failures fall back to plain text; let a later render retry.
  result.catch(() => cache.delete(key));
  return result;
}
