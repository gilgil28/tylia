// Folders opened from outside the window in browser mode. `?open=<path>` (repeatable) acts
// as the launch's command line; Playwright (or the console) simulates a later launch with
// `window.__tyliaOpen.launch([path, …])`.

import type { Backend } from "../backend";

export interface MockOpenRequests {
  /** Whether the UI is listening for open requests yet. */
  listening(): boolean;
  /** As if `tylia <paths…>` ran while the window is open. */
  launch(paths: string[]): void;
}

declare global {
  interface Window {
    __tyliaOpen?: MockOpenRequests;
  }
}

const handlers = new Set<() => void>();
let queue = new URLSearchParams(location.search).getAll("open");

window.__tyliaOpen = {
  listening: () => handlers.size > 0,
  launch: (paths) => {
    queue.push(...paths);
    for (const handler of handlers) handler();
  },
};

export const openRequestsMock: Pick<Backend, "takeOpenRequests" | "onOpenRequested"> = {
  takeOpenRequests: async () => {
    const paths = queue;
    queue = [];
    return paths;
  },
  onOpenRequested: async (handler) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },
};
