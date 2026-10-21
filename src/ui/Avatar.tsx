import type { CSSProperties } from "react";

import { cn } from "./cn";

const LANES = 8;

/** Stable 1–8 colour for a person, from their email (or name). */
export function avatarLane(key: string): number {
  let hash = 0;
  for (const ch of key.trim().toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return (hash % LANES) + 1;
}

/** "Ada Lovelace" → "AL", "grace" → "G". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

interface AvatarProps {
  name: string;
  email?: string;
  /** Only when the user opted in to avatars. */
  src?: string;
  size?: 20 | 24 | 32;
  className?: string;
}

const sizes = {
  20: "size-5 text-caption tracking-tight",
  24: "size-6 text-caption",
  32: "size-8 text-small",
};

export function Avatar({ name, email, src, size = 20, className }: AvatarProps) {
  const lane = avatarLane(email ?? name);
  return (
    // Always shown next to the name, so screen readers skip it (no "T Test").
    <span
      aria-hidden
      title={email ? `${name} <${email}>` : name}
      style={{ "--avatar-c": `var(--lane-${lane})` } as CSSProperties}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--avatar-c)_24%,transparent)] font-semibold text-fg",
        sizes[size],
        className,
      )}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
