// "Git LFS locks": who has locked what on the server, read when the dialog opens. Your own
// locks can be released here; others' only by them (or an admin on the server).

import { useQuery } from "@tanstack/react-query";
import { Lock, Unlock } from "lucide-react";

import { absoluteTime } from "@/app/format";
import { readLfsLocks, setLfsLock } from "@/features/remote/operations";
import { t } from "@/i18n";
import type { LfsLock, LfsLocks } from "@/ipc";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";

import { useLfsLocksDialog } from "./lfs";

function LockRow({ lock, onUnlock }: { lock: LfsLock; onUnlock?: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-1.5">
      <Lock size={14} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-code text-small text-fg" data-selectable title={lock.path}>
          {lock.path}
        </span>
        <span className="truncate text-small text-fg-muted">
          {t("lfs.lockedBy", {
            owner: lock.owner || t("lfs.unknownOwner"),
            time: absoluteTime(Date.parse(lock.lockedAt) / 1000),
          })}
        </span>
      </span>
      {onUnlock && (
        <Button size="sm" icon={Unlock} onClick={onUnlock}>
          {t("lfs.unlock")}
        </Button>
      )}
    </li>
  );
}

export function LfsLocksDialog({ repo }: { repo: string }) {
  const openFor = useLfsLocksDialog((s) => s.repo);
  const close = useLfsLocksDialog((s) => s.close);
  const open = openFor === repo;
  // Read from the server each time the dialog opens; a failure is toasted (null here).
  const query = useQuery({
    queryKey: ["lfs-locks", repo],
    queryFn: () => readLfsLocks(repo),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const locks: LfsLocks | null = query.data ?? null;
  const load = () => void query.refetch();

  if (!open) return null;
  const list = (items: LfsLock[], mine: boolean) =>
    items.length === 0 ? (
      <p className="px-3 py-2 text-small text-fg-muted">{t("lfs.noLocks")}</p>
    ) : (
      <ul className="flex flex-col divide-y divide-line-subtle">
        {items.map((lock) => (
          <LockRow
            key={lock.id}
            lock={lock}
            onUnlock={
              mine
                ? () => void setLfsLock(repo, lock.path, false).then((ok) => ok && load())
                : undefined
            }
          />
        ))}
      </ul>
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t("lfs.locksTitle")}
      description={t("lfs.locksHint")}
      width="lg"
      footer={
        <Button size="lg" variant="primary" onClick={close} autoFocus data-autofocus>
          {t("common.close")}
        </Button>
      }
    >
      {query.isPending ? (
        <p className="text-fg-secondary">{t("lfs.readingLocks")}</p>
      ) : !locks ? (
        <p className="text-danger">{t("lfs.locksFailed")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-1">
            <h3 className="text-small font-semibold text-fg-secondary">{t("lfs.yourLocks")}</h3>
            <div className="rounded-menu border border-line-subtle bg-panel">
              {list(locks.ours, true)}
            </div>
          </section>
          <section className="flex flex-col gap-1">
            <h3 className="text-small font-semibold text-fg-secondary">{t("lfs.otherLocks")}</h3>
            <div className="rounded-menu border border-line-subtle bg-panel">
              {list(locks.theirs, false)}
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
