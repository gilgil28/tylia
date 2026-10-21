import { Check, Minus } from "lucide-react";
import { Checkbox as C } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "./cn";

interface CheckboxProps {
  checked: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /**
   * Mouse-only: out of the tab order and hidden from assistive tech, for a checkbox inside a
   * row (an option or tab) that offers the same action from the keyboard.
   */
  presentational?: boolean;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  presentational = false,
  ...aria
}: CheckboxProps) {
  const id = useId();
  if (presentational) {
    return (
      <span
        aria-hidden
        data-state={checked === true ? "checked" : checked ? "indeterminate" : "unchecked"}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onCheckedChange?.(checked !== true);
        }}
        className={cn(
          "flex size-4 shrink-0 cursor-default items-center justify-center rounded-badge border border-line-strong bg-input text-on-accent transition-colors duration-(--dur-fast) hover:border-fg-muted data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill data-[state=indeterminate]:border-accent-fill data-[state=indeterminate]:bg-accent-fill",
          disabled && "opacity-50",
          className,
        )}
      >
        {checked === "indeterminate" ? (
          <Minus size={12} strokeWidth={2.5} />
        ) : checked ? (
          <Check size={12} strokeWidth={2.5} />
        ) : null}
      </span>
    );
  }
  return (
    <div className={cn("inline-flex items-center gap-2", disabled && "opacity-50", className)}>
      <C.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange?.(value === true)}
        className="flex size-4 shrink-0 items-center justify-center rounded-badge border border-line-strong bg-input text-on-accent transition-colors duration-(--dur-fast) focus-ring hover:border-fg-muted data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill data-[state=indeterminate]:border-accent-fill data-[state=indeterminate]:bg-accent-fill"
        {...aria}
      >
        <C.Indicator>
          {checked === "indeterminate" ? (
            <Minus size={12} strokeWidth={2.5} aria-hidden />
          ) : (
            <Check size={12} strokeWidth={2.5} aria-hidden />
          )}
        </C.Indicator>
      </C.Root>
      {label && (
        <label htmlFor={id} className="text-fg">
          {label}
        </label>
      )}
    </div>
  );
}
