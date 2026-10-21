import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Replaces the icon (e.g. the logo on the welcome screen). */
  art?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  art,
  title,
  description,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center", className)}
    >
      {art ??
        (Icon && (
          <span className="flex size-10 items-center justify-center rounded-full bg-hover text-fg-secondary">
            <Icon size={20} strokeWidth={1.75} aria-hidden />
          </span>
        ))}
      <div className="flex max-w-96 flex-col gap-1">
        <h2 className="text-title font-medium text-fg">{title}</h2>
        {description && <p className="text-fg-secondary">{description}</p>}
      </div>
      {actions && <div className="mt-1 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
