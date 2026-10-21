import { create } from "zustand";

export type RepoSettingsSection = "remotes" | "authentication" | "identity";

/** Which repository's settings dialog is open, at which section. */
export const useRepoSettings = create<{
  repo: string | null;
  section: RepoSettingsSection;
  open(repo: string, section?: RepoSettingsSection): void;
  setSection(section: RepoSettingsSection): void;
  close(): void;
}>((set) => ({
  repo: null,
  section: "remotes",
  open: (repo, section = "remotes") => set({ repo, section }),
  setSection: (section) => set({ section }),
  close: () => set({ repo: null }),
}));
