// Default names and formats for files Tylia saves (patches, archives). No imports, so the
// rules are unit-tested without the app around them.

/** `git format-patch`'s file name for a subject: `0001-fix-the-parser.patch`. */
export function patchFileName(subject: string): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52)
    .replace(/-+$/, "");
  return `0001-${slug || "patch"}.patch`;
}

/** The archive format from the chosen file name: `.tar.gz` / `.tgz`, else zip. */
export function archiveFormat(file: string): "zip" | "tarGz" {
  return /\.(tar\.gz|tgz)$/i.test(file) ? "tarGz" : "zip";
}
