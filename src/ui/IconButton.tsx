import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name and tooltip text. */
  label: string;
  shortcut?: string;
  /** 28×28 (default) or 24×24 for compact rows. */
  compact?: boolean;
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  compact = false,
  active = false,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <button
        type={type}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-control text-fg-secondary transition-colors duration-(--dur-fast) ease-(--ease-out) focus-ring hover:bg-hover hover:text-fg active:bg-active disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-active data-[state=open]:text-fg",
          compact ? "size-6" : "size-7",
          active && "bg-active text-fg",
          className,
        )}
        {...props}
      >
        <Icon size={compact ? 14 : 16} strokeWidth={1.75} aria-hidden />
      </button>
    </Tooltip>
  );
}
