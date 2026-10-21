import { t } from "@/i18n";

/** Human-readable file size: `512 B`, `14.2 KB`, `3.1 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return t("diff.sizeBytes", { size: bytes });
  const kb = bytes / 1024;
  if (kb < 1024) return t("diff.sizeKilobytes", { size: kb.toFixed(1) });
  return t("diff.sizeMegabytes", { size: (kb / 1024).toFixed(1) });
}
