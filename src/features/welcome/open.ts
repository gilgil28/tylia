// Opening repositories from a path, the folder picker or a drop, with errors as toasts.

import { useWorkspace } from "@/app/workspace";
import { t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { toast } from "@/ui/Toast";

export function showOpenError(path: string, err: unknown) {
  if (isIpcError(err) && err.kind === "notARepository") {
    toast({
      kind: "error",
      title: t("open.failed"),
      description: t("open.notARepo", { path }),
      action: { label: t("open.initHere"), run: () => void createRepoAt(path) },
    });
  } else if (isIpcError(err) && err.kind === "bareRepository") {
    toast({ kind: "error", title: t("open.failed"), description: t("open.bare", { path }) });
  } else {
    toast({
      kind: "error",
      title: t("open.failed"),
      error: isIpcError(err) ? err : { message: String(err) },
    });
  }
}

export async function openRepoAt(path: string): Promise<boolean> {
  try {
    useWorkspace.getState().openRepo(await ipc.openRepo(path));
    return true;
  } catch (err) {
    showOpenError(path, err);
    return false;
  }
}

export async function pickAndOpenRepo() {
  const path = await ipc.pickFolder(t("welcome.pickTitle"));
  if (path) await openRepoAt(path);
}

export async function createRepoAt(path: string): Promise<boolean> {
  try {
    useWorkspace.getState().openRepo(await ipc.initRepo(path));
    return true;
  } catch (err) {
    toast({
      kind: "error",
      title: t("create.failed"),
      error: isIpcError(err) ? err : { message: String(err) },
    });
    return false;
  }
}
