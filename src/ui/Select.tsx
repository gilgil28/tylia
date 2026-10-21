import { Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";

import { cn } from "./cn";
import { fieldBase } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text after the label, e.g. a remote's URL. */
  hint?: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A field-styled dropdown for picking one of a few known values. */
export function Select({
  id,
  value,
  onValueChange,
  options,
  disabled,
  className,
  ...aria
}: SelectProps) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        className={cn(
          fieldBase,
          "flex h-7 w-full items-center justify-between gap-2 px-2 text-left data-[state=open]:border-line-strong",
          className,
        )}
        {...aria}
      >
        <span className="truncate">
          <S.Value />
        </span>
        <S.Icon>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) animate-float-in overflow-hidden rounded-menu bg-elevated p-1 text-fg shadow-float"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex h-7 cursor-default items-center gap-2 rounded-control pr-2 pl-7 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
              >
                <S.ItemIndicator className="absolute left-2 flex items-center">
                  <Check size={14} strokeWidth={2} aria-hidden />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="truncate text-small text-fg-muted">{o.hint}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
