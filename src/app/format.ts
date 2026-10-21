import { t } from "@/i18n";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const clock = new Intl.DateTimeFormat("en", { timeStyle: "short" });
const shortDate = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday"; dates older than a year show as "12 Mar 2024". */
export function relativeTime(epochSeconds: number, now = Date.now()): string {
  const diff = Math.round(now / 1000 - epochSeconds);
  if (diff < 60) return t("time.justNow");
  if (diff >= 365 * 24 * 3600) return shortDate.format(epochSeconds * 1000);
  for (const [unit, seconds] of UNITS) {
    if (diff >= seconds) return relative.format(-Math.floor(diff / seconds), unit);
  }
  return t("time.justNow");
}

export function absoluteTime(epochSeconds: number): string {
  return absolute.format(epochSeconds * 1000);
}

/** The time of day of a `Date.now()` value, e.g. "1:53 PM". */
export function clockTime(ms: number): string {
  return clock.format(ms);
}

/** A time as the date-format setting wants it, with the other form for a tooltip. */
export function timeLabel(
  epochSeconds: number,
  format: "relative" | "absolute",
): { text: string; title: string } {
  return format === "absolute"
    ? { text: absoluteTime(epochSeconds), title: relativeTime(epochSeconds) }
    : { text: relativeTime(epochSeconds), title: absoluteTime(epochSeconds) };
}

/**
 * Shortens a path in the middle, keeping the first segment and the file name:
 * `src/features/history/rows/Row.tsx` → `src/…/rows/Row.tsx` within `max` characters.
 */
export function middleEllipsis(path: string, max: number): string {
  if (path.length <= max) return path;
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(sep);
  const name = parts.pop() ?? path;
  const head = parts.shift();
  if (head === undefined || name.length + head.length + 2 > max) {
    // Even "head/…/name" doesn't fit: cut the middle of the string itself.
    const keep = Math.max(1, max - 1);
    const left = Math.ceil(keep / 2);
    return `${path.slice(0, left)}…${path.slice(path.length - (keep - left))}`;
  }
  const tail: string[] = [name];
  let length = head.length + 3 + name.length;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (length + part.length + 1 > max) break;
    tail.unshift(part);
    length += part.length + 1;
  }
  return tail.length === parts.length + 1 ? path : [head, "…", ...tail].join(sep);
}

export const shortHash = (oid: string) => oid.slice(0, 7);
