import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import { FlowFinishDialog, FlowInitDialog, FlowStartDialog } from "@/features/flow/FlowDialogs";
import { RebaseEditor } from "@/features/rebase/RebaseEditor";
import { deleteRemoteBranch } from "@/features/remote/operations";
import { plural, t } from "@/i18n";
import type { RefsSnapshot, ResetMode, WorkingStatus } from "@/ipc";
import { Checkbox } from "@/ui/Checkbox";
import { cn } from "@/ui/cn";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { Textarea } from "@/ui/Textarea";

import { useBranchDialog, type BranchDialog } from "./dialog-store";
import { FormDialog } from "./FormDialog";
import { currentName, useBranching } from "./useBranching";

/** Files listed in a dialog before "and N more". */
const MAX_FILES = 8;

type Close = () => void;

/** Quick client-side check; Git validates names properly. */
const plausibleName = (name: string) => name.trim() !== "" && !/\s/.test(name.trim());

function CreateBranch({
  repo,
  refs,
  start,
  startLabel,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  start: string;
  startLabel: string;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const taken = refs.branches.some((x) => x.name === name.trim());
  return (
    <FormDialog
      title={t("branchDialog.createTitle")}
      description={t("branchDialog.createFrom", { start: startLabel })}
      submitLabel={t("branchDialog.create")}
      valid={plausibleName(name) && !taken}
      onSubmit={() => b.createBranch(name.trim(), start, checkout)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t("branchDialog.name")}
          htmlFor="branch-name"
          hint={taken && <span className="text-danger">{t("branchDialog.nameTaken")}</span>}
        >
          <Input
            id="branch-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("branchDialog.namePlaceholder")}
            autoFocus
          />
        </Field>
        <Checkbox
          checked={checkout}
          onCheckedChange={setCheckout}
          label={t("branchDialog.checkoutAfter")}
        />
      </div>
    </FormDialog>
  );
}

function RenameBranch({
  repo,
  refs,
  name,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  name: string;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  const taken = trimmed !== name && refs.branches.some((x) => x.name === trimmed);
  return (
    <FormDialog
      title={t("branchDialog.renameTitle", { name })}
      submitLabel={t("branchDialog.rename")}
      valid={plausibleName(value) && !taken && trimmed !== name}
      onSubmit={() => b.renameBranch(name, trimmed)}
      onClose={onClose}
    >
      <Field
        label={t("branchDialog.newName")}
        htmlFor="branch-new-name"
        hint={taken && <span className="text-danger">{t("branchDialog.nameTaken")}</span>}
      >
        <Input
          id="branch-new-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      </Field>
    </FormDialog>
  );
}

function CheckoutRemote({
  repo,
  refs,
  remoteBranch,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  remoteBranch: string;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const remote = refs.remotes.find((r) => remoteBranch.startsWith(`${r.name}/`))?.name ?? "";
  const [name, setName] = useState(remoteBranch.slice(remote.length + 1));
  const taken = refs.branches.some((x) => x.name === name.trim());
  return (
    <FormDialog
      title={t("branchDialog.checkoutRemoteTitle", { name: remoteBranch })}
      description={t("branchDialog.checkoutRemoteBody", { name: remoteBranch })}
      submitLabel={t("branchDialog.checkout")}
      valid={plausibleName(name) && !taken}
      onSubmit={async () => {
        await b.checkout({ kind: "remote", remoteBranch, localName: name.trim() });
      }}
      onClose={onClose}
    >
      <Field
        label={t("branchDialog.localName")}
        htmlFor="branch-local-name"
        hint={taken && <span className="text-danger">{t("branchDialog.nameTaken")}</span>}
      >
        <Input
          id="branch-local-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
    </FormDialog>
  );
}

function LocalChanges({
  repo,
  dialog,
  onClose,
}: {
  repo: string;
  dialog: Extract<BranchDialog, { mode: "localChanges" }>;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const shown = dialog.files.slice(0, MAX_FILES);
  const more = dialog.files.length - shown.length;
  return (
    <FormDialog
      title={t("branchDialog.localChangesTitle")}
      description={t("branchDialog.localChangesBody", { name: dialog.label })}
      submitLabel={t("branchDialog.stashAndSwitch")}
      onSubmit={() => b.checkout(dialog.target, true)}
      onClose={onClose}
    >
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-control bg-panel px-3 py-2 font-code text-small text-fg-secondary">
          {shown.map((f) => (
            <li key={f} className="truncate" title={f}>
              {f}
            </li>
          ))}
          {more > 0 && (
            <li className="text-fg-muted">{t("branchDialog.andMore", { count: more })}</li>
          )}
        </ul>
      )}
      <p className="mt-3 text-small text-fg-muted">{t("branchDialog.localChangesHint")}</p>
    </FormDialog>
  );
}

function SetUpstream({
  repo,
  refs,
  branch,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  branch: string;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const options = refs.remotes.flatMap((r) =>
    r.branches.map((x) => ({ value: x.fullName, label: x.fullName })),
  );
  const existing = refs.branches.find((x) => x.name === branch)?.upstream;
  const sameName = options.find((o) => o.value.endsWith(`/${branch}`))?.value;
  const [upstream, setUpstream] = useState(existing ?? sameName ?? options[0]?.value ?? "");
  return (
    <FormDialog
      title={t("branchDialog.upstreamTitle", { name: branch })}
      description={
        options.length === 0 ? t("branchDialog.noRemoteBranches") : t("branchDialog.upstreamBody")
      }
      submitLabel={t("branchDialog.setUpstream")}
      valid={upstream !== ""}
      onSubmit={() => b.setUpstream(branch, upstream)}
      onClose={onClose}
    >
      {options.length > 0 && (
        <Field label={t("branchDialog.upstream")} htmlFor="branch-upstream">
          <Select
            id="branch-upstream"
            value={upstream}
            onValueChange={setUpstream}
            options={options}
          />
        </Field>
      )}
    </FormDialog>
  );
}

function CreateTag({
  repo,
  refs,
  target,
  targetLabel,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  target: string;
  targetLabel: string;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const taken = refs.tags.some((x) => x.name === name.trim());
  return (
    <FormDialog
      title={t("branchDialog.tagTitle")}
      description={t("branchDialog.tagOn", { target: targetLabel })}
      submitLabel={t("branchDialog.createTag")}
      valid={plausibleName(name) && !taken}
      onSubmit={() => b.createTag(name.trim(), target, message.trim() || null)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t("branchDialog.name")}
          htmlFor="tag-name"
          hint={taken && <span className="text-danger">{t("branchDialog.tagTaken")}</span>}
        >
          <Input
            id="tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("branchDialog.tagPlaceholder")}
            autoFocus
          />
        </Field>
        <Field
          label={t("branchDialog.tagMessage")}
          htmlFor="tag-message"
          hint={t("branchDialog.tagMessageHint")}
        >
          <Textarea
            id="tag-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

function StashForm({ repo, onClose }: { repo: string; onClose: Close }) {
  const b = useBranching(repo);
  const [message, setMessage] = useState("");
  const [untracked, setUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  return (
    <FormDialog
      title={t("branchDialog.stashTitle")}
      description={t("branchDialog.stashBody")}
      submitLabel={t("branchDialog.stash")}
      onSubmit={() =>
        b.stashSave({
          message: message.trim() || null,
          includeUntracked: untracked,
          keepIndex,
        })
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Field label={t("branchDialog.stashMessage")} htmlFor="stash-message">
          <Input
            id="stash-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("branchDialog.stashMessagePlaceholder")}
            autoFocus
          />
        </Field>
        <div className="flex flex-col gap-2.5">
          <Checkbox
            checked={untracked}
            onCheckedChange={setUntracked}
            label={t("branchDialog.includeUntracked")}
          />
          <Checkbox
            checked={keepIndex}
            onCheckedChange={setKeepIndex}
            label={t("branchDialog.keepIndex")}
          />
        </div>
      </div>
    </FormDialog>
  );
}

const RESET_MODES: ResetMode[] = ["soft", "mixed", "hard"];

function Reset({
  repo,
  refs,
  status,
  oid,
  subject,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  status: WorkingStatus | undefined;
  oid: string;
  subject: string;
  onClose: Close;
}) {
  const b = useBranching(repo);
  const [mode, setMode] = useState<ResetMode>("mixed");
  const [confirming, setConfirming] = useState(false);
  const branch = currentName(refs);
  // Hard reset loses changes to tracked files (untracked ones stay).
  const lost = (status?.entries ?? []).filter((e) => e.unstaged !== "untracked").length;
  if (confirming) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && setConfirming(false)}
        title={t("branchDialog.hardResetTitle", { branch })}
        consequence={
          lost > 0
            ? t("branchDialog.hardResetLoses", { files: plural("count.files", lost) })
            : t("branchDialog.hardResetClean")
        }
        confirmLabel={t("branchDialog.hardResetConfirm")}
        destructive
        onConfirm={() => {
          void b.reset(oid, "hard");
          onClose();
        }}
      />
    );
  }
  return (
    <FormDialog
      title={t("branchDialog.resetTitle", { branch })}
      description={t("branchDialog.resetTo", { branch, subject })}
      submitLabel={mode === "hard" ? t("branchDialog.resetHardNext") : t("branchDialog.reset")}
      danger={mode === "hard"}
      onSubmit={async () => {
        if (mode === "hard") {
          setConfirming(true);
          return false;
        }
        await b.reset(oid, mode);
      }}
      onClose={onClose}
    >
      <div
        role="radiogroup"
        aria-label={t("branchDialog.resetMode")}
        className="flex flex-col gap-2"
      >
        {RESET_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "flex flex-col gap-0.5 rounded-control border px-3 py-2 text-left focus-ring",
              mode === m ? "border-accent bg-selected" : "border-line hover:bg-hover",
            )}
          >
            <span className="font-medium text-fg">{t(`branchDialog.mode.${m}`)}</span>
            <span className="text-small text-fg-secondary">{t(`branchDialog.modeHint.${m}`)}</span>
          </button>
        ))}
        {mode === "hard" && lost > 0 && (
          <p className="flex items-center gap-1.5 text-small text-warning">
            <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
            {t("branchDialog.hardResetLoses", { files: plural("count.files", lost) })}
          </p>
        )}
      </div>
    </FormDialog>
  );
}

const OPERATION_NAMES = {
  merge: "branchDialog.op.merge",
  rebase: "branchDialog.op.rebase",
  cherryPick: "branchDialog.op.cherryPick",
  revert: "branchDialog.op.revert",
} as const;

/** The open branching dialog for `repo`, if any. Rendered once per repository view. */
export function BranchDialogs({
  repo,
  refs,
  status,
}: {
  repo: string;
  refs: RefsSnapshot | undefined;
  status: WorkingStatus | undefined;
}) {
  const dialog = useBranchDialog((s) => (s.repo === repo ? s.dialog : null));
  const close = useBranchDialog((s) => s.close);
  const b = useBranching(repo);
  if (!dialog || !refs) return null;
  const current = currentName(refs);

  switch (dialog.mode) {
    case "flowInit":
      return <FlowInitDialog repo={repo} refs={refs} onClose={close} />;
    case "flowStart":
      return <FlowStartDialog repo={repo} refs={refs} kind={dialog.kind} onClose={close} />;
    case "flowFinish":
      return <FlowFinishDialog repo={repo} refs={refs} branch={dialog.branch} onClose={close} />;
    case "createBranch":
      return (
        <CreateBranch
          repo={repo}
          refs={refs}
          start={dialog.start}
          startLabel={dialog.startLabel}
          onClose={close}
        />
      );
    case "renameBranch":
      return <RenameBranch repo={repo} refs={refs} name={dialog.name} onClose={close} />;
    case "checkoutRemote":
      return (
        <CheckoutRemote
          repo={repo}
          refs={refs}
          remoteBranch={dialog.remoteBranch}
          onClose={close}
        />
      );
    case "localChanges":
      return <LocalChanges repo={repo} dialog={dialog} onClose={close} />;
    case "setUpstream":
      return <SetUpstream repo={repo} refs={refs} branch={dialog.branch} onClose={close} />;
    case "createTag":
      return (
        <CreateTag
          repo={repo}
          refs={refs}
          target={dialog.target}
          targetLabel={dialog.targetLabel}
          onClose={close}
        />
      );
    case "stash":
      return <StashForm repo={repo} onClose={close} />;
    case "reset":
      return (
        <Reset
          repo={repo}
          refs={refs}
          status={status}
          oid={dialog.oid}
          subject={dialog.subject}
          onClose={close}
        />
      );
    case "deleteBranch":
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={
            dialog.unmerged
              ? t("branchDialog.deleteUnmergedTitle", { name: dialog.name })
              : t("branchDialog.deleteTitle", { name: dialog.name })
          }
          consequence={
            dialog.unmerged ? t("branchDialog.deleteUnmergedBody") : t("branchDialog.deleteBody")
          }
          confirmLabel={dialog.unmerged ? t("branchDialog.deleteAnyway") : t("branchDialog.delete")}
          destructive
          onConfirm={() => void b.deleteBranch(dialog.name, dialog.unmerged)}
        />
      );
    case "deleteRemoteBranch":
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("branchDialog.deleteRemoteTitle", { name: `${dialog.remote}/${dialog.branch}` })}
          consequence={t("branchDialog.deleteRemoteBody", { remote: dialog.remote })}
          confirmLabel={t("branchDialog.deleteRemote", { remote: dialog.remote })}
          destructive
          onConfirm={() => void deleteRemoteBranch(repo, dialog.remote, dialog.branch)}
        />
      );
    case "checkoutDetached":
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("branchDialog.detachedTitle", { name: dialog.label })}
          consequence={t("branchDialog.detachedBody")}
          confirmLabel={t("branchDialog.checkout")}
          onConfirm={() => void b.checkout({ kind: "detached", oid: dialog.oid })}
        />
      );
    case "deleteTag":
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("branchDialog.deleteTagTitle", { name: dialog.name })}
          consequence={t("branchDialog.deleteTagBody")}
          confirmLabel={t("branchDialog.deleteTag")}
          destructive
          onConfirm={() => void b.deleteTag(dialog.name)}
        />
      );
    case "dropStash":
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("branchDialog.dropTitle")}
          consequence={t("branchDialog.dropBody", { message: dialog.message })}
          confirmLabel={t("branchDialog.drop")}
          destructive
          onConfirm={() => void b.stashDrop(dialog.index)}
        />
      );
    case "rebase":
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("branchDialog.rebaseTitle", { branch: current, name: dialog.label })}
          consequence={t("branchDialog.rebaseBody", { branch: current, name: dialog.label })}
          confirmLabel={t("branchDialog.rebase")}
          onConfirm={() => void b.rebase(dialog.onto, dialog.label)}
        />
      );
    case "interactiveRebase":
      return (
        <RebaseEditor
          repo={repo}
          base={dialog.base}
          baseLabel={dialog.label}
          current={current}
          onClose={close}
        />
      );
    case "abortOperation": {
      const kind = status?.operation?.kind ?? "merge";
      const name = t(OPERATION_NAMES[kind]);
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t("branchDialog.abortTitle", { operation: name })}
          consequence={t("branchDialog.abortBody", { branch: current })}
          confirmLabel={t("branchDialog.abort", { operation: name })}
          destructive
          onConfirm={() => void b.abortOperation()}
        />
      );
    }
  }
}
