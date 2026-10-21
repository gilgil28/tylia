import {
  Check,
  ChevronDown,
  Cloud,
  GitBranch,
  GitBranchPlus,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { create } from "zustand";

import { t } from "@/i18n";
import type { RefsSnapshot, WorkingStatus } from "@/ipc";
import { cn } from "@/ui/cn";
import { Input } from "@/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";

import { useBranchDialog } from "./dialog-store";
import { useBranching } from "./useBranching";

/** The repository whose branch switcher is open. */
export const useSwitcher = create<{ repo: string | null }>(() => ({ repo: null }));

/** Rows shown before the filter is needed. */
const MAX_ROWS = 200;

type Row =
  | { kind: "local"; name: string; current: boolean }
  /** A remote branch no local branch tracks: checking it out creates one. */
  | { kind: "remote"; name: string };

/**
 * The current branch in the toolbar; opens a filterable list to switch branches (Enter
 * takes the first match).
 */
export function BranchSwitcher({
  repo,
  refs,
  status,
}: {
  repo: string;
  refs: RefsSnapshot;
  status: WorkingStatus | undefined;
}) {
  const b = useBranching(repo);
  const openDialog = useBranchDialog((s) => s.open);
  // Open state lives in a store so the "Switch branch…" action can open it.
  const open = useSwitcher((s) => s.repo === repo);
  const setOpen = (o: boolean) => useSwitcher.setState({ repo: o ? repo : null });
  const [filter, setFilter] = useState("");
  const { head } = refs;
  const label = head.branch ?? t("toolbar.detached");
  const busy = !!status?.operation;

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const tracked = new Set(refs.branches.map((x) => x.upstream));
    const locals: Row[] = [...refs.branches]
      .sort((a, c) => Number(c.isHead) - Number(a.isHead) || a.name.localeCompare(c.name))
      .filter((x) => !f || x.name.toLowerCase().includes(f))
      .map((x) => ({ kind: "local", name: x.name, current: x.isHead }));
    // Remote-only branches only while filtering, to keep the list short.
    const remotes: Row[] = f
      ? refs.remotes
          .flatMap((r) => r.branches)
          .filter((x) => !tracked.has(x.fullName) && x.fullName.toLowerCase().includes(f))
          .map((x) => ({ kind: "remote", name: x.fullName }))
      : [];
    return [...locals, ...remotes].slice(0, MAX_ROWS);
  }, [refs, filter]);

  const choose = (row: Row) => {
    setOpen(false);
    setFilter("");
    if (row.kind === "local") {
      if (!row.current) void b.checkout({ kind: "branch", name: row.name });
    } else {
      openDialog(repo, { mode: "checkoutRemote", remoteBranch: row.name });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && rows[0]) {
      e.preventDefault();
      choose(rows[0]);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFilter("");
      }}
    >
      <PopoverTrigger
        className="flex h-7 min-w-0 items-center gap-2 rounded-control px-1.5 focus-ring hover:bg-hover data-[state=open]:bg-active"
        aria-label={t("switcher.label", { name: label })}
      >
        {head.branch ? (
          <GitBranch size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent" />
        ) : (
          <TriangleAlert
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-warning"
          />
        )}
        <span className="truncate font-medium text-fg" title={label}>
          {head.oid ? label : `${label} · ${t("toolbar.unborn")}`}
        </span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2 p-2">
        <Input
          icon={Search}
          compact
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("switcher.filter")}
          aria-label={t("switcher.filter")}
          autoFocus
        />
        <div
          role="listbox"
          aria-label={t("switcher.branches")}
          className="flex max-h-80 flex-col overflow-y-auto"
        >
          {rows.length === 0 && (
            <p className="px-2 py-1.5 text-small text-fg-muted">{t("switcher.none")}</p>
          )}
          {rows.map((row) => (
            <button
              key={`${row.kind}:${row.name}`}
              type="button"
              role="option"
              aria-selected={row.kind === "local" && row.current}
              disabled={busy && !(row.kind === "local" && row.current)}
              onClick={() => choose(row)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-2 rounded-control px-2 text-left focus-ring hover:bg-hover disabled:opacity-50",
                row.kind === "local" && row.current && "font-medium text-fg",
              )}
            >
              {row.kind === "remote" ? (
                <Cloud
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden
                  className="shrink-0 text-fg-muted"
                />
              ) : row.current ? (
                <Check size={14} strokeWidth={2} aria-hidden className="shrink-0 text-accent" />
              ) : (
                <GitBranch
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden
                  className="shrink-0 text-fg-muted"
                />
              )}
              <span className="truncate">{row.name}</span>
            </button>
          ))}
        </div>
        <div className="-mx-2 h-px bg-line-subtle" />
        <button
          type="button"
          disabled={!head.oid}
          onClick={() => {
            setOpen(false);
            openDialog(repo, { mode: "createBranch", start: "HEAD", startLabel: label });
          }}
          className="flex h-7 items-center gap-2 rounded-control px-2 text-left focus-ring hover:bg-hover disabled:opacity-50"
        >
          <GitBranchPlus
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-fg-muted"
          />
          {t("switcher.newBranch")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
