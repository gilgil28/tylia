import { useQuery } from "@tanstack/react-query";
import {
  CloudDownload,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LayoutGrid,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useOverlays } from "@/app/overlays";

import { revealLabel } from "@/app/labels";
import { middleEllipsis, relativeTime } from "@/app/format";
import { GitStatusLine } from "@/app/GitStatusLine";
import { Logo } from "@/app/Logo";
import { galleryEnabled } from "@/app/route";
import { useWorkspace, type RecentRepo } from "@/app/workspace";
import { t } from "@/i18n";
import { ipc } from "@/ipc";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { Input } from "@/ui/Input";
import { Kbd } from "@/ui/Kbd";

import { CloneDialog } from "./CloneDialog";
import { CreateDialog } from "./CreateDialog";
import { openRepoAt, pickAndOpenRepo } from "./open";

function ActionCard({
  icon: Icon,
  title,
  hint,
  shortcut,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-menu border border-line-subtle bg-panel p-4 text-left transition-colors duration-(--dur-fast) focus-ring hover:border-line hover:bg-hover"
    >
      <span className="flex w-full items-center justify-between">
        <span className="flex size-8 items-center justify-center rounded-control bg-hover text-fg-secondary group-hover:text-fg">
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </span>
        {shortcut && <Kbd shortcut={shortcut} />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-fg">{title}</span>
        <span className="text-small text-fg-secondary">{hint}</span>
      </span>
    </button>
  );
}

function RecentRow({ repo }: { repo: RecentRepo }) {
  const removeRecent = useWorkspace((s) => s.removeRecent);
  const branch = useQuery({
    queryKey: ["repo-branch", repo.path],
    queryFn: () => ipc.repoBranch(repo.path),
    retry: false,
    staleTime: 60_000,
  });
  const missing = branch.isError;
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => void openRepoAt(repo.path)}
        title={repo.path}
        className="flex h-12 w-full items-center gap-3 rounded-control px-3 text-left focus-ring hover:bg-hover"
      >
        <FolderGit2
          size={16}
          strokeWidth={1.75}
          aria-hidden
          className={cn("shrink-0", missing ? "text-fg-muted" : "text-fg-secondary")}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate font-medium", missing ? "text-fg-muted" : "text-fg")}>
            {repo.name}
          </span>
          <span className="truncate text-small text-fg-muted">{middleEllipsis(repo.path, 64)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-small text-fg-secondary group-hover:invisible group-focus-within:invisible">
          {missing ? (
            <Badge tone="warning">{t("welcome.missing")}</Badge>
          ) : (
            branch.data !== undefined && (
              <span className="flex max-w-40 items-center gap-1">
                <GitBranch size={12} strokeWidth={1.75} aria-hidden className="shrink-0" />
                <span className="truncate">{branch.data ?? t("welcome.detached")}</span>
              </span>
            )
          )}
          <span className="w-24 text-right tabular-nums">
            {relativeTime(repo.lastOpened / 1000)}
          </span>
        </span>
      </button>
      {/* Row actions replace the metadata on hover/focus. */}
      <span className="absolute top-1/2 right-2 hidden -translate-y-1/2 items-center gap-1 group-focus-within:flex group-hover:flex">
        {!missing && (
          <IconButton
            icon={FolderOpen}
            label={revealLabel}
            compact
            onClick={() => void ipc.revealInFileManager(repo.path)}
          />
        )}
        <IconButton
          icon={X}
          label={t("welcome.removeRecent")}
          compact
          onClick={() => removeRecent(repo.path)}
        />
      </span>
    </li>
  );
}

export function WelcomeScreen() {
  const recent = useWorkspace((s) => s.recent);
  const [filter, setFilter] = useState("");
  const dialog = useOverlays((s) => s.welcomeDialog);
  const setDialog = useOverlays((s) => s.setWelcomeDialog);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? recent.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
      : recent;
  }, [recent, filter]);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-app">
      <div className="mx-auto flex w-full max-w-160 flex-col gap-8 px-6 pt-16 pb-10">
        <header className="flex items-center gap-3">
          <Logo size={32} />
          <h1 className="text-heading font-semibold text-fg">{t("welcome.title")}</h1>
        </header>

        <div className="grid grid-cols-3 gap-3">
          <ActionCard
            icon={FolderOpen}
            title={t("welcome.open")}
            hint={t("welcome.openHint")}
            shortcut="Mod+O"
            onClick={() => void pickAndOpenRepo()}
          />
          <ActionCard
            icon={CloudDownload}
            title={t("welcome.clone")}
            hint={t("welcome.cloneHint")}
            onClick={() => setDialog("clone")}
          />
          <ActionCard
            icon={FolderPlus}
            title={t("welcome.create")}
            hint={t("welcome.createHint")}
            onClick={() => setDialog("create")}
          />
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-title font-semibold text-fg">{t("welcome.recent")}</h2>
            {recent.length > 0 && (
              <Input
                icon={Search}
                compact
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("welcome.filterRecent")}
                aria-label={t("welcome.filterRecent")}
                className="w-56"
              />
            )}
          </div>
          {shown.length > 0 ? (
            <ul className="-mx-3 flex flex-col">
              {shown.map((r) => (
                <RecentRow key={r.path} repo={r} />
              ))}
            </ul>
          ) : (
            <p className="rounded-menu border border-dashed border-line px-4 py-6 text-center text-fg-secondary">
              {recent.length === 0 ? (
                <>
                  {t("welcome.noRecent")}
                  <br />
                  <span className="text-small text-fg-muted">{t("welcome.dropHint")}</span>
                </>
              ) : (
                t("welcome.noMatches", { query: filter.trim() })
              )}
            </p>
          )}
        </section>

        <footer className="flex flex-col items-center gap-3">
          <GitStatusLine />
          {galleryEnabled && (
            <Button
              variant="ghost"
              size="sm"
              icon={LayoutGrid}
              onClick={() => (location.hash = "#/gallery")}
            >
              {t("shell.gallery")}
            </Button>
          )}
        </footer>
      </div>
      {/* Mounted only while open, so every opening starts with empty fields. */}
      {dialog === "clone" && <CloneDialog open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "create" && <CreateDialog open onOpenChange={(o) => !o && setDialog(null)} />}
    </main>
  );
}
