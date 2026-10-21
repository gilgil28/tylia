import { useEffect } from "react";

import { openRepoAt } from "@/features/welcome/open";
import { ipc } from "@/ipc";

/**
 * Opens, as tabs, the folders handed to Tylia from outside: `tylia <path>`, a second launch
 * (which only focuses this window), or a file manager's "Open in Tylia". Folders inside a
 * repository open that repository; anything else shows the usual "not a repository" toast.
 */
export function useOpenRequests() {
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    // One at a time, in order, so the last folder ends up as the active tab. Taken paths are
    // always opened, even if this component unmounts meanwhile: the queue is already empty.
    let draining = Promise.resolve();
    const drain = () => {
      draining = draining.then(async () => {
        for (const path of await ipc.takeOpenRequests()) await openRepoAt(path);
      });
    };
    void ipc.onOpenRequested(drain).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    // Requests from this launch's command line, or sent before the listener was ready.
    drain();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
}
