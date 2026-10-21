import type { LucideIcon } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "./cn";

export const fieldBase =
  "rounded-control border border-line bg-input text-fg transition-[border-color,box-shadow] duration-(--dur-fast) ease-(--ease-out) outline-none placeholder:text-fg-muted hover:border-line-strong focus:border-line-strong focus:shadow-(--focus-ring) disabled:opacity-50";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  icon?: LucideIcon;
  /** 24 px tall instead of 28. */
  compact?: boolean;
  /** Shown inside the right edge, e.g. a compact show/hide IconButton. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ icon: Icon, compact = false, trailing, className, ...props }: InputProps) {
  return (
    <div className={cn("relative flex items-center", className)}>
      {Icon && (
        <Icon
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className="pointer-events-none absolute left-2 text-fg-muted"
        />
      )}
      <input
        spellCheck={false}
        className={cn(
          fieldBase,
          "w-full",
          compact ? "h-6 text-small" : "h-7",
          Icon ? "pl-7" : "pl-2",
          trailing ? "pr-8" : "pr-2",
        )}
        {...props}
      />
      {trailing && <div className="absolute right-0.5 flex items-center">{trailing}</div>}
    </div>
  );
}
