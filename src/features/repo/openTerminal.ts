import { t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { toast } from "@/ui/Toast";

/** Opens the user's terminal in `repo`; failures become a toast saying why. */
export function openTerminal(repo: string) {
  ipc.openTerminal(repo).catch((err: unknown) =>
    toast({
      kind: "error",
      title: t("actions.openTerminalFailed"),
      description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
      error: isIpcError(err) ? err : { message: String(err) },
    }),
  );
}
