import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";

import { t } from "@/i18n";
import { ipc, isIpcError, type GitVersion } from "@/ipc";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { Skeleton } from "@/ui/Skeleton";

const formatVersion = (v: GitVersion) => `${v.major}.${v.minor}.${v.patch}`;

/** Which Git Tylia found — the `git_version` command, end to end. */
export function GitStatusLine() {
  const { data, error, isPending } = useQuery({
    queryKey: ["git-version"],
    queryFn: ipc.gitVersion,
    retry: false,
  });

  // Same height loading or loaded, so nothing shifts when Git is found.
  if (isPending)
    return (
      <div className="flex h-5 items-center">
        <Skeleton className="h-2.5 w-48" />
      </div>
    );

  if (error) {
    const missing = isIpcError(error) && error.kind === "gitNotFound";
    return (
      <ErrorPanel
        className="w-112 max-w-full text-left"
        message={missing ? t("shell.gitMissing") : t("shell.gitError")}
        command={isIpcError(error) ? error.command : null}
        stderr={isIpcError(error) ? (error.stderr ?? error.message) : String(error)}
      />
    );
  }

  const version = formatVersion(data.version);
  return (
    <p className="flex h-5 items-center gap-2 text-small text-fg-muted">
      {!data.supported && (
        <CircleAlert size={14} strokeWidth={1.75} className="text-warning" aria-hidden />
      )}
      <span>
        {data.supported
          ? t("shell.gitFound", { version })
          : t("shell.gitUnsupported", { version, minimum: formatVersion(data.minimum) })}
      </span>
      <span aria-hidden>·</span>
      <code className="truncate" data-selectable title={data.path}>
        {data.path}
      </code>
    </p>
  );
}
