import { useState } from "react";
import { create } from "zustand";

import { queryClient } from "@/app/query-client";
import { plural, t } from "@/i18n";
import { ipc, isIpcError, type IpcError, type RefsSnapshot, type Remote } from "@/ipc";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { toast } from "@/ui/Toast";

export type RemoteDialogRequest =
  { repo: string; mode: "add" } | { repo: string; mode: "edit" | "remove"; name: string };

/** Which remote dialog is open (opened from the sidebar and the Push dialog). */
export const useRemoteDialog = create<{
  dialog: RemoteDialogRequest | null;
  open(dialog: RemoteDialogRequest): void;
  close(): void;
}>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

const refreshRefs = (repo: string) => {
  void queryClient.invalidateQueries({ queryKey: ["refs", repo] });
  void queryClient.invalidateQueries({ queryKey: ["repo-config", repo] });
};

/** Add a remote, or edit one's name and URLs. */
function RemoteForm({
  repo,
  remotes,
  editing,
  onClose,
}: {
  repo: string;
  remotes: Remote[];
  editing: Remote | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? (remotes.length === 0 ? "origin" : ""));
  const [url, setUrl] = useState(editing?.url ?? "");
  const [pushUrl, setPushUrl] = useState(editing?.pushUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<IpcError | null>(null);

  const trimmed = name.trim();
  const taken = trimmed !== editing?.name && remotes.some((r) => r.name === trimmed);
  const valid = trimmed !== "" && url.trim() !== "" && !taken;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!editing) {
        await ipc.addRemote(repo, trimmed, url.trim());
        if (pushUrl.trim()) await ipc.setRemoteUrl(repo, trimmed, pushUrl.trim(), true);
      } else {
        let current = editing.name;
        if (trimmed !== current) {
          await ipc.renameRemote(repo, current, trimmed);
          current = trimmed;
        }
        if (url.trim() !== (editing.url ?? "")) {
          await ipc.setRemoteUrl(repo, current, url.trim(), false);
        }
        if (pushUrl.trim() !== (editing.pushUrl ?? "")) {
          await ipc.setRemoteUrl(repo, current, pushUrl.trim(), true);
        }
      }
      onClose();
    } catch (err) {
      setError(
        isIpcError(err) ? err : { kind: "io", message: String(err), command: null, stderr: null },
      );
    } finally {
      setSaving(false);
      void refreshRefs(repo);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? t("remotes.editTitle", { name: editing.name }) : t("remotes.addTitle")}
      onSubmit={() => void save()}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" type="submit" variant="primary" disabled={!valid} loading={saving}>
            {editing ? t("remotes.save") : t("remotes.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t("remotes.name")}
          htmlFor="remote-name"
          hint={
            taken && (
              <span className="text-danger">{t("remotes.nameTaken", { name: trimmed })}</span>
            )
          }
        >
          <Input
            id="remote-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!editing}
          />
        </Field>
        <Field label={t("remotes.url")} htmlFor="remote-url">
          <Input
            id="remote-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("remotes.urlPlaceholder")}
            autoFocus={!!editing}
          />
        </Field>
        <Field
          label={t("remotes.pushUrl")}
          htmlFor="remote-push-url"
          hint={t("remotes.pushUrlHint")}
        >
          <Input
            id="remote-push-url"
            value={pushUrl}
            onChange={(e) => setPushUrl(e.target.value)}
          />
        </Field>
        {error && (
          <ErrorPanel
            message={t("remotes.failed")}
            command={error.command}
            stderr={error.stderr ?? error.message}
          />
        )}
      </div>
    </Dialog>
  );
}

/** The open remote dialog for `repo`, if any. Rendered once per repository view. */
export function RemoteDialogs({ repo, refs }: { repo: string; refs: RefsSnapshot | undefined }) {
  const dialog = useRemoteDialog((s) => (s.dialog?.repo === repo ? s.dialog : null));
  const close = useRemoteDialog((s) => s.close);
  if (!dialog || !refs) return null;
  if (dialog.mode === "add") {
    return <RemoteForm repo={repo} remotes={refs.remotes} editing={null} onClose={close} />;
  }
  const remote = refs.remotes.find((r) => r.name === dialog.name);
  if (!remote) return null;
  if (dialog.mode === "edit") {
    return <RemoteForm repo={repo} remotes={refs.remotes} editing={remote} onClose={close} />;
  }
  const branches = remote.branches.length;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && close()}
      title={t("remotes.removeTitle", { name: remote.name })}
      consequence={
        branches > 0
          ? t("remotes.removeBody", { branches: plural("count.remoteBranches", branches) })
          : t("remotes.removeBodyEmpty")
      }
      confirmLabel={t("remotes.removeConfirm")}
      destructive
      onConfirm={() => {
        ipc
          .removeRemote(repo, remote.name)
          .catch((err: unknown) =>
            toast({
              kind: "error",
              title: t("remotes.failed"),
              error: isIpcError(err) ? err : { message: String(err) },
            }),
          )
          .finally(() => void refreshRefs(repo));
      }}
    />
  );
}
