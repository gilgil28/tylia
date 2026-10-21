import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { buttonBase, buttonSizes, buttonVariants, type ButtonVariant } from "./Button";
import { cn } from "./cn";
import { Menu } from "./Menu";
import { Tooltip } from "./Tooltip";

interface SplitButtonProps {
  label: string;
  icon?: LucideIcon;
  /** Replaces the icon, e.g. a ProgressRing while the action runs. */
  leading?: ReactNode;
  /** After the label, e.g. a count badge. */
  trailing?: ReactNode;
  /** Classes for the label, e.g. to hide it visually in a narrow container. */
  labelClassName?: string;
  variant?: ButtonVariant;
  onClick: () => void;
  /** Accessible name of the menu half, e.g. "Pull options". */
  menuLabel: string;
  /** `Menu.Item`s for the dropdown. */
  menu: ReactNode;
  disabled?: boolean;
  /** Disables only the main half (the menu stays usable). */
  mainDisabled?: boolean;
  /** Extra props for the main half (tooltip triggers, popover anchors). */
  mainProps?: Record<string, unknown>;
  mainRef?: Ref<HTMLButtonElement>;
  /** Tooltip for the main half (shown even while it is disabled). */
  tooltip?: ReactNode;
}

/** A default action with a menu of alternatives (e.g. Pull ▾). */
export function SplitButton({
  label,
  icon: Icon,
  leading,
  trailing,
  labelClassName,
  variant = "secondary",
  onClick,
  menuLabel,
  menu,
  disabled,
  mainDisabled,
  mainProps,
  mainRef,
  tooltip,
}: SplitButtonProps) {
  const outlined = variant === "secondary";
  const main = (
    <button
      ref={mainRef}
      type="button"
      disabled={disabled || mainDisabled}
      onClick={onClick}
      {...mainProps}
      className={cn(
        buttonBase,
        buttonVariants[variant],
        buttonSizes.md,
        "rounded-r-none",
        outlined && "border-r-0",
      )}
    >
      {leading ?? (Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />)}
      <span className={labelClassName}>{label}</span>
      {trailing}
    </button>
  );
  return (
    <div className={cn("inline-flex", outlined && "rounded-control")}>
      {tooltip ? (
        // The span keeps the tooltip working while the button is disabled.
        <Tooltip content={tooltip}>
          <span className="inline-flex">{main}</span>
        </Tooltip>
      ) : (
        main
      )}
      <Menu.Root>
        <Menu.Trigger
          disabled={disabled}
          aria-label={menuLabel}
          className={cn(
            buttonBase,
            buttonVariants[variant],
            "h-7 w-6 rounded-l-none data-[state=open]:bg-active",
            variant === "primary" || variant === "danger"
              ? "border-l border-[color-mix(in_srgb,var(--accent-text)_25%,transparent)]"
              : "",
          )}
        >
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
        </Menu.Trigger>
        <Menu.Content align="end">{menu}</Menu.Content>
      </Menu.Root>
    </div>
  );
}
