// "Apply patch": what the picked patch file changes (its commits, files and line counts),
// whether it applies here, then apply it to the working copy or create its commits.

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { useBranching } from "@/features/branching/useBranching";
import { plural, t } from "@/i18n";
import { ipc, isIpcError, type PatchApplyMode, type PatchPreview } from "@/ipc";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ErrorPanel } from "@/ui/ErrorPanel";

import { useApplyPatch } from "./patch";

function CheckLine({ preview }: { preview: PatchPreview }) {
  const [Icon, color, text] =
    preview.check === "clean"
      ? [CircleCheck, "text-success", t("patch.checkClean")]
      : preview.check === "threeWay"
        ? [TriangleAlert, "text-warning", t("patch.checkThreeWay")]
        : [CircleAlert, "text-danger", t("patch.checkFails")];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-start gap-2">
        <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
        <span>{text}</span>
      </p>
      {preview.checkMessage && (
        <pre
          className="max-h-24 overflow-auto rounded-menu border border-line-subtle bg-panel p-2 font-code text-small whitespace-pre-wrap text-fg-secondary"
          data-selectable
        >
          {preview.checkMessage}
        </pre>
      )}
    </div>
  );
}

function Contents({ preview }: { preview: PatchPreview }) {
  return (
    <div className="flex flex-col gap-3">
      {preview.commits.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-small font-semibold text-fg-secondary">
            {plural("count.commits", preview.commits.length)}
          </h3>
          <ol className="list-decimal pl-5 text-fg" data-selectable>
            {preview.commits.map((subject, i) => (
              <li key={i}>{subject}</li>
            ))}
          </ol>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <h3 className="text-small font-semibold text-fg-secondary">
          {plural("count.files", preview.files.length)}
        </h3>
        <ul
          className="flex max-h-48 flex-col overflow-auto rounded-menu border border-line-subtle bg-panel py-1"
          data-selectable
        >
          {preview.files.map((file) => (
            <li
              key={file.path}
              className="flex items-baseline justify-between gap-3 px-3 py-0.5 text-small"
            >
              <span className="min-w-0 truncate font-code text-fg" title={file.path}>
                {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              </span>
              <span className="shrink-0 font-code">
                {file.added === null ? (
                  <span className="text-fg-muted">{t("patch.binary")}</span>
                ) : (
                  <>
                    <span className="text-success">+{file.added}</span>{" "}
                    <span className="text-danger">−{file.removed}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Rendered once per repository view; opens for `useApplyPatch`'s target. */
export function ApplyPatchDialog({ repo }: { repo: string }) {
  const target = useApplyPatch((s) => s.target);
  const close = useApplyPatch((s) => s.close);
  const b = useBranching(repo);
  const [busy, setBusy] = useState<PatchApplyMode | null>(null);
  const file = target?.repo === repo ? target.file : null;
  const preview = useQuery({
    queryKey: ["patch-preview", repo, file],
    queryFn: () => ipc.previewPatch(repo, file!),
    enabled: file !== null,
    retry: false,
    gcTime: 0,
  });
  if (!file) return null;

  const data = preview.data;
  const mailbox = data?.format === "mailbox";
  const canApply = !!data && data.check !== "fails" && !busy;
  const apply = async (mode: PatchApplyMode) => {
    setBusy(mode);
    const done = await b.applyPatch(file, mode, data?.commits.length ?? 0);
    setBusy(null);
    if (done) close();
  };
  const name = file.split(/[\\/]/).pop() ?? file;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && close()}
      title={t("patch.applyTitle")}
      description={name}
      width="lg"
      footer={
        <>
          <Button size="lg" onClick={close} disabled={!!busy}>
            {t("common.cancel")}
          </Button>
          {mailbox && (
            <Button
              size="lg"
              onClick={() => void apply("workingTree")}
              disabled={!canApply}
              loading={busy === "workingTree"}
            >
              {t("patch.applyToWorkingCopy")}
            </Button>
          )}
          <Button
            size="lg"
            variant="primary"
            onClick={() => void apply(mailbox ? "commits" : "workingTree")}
            disabled={!canApply}
            loading={busy === (mailbox ? "commits" : "workingTree")}
            autoFocus
            data-autofocus
          >
            {mailbox
              ? t("patch.createCommits", {
                  commits: plural("count.commits", data.commits.length),
                })
              : t("patch.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {preview.isPending && <p className="text-fg-secondary">{t("patch.reading")}</p>}
        {preview.isError && (
          <ErrorPanel
            message={
              isIpcError(preview.error) && preview.error.kind === "invalidInput"
                ? preview.error.message
                : t("patch.readFailed")
            }
            command={isIpcError(preview.error) ? preview.error.command : null}
            stderr={
              isIpcError(preview.error)
                ? preview.error.kind === "invalidInput"
                  ? null
                  : (preview.error.stderr ?? preview.error.message)
                : String(preview.error)
            }
          />
        )}
        {data && (
          <>
            <CheckLine preview={data} />
            <Contents preview={data} />
            <p className="text-small text-fg-muted">
              {mailbox ? t("patch.mailboxHint") : t("patch.diffHint")}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
