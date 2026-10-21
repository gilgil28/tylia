import { FolderInput } from "lucide-react";
import { useEffect, useState } from "react";

import { openRepoAt } from "@/features/welcome/open";
import { t } from "@/i18n";
import { ipc } from "@/ipc";

/** Drop a folder anywhere on the window to open it as a repository. */
export function FolderDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void ipc
      .onFolderDrop({
        over: setOver,
        drop: (paths) => {
          for (const p of paths) void openRepoAt(p);
        },
      })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-2 z-50 flex animate-fade-in items-center justify-center rounded-dialog border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--bg-app)_85%,transparent)]">
      <div className="flex flex-col items-center gap-2 text-fg">
        <FolderInput size={28} strokeWidth={1.5} aria-hidden className="text-accent" />
        <span className="text-title font-medium">{t("welcome.dropOverlay")}</span>
      </div>
    </div>
  );
}
