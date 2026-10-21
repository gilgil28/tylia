import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/i18n";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** States the consequence, e.g. "This permanently deletes uncommitted changes in 3 files." */
  consequence: ReactNode;
  /** A verb naming the action, e.g. "Discard 3 files". */
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

/**
 * Asks before an action and says what it will do. Destructive confirmations focus Cancel
 * first, so Enter alone never destroys data.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  destructive = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const confirm = () => {
    onConfirm();
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={consequence}
      width="sm"
      icon={
        destructive && (
          <span className="flex size-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger">
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden />
          </span>
        )
      }
      onSubmit={confirm}
      footer={
        <>
          <Button
            size="lg"
            onClick={() => onOpenChange(false)}
            autoFocus={destructive}
            data-autofocus={destructive || undefined}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            type="submit"
            variant={destructive ? "danger" : "primary"}
            autoFocus={!destructive}
            data-autofocus={!destructive || undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
