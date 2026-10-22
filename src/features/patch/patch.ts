// Patch files: save a commit or the working copy's changes as a patch, and pick one to
// apply (ApplyPatchDialog). The work happens in tylia-git (`patch_file.rs`).

import { create } from "zustand";

import { patchFileName } from "@/app/fileNames";
import { plural, t } from "@/i18n";
import { ipc, isIpcError, type FileFilter } from "@/ipc";
import { toast } from "@/ui/Toast";

const filters = (): FileFilter[] => [
  { name: t("patch.filterName"), extensions: ["patch", "diff", "eml", "mbox"] },
  { name: t("patch.filterAll"), extensions: ["*"] },
];

/** Asks where to save, writes, and says where it went (with a way to show the file). */
async function saveAs(defaultName: string, write: (file: string) => Promise<void>) {
  const file = await ipc.pickSaveFile(t("patch.saveTitle"), defaultName, filters());
  if (!file) return;
  try {
    await write(file);
    toast({
      kind: "success",
      title: t("patch.saved"),
      description: file,
      action: { label: t("patch.showFile"), run: () => void ipc.revealInFileManager(file) },
    });
  } catch (err) {
    toast({
      kind: "error",
      title: t("patch.saveFailed"),
      description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
      error: isIpcError(err) ? err : { message: String(err) },
    });
  }
}

export function saveCommitPatch(repo: string, oid: string, subject: string) {
  return saveAs(patchFileName(subject), (file) => ipc.saveCommitPatch(repo, oid, file));
}

/** Saves `oids` (oldest first) as a numbered series in a folder the user picks. */
export async function saveCommitPatches(repo: string, oids: string[]) {
  const dir = await ipc.pickFolder(t("patch.pickFolder"));
  if (!dir) return;
  try {
    const files = await ipc.saveCommitPatches(repo, oids, dir);
    toast({
      kind: "success",
      title: t("patch.savedMany", { patches: plural("count.patches", files.length) }),
      description: dir,
      action: { label: t("patch.showFile"), run: () => void ipc.revealInFileManager(files[0]!) },
    });
  } catch (err) {
    toast({
      kind: "error",
      title: t("patch.saveFailed"),
      description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
      error: isIpcError(err) ? err : { message: String(err) },
    });
  }
}

export function saveChangesPatch(repo: string, staged: boolean) {
  const name = repo.split(/[\\/]/).filter(Boolean).pop() ?? "changes";
  return saveAs(`${name}-${staged ? "staged" : "unstaged"}.patch`, (file) =>
    ipc.saveChangesPatch(repo, staged, file),
  );
}

interface ApplyPatchState {
  target: { repo: string; file: string } | null;
  close(): void;
}

export const useApplyPatch = create<ApplyPatchState>((set) => ({
  target: null,
  close: () => set({ target: null }),
}));

/** Lets the user pick a patch file, then shows what applying it would do. */
export async function pickPatch(repo: string) {
  const file = await ipc.pickFile(t("patch.pickTitle"), undefined, filters());
  if (file) useApplyPatch.setState({ target: { repo, file } });
}
