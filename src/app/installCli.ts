import { t } from "@/i18n";
import { ipc, isIpcError } from "@/ipc";
import { toast } from "@/ui/Toast";

/** macOS: links the `tylia` command into /usr/local/bin, then says how it went. */
export function installCli() {
  ipc.installCli().then(
    (outcome) => {
      if (outcome === "cancelled") return;
      toast({
        kind: "success",
        title: outcome === "installed" ? t("cli.installed") : t("cli.alreadyInstalled"),
        description: t("cli.usage"),
      });
    },
    (err: unknown) =>
      toast({
        kind: "error",
        title: t("cli.failed"),
        description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
        error: isIpcError(err) ? err : { message: String(err) },
      }),
  );
}
