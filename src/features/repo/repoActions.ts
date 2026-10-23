// Actions of the visible repository: views, remote operations, branches, stashes, the
// operation in progress, and (while searching the palette) one item per branch.

import { useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore,
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleCheck,
  CircleX,
  FileArchive,
  FileDown,
  FileUp,
  Cloud,
  FolderCog,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  History,
  RefreshCw,
  RotateCw,
  SkipForward,
  SquarePen,
  SquareSplitHorizontal,
  SquareTerminal,
  Redo2,
  Undo2,
} from "lucide-react";

import { useRegisterActions, type Action } from "@/app/actions";
import { shortHash } from "@/app/format";
import { revealLabel } from "@/app/labels";
import { useSettings } from "@/app/settings";
import { useBranchDialog } from "@/features/branching/dialog-store";
import { useSwitcher } from "@/features/branching/BranchSwitcher";
import { useBranching } from "@/features/branching/useBranching";
import { customPaletteActions } from "@/features/custom-actions/CustomActionItems";
import {
  fetchRepo,
  headBranch,
  pullRepo,
  pushRepo,
  useOperations,
} from "@/features/remote/operations";
import { exportArchive } from "@/features/archive/archive";
import {
  pickPatch,
  saveChangesPatch,
  saveCommitPatch,
  saveCommitPatches,
} from "@/features/patch/patch";
import { useRemoteDialog } from "@/features/remote/RemoteDialogs";
import { useBackupsDialog } from "@/features/undo/backups";
import { operationName, useUndo } from "@/features/undo/undo";
import { t } from "@/i18n";
import { workingDiffRequest } from "@/features/changes/StagingDiffPane";
import { commitDiffRequest } from "@/features/commit-details/DiffPane";
import { openInDiffTool } from "@/features/diff/externalDiff";
import {
  ipc,
  type CommitDetails,
  type DiffRequest,
  type RefsSnapshot,
  type WorkingStatus,
} from "@/ipc";

import { useRepoSettings } from "@/features/repo-settings/store";

import { openTerminal } from "./openTerminal";
import { useRepoUi } from "./repo-store";

