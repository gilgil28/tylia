import { useState } from "react";

import { useWorkspace } from "@/app/workspace";
import { t } from "@/i18n";
import { ipc } from "@/ipc";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";

import { createRepoAt } from "./open";
import { joinPath } from "./paths";
import { useParentFolder } from "./useParentFolder";

export function FolderField({
  id,
  value,
  onChange,
  pickTitle,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  pickTitle: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1"
      />
      <Button
        disabled={disabled}
        onClick={() =>
          void ipc.pickFolder(pickTitle, value || undefined).then((p) => p && onChange(p))
        }
      >
        {t("create.choose")}
      </Button>
    </div>
  );
}

export function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [parent, setParent] = useParentFolder();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const setLastParent = useWorkspace((s) => s.setLastParentFolder);

  const valid = parent.trim() !== "" && name.trim() !== "";
  const path = valid ? joinPath(parent.trim(), name.trim()) : "";

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await createRepoAt(path);
    setBusy(false);
    if (ok) {
      setLastParent(parent.trim());
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("create.title")}
      description={t("create.description")}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button size="lg" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" variant="primary" type="submit" disabled={!valid} loading={busy}>
            {t("create.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("create.name")} htmlFor="create-name">
          <Input
            id="create-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("create.namePlaceholder")}
          />
        </Field>
        <Field label={t("create.location")} htmlFor="create-location">
          <FolderField
            id="create-location"
            value={parent}
            onChange={setParent}
            pickTitle={t("create.pickTitle")}
          />
        </Field>
        <p className="min-h-5 text-small break-all text-fg-muted" data-selectable>
          {path && t("create.preview", { path })}
        </p>
      </div>
    </Dialog>
  );
}
