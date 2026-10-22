// Settings → Actions: custom actions (programs in menus and the palette). Each card edits
// one action in place; text fields save when they lose focus, the rest at once.

import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

import { useSettings } from "@/app/settings";
import { t } from "@/i18n";
import { ipc, type ActionScope, type CustomAction } from "@/ipc";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { IconButton } from "@/ui/IconButton";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";

const SCOPES: ActionScope[] = ["repository", "commit", "branch", "file"];
const VARIABLES = ["{repo}", "{sha}", "{shortSha}", "{branch}", "{file}", "{files}"];

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A labelled field in a card. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-small text-fg-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

function ActionCard({
  action,
  onChange,
  onRemove,
}: {
  action: CustomAction;
  onChange: (next: CustomAction) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(action);
  const id = (field: string) => `action-${action.id}-${field}`;
  const save = (patch: Partial<CustomAction> = {}) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (JSON.stringify(next) !== JSON.stringify(action)) onChange(next);
  };
  const text = (field: "name" | "program" | "arguments") => ({
    id: id(field),
    value: draft[field],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [field]: e.target.value }),
    onBlur: () => save(),
    onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && save(),
  });
  const browse = async () => {
    const program = await ipc.pickFile(t("customActions.pickProgram"));
    if (program) save({ program });
  };
  return (
    <li className="flex flex-col gap-3 rounded-menu border border-line-subtle bg-panel p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t("customActions.name")} htmlFor={id("name")}>
            <Input {...text("name")} placeholder={t("customActions.namePlaceholder")} />
          </Field>
        </div>
        <div className="w-44">
          <Field label={t("customActions.scope")} htmlFor={id("scope")}>
            <Select
              id={id("scope")}
              value={draft.scope}
              onValueChange={(scope) => save({ scope: scope as ActionScope })}
              options={SCOPES.map((s) => ({ value: s, label: t(`customActions.scope.${s}`) }))}
            />
          </Field>
        </div>
        <IconButton
          icon={Trash2}
          label={t("customActions.remove", { name: draft.name })}
          onClick={onRemove}
        />
      </div>
      <Field label={t("customActions.program")} htmlFor={id("program")}>
        <div className="flex gap-2">
          <Input
            {...text("program")}
            className="flex-1 font-code"
            placeholder={t("customActions.programPlaceholder")}
          />
          <Button icon={FolderOpen} onClick={() => void browse()}>
            {t("customActions.browse")}
          </Button>
        </div>
      </Field>
      <Field label={t("customActions.arguments")} htmlFor={id("arguments")}>
        <Input
          {...text("arguments")}
          className="font-code"
          placeholder={t("customActions.argumentsPlaceholder")}
        />
      </Field>
      <div className="flex gap-6">
        <label className="flex items-center gap-2">
          <Checkbox checked={draft.confirm} onCheckedChange={(confirm) => save({ confirm })} />
          {t("customActions.confirm")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={draft.showOutput}
            onCheckedChange={(showOutput) => save({ showOutput })}
          />
          {t("customActions.showOutput")}
        </label>
      </div>
    </li>
  );
}

export function ActionsSettings() {
  const { settings, update } = useSettings();
  const actions = settings.customActions;
  const replace = (index: number, next: CustomAction | null) =>
    update({
      customActions: next
        ? actions.map((a, i) => (i === index ? next : a))
        : actions.filter((_, i) => i !== index),
    });
  const add = () =>
    update({
      customActions: [
        ...actions,
        {
          id: newId(),
          name: t("customActions.newName"),
          program: "",
          arguments: "",
          scope: "repository",
          confirm: true,
          showOutput: true,
        },
      ],
    });
  return (
    <div className="flex flex-col gap-3 py-3">
      <p className="text-small text-fg-secondary">{t("customActions.intro")}</p>
      <p className="text-small text-fg-secondary">
        {t("customActions.variables")}{" "}
        {VARIABLES.map((v, i) => (
          <span key={v}>
            {i > 0 && ", "}
            <code className="font-code text-fg">{v}</code>
          </span>
        ))}
        . {t("customActions.quoting")}
      </p>
      {actions.length === 0 ? (
        <p className="text-fg-muted">{t("customActions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((action, i) => (
            <ActionCard
              key={action.id}
              action={action}
              onChange={(next) => replace(i, next)}
              onRemove={() => replace(i, null)}
            />
          ))}
        </ul>
      )}
      <div>
        <Button icon={Plus} onClick={add}>
          {t("customActions.add")}
        </Button>
      </div>
    </div>
  );
}
