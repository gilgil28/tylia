import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useRef, type FormEvent, type ReactNode } from "react";

import { t } from "@/i18n";

import { cn } from "./cn";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Footer actions, right-aligned. A `type="submit"` button runs on Enter. */
  footer?: ReactNode;
  /** Called on Enter / submit. Esc and the close button call `onOpenChange(false)`. */
  onSubmit?: () => void;
  /** Visual marker before the title (e.g. a warning icon). */
  icon?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  children?: ReactNode;
}

const widths = { sm: "w-96", md: "w-112", lg: "w-160", xl: "w-220" };

/** Where focus starts when nothing in the dialog asked for it (`autoFocus`). */
const FIRST_FIELD = "[data-dialog-body] :is(input:not([type=hidden]), textarea):not(:disabled)";

/**
 * Starts focus in the dialog's field (the `autoFocus` one, else the first) rather than the
 * close button, and takes it back once if something else grabs it while the dialog opens
 * (a menu that opened the dialog returns focus to its trigger as it closes).
 */
function focusOnOpen(content: HTMLElement | null, e: Event) {
  if (!content) return;
  const active = document.activeElement;
  const target =
    active instanceof HTMLElement &&
    content.contains(active) &&
    !active.matches("[data-dialog-close]")
      ? active
      : // `data-autofocus` marks an `autoFocus` control whose focus another dialog's focus
        // trap took back (a confirmation opened from a dialog).
        (content.querySelector<HTMLElement>("[data-autofocus]") ??
        content.querySelector<HTMLElement>(FIRST_FIELD));
  if (!target) return;
  e.preventDefault();
  target.focus();
  setTimeout(() => {
    const now = document.activeElement;
    if (now !== target && (!content.contains(now) || now?.matches("[data-dialog-close]"))) {
      target.focus();
    }
  }, 0);
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  onSubmit,
  icon,
  width = "md",
  children,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <D.Content
          ref={contentRef}
          onOpenAutoFocus={(e) => focusOnOpen(contentRef.current, e)}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[85vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-dialog-in overflow-hidden rounded-dialog bg-elevated text-fg shadow-float outline-none",
            widths[width],
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <form onSubmit={submit} className="flex max-h-[85vh] flex-col">
            <div className="flex items-start gap-3 px-5 pt-5 pb-3">
              {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
              <div className="min-w-0 flex-1">
                <D.Title className="text-dialog-title font-semibold">{title}</D.Title>
                {description && (
                  <D.Description className="mt-1 text-fg-secondary">{description}</D.Description>
                )}
              </div>
              <D.Close asChild>
                <IconButton
                  icon={X}
                  label={t("common.close")}
                  compact
                  className="-mt-1 -mr-2"
                  data-dialog-close
                />
              </D.Close>
            </div>
            {children && (
              <div data-dialog-body className="min-h-0 overflow-auto px-5 pb-3">
                {children}
              </div>
            )}
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-line-subtle bg-panel px-5 py-3">
                {footer}
              </div>
            )}
          </form>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
