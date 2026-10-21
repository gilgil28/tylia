import { X, type LucideIcon } from "lucide-react";
import type { HTMLAttributes } from "react";

import { t } from "@/i18n";

import { cn } from "./cn";

interface RepoTabProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  label: string;
  icon?: LucideIcon;
  active?: boolean;
  /** Uncommitted changes: shows a dot where the close button sits until hovered. */
  dirty?: boolean;
  onSelect?: () => void;
  onClose?: () => void;
}

/**
 * A repository tab in the title bar. Spread drag props on it to make it reorderable. The
 * `role="tab"` element and the close button are siblings (a tab may not contain controls);
 * the outer element carries the look and `data-tab` for the strip.
 */
export function RepoTab({
  label,
  icon: Icon,
  active = false,
  dirty = false,
  onSelect,
  onClose,
  className,
  title,
  ...props
}: RepoTabProps) {
  return (
    <div
      data-tab
      onAuxClick={(e) => e.button === 1 && onClose?.()}
      className={cn(
        "group/tab relative flex h-7 max-w-52 min-w-0 shrink-0 items-center overflow-hidden rounded-control pr-1 transition-colors duration-(--dur-fast)",
        "has-[[role=tab]:focus-visible]:shadow-(--focus-ring)",
        // Active: lifted off the darker strip (--bg-tab-active), a visible edge, an accent bar
        // on top, medium text. Inactive tabs only get a light hover.
        active
          ? "bg-tab-active font-medium text-fg shadow-[0_0_0_1px_var(--border)] before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-accent"
          : "text-fg-secondary hover:bg-hover hover:text-fg",
        className,
      )}
      {...props}
    >
      <div
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={title ?? label}
        onClick={onSelect}
        onKeyDown={(e) => e.key === "Enter" && onSelect?.()}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 outline-none"
      >
        {Icon && (
          <Icon
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className={cn("shrink-0", active ? "text-accent" : "opacity-80")}
          />
        )}
        <span className="truncate">{label}</span>
      </div>
      <span className="relative ml-2 flex size-5 shrink-0 items-center justify-center">
        {dirty && <span className="size-1.5 rounded-full bg-fg-secondary group-hover/tab:hidden" />}
        {onClose && (
          // Mouse-only (a tab list may contain only tabs): Mod+W and middle-click close too.
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            aria-label={t("titlebar.closeTab", { name: label })}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-badge text-fg-muted focus-ring hover:bg-active hover:text-fg",
              active && !dirty
                ? "opacity-100"
                : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
            )}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        )}
      </span>
    </div>
  );
}
