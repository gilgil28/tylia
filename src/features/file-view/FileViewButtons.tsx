import { FileClock, FileUser } from "lucide-react";

import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { IconButton } from "@/ui/IconButton";

/** "Show history" and "Blame" for a file, e.g. in a diff header. `rev`: the commit shown
 * (blame at it), or `null` for the working copy. */
export function FileViewButtons({ path, rev }: { path: string; rev: string | null }) {
  const openFile = useRepoUi((s) => s.openFile);
  return (
    <>
      <IconButton
        icon={FileClock}
        label={t("fileView.actionHistory")}
        compact
        onClick={() => openFile({ path, mode: "history" })}
      />
      <IconButton
        icon={FileUser}
        label={t("fileView.actionBlame")}
        compact
        onClick={() => openFile({ path, mode: "blame", rev })}
      />
    </>
  );
}
