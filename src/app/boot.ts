import type { BootInfo, Distribution } from "@/ipc";

export type Platform = "windows" | "macos" | "linux";

declare global {
  interface Window {
    /** Set by Rust (window.rs) or, in browser mode, by public/boot.js. */
    __TYLIA_BOOT__: BootInfo;
  }
}

export const boot: BootInfo = window.__TYLIA_BOOT__;

export const platform: Platform =
  boot.platform === "macos" || boot.platform === "windows" ? boot.platform : "linux";

/** How this copy is updated: a Flatpak by Flathub, a pacman package by pacman, else Tylia. */
export const distribution: Distribution = boot.distribution;

/** Tylia's version, from package.json. */
export const appVersion: string = import.meta.env.VITE_APP_VERSION;
