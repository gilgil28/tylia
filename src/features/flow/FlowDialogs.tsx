// git-flow dialogs: set up, start a feature / release / hotfix, finish one.

import { useState } from "react";

import { FormDialog } from "@/features/branching/FormDialog";
import { t } from "@/i18n";
import type { FlowConfig, FlowKind, RefsSnapshot } from "@/ipc";
import { Checkbox } from "@/ui/Checkbox";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";
import { Textarea } from "@/ui/Textarea";

import { classifyFlowBranch, flowPrefix, useFlow, useFlowState } from "./useFlow";

type Close = () => void;

/** Quick client-side check; Git validates names properly. */
const plausible = (name: string) => name.trim() !== "" && !/\s/.test(name.trim());

export function FlowInitDialog({
  repo,
  refs,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  onClose: Close;
}) {
  const state = useFlowState(repo);
  const flow = useFlow(repo);
  const initial = state.data?.config ?? state.data?.suggested;
  const [config, setConfig] = useState<FlowConfig | null>(null);
  const value = config ?? initial;
  if (!value) return null;
  const set = (patch: Partial<FlowConfig>) => setConfig({ ...value, ...patch });
  const developExists = refs.branches.some((b) => b.name === value.develop.trim());
  const trimmed: FlowConfig = {
    main: value.main.trim(),
    develop: value.develop.trim(),
    featurePrefix: value.featurePrefix.trim(),
    releasePrefix: value.releasePrefix.trim(),
    hotfixPrefix: value.hotfixPrefix.trim(),
    versionTagPrefix: value.versionTagPrefix.trim(),
  };
  const valid =
    [
      trimmed.main,
      trimmed.develop,
      trimmed.featurePrefix,
      trimmed.releasePrefix,
      trimmed.hotfixPrefix,
    ].every(plausible) &&
    trimmed.main !== trimmed.develop &&
    !/\s/.test(trimmed.versionTagPrefix);
  const field = (key: keyof FlowConfig, label: string, hint?: string) => (
    <Field label={label} htmlFor={`flow-${key}`} hint={hint}>
      <Input
        id={`flow-${key}`}
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <FormDialog
      title={state.data?.config ? t("flow.setupEditTitle") : t("flow.setupTitle")}
      description={t("flow.setupDescription")}
      submitLabel={t("flow.setupSubmit")}
      width="md"
      valid={valid}
      onSubmit={() => flow.init(trimmed)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("flow.main")} htmlFor="flow-main">
            <Select
              id="flow-main"
              aria-label={t("flow.main")}
              value={value.main}
              onValueChange={(main) => set({ main })}
              options={refs.branches.map((b) => ({ value: b.name, label: b.name }))}
            />
          </Field>
          {field(
            "develop",
            t("flow.develop"),
            developExists ? undefined : t("flow.developCreated", { main: value.main }),
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {field("featurePrefix", t("flow.featurePrefix"))}
          {field("releasePrefix", t("flow.releasePrefix"))}
          {field("hotfixPrefix", t("flow.hotfixPrefix"))}
        </div>
        {field("versionTagPrefix", t("flow.tagPrefix"), t("flow.tagPrefixHint"))}
      </div>
    </FormDialog>
  );
}

export function FlowStartDialog({
  repo,
  refs,
  kind,
  onClose,
}: {
  repo: string;
  refs: RefsSnapshot;
  kind: FlowKind;
  onClose: Close;
}) {
  const state = useFlowState(repo);
  const flow = useFlow(repo);
  const [name, setName] = useState("");
  const config = state.data?.config;
  if (!config) return null;
  const branch = `${flowPrefix(config, kind)}${name.trim()}`;
  const base = kind === "hotfix" ? config.main : config.develop;
  const taken = refs.branches.some((b) => b.name === branch);
  return (
    <FormDialog
      title={t(`flow.startTitle.${kind}`)}
      description={t("flow.startDescription", { base })}
      submitLabel={t("flow.start")}
      valid={plausible(name) && !taken}
      onSubmit={() => flow.start(kind, name.trim())}
      onClose={onClose}
    >
      <Field
        label={kind === "feature" ? t("flow.featureName") : t("flow.version")}
        htmlFor="flow-name"
        hint={
          taken ? (
            <span className="text-danger">{t("branchDialog.nameTaken")}</span>
          ) : (
            name.trim() && t("flow.branchPreview", { branch })
          )
        }
      >
        <Input
          id="flow-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            kind === "feature" ? t("flow.featurePlaceholder") : t("flow.versionPlaceholder")
          }
          autoFocus
        />
      </Field>
    </FormDialog>
  );
}

export function FlowFinishDialog({
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
  const state = useFlowState(repo);
  const flow = useFlow(repo);
  const config = state.data?.config;
  const flowBranch = classifyFlowBranch(config, branch);
  const tagged = flowBranch?.kind === "release" || flowBranch?.kind === "hotfix";
  const [message, setMessage] = useState(
    flowBranch
      ? t(flowBranch.kind === "hotfix" ? "flow.hotfixTagMessage" : "flow.releaseTagMessage", {
          name: flowBranch.name,
        })
      : "",
  );
  const [keep, setKeep] = useState(false);
  if (!config || !flowBranch) return null;

  // Mirrors flow.rs: a hotfix goes into an open release instead of develop.
  const openRelease = refs.branches.find((b) => b.name.startsWith(config.releasePrefix))?.name;
  const second = flowBranch.kind === "hotfix" && openRelease ? openRelease : config.develop;
  const tag = `${config.versionTagPrefix}${flowBranch.name}`;
  const steps =
    flowBranch.kind === "feature"
      ? [t("flow.stepMerge", { branch, into: config.develop })]
      : [
          t("flow.stepMerge", { branch, into: config.main }),
          t("flow.stepTag", { tag, into: config.main }),
          t("flow.stepMerge", { branch, into: second }),
        ];
  if (!keep) steps.push(t("flow.stepDelete", { branch }));

  return (
    <FormDialog
      title={t(`flow.finishTitle.${flowBranch.kind}`, { branch })}
      description={t("flow.finishDescription")}
      submitLabel={t("flow.finish")}
      onSubmit={() => flow.finish(branch, tagged ? message : null, keep)}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-fg-secondary">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {tagged && (
          <Field label={t("flow.tagMessage", { tag })} htmlFor="flow-tag-message">
            <Textarea
              id="flow-tag-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
            />
          </Field>
        )}
        <Checkbox checked={keep} onCheckedChange={setKeep} label={t("flow.keepBranch")} />
      </div>
    </FormDialog>
  );
}
