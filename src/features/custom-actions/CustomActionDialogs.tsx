// The custom-action confirmation ("ask before running") and output panel.

import { CircleAlert, CircleCheck } from "lucide-react";

import { t } from "@/i18n";
import { ipc } from "@/ipc";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { ProgressRing } from "@/ui/ProgressRing";

import { runConfirmed, useActionRun } from "./run";

/** The command line as a shell would show it: arguments with spaces or quotes are quoted. */
function shown(command: string[]): string {
  return command
    .map((arg) =>
      arg === "" || /[\s"'\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, "\\$1")}"` : arg,
    )
    .join(" ");
}

function CommandLine({ command }: { command: string[] }) {
  return (
    <code
      className="block rounded-menu border border-line-subtle bg-panel p-2 font-code text-small break-all text-fg"
      data-selectable
    >
      {shown(command)}
    </code>
  );
}

function Stream({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <section className="flex min-h-0 flex-col gap-1">
      <h3 className="text-small font-semibold text-fg-secondary">{label}</h3>
      <pre
        className="max-h-64 overflow-auto rounded-menu border border-line-subtle bg-panel p-2 font-code text-small whitespace-pre-wrap text-fg"
        data-selectable
      >
        {text}
      </pre>
    </section>
  );
}

function OutputDialog() {
  const output = useActionRun((s) => s.output);
  const close = useActionRun((s) => s.closeOutput);
  if (!output) return null;
  const { action, command, result } = output;
  const running = result.status === "running";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !running && close()}
      title={action.name}
      width="lg"
      footer={
        running ? (
          <Button size="lg" onClick={() => void ipc.cancelOperation(result.operationId)}>
            {t("customActions.stop")}
          </Button>
        ) : (
          <Button size="lg" variant="primary" onClick={close} autoFocus data-autofocus>
            {t("common.close")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <CommandLine command={command} />
        {running && (
          <p className="flex items-center gap-2 text-fg-secondary">
            <ProgressRing />
            {t("customActions.running")}
          </p>
        )}
        {result.status === "failed" && (
          <p className="flex items-start gap-2">
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            {result.cancelled ? t("customActions.stopped") : result.message}
          </p>
        )}
        {result.status === "done" && (
          <>
            <p className="flex items-center gap-2">
              {result.run.code === 0 ? (
                <CircleCheck size={16} className="shrink-0 text-success" aria-hidden />
              ) : (
                <CircleAlert size={16} className="shrink-0 text-danger" aria-hidden />
              )}
              {result.run.code === null
                ? t("customActions.endedBySignal")
                : t("customActions.exited", { code: String(result.run.code) })}
            </p>
            <Stream label={t("customActions.stdout")} text={result.run.stdout} />
            <Stream label={t("customActions.stderr")} text={result.run.stderr} />
            {!result.run.stdout && !result.run.stderr && (
              <p className="text-fg-muted">{t("customActions.noOutput")}</p>
            )}
            {result.run.truncated && (
              <p className="text-small text-fg-muted">{t("customActions.truncated")}</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Rendered once at the app's root. */
export function CustomActionDialogs() {
  const confirming = useActionRun((s) => s.confirming);
  const closeConfirm = useActionRun((s) => s.closeConfirm);
  return (
    <>
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && closeConfirm()}
          title={t("customActions.confirmTitle", { name: confirming.action.name })}
          consequence={t("customActions.confirmBody")}
          confirmLabel={t("customActions.run")}
          onConfirm={() =>
            void runConfirmed(confirming.action, confirming.context, confirming.command)
          }
        >
          <CommandLine command={confirming.command} />
        </ConfirmDialog>
      )}
      <OutputDialog />
    </>
  );
}
