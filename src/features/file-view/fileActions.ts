// Actions for the selected file (history, blame) and for leaving the file view.

import { ArrowLeft, FileClock, FileUser } from "lucide-react";

import { useRegisterActions, type Action } from "@/app/actions";
import { platform } from "@/app/boot";
import { useRepoUi, type FileViewMode } from "@/features/repo/repo-store";
import { t } from "@/i18n";

/** Back, as in browsers and file managers: Cmd+[ on macOS, Alt+← elsewhere. */
export const BACK_SHORTCUT = platform === "macos" ? "Mod+[" : "Alt+Left";

/**
 * Registers "Show file history" and "Blame file" for the file selected in History or Changes
 * (or switching modes in the file view), and Back while the file view is shown.
 */
export function useFileActions(repo: string, active: boolean) {
  const view = useRepoUi((s) => s.view);
  const file = useRepoUi((s) => s.file);
  const selectedFile = useRepoUi((s) => s.selectedFile);
  const selection = useRepoUi((s) => s.selection);
  const openFile = useRepoUi((s) => s.openFile);
  const closeFile = useRepoUi((s) => s.closeFile);

  // What the actions apply to: the file view's file, or the selected file (not one that
  // Git doesn't know yet).
  let target: { path: string; rev: string | null } | null = null;
  if (view === "file" && file) {
    target = { path: file.path, rev: file.rev };
  } else if (selectedFile && selectedFile.target !== "untracked") {
    const commit = selectedFile.target === "commit" && selection?.kind === "commit";
    target = { path: selectedFile.path, rev: commit ? selection.oid : null };
  }
  const open = (mode: FileViewMode) => () => {
    if (!target) return;
    if (view === "file" && file) openFile({ ...file, mode, line: null });
    else openFile({ path: target.path, mode, rev: mode === "blame" ? target.rev : null });
  };

  const actions: Action[] = [
    {
      id: "file.history",
      title: t("fileView.actionHistory"),
      group: "file",
      icon: FileClock,
      shortcut: "Mod+Shift+H",
      keywords: ["log selected", "follow", "renames", target?.path ?? ""],
      disabled: !target,
      run: open("history"),
    },
    {
      id: "file.blame",
      title: t("fileView.actionBlame"),
      group: "file",
      icon: FileUser,
      shortcut: "Mod+Shift+A",
      keywords: ["annotate", "who changed", target?.path ?? ""],
      disabled: !target,
      run: open("blame"),
    },
    ...(view === "file"
      ? [
          {
            id: "file.back",
            title: t("fileView.actionBack"),
            group: "file",
            icon: ArrowLeft,
            shortcut: BACK_SHORTCUT,
            run: closeFile,
          } satisfies Action,
        ]
      : []),
  ];
  useRegisterActions(`file:${repo}`, actions, active);
}
