import type { CSSProperties, ReactNode } from "react";

import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "success" | "danger" | "warning" | "info";

const toneColor: Record<BadgeTone, string> = {
  neutral: "var(--text-secondary)",
  accent: "var(--accent)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
};

/** Small tinted pill for counts and statuses. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      style={{ "--badge-c": toneColor[tone] } as CSSProperties}
      className={cn(
        "inline-flex h-4.5 shrink-0 items-center rounded-badge bg-[color-mix(in_srgb,var(--badge-c)_14%,transparent)] px-1.5 text-caption font-medium text-[color-mix(in_srgb,var(--badge-c)_62%,var(--text))] tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}
