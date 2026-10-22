// "Tylia X is available": release notes, then install and restart (or, where Tylia can't
// replace itself, the download page).

import { Download, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { distribution, platform } from "@/app/boot";
import { absoluteTime } from "@/app/format";
import { t } from "@/i18n";
import { ipc, isIpcError, type IpcError } from "@/ipc";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { ProgressRing } from "@/ui/ProgressRing";

import { useUpdate } from "./update";

const MB = 1024 * 1024;

/** The few Markdown forms release notes use: headings, bullets, links (shown as text). */
function ReleaseNotes({ notes }: { notes: string }) {
  const text = (line: string) => line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "");
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(text(bullet[1]!));
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold text-fg">
          {text(heading[1]!)}
        </p>
      ) : (
        <p key={blocks.length}>{text(line)}</p>
      ),
    );
  }
  flush();
  return (
    <div
      className="flex max-h-64 flex-col gap-1.5 overflow-auto rounded-menu border border-line-subtle bg-panel p-3 text-small text-fg-secondary"
      data-selectable
    >
      {blocks}
    </div>
  );
}

export function UpdateDialog() {
  const status = useUpdate((s) => s.status);
  const open = useUpdate((s) => s.dialogOpen);
  const setOpen = useUpdate((s) => s.setDialogOpen);
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null } | null>(
    null,
  );
  const [error, setError] = useState<IpcError | null>(null);

  if (status.kind !== "available") return null;
  const { info } = status;
  const installing = progress !== null && error === null;

  const install = () => {
    setError(null);
    setProgress({ downloaded: 0, total: null });
    ipc
      .installUpdate(setProgress)
      .then(() => setProgress(null))
      .catch((err: unknown) => {
        setProgress(null);
        setError(
          isIpcError(err)
            ? err
            : { kind: "updateFailed", message: String(err), command: null, stderr: null },
        );
      });
  };

  const fraction =
    progress?.total && progress.total > 0 ? progress.downloaded / progress.total : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !installing && setOpen(o)}
      title={t("update.availableTitle", { version: info.version })}
      description={t("update.currentVersion", { version: info.currentVersion })}
      width="lg"
      footer={
        <>
          {installing && (
            <span className="mr-auto flex items-center gap-2 text-small text-fg-secondary">
              <ProgressRing value={fraction} />
              {progress.total
                ? t("update.downloadingOf", {
                    done: (progress.downloaded / MB).toFixed(1),
                    total: (progress.total / MB).toFixed(1),
                  })
                : t("update.downloading")}
            </span>
          )}
          <Button variant="ghost" disabled={installing} onClick={() => setOpen(false)}>
            {t("update.later")}
          </Button>
          {info.canInstall ? (
            <Button
              variant="primary"
              icon={Download}
              loading={installing}
              onClick={install}
              autoFocus
              data-autofocus
            >
              {t("update.install")}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={ExternalLink}
              onClick={() => void ipc.openDownloadPage()}
              autoFocus
              data-autofocus
            >
              {t("update.openDownloadPage")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {info.date && (
          <p className="text-small text-fg-muted">
            {t("update.released", { date: absoluteTime(Date.parse(info.date) / 1000) })}
          </p>
        )}
        {info.notes ? (
          <ReleaseNotes notes={info.notes} />
        ) : (
          <p className="text-fg-secondary">{t("update.noNotes")}</p>
        )}
        {!info.canInstall && (
          <p className="text-small text-fg-secondary">
            {distribution === "pacman"
              ? t("update.manualPacman")
              : distribution === "scoop"
                ? t("update.manualScoop")
                : platform === "linux"
                  ? t("update.manualLinux")
                  : t("update.manual")}
          </p>
        )}
        {info.canInstall && !error && (
          <p className="text-small text-fg-secondary">
            {platform === "windows" ? t("update.installHintWindows") : t("update.installHint")}
          </p>
        )}
        {error && (
          <ErrorPanel {...error} message={t("update.installFailed", { message: error.message })} />
        )}
      </div>
    </Dialog>
  );
}
