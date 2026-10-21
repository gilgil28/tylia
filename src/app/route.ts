import { useSyncExternalStore } from "react";

export type Route = "start" | "gallery";

/** The component gallery is a development page: not routed in release builds. */
export const galleryEnabled = import.meta.env.DEV || import.meta.env.MODE === "web";

function current(): Route {
  return galleryEnabled && location.hash.startsWith("#/gallery") ? "gallery" : "start";
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, current);
}
