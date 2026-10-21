import { t } from "@/i18n";

import { cn } from "./cn";

interface ProgressRingProps {
  /** 0–1; omit for an indeterminate spinner. */
  value?: number;
  size?: 12 | 14 | 16 | 20;
  className?: string;
}

const STROKE = 2;

export function ProgressRing({ value, size = 16, className }: ProgressRingProps) {
  const r = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const indeterminate = value === undefined;
  const filled = indeterminate ? 0.25 : Math.min(1, Math.max(0, value));
  return (
    <svg
      role="progressbar"
      aria-label={t("common.loading")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(filled * 100)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", indeterminate && "animate-spin", className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={STROKE}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
