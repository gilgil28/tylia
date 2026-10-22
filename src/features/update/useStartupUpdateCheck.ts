import { useEffect } from "react";

import { distribution } from "@/app/boot";
import { useSettings } from "@/app/settings";

import { useUpdate } from "./update";

/** Lets startup settle before the network request. */
const START_DELAY_MS = 5000;

/** With "Check for updates" on, checks once per run, a few seconds after start (never in a
 * Flatpak: Flathub updates it). */
export function useStartupUpdateCheck() {
  const enabled = useSettings((s) => s.settings.checkForUpdates) && distribution !== "flatpak";
  useEffect(() => {
    if (!enabled || useUpdate.getState().status.kind !== "idle") return;
    const id = setTimeout(() => void useUpdate.getState().check("start"), START_DELAY_MS);
    return () => clearTimeout(id);
  }, [enabled]);
}
