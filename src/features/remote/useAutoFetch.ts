import { useEffect } from "react";

import { useSettings } from "@/app/settings";

import { fetchRepo } from "./operations";

/** The first background fetch waits a little, so opening a repository stays fast. */
const FIRST_FETCH_MS = 15_000;

/**
 * Background fetch for an open repository, every `autoFetchMinutes` (off by default). Quiet:
 * it never shows a credential prompt, and a failure is reported once.
 */
export function useAutoFetch(repo: string, hasRemotes: boolean) {
  const minutes = useSettings((s) => s.settings.autoFetchMinutes);
  useEffect(() => {
    if (!minutes || !hasRemotes) return;
    const tick = () => {
      if (!document.hidden) void fetchRepo(repo, { background: true });
    };
    const first = setTimeout(tick, FIRST_FETCH_MS);
    const every = setInterval(tick, minutes * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [repo, minutes, hasRemotes]);
}
