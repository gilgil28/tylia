import type { LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";

import { cn } from "./cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  segments: Segment<T>[];
  "aria-label": string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  segments,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      className={cn(
        "inline-flex h-7 items-center gap-0.5 rounded-control border border-line-subtle bg-hover p-0.5",
        className,
      )}
      {...aria}
    >
      {segments.map(({ value: v, label, icon: Icon }) => (
        <ToggleGroup.Item
          key={v}
          value={v}
          className="inline-flex h-full items-center gap-1 rounded-badge px-2 whitespace-nowrap text-small font-medium text-fg-secondary transition-colors duration-(--dur-fast) focus-ring hover:text-fg data-[state=on]:bg-elevated data-[state=on]:text-fg data-[state=on]:shadow-[0_0_0_1px_var(--border)]"
        >
          {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
          {label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
