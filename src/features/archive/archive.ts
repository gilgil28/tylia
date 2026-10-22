// "Export archive…": a commit, branch or tag's files as a zip or tar.gz (`git archive`).

import { archiveFormat } from "@/app/fileNames";
import { t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { toast } from "@/ui/Toast";

/** Asks where to save the archive of `rev` (`label` names it), then writes it. */
export async function exportArchive(repo: string, rev: string, label: string) {
  const name = repo.split(/[\\/]/).filter(Boolean).pop() ?? "repository";
  const base = `${name}-${label}`.replace(/[\\/:*?"<>|]/g, "-");
  const file = await ipc.pickSaveFile(t("archive.saveTitle"), `${base}.zip`, [
    { name: t("archive.zip"), extensions: ["zip"] },
    { name: t("archive.tarGz"), extensions: ["tar.gz", "tgz"] },
  ]);
  if (!file) return;
  const progress = toast({ kind: "progress", title: t("archive.exporting", { label }) });
  try {
    await ipc.exportArchive(repo, rev, label, archiveFormat(file), file);
    toast.dismiss(progress);
    toast({
      kind: "success",
      title: t("archive.exported", { label }),
      description: file,
      action: { label: t("patch.showFile"), run: () => void ipc.revealInFileManager(file) },
    });
  } catch (err) {
    toast.dismiss(progress);
    toast({
      kind: "error",
      title: t("archive.failed"),
      description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
      error: isIpcError(err) ? err : { message: String(err) },
    });
  }
}
