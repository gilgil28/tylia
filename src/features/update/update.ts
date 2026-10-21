// Update check state. A check runs only when the user asks (Settings, the palette) or, with
// "Check for updates" on, once at start; nothing else talks to the release server.

import { create } from "zustand";

import { appVersion } from "@/app/boot";
import { t } from "@/i18n";
import { ipc, isIpcError, type IpcError, type UpdateInfo } from "@/ipc";
import { toast } from "@/ui/Toast";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "failed"; error: IpcError };

/**
 * Who asked, which decides how the result is reported: `start` only announces an update
 * (offline is normal), `settings` shows everything inline, `palette` uses toasts.
 */
export type CheckSource = "start" | "settings" | "palette";

interface UpdateState {
  status: UpdateStatus;
  dialogOpen: boolean;
  check(source: CheckSource): Promise<void>;
  setDialogOpen(open: boolean): void;
}

const asError = (err: unknown): IpcError =>
  isIpcError(err)
    ? err
    : { kind: "updateFailed", message: String(err), command: null, stderr: null };

export const useUpdate = create<UpdateState>((set, get) => ({
  status: { kind: "idle" },
  dialogOpen: false,
  async check(source) {
    if (get().status.kind === "checking") return;
    set({ status: { kind: "checking" } });
    try {
      const info = await ipc.checkUpdate();
      if (!info) {
        set({ status: { kind: "upToDate" } });
        if (source === "palette") {
          toast({ kind: "success", title: t("update.upToDate", { version: appVersion }) });
        }
        return;
      }
      set({ status: { kind: "available", info } });
      if (source === "start") {
        toast({
          kind: "success",
          title: t("update.availableTitle", { version: info.version }),
          action: { label: t("update.view"), run: () => set({ dialogOpen: true }) },
        });
      } else {
        set({ dialogOpen: true });
      }
    } catch (err) {
      const error = asError(err);
      set({ status: { kind: "failed", error } });
      if (source === "palette") toast({ kind: "error", title: t("update.checkFailed"), error });
    }
  },
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}));
