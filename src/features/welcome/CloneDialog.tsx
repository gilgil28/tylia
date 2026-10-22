import { useRef, useState } from "react";

import { useSettings } from "@/app/settings";
import { useWorkspace } from "@/app/workspace";
import { nextOperationId } from "@/features/remote/operations";
import { t } from "@/i18n";
import { ipc, isIpcError, type IpcError, type Progress } from "@/ipc";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Dialog } from "@/ui/Dialog";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { toast } from "@/ui/Toast";

import { FolderField } from "./CreateDialog";
import { HostedRepoPicker } from "./HostedRepoPicker";
import { joinPath, repoNameFromUrl } from "./paths";
import { useParentFolder } from "./useParentFolder";

export function CloneDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const accounts = useSettings((s) => s.settings.hostingAccounts);
  // "Your repositories" asks the provider, so only when chosen.
  const [source, setSource] = useState<"url" | "accounts">("url");
  const [parent, setParent] = useParentFolder();
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [branch, setBranch] = useState("");
  const [shallow, setShallow] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<IpcError | null>(null);
  const operation = useRef<number | null>(null);
  const { openRepo, setLastParentFolder } = useWorkspace();

  const effectiveName = nameEdited ? name : repoNameFromUrl(url);
  const valid = url.trim() !== "" && parent.trim() !== "" && effectiveName.trim() !== "";
  const destination = valid ? joinPath(parent.trim(), effectiveName.trim()) : "";

  const start = async () => {
    if (!valid || running) return;
    const id = nextOperationId();
    operation.current = id;
    setRunning(true);
    setError(null);
    setProgress(null);
    try {
      const repo = await ipc.cloneRepo(
        {
          url: url.trim(),
          destination,
          branch: branch.trim() || null,
          depth: shallow ? 1 : null,
        },
        id,
        setProgress,
      );
      setLastParentFolder(parent.trim());
      openRepo(repo);
      toast({ kind: "success", title: t("clone.done", { name: repo.name }) });
      onOpenChange(false);
    } catch (err) {
      if (isIpcError(err) && err.kind === "cancelled") {
        toast({ kind: "success", title: t("clone.cancelled") });
      } else {
        setError(
          isIpcError(err)
            ? err
            : { kind: "gitFailed", message: String(err), command: null, stderr: null },
        );
      }
    } finally {
      setRunning(false);
      operation.current = null;
    }
  };

  const cancel = () => {
    if (operation.current !== null) void ipc.cancelOperation(operation.current);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : cancel())}
      title={t("clone.title")}
      onSubmit={() => void start()}
      footer={
        <>
          <Button size="lg" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" variant="primary" type="submit" disabled={!valid} loading={running}>
            {t("clone.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {accounts.length > 0 && (
          <SegmentedControl
            aria-label={t("clone.source")}
            value={source}
            onValueChange={(s) => setSource(s as "url" | "accounts")}
            segments={[
              { value: "url", label: t("clone.sourceUrl") },
              { value: "accounts", label: t("clone.yourRepos") },
            ]}
          />
        )}
        {source === "accounts" && accounts.length > 0 && (
          <HostedRepoPicker accounts={accounts} picked={url} onPick={setUrl} disabled={running} />
        )}
        <Field label={t("clone.url")} htmlFor="clone-url">
          <Input
            id="clone-url"
            autoFocus
            value={url}
            disabled={running}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("clone.urlPlaceholder")}
          />
        </Field>
        <Field label={t("clone.location")} htmlFor="clone-location">
          <FolderField
            id="clone-location"
            value={parent}
            onChange={setParent}
            pickTitle={t("clone.pickTitle")}
            disabled={running}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("clone.name")} htmlFor="clone-name">
            <Input
              id="clone-name"
              value={effectiveName}
              disabled={running}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
            />
          </Field>
          <Field label={t("clone.branch")} htmlFor="clone-branch">
            <Input
              id="clone-branch"
              value={branch}
              disabled={running}
              onChange={(e) => setBranch(e.target.value)}
              placeholder={t("clone.branchPlaceholder")}
            />
          </Field>
        </div>
        <Checkbox
          checked={shallow}
          onCheckedChange={setShallow}
          disabled={running}
          label={t("clone.shallow")}
        />
        {running ? (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <div className="flex justify-between text-small text-fg-secondary">
              <span>{progress?.phase ?? t("clone.starting")}</span>
              {progress && <span className="tabular-nums">{progress.percent}%</span>}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-active">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-(--dur-panel)"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-small break-all text-fg-muted" data-selectable>
            {destination ? t("clone.preview", { path: destination }) : t("clone.authHint")}
          </p>
        )}
        {error && (
          <ErrorPanel
            message={
              error.kind === "authFailed"
                ? `${t("ops.authFailed")}. ${t("ops.authFailedHint")}`
                : error.kind === "hostKeyFailed"
                  ? `${t("ops.hostKeyFailed")}. ${t("ops.hostKeyFailedHint")}`
                  : `${t("clone.failed")}: ${error.message}`
            }
            command={error.command}
            stderr={error.stderr}
          />
        )}
      </div>
    </Dialog>
  );
}
