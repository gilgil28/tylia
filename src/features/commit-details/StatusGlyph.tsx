import { t } from "@/i18n";
import type { FileStatus } from "@/ipc";
import { cn } from "@/ui/cn";

const GLYPH: Record<FileStatus, { letter: string; color: string; label: string }> = {
  added: { letter: "A", color: "text-success", label: t("status.added") },
  modified: { letter: "M", color: "text-warning", label: t("status.modified") },
  deleted: { letter: "D", color: "text-danger", label: t("status.deleted") },
  renamed: { letter: "R", color: "text-info", label: t("status.renamed") },
  copied: { letter: "C", color: "text-info", label: t("status.copied") },
  typeChanged: { letter: "T", color: "text-warning", label: t("status.typeChanged") },
  unmerged: { letter: "U", color: "text-danger", label: t("status.unmerged") },
  untracked: { letter: "?", color: "text-fg-secondary", label: t("status.untracked") },
};

/** One-letter file status (A, M, D, R…) in its status colour, with an accessible label. */
export function StatusGlyph({ status }: { status: FileStatus }) {
  const g = GLYPH[status];
  return (
    <span
      title={g.label}
      aria-label={g.label}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-badge bg-[color-mix(in_srgb,currentColor_14%,transparent)] font-code text-caption font-semibold",
        g.color,
      )}
    >
      {g.letter}
    </span>
  );
}