export function useRepoActions(
  repo: string,
  refs: RefsSnapshot | undefined,
  status: WorkingStatus | undefined,
  active: boolean,
) {
  const client = useQueryClient();
  const setView = useRepoUi((s) => s.setView);
  const openBranchDialog = useBranchDialog((s) => s.open);
  const openRemoteDialog = useRemoteDialog((s) => s.open);
  const openPushDialog = useOperations((s) => s.openPushDialog);
  const b = useBranching(repo);

  const branch = headBranch(refs);
  const hasRemotes = (refs?.remotes.length ?? 0) > 0;
  const op = status?.operation;
  const busy = !!op;
  const conflicts = status?.entries.filter((e) => e.conflicted).length ?? 0;
  const dirty = (status?.entries.length ?? 0) > 0;
  const tracked = new Set(refs?.branches.map((x) => x.upstream));
  const selectedFile = useRepoUi((s) => s.selectedFile);
  const selection = useRepoUi((s) => s.selection);
  const selectedOids = useRepoUi((s) => s.selectedOids);
  const customActions = useSettings((s) => s.settings.customActions);
  const undo = useUndo(repo);
  const undoKind = undo.state?.undo;
  const redoKind = undo.state?.redo;

  // The selected file's diff, for the external diff tool.
  const diffRequest = (): DiffRequest | null => {
    const f = selectedFile;
    if (!f || f.target === "untracked" || f.target === "conflicted") return null;
    if (f.target !== "commit") return workingDiffRequest({ ...f, target: f.target });
    if (selection?.kind !== "commit") return null;
    const commit = client.getQueryData<CommitDetails>(["commit", repo, selection.oid]);
    return commit ? commitDiffRequest(commit, f) : null;
  };

  const actions: Action[] = [
    {
      id: "repo.undo",
      title: undoKind
        ? t("undo.undo", { operation: operationName(undoKind) })
        : t("undo.undoPlain"),
      group: "repository",
      icon: Undo2,
      shortcut: "Mod+Z",
      notWhileTyping: true,
      keywords: ["revert", "back", "restore"],
      disabled: !undoKind || busy,
      run: undo.undo,
    },
    {
      id: "repo.redo",
      title: redoKind
        ? t("undo.redo", { operation: operationName(redoKind) })
        : t("undo.redoPlain"),
      group: "repository",
      icon: Redo2,
      shortcut: "Mod+Shift+Z",
      notWhileTyping: true,
      disabled: !redoKind || busy,
      run: undo.redo,
    },
    {
      id: "changes.discarded",
      title: t("backups.open"),
      group: "changes",
      icon: ArchiveRestore,
      keywords: ["restore", "backup", "lost changes", "recover"],
      run: () => useBackupsDialog.getState().open(repo),
    },
    {
      id: "view.changes",
      title: t("actions.showChanges"),
      group: "view",
      icon: SquarePen,
      shortcut: "Alt+1",
      run: () => setView("changes"),
    },
    {
      id: "view.history",
      title: t("actions.showHistory"),
      group: "view",
      icon: History,
      shortcut: "Alt+2",
      run: () => setView("history"),
    },
    {
      id: "repo.refresh",
      title: t("actions.refresh"),
      group: "repository",
      icon: RotateCw,
      shortcut: "F5",
      keywords: ["reload"],
      run: () => {
        void client.invalidateQueries({ queryKey: ["refs", repo] });
        void client.invalidateQueries({ queryKey: ["status", repo] });
      },
    },
    {
      id: "repo.reveal",
      title: revealLabel,
      group: "repository",
      icon: FolderOpen,
      run: () => void ipc.revealInFileManager(repo),
    },
    {
      id: "repo.settings",
      title: t("actions.repoSettings"),
      group: "repository",
      icon: FolderCog,
      // Each keyword is matched on its own, so include the phrases people type.
      keywords: [
        "remotes",
        "remote url",
        "ssh key",
        "https",
        "credentials",
        "sign in",
        "token",
        "user name",
        "email",
        "identity",
      ],
      run: () => useRepoSettings.getState().open(repo),
    },
    {
      id: "repo.applyPatch",
      title: t("patch.applyAction"),
      group: "repository",
      icon: FileUp,
      keywords: ["patch", "diff", "am", "mbox", "import"],
      disabled: busy,
      run: () => void pickPatch(repo),
    },
    {
      id: "changes.saveStagedPatch",
      title: t("patch.saveStagedAction"),
      group: "changes",
      icon: FileDown,
      keywords: ["patch", "diff", "export"],
      disabled: !status?.entries.some((e) => e.staged),
      run: () => void saveChangesPatch(repo, true),
    },
    {
      id: "changes.saveUnstagedPatch",
      title: t("patch.saveUnstagedAction"),
      group: "changes",
      icon: FileDown,
      keywords: ["patch", "diff", "export"],
      disabled: !status?.entries.some((e) => e.unstaged),
      run: () => void saveChangesPatch(repo, false),
    },
    {
      id: "history.savePatch",
      title: t("patch.saveCommitAction"),
      group: "history",
      icon: FileDown,
      keywords: ["patch", "format-patch", "export"],
      disabled: selection?.kind !== "commit",
      run: () => {
        if (selection?.kind !== "commit") return;
        // Several selected: a numbered series, oldest first.
        if (selectedOids.length > 1)
          return void saveCommitPatches(repo, [...selectedOids].reverse());
        const commit = client.getQueryData<CommitDetails>(["commit", repo, selection.oid]);
        void saveCommitPatch(repo, selection.oid, commit?.subject ?? selection.oid);
      },
    },
    {
      id: "repo.exportArchive",
      title: t("archive.action"),
      group: "repository",
      icon: FileArchive,
      keywords: ["archive", "zip", "tar", "export", "snapshot"],
      disabled: !refs?.head.oid,
      run: () => {
        const head = refs?.head;
        if (!head?.oid) return;
        void exportArchive(repo, head.oid, head.branch ?? shortHash(head.oid));
      },
    },
    {
      id: "repo.terminal",
      title: t("actions.openTerminal"),
      group: "repository",
      icon: SquareTerminal,
      shortcut: "Mod+Shift+T",
      keywords: ["shell", "console", "command line", "cli", "powershell", "bash"],
      run: () => openTerminal(repo),
    },
    {
      id: "file.diffTool",
      title: t("actions.diffTool"),
      group: "file",
      icon: SquareSplitHorizontal,
      shortcut: "Mod+D",
      keywords: ["external", "difftool", "compare"],
      disabled:
        !selectedFile ||
        selectedFile.target === "untracked" ||
        selectedFile.target === "conflicted",
      run: () => {
        const request = diffRequest();
        if (request) openInDiffTool(repo, request);
      },
    },
    {
      id: "remote.fetch",
      title: t("ops.fetch"),
      group: "remote",
      icon: RefreshCw,
      shortcut: "Mod+Shift+F",
      disabled: !hasRemotes,
      run: () => void fetchRepo(repo),
    },
    {
      id: "remote.pull",
      title: t("ops.pull"),
      group: "remote",
      icon: ArrowDownToLine,
      shortcut: "Mod+Shift+L",
      disabled: !branch?.upstream || busy,
      run: () => void pullRepo(repo, undefined, { onConflicts: () => setView("changes") }),
    },
    {
      id: "remote.push",
      title: t("ops.push"),
      group: "remote",
      icon: ArrowUpFromLine,
      shortcut: "Mod+Shift+P",
      disabled: !branch || !refs?.head.oid,
      run: () => void pushRepo(repo),
    },
    {
      id: "remote.pushDialog",
      title: t("actions.pushDialog"),
      group: "remote",
      icon: ArrowUpFromLine,
      disabled: !branch || !refs?.head.oid,
      run: () => openPushDialog(repo),
    },
    {
      id: "remote.add",
      title: t("actions.addRemote"),
      group: "remote",
      icon: Cloud,
      run: () => openRemoteDialog({ repo, mode: "add" }),
    },
    {
      id: "branch.switch",
      title: t("actions.switchBranch"),
      group: "branch",
      icon: GitBranch,
      shortcut: "Mod+P",
      keywords: ["checkout"],
      disabled: busy,
      run: () => useSwitcher.setState({ repo }),
    },
    {
      id: "branch.new",
      title: t("actions.newBranch"),
      group: "branch",
      icon: GitBranchPlus,
      shortcut: "Mod+Shift+B",
      disabled: !refs?.head.oid,
      run: () =>
        openBranchDialog(repo, {
          mode: "createBranch",
          start: "HEAD",
          startLabel: refs?.head.branch ?? "HEAD",
        }),
    },
    {
      id: "stash.save",
      title: t("actions.stash"),
      group: "changes",
      icon: Archive,
      shortcut: "Mod+Shift+S",
      disabled: !dirty || busy,
      run: () => openBranchDialog(repo, { mode: "stash" }),
    },
    {
      id: "stash.pop",
      title: t("actions.popStash"),
      group: "changes",
      icon: ArchiveRestore,
      disabled: (refs?.stashes.length ?? 0) === 0 || busy,
      run: () => void b.stashApply(0, true),
    },
    ...(op
      ? ([
          {
            id: "operation.continue",
            title: op.kind === "merge" ? t("banner.commitMerge") : t("banner.continue"),
            group: "branch",
            icon: CircleCheck,
            disabled: conflicts > 0,
            run: () => void b.continueOperation(),
          },
          ...(op.kind !== "merge"
            ? [
                {
                  id: "operation.skip",
                  title: op.kind === "am" ? t("banner.skipPatch") : t("banner.skip"),
                  group: "branch",
                  icon: SkipForward,
                  run: () => void b.skipOperation(),
                } satisfies Action,
              ]
            : []),
          {
            id: "operation.abort",
            title: t("actions.abortOperation"),
            group: "branch",
            icon: CircleX,
            run: () => openBranchDialog(repo, { mode: "abortOperation" }),
          },
        ] satisfies Action[])
      : []),
    // One item per branch while searching: "Switch to feature/x".
    ...(refs?.branches ?? [])
      .filter((x) => !x.isHead)
      .map((x): Action => ({
        id: `branch.checkout.${x.name}`,
        title: t("actions.switchTo", { name: x.name }),
        group: "branch",
        icon: GitBranch,
        searchOnly: true,
        disabled: busy,
        run: () => void b.checkout({ kind: "branch", name: x.name }),
      })),
    ...(refs?.remotes ?? []).flatMap((r) =>
      r.branches
        .filter((x) => !tracked.has(x.fullName))
        .map((x): Action => ({
          id: `branch.checkoutRemote.${x.fullName}`,
          title: t("actions.checkoutRemote", { name: x.fullName }),
          group: "branch",
          icon: Cloud,
          searchOnly: true,
          disabled: busy,
          run: () => openBranchDialog(repo, { mode: "checkoutRemote", remoteBranch: x.fullName }),
        })),
    ),
    // Settings → Actions: each for the selected commit / current branch / selected file.
    ...customPaletteActions(customActions, (scope) => {
      const base = { repo, sha: null, branch: null, files: [] };
      switch (scope) {
        case "repository":
          return base;
        case "commit":
          return selection?.kind === "commit" ? { ...base, sha: selection.oid } : null;
        case "branch":
          return refs?.head.branch
            ? { ...base, branch: refs.head.branch, sha: refs.head.oid ?? null }
            : null;
        case "file":
          return selectedFile
            ? {
                ...base,
                files: [selectedFile.path],
                sha:
                  selectedFile.target === "commit" && selection?.kind === "commit"
                    ? selection.oid
                    : null,
              }
            : null;
      }
    }),
  ];
  useRegisterActions(`repo:${repo}`, actions, active);
}
