// Discarded changes (ROADMAP Phase 11 C): every discard keeps a backup in Rust
// (crates/tylia-git/src/backup.rs); this restores one from the toast after discarding, or
// from the list in the "Discarded changes" dialog.

import { useQuery } from "@tanstack/react-query";
import { ArchiveRestore } from "lucide-react";
import { useCallback } from "react";
import { create } from "zustand";

import { relativeTime } from "@/app/format";
import { useRepoAction } from "@/features/changes/useRepoAction";
import { plural, t, type MessageKey } from "@/i18n";
import { ipc, type DiscardKind } from "@/ipc";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { toast } from "@/ui/Toast";

/** Which repository's "Discarded changes" dialog is open. */
export const useBackupsDialog = create<{
  repo: string | null;
  open(repo: string): void;
  close(): void;
}>((set) => ({
  repo: null,
  open: (repo) => set({ repo }),
  close: () => set({ repo: null }),
}));

const KINDS: Record<DiscardKind, MessageKey> = {
  files: "backups.kind.files",
  lines: "backups.kind.lines",
  reset: "backups.kind.reset",
};

const fileList = (files: string[]) =>
  files.length === 1 ? files[0]! : plural("count.files", files.length);

/** Restores backups and reports what came back. */
export function useRestore(repo: string) {
  const run = useRepoAction(repo);
  const restore = useCallback(
    async (id: string) => {
      const outcome = await run(() => ipc.restoreBackup(repo, id), t("backups.restoreFailed"));
      if (!outcome) return;
      if (outcome.conflicts.length > 0) {
        toast({
          kind: "error",
          title: t("backups.conflicts", { files: fileList(outcome.conflicts) }),
          description: t("backups.conflictsHint"),
        });
      } else if (outcome.skipped.length > 0) {
        toast({
          kind: "error",
          title: t("backups.restoreFailed"),
          description: t("backups.skipped", { files: fileList(outcome.skipped) }),
        });
      } else if (outcome.restored.length > 0) {
        toast({
          kind: "success",
          title: t("backups.restored", { files: fileList(outcome.restored) }),
        });
      }
    },
    [repo, run],
  );
  /** After a discard: "Discarded changes in …" with Restore. */
  const discarded = useCallback(
    (id: string | null | undefined, files: string[]) => {
      if (!id) return;
      toast({
        kind: "success",
        title: t("backups.discarded", { files: fileList(files) }),
        action: { label: t("backups.restore"), run: () => void restore(id) },
      });
    },
    [restore],
  );
  return { restore, discarded };
}

export function BackupsDialog({ repo }: { repo: string }) {
  const openFor = useBackupsDialog((s) => s.repo);
  const close = useBackupsDialog((s) => s.close);
  const open = openFor === repo;
  const backups = useQuery({
    queryKey: ["backups", repo],
    queryFn: () => ipc.discardBackups(repo),
    enabled: open,
  });
  const { restore } = useRestore(repo);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t("backups.title")}
      description={t("backups.description")}
      width="lg"
    >
      {backups.isError ? (
        <ErrorPanel message={t("backups.loadFailed")} stderr={String(backups.error)} />
      ) : backups.data?.length === 0 ? (
        <p className="py-4 text-fg-muted">{t("backups.none")}</p>
      ) : (
        <ul className="flex max-h-96 flex-col overflow-auto">
          {backups.data?.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3 border-b border-line-subtle py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-fg">
                  {t(KINDS[b.kind])}
                  <span className="text-fg-muted"> · {relativeTime(b.time)}</span>
                </span>
                <span className="truncate text-small text-fg-muted" title={b.files.join("\n")}>
                  {b.files.join(", ")}
                </span>
              </div>
              <Button size="sm" icon={ArchiveRestore} onClick={() => void restore(b.id)}>
                {t("backups.restore")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
