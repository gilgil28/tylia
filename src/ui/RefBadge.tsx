import {
  Archive,
  Check,
  Cloud,
  GitBranch,
  Tag,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { t } from "@/i18n";

import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export type RefKind = "local" | "remote" | "tag" | "head" | "stash";

export interface RefInfo {
  kind: RefKind;
  name: string;
  /** Graph lane colour 1–8 of the commit the ref points to. */
  lane?: number;
  /** The checked-out branch. */
  current?: boolean;
  /** For a local branch whose upstream points at the same commit: the remote name. */
  syncedRemote?: string;
}

const icons: Record<RefKind, LucideIcon> = {
  local: GitBranch,
  remote: Cloud,
  tag: Tag,
  head: TriangleAlert,
  stash: Archive,
};

function badgeColor({ kind, lane = 1 }: RefInfo): string {
  if (kind === "tag" || kind === "stash") return "var(--lane-8)";
  if (kind === "head") return "var(--warning)";
  return `var(--lane-${lane})`;
}

/** A ref label in the history (docs/DESIGN.md §4.10). */
export function RefBadge({ refInfo, className }: { refInfo: RefInfo; className?: string }) {
  const { kind, name, current, syncedRemote } = refInfo;
  const Icon = current ? Check : icons[kind];
  return (
    <span
      style={{ "--badge-c": badgeColor(refInfo) } as CSSProperties}
      data-ref-kind={kind}
      data-ref-name={name}
      data-ref-current={current || undefined}
      title={syncedRemote ? `${name} ⇄ ${syncedRemote}/${name}` : name}
      className={cn(
        "inline-flex h-4.5 max-w-48 shrink-0 items-center gap-1 rounded-badge border px-1.5 text-caption font-medium",
        current
          ? "border-transparent bg-accent-fill text-on-accent"
          : kind === "remote"
            ? "border-[color-mix(in_srgb,var(--badge-c)_40%,transparent)] text-fg-secondary"
            : kind === "stash"
              ? "border-dashed border-[color-mix(in_srgb,var(--badge-c)_60%,transparent)] text-fg-secondary"
              : "border-[color-mix(in_srgb,var(--badge-c)_40%,transparent)] bg-[color-mix(in_srgb,var(--badge-c)_14%,transparent)] text-fg",
        className,
      )}
    >
      <Icon
        size={12}
        strokeWidth={2}
        aria-hidden
        className={cn("shrink-0", !current && "text-(--badge-c)")}
      />
      <span className="truncate">{kind === "head" ? t("refs.head") : name}</span>
      {syncedRemote && (
        <span className={cn("shrink-0", current ? "opacity-80" : "text-fg-muted")}>
          ⇄ {syncedRemote}
        </span>
      )}
    </span>
  );
}

const MAX_VISIBLE = 3;

/** Up to three badges, then a `+n` chip that lists the rest. */
export function RefBadgeList({ refs, className }: { refs: RefInfo[]; className?: string }) {
  const visible = refs.slice(0, MAX_VISIBLE);
  const hidden = refs.slice(MAX_VISIBLE);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {visible.map((r) => (
        <RefBadge key={`${r.kind}:${r.name}`} refInfo={r} />
      ))}
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger
            aria-label={t("refs.moreRefs", { count: hidden.length })}
            className="inline-flex h-4.5 shrink-0 items-center rounded-badge border border-line px-1.5 text-caption font-medium text-fg-secondary focus-ring hover:bg-hover"
          >
            {t("common.more", { count: hidden.length })}
          </PopoverTrigger>
          <PopoverContent className="flex max-w-80 flex-col items-start gap-1 p-2">
            {hidden.map((r) => (
              <RefBadge key={`${r.kind}:${r.name}`} refInfo={r} />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
