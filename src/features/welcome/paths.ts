// Path helpers for the open, clone and create flows.

/** Joins a parent folder and a child name with the parent's separator style. */
export function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.endsWith(sep) ? parent + name : parent + sep + name;
}

/** Folder name suggested for a clone URL: `https://x/owner/repo.git` → `repo`. */
export function repoNameFromUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[/\\]+$/, "")
    .replace(/\.git$/i, "");
  const last = trimmed.split(/[/\\:]/).pop() ?? "";
  return last.replace(/[<>:"|?*]/g, "");
}
