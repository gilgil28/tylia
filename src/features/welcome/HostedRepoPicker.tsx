// The Clone dialog's "Your repositories": the signed-in accounts' repositories (Settings →
// Accounts), searchable; picking one fills in the URL. Asked for only when this is shown.

import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useMemo, useState } from "react";

import { relativeTime } from "@/app/format";
import { t } from "@/i18n";
import { ipc, isIpcError, type HostedRepo, type HostingAccount } from "@/ipc";
import { Checkbox } from "@/ui/Checkbox";
import { cn } from "@/ui/cn";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";

const accountKey = (a: HostingAccount) => `${a.provider}:${a.host}:${a.login}`;

export function HostedRepoPicker({
  accounts,
  picked,
  onPick,
  disabled,
}: {
  accounts: HostingAccount[];
  picked: string;
  onPick: (url: string) => void;
  disabled: boolean;
}) {
  const [key, setKey] = useState(accountKey(accounts[0]!));
  const [query, setQuery] = useState("");
  const [ssh, setSsh] = useState(false);
  const account = accounts.find((a) => accountKey(a) === key) ?? accounts[0]!;
  const repos = useQuery({
    queryKey: ["hosted-repos", accountKey(account)],
    queryFn: () => ipc.listHostedRepos(account),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos.data ?? []).filter(
      (r) => !q || r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }, [repos.data, query]);
  const urlOf = (r: HostedRepo) => (ssh && r.sshUrl ? r.sshUrl : r.httpsUrl);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {accounts.length > 1 && (
          <div className="w-56 shrink-0">
            <Select
              aria-label={t("clone.account")}
              value={key}
              onValueChange={setKey}
              options={accounts.map((a) => ({
                value: accountKey(a),
                label: `${a.login} · ${a.host}`,
              }))}
            />
          </div>
        )}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("clone.searchRepos")}
          aria-label={t("clone.searchRepos")}
          className="flex-1"
          autoFocus
        />
      </div>
      <div
        role="listbox"
        aria-label={t("clone.yourRepos")}
        className="flex h-52 flex-col overflow-auto rounded-menu border border-line-subtle bg-panel py-1"
      >
        {repos.isPending && (
          <p className="p-3 text-small text-fg-muted">{t("clone.loadingRepos")}</p>
        )}
        {repos.isError && (
          <p className="p-3 text-small text-danger" role="alert">
            {isIpcError(repos.error) ? repos.error.message : String(repos.error)}
          </p>
        )}
        {repos.data && shown.length === 0 && (
          <p className="p-3 text-small text-fg-muted">
            {query ? t("clone.noMatchingRepos") : t("clone.noRepos")}
          </p>
        )}
        {shown.map((r) => {
          const url = urlOf(r);
          const selected = picked === url;
          return (
            <button
              key={r.fullName}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onPick(url)}
              className={cn(
                "flex flex-col items-start gap-0.5 px-3 py-1.5 text-left focus-ring",
                selected ? "bg-selected" : "hover:bg-hover",
              )}
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="min-w-0 truncate text-fg">{r.fullName}</span>
                {r.private && (
                  <Lock
                    size={12}
                    className="shrink-0 text-fg-muted"
                    aria-label={t("clone.private")}
                  />
                )}
                {r.updated && (
                  <span className="ml-auto shrink-0 text-small text-fg-muted">
                    {relativeTime(Date.parse(r.updated) / 1000)}
                  </span>
                )}
              </span>
              {r.description && (
                <span className="w-full truncate text-small text-fg-muted">{r.description}</span>
              )}
            </button>
          );
        })}
      </div>
      <Checkbox checked={ssh} onCheckedChange={setSsh} label={t("clone.useSsh")} />
    </div>
  );
}
