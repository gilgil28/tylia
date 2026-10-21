import { t } from "@/i18n";
import { ipc, isIpcError, type DiffRequest } from "@/ipc";
import { toast } from "@/ui/Toast";

/** Opens the user's external diff tool for one file; refusals become a toast saying why. */
export function openInDiffTool(repo: string, request: DiffRequest) {
  ipc.diffTool(repo, request).catch((err: unknown) =>
    toast({
      kind: "error",
      title: t("actions.diffToolFailed"),
      description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
      error: isIpcError(err) ? err : { message: String(err) },
    }),
  );
}
