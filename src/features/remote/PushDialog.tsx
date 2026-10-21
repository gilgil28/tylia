import { useState } from "react";

import { plural, t } from "@/i18n";
import type { Branch, RefsSnapshot } from "@/ipc";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";

import { pushRepo, pushTarget } from "./operations";
import { useRemoteDialog } from "./RemoteDialogs";

/** The remote a first push goes to: `origin` if there is one. */
function defaultRemote(refs: RefsSnapshot): string {
  return refs.remotes.find((r) => r.name === "origin")?.name ?? refs.remotes[0]?.name ?? "";
}

/** Push with options: remote, remote branch name, upstream, tags, force (with lease). */
export function PushDialog({
  repo,
  refs,
  branch,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  branch: Branch;
  onClose: () => void;
}) {
  const target = pushTarget(branch);
  const [remote, setRemote] = useState(target?.remote ?? defaultRemote(refs));
  const [remoteBranch, setRemoteBranch] = useState(target?.remoteBranch ?? branch.name);
  const [setUpstream, setSetUpstream] = useState(!target);
  const [tags, setTags] = useState(false);
  const [force, setForce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const openRemoteDialog = useRemoteDialog((s) => s.open);

  const name = remoteBranch.trim();
  const destination = `${remote}/${name}`;
  const existing = refs.remotes
    .find((r) => r.name === remote)
    ?.branches.find((b) => b.name === name);
  const valid = remote !== "" && name !== "";

  const push = (forceLease: string | null) => {
    onClose();
    void pushRepo(repo, {
      remote,
      branch: branch.name,
      remoteBranch: name,
      setUpstream,
      tags,
      forceLease,
    });
  };

  // Commits a force push would drop: known when pushing to the branch's own upstream.
  const isUpstream = target?.remote === remote && target.remoteBranch === name;
  const consequence = !existing
    ? t("push.confirmNew", { destination })
    : isUpstream && branch.behind > 0
      ? t("push.confirmLoses", {
          commits: plural("count.commits", branch.behind),
          destination,
          branch: branch.name,
        })
      : t("push.confirmReplaces", { destination, branch: branch.name });

  if (refs.remotes.length === 0) {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={t("push.title", { branch: branch.name })}
        description={t("push.noRemotes")}
        width="sm"
        footer={
          <>
            <Button size="lg" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              size="lg"
              variant="primary"
              onClick={() => {
                onClose();
                openRemoteDialog({ repo, mode: "add" });
              }}
            >
              {t("push.addRemote")}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <>
      <Dialog
        open={!confirming}
        onOpenChange={(open) => !open && onClose()}
        title={t("push.title", { branch: branch.name })}
        width="sm"
        onSubmit={() => {
          if (!valid) return;
          if (force) setConfirming(true);
          else push(null);
        }}
        footer={
          <>
            <Button size="lg" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              size="lg"
              type="submit"
              variant={force ? "danger" : "primary"}
              disabled={!valid}
            >
              {force ? t("push.submitForce") : t("push.submit")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t("push.remote")} htmlFor="push-remote">
            <Select
              id="push-remote"
              value={remote}
              onValueChange={setRemote}
              options={refs.remotes.map((r) => ({
                value: r.name,
                label: r.name,
                hint: r.pushUrl ?? r.url ?? undefined,
              }))}
            />
          </Field>
          <Field label={t("push.remoteBranch")} htmlFor="push-branch">
            <Input
              id="push-branch"
              value={remoteBranch}
              onChange={(e) => setRemoteBranch(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <Checkbox
                checked={setUpstream}
                onCheckedChange={setSetUpstream}
                label={t("push.setUpstream")}
              />
              <p className="pl-6 text-small text-fg-muted">{t("push.setUpstreamHint")}</p>
            </div>
            <Checkbox checked={tags} onCheckedChange={setTags} label={t("push.tags")} />
            <div className="flex flex-col gap-0.5">
              <Checkbox checked={force} onCheckedChange={setForce} label={t("push.force")} />
              {force && <p className="pl-6 text-small text-warning">{t("push.forceHint")}</p>}
            </div>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title={t("push.confirmTitle", { destination })}
        consequence={consequence}
        confirmLabel={t("push.confirm")}
        destructive
        onConfirm={() => push(existing?.oid ?? "")}
      />
    </>
  );
}
