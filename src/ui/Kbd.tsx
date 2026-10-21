import { platform } from "@/app/boot";
import { shortcutKeys } from "@/app/shortcuts";

import { cn } from "./cn";

interface KbdProps {
  /** Shortcut like `Mod+Shift+K`; `Mod` is ⌘ on macOS and Ctrl elsewhere. */
  shortcut: string;
  className?: string;
}

export function Kbd({ shortcut, className }: KbdProps) {
  return (
    <kbd className={cn("inline-flex items-center gap-0.5 font-ui", className)}>
      {shortcutKeys(shortcut, platform).map((key, i) => [
        i > 0 && " ",
        <span
          key={i}
          className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-badge border border-line bg-hover px-1 text-caption font-medium text-fg-secondary"
        >
          {key}
        </span>,
      ])}
    </kbd>
  );
}
