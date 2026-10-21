import { CircleCheck, CircleX, X } from "lucide-react";
import { Toast as T } from "radix-ui";
import { useState } from "react";
import { create } from "zustand";

import { t } from "@/i18n";

import { Button } from "./Button";
import { ErrorPanel, type ErrorDetails } from "./ErrorPanel";
import { IconButton } from "./IconButton";
import { ProgressRing } from "./ProgressRing";

export interface ToastAction {
  label: string;
  run: () => void;
}

export type ToastInput =
  | { kind: "success"; title: string; description?: string; action?: ToastAction }
  | {
      kind: "error";
      title: string;
      description?: string;
      error?: ErrorDetails;
      action?: ToastAction;
    }
  | { kind: "progress"; title: string; description?: string; progress?: number };

type ToastItem = ToastInput & { id: number };

interface ToastState {
  toasts: ToastItem[];
  push(toast: ToastInput): number;
  update(id: number, toast: ToastInput): void;
  dismiss(id: number): void;
}

let nextId = 1;

const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(toast) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  update(id, toast) {
    set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...toast, id } : x)) }));
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

/** Shows a toast and returns its id (for `toast.update` / `toast.dismiss`). */
export const toast = Object.assign((input: ToastInput) => useToasts.getState().push(input), {
  update: (id: number, input: ToastInput) => useToasts.getState().update(id, input),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
});

/** Success toasts close themselves; errors and running operations stay until dismissed. */
const DURATION = { success: 4000, error: Infinity, progress: Infinity };

function ToastCard({ item }: { item: ToastItem }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <T.Root
      duration={DURATION[item.kind]}
      onOpenChange={(open) => !open && toast.dismiss(item.id)}
      className="flex w-90 animate-float-in flex-col gap-2 rounded-menu bg-elevated p-3 text-fg shadow-float"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          {item.kind === "success" && (
            <CircleCheck size={16} strokeWidth={1.75} className="text-success" aria-hidden />
          )}
          {item.kind === "error" && (
            <CircleX size={16} strokeWidth={1.75} className="text-danger" aria-hidden />
          )}
          {item.kind === "progress" && (
            <ProgressRing value={item.progress} className="text-accent" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <T.Title className="font-medium">{item.title}</T.Title>
          {item.description && (
            <T.Description className="mt-0.5 text-small text-fg-secondary">
              {item.description}
            </T.Description>
          )}
        </div>
        <T.Close asChild>
          <IconButton icon={X} label={t("common.dismiss")} compact className="-mt-1 -mr-1" />
        </T.Close>
      </div>
      {((item.kind === "error" && item.error) || ("action" in item && item.action)) && (
        <div className="flex items-center gap-2 pl-6">
          {"action" in item && item.action && (
            <Button
              size="sm"
              onClick={() => {
                item.action!.run();
                toast.dismiss(item.id);
              }}
            >
              {item.action.label}
            </Button>
          )}
          {item.kind === "error" && item.error && (
            <Button size="sm" variant="ghost" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? t("common.hideDetails") : t("common.details")}
            </Button>
          )}
        </div>
      )}
      {item.kind === "error" && item.error && showDetails && <ErrorPanel {...item.error} />}
    </T.Root>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <T.Provider swipeDirection="right">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
      <T.Viewport className="fixed right-0 bottom-0 z-50 m-0 flex max-w-full list-none flex-col gap-2 p-4 outline-none" />
    </T.Provider>
  );
}
