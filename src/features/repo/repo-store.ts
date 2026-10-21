// Per-repository UI state that isn't persisted: selection, search, pending scroll target.

import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

import type { SearchField } from "@/ipc";

export type Selection = { kind: "commit"; oid: string } | null;

export type FileTarget = "commit" | "staged" | "unstaged" | "untracked" | "conflicted";

export interface SelectedFile {
  path: string;
  oldPath: string | null;
  target: FileTarget;
}

export type FileViewMode = "history" | "blame";

/** The file shown in the file view (its history or its blame). */
export interface FileViewTarget {
  path: string;
  mode: FileViewMode;
  /** Blame at / history up to this commit; `null`: the working copy / HEAD. */
  rev: string | null;
  /** Blame: the line to bring into view first. */
  line: number | null;
}

export interface CommitDraft {
  /** The whole commit message; its first line is the commit's title. */
  message: string;
  amend: boolean;
}

export interface RepoUiState {
  repo: string;
  /** History (graph + commit details), Changes (staging + commit), or one file's history /
   * blame. */
  view: "history" | "changes" | "file";
  /** What the file view shows (while `view` is "file"). */
  file: FileViewTarget | null;
  /** Where Back leads from the file view. */
  fileReturn: { view: "history" | "changes"; selectedFile: SelectedFile | null } | null;
  draft: CommitDraft;
  selection: Selection;
  selectedFile: SelectedFile | null;
  search: { field: SearchField; query: string };
  /** Commit to scroll to and select once it has been loaded. */
  revealOid: string | null;
  setView(view: "history" | "changes"): void;
  /** Shows a file's history or blame; Back returns to the current view. */
  openFile(target: Pick<FileViewTarget, "path" | "mode"> & Partial<FileViewTarget>): void;
  closeFile(): void;
  setDraft(draft: Partial<CommitDraft>): void;
  select(selection: Selection): void;
  selectFile(file: SelectedFile | null): void;
  setSearch(search: Partial<RepoUiState["search"]>): void;
  reveal(oid: string): void;
  revealed(): void;
}

export function createRepoStore(repo: string): StoreApi<RepoUiState> {
  return createStore<RepoUiState>((set, get) => ({
    repo,
    view: "history",
    draft: { message: "", amend: false },
    selection: null,
    selectedFile: null,
    search: { field: "message", query: "" },
    revealOid: null,
    file: null,
    fileReturn: null,
    setView(view) {
      if (get().view !== view) set({ view, selectedFile: null, file: null, fileReturn: null });
    },
    openFile({ path, mode, rev = null, line = null }) {
      const { view, selectedFile, fileReturn } = get();
      set({
        view: "file",
        file: { path, mode, rev, line },
        fileReturn: view === "file" ? fileReturn : { view, selectedFile },
      });
    },
    closeFile() {
      const back = get().fileReturn;
      set({
        view: back?.view ?? "history",
        selectedFile: back?.selectedFile ?? null,
        file: null,
        fileReturn: null,
      });
    },
    setDraft(draft) {
      set((s) => ({ draft: { ...s.draft, ...draft } }));
    },
    select(selection) {
      const prev = get().selection;
      const same =
        prev?.kind === selection?.kind &&
        (prev?.kind !== "commit" || (selection?.kind === "commit" && prev.oid === selection.oid));
      if (!same) set({ selection, selectedFile: null });
    },
    selectFile(selectedFile) {
      set({ selectedFile });
    },
    setSearch(search) {
      set((s) => ({ search: { ...s.search, ...search } }));
    },
    reveal(oid) {
      set({
        revealOid: oid,
        view: "history",
        file: null,
        fileReturn: null,
        search: { ...get().search, query: "" },
      });
    },
    revealed() {
      set({ revealOid: null });
    },
  }));
}

export const RepoStoreContext = createContext<StoreApi<RepoUiState> | null>(null);

export function useRepoUi<T>(selector: (s: RepoUiState) => T): T {
  const store = useContext(RepoStoreContext);
  if (!store) throw new Error("useRepoUi outside a repository view");
  return useStore(store, selector);
}
