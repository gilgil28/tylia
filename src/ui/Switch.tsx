import { Switch as S } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "./cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("inline-flex items-center gap-2", disabled && "opacity-50", className)}>
      <S.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-(--dur-fast) ease-(--ease-out) focus-ring data-[state=checked]:bg-accent-fill"
      >
        <S.Thumb className="block size-3 translate-x-0.5 rounded-full bg-on-accent shadow-float transition-transform duration-(--dur-fast) ease-(--ease-out) data-[state=checked]:translate-x-3.5" />
      </S.Root>
      {label && (
        <label htmlFor={id} className="text-fg">
          {label}
        </label>
      )}
    </div>
  );
}
