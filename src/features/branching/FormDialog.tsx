import { useState, type ReactNode } from "react";

import { t } from "@/i18n";
import { Button } from "@/ui/Button";
import { Dialog, type DialogProps } from "@/ui/Dialog";

/** A small form dialog: Cancel + a submit button, busy while the action runs. */
export function FormDialog({
  title,
  description,
  submitLabel,
  valid = true,
  danger = false,
  width = "sm",
  onSubmit,
  onClose,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  submitLabel: string;
  valid?: boolean;
  danger?: boolean;
  width?: DialogProps["width"];
  /** Resolves true when done (the dialog closes); false keeps it open. */
  onSubmit: () => Promise<boolean | void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const done = await onSubmit();
    setBusy(false);
    if (done !== false) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      width={width}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            type="submit"
            variant={danger ? "danger" : "primary"}
            disabled={!valid}
            loading={busy}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
