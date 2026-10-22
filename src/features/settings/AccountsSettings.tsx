// Settings → Accounts: GitHub, GitLab and Bitbucket accounts, signed in with a personal
// access token, to list their repositories in the Clone dialog. Tokens stay with Git's
// credential helpers (src-tauri/src/hosting.rs); settings.json only names the accounts.

import { ExternalLink, LogOut, Plus } from "lucide-react";
import { useState } from "react";

import { useSettings } from "@/app/settings";
import { t } from "@/i18n";
import { ipc, isIpcError, type HostingAccount, type HostingProvider } from "@/ipc";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Input } from "@/ui/Input";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { toast } from "@/ui/Toast";

const PROVIDERS: HostingProvider[] = ["github", "gitlab", "bitbucket"];

/** Where to create a token, with the scopes Tylia needs filled in where the site allows it. */
function tokenPage(provider: HostingProvider, host: string): { url: string; opens: boolean } {
  switch (provider) {
    case "github":
      return host === "" || host === "github.com"
        ? {
            url: "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Tylia",
            opens: true,
          }
        : { url: `https://${host}/settings/tokens/new`, opens: false };
    case "gitlab":
      return host === "" || host === "gitlab.com"
        ? {
            url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=Tylia&scopes=read_api",
            opens: true,
          }
        : { url: `https://${host}/-/user_settings/personal_access_tokens`, opens: false };
    case "bitbucket":
      return { url: "https://id.atlassian.com/manage-profile/security/api-tokens", opens: true };
  }
}

function AddAccount({ onDone }: { onDone: () => void }) {
  const { settings, update } = useSettings();
  const [provider, setProvider] = useState<HostingProvider>("github");
  const [host, setHost] = useState("");
  const [login, setLogin] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = tokenPage(provider, host.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { account, saved } = await ipc.addHostingAccount(provider, host, login, token);
      const same = (a: HostingAccount) =>
        a.provider === account.provider && a.host === account.host && a.login === account.login;
      update({ hostingAccounts: [...settings.hostingAccounts.filter((a) => !same(a)), account] });
      toast({
        kind: "success",
        title: t("accounts.added", { name: account.name, host: account.host }),
        description: saved ? undefined : t("accounts.notSaved"),
      });
      onDone();
    } catch (err) {
      setError(isIpcError(err) ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-menu border border-line-subtle bg-panel p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <SegmentedControl
        aria-label={t("accounts.provider")}
        value={provider}
        onValueChange={(p) => setProvider(p as HostingProvider)}
        segments={PROVIDERS.map((p) => ({ value: p, label: t(`accounts.provider.${p}`) }))}
      />
      {provider !== "bitbucket" && (
        <label className="flex flex-col gap-1 text-small text-fg-secondary">
          {t("accounts.host")}
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={provider === "github" ? "github.com" : "gitlab.com"}
          />
        </label>
      )}
      {provider === "bitbucket" && (
        <label className="flex flex-col gap-1 text-small text-fg-secondary">
          {t("accounts.email")}
          <Input
            type="email"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-small text-fg-secondary">
        {t("accounts.token")}
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          className="font-code"
        />
      </label>
      <p className="text-small text-fg-muted">
        {t(`accounts.tokenHint.${provider}`)}{" "}
        {page.opens ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline focus-ring rounded-control"
            onClick={() => void ipc.openTokenPage(page.url)}
          >
            {t("accounts.createToken")}
            <ExternalLink size={12} aria-hidden />
          </button>
        ) : (
          <code className="font-code break-all text-fg-secondary" data-selectable>
            {page.url}
          </code>
        )}
      </p>
      {error && (
        <p className="text-small text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!token.trim()}>
          {t("accounts.signIn")}
        </Button>
      </div>
    </form>
  );
}

export function AccountsSettings() {
  const { settings, update } = useSettings();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<HostingAccount | null>(null);
  const accounts = settings.hostingAccounts;

  const signOut = async (account: HostingAccount) => {
    try {
      await ipc.removeHostingAccount(account);
    } catch (err) {
      toast({
        kind: "error",
        title: t("accounts.signOutFailed"),
        error: isIpcError(err) ? err : { message: String(err) },
      });
    }
    update({ hostingAccounts: accounts.filter((a) => a !== account) });
  };

  return (
    <div className="flex flex-col gap-3 py-3">
      <p className="text-small text-fg-secondary">{t("accounts.intro")}</p>
      {accounts.length === 0 && !adding && <p className="text-fg-muted">{t("accounts.empty")}</p>}
      {accounts.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-subtle rounded-menu border border-line-subtle">
          {accounts.map((account) => (
            <li
              key={`${account.provider}:${account.host}:${account.login}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-fg">{account.name}</span>
                <span className="truncate text-small text-fg-muted">
                  {t(`accounts.provider.${account.provider}`)} · {account.login} · {account.host}
                </span>
              </span>
              <Button icon={LogOut} onClick={() => setRemoving(account)}>
                {t("accounts.signOut")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddAccount onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button icon={Plus} onClick={() => setAdding(true)}>
            {t("accounts.add")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("accounts.signOutTitle", { name: removing?.name ?? "" })}
        consequence={t("accounts.signOutBody")}
        confirmLabel={t("accounts.signOut")}
        onConfirm={() => removing && void signOut(removing)}
      />
    </div>
  );
}
