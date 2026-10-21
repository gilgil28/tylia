import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "./cn";
import { ProgressRing } from "./ProgressRing";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ghostDanger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 24 / 28 / 32 px tall. */
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export const buttonBase =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control font-medium transition-colors duration-(--dur-fast) ease-(--ease-out) focus-ring disabled:pointer-events-none disabled:opacity-50";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent-fill text-on-accent hover:bg-accent-hover",
  secondary: "border border-line bg-transparent text-fg hover:bg-hover active:bg-active",
  ghost: "text-fg-secondary hover:bg-hover hover:text-fg active:bg-active",
  danger: "bg-danger-fill text-on-accent hover:bg-danger-hover",
  /** A quiet destructive action next to others (e.g. "Discard hunk"). */
  ghostDanger:
    "text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] active:bg-[color-mix(in_srgb,var(--danger)_16%,transparent)]",
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-6 gap-1 px-2 text-small",
  md: "h-7 gap-2 px-3",
  lg: "h-8 gap-2 px-4",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    >
      {loading ? (
        <ProgressRing size={iconSize} />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={1.75} aria-hidden />
      )}
      {children}
    </button>
  );
}
