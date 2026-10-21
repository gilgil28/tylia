import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("block animate-skeleton rounded-badge bg-active", className)} />
  );
}

const WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-3/4", "w-1/3"];

/** Placeholder list rows shaped like the final rows (dot, text, metadata). */
export function SkeletonRows({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-(--row-h) items-center gap-3 px-2">
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className={cn("h-2.5", WIDTHS[i % WIDTHS.length])} />
          <Skeleton className="ml-auto h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}
