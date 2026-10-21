// Minimize / maximize / close for the custom title bar on Windows and Linux (DESIGN §4.7).
// macOS keeps its native traffic lights, so nothing is drawn there.

import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { t } from "@/i18n";
import { ipc } from "@/ipc";
import { cn } from "@/ui/cn";

import type { Platform } from "./boot";

function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    const refresh = () => void ipc.window.isMaximized().then((m) => alive && setMaximized(m));
    refresh();
    void ipc.window.onResized(refresh).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return maximized;
}

/** Windows 11 caption glyphs, drawn at 10px with 1px strokes. */
function WinGlyph({ kind }: { kind: "min" | "max" | "restore" | "close" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden>
      {kind === "min" && <path d="M0 5.5h10" />}
      {kind === "max" && <rect x="0.5" y="0.5" width="9" height="9" rx="1" />}
      {kind === "restore" && (
        <>
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
          <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
        </>
      )}
      {kind === "close" && <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />}
    </svg>
  );
}

export function WindowControls({ platform }: { platform: Exclude<Platform, "macos"> }) {
  const maximized = useMaximized();
  const actions = [
    { key: "min", label: t("titlebar.minimize"), run: ipc.window.minimize },
    {
      key: maximized ? "restore" : "max",
      label: maximized ? t("titlebar.restore") : t("titlebar.maximize"),
      run: ipc.window.toggleMaximize,
    },
    { key: "close", label: t("titlebar.close"), run: ipc.window.close },
  ] as const;

  if (platform === "windows") {
    return (
      <div className="flex h-full shrink-0">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            tabIndex={-1}
            aria-label={a.label}
            title={a.label}
            onClick={() => void a.run()}
            className={cn(
              "flex h-full w-11.5 items-center justify-center text-fg transition-colors duration-(--dur-fast)",
              a.key === "close"
                ? "hover:bg-(--titlebar-close-hover) hover:text-on-accent"
                : "hover:bg-hover active:bg-active",
            )}
          >
            <WinGlyph kind={a.key} />
          </button>
        ))}
      </div>
    );
  }

  // Linux: GNOME-style round buttons.
  const icons = { min: Minus, max: Square, restore: Copy, close: X };
  return (
    <div className="flex shrink-0 items-center gap-3 pr-2.5 pl-1">
      {actions.map((a) => {
        const Icon = icons[a.key];
        return (
          <button
            key={a.key}
            type="button"
            tabIndex={-1}
            aria-label={a.label}
            title={a.label}
            onClick={() => void a.run()}
            className="flex size-6 items-center justify-center rounded-full bg-hover text-fg transition-colors duration-(--dur-fast) hover:bg-active"
          >
            <Icon size={a.key === "close" ? 14 : 12} strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
