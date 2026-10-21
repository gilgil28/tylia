/** A small count on a toolbar button (outgoing commits, changed files); nothing at 0. */
export function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className="min-w-4 rounded-full bg-accent-fill px-1 text-center text-caption leading-4 font-semibold text-on-accent tabular-nums"
    >
      {count > 999 ? "999+" : count}
    </span>
  );
}
